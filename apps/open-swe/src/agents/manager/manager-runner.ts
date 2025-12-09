import { FrappeProgrammerAgent } from "../programmer/programmer-agent.js";
import { MetricsLogger } from "../../utils/metrics-logger.js";
import { PlannerAgent } from "../planner/planner-agent.js";
import { ReviewerAgent } from "../reviewer/reviewer-agent.js";
import pLimit from "p-limit";
import { LRUCache } from "lru-cache";
import fs from 'fs';
import path from 'path';
import { CheckpointManager, CheckpointState } from './checkpoint-manager.js';

// Result object returned after agent pipeline execution
export interface AgentExecutionResult {
    status: 'completed' | 'failed' | 'partial'; // Final status of the run
    migrationLog: string;           // Log output from migration/code changes
    testResults: { exitCode: number; output?: string }; // Test execution results
    filesModified: string[];        // List of files modified by the agent
    issueNumber: number;            // Associated issue/task number
    taskTitle: string;              // Title of the task/issue
    taskDescription: string;        // Description of the task/issue
    installationToken: string;      // Token for repo installation (for PRs, etc.)
    sandboxWorkDir: string;         // Working directory for sandboxed execution
    repoOwner: string;              // GitHub repo owner
    repoName: string;               // GitHub repo name
    metrics?: {
        totalSteps: number;
        successfulSteps: number;
        failedSteps: number;
        totalTokensUsed: number;
        estimatedCost: number;
        executionTimeMs: number;
    };
    executionId?: string; // <-- Added for checkpointing support
}

// Input parameters required to start the agent pipeline
interface RunAgentParams {
    issueNumber: number;
    taskTitle: string;
    taskDescription: string;
    targetRepository?: string | { owner: string; repo: string; branch?: string };
    targetBranch?: string;
    sandbox: any;
    config?: any;
    autoAcceptPlan: boolean;
    maxRetries?: number;
    enableParallelExecution?: boolean;
    enableIncrementalReview?: boolean;
    resumeFromCheckpoint?: boolean;
    executionId?: string;
    checkpointInterval?: number;
    maxCheckpointAge?: number;
}


// Caching layers
const contextCache = new LRUCache<string, any>({ max: 50, ttl: 1000 * 60 * 15 });
const planCache = new LRUCache<string, any[]>({ max: 100, ttl: 1000 * 60 * 30 });
const stepResultCache = new LRUCache<string, any>({ max: 200, ttl: 1000 * 60 * 60 }); // 1 hour
// const reviewCache = new LRUCache<string, boolean>({ max: 100, ttl: 1000 * 60 * 45 }); // 45 min (unused)

function getCachedStepResult(step: any, context: any): any | null {
    const stepKey = `${JSON.stringify(step)}-${JSON.stringify(context).slice(0, 200)}`;
    return stepResultCache.get(stepKey);
}

function setCachedStepResult(step: any, context: any, result: any): void {
    const stepKey = `${JSON.stringify(step)}-${JSON.stringify(context).slice(0, 200)}`;
    stepResultCache.set(stepKey, result);
}


function optimizeParallelGroups(steps: any[]): any[][] {
    const groups: any[][] = [];
    const dependencyMap = new Map<string, string[]>();
    steps.forEach(step => {
        const deps: string[] = [];
        if (step.dependsOn) deps.push(...step.dependsOn);
        if (step.requires) deps.push(...step.requires);
        dependencyMap.set(step.id || JSON.stringify(step), deps);
    });
    const processed = new Set<string>();
    const available = [...steps];
    while (available.length > 0) {
        const currentBatch: any[] = [];
        const remaining: any[] = [];
        for (const step of available) {
            const stepId = step.id || JSON.stringify(step);
            const deps = dependencyMap.get(stepId) || [];
            if (deps.every(dep => processed.has(dep))) {
                currentBatch.push(step);
                processed.add(stepId);
            } else {
                remaining.push(step);
            }
        }
        if (currentBatch.length > 0) {
            const maxBatchSize = 4;
            for (let i = 0; i < currentBatch.length; i += maxBatchSize) {
                groups.push(currentBatch.slice(i, i + maxBatchSize));
            }
        }
        available.splice(0, available.length, ...remaining);
        if (currentBatch.length === 0 && remaining.length > 0) {
            groups.push([remaining.shift()!]);
        }
    }
    return groups;
}

interface TokenBudget {
    maxTokens: number;
    usedTokens: number;
    reserveTokens: number;
}

class TokenManager {
    private budget: TokenBudget;
    constructor(maxTokens: number = 100000) {
        this.budget = {
            maxTokens,
            usedTokens: 0,
            reserveTokens: maxTokens * 0.1
        };
    }
    canExecuteStep(estimatedTokens: number): boolean {
        return (this.budget.usedTokens + estimatedTokens) <= (this.budget.maxTokens - this.budget.reserveTokens);
    }
    recordUsage(tokens: number): void {
        this.budget.usedTokens += tokens;
    }
    getRemainingBudget(): number {
        return this.budget.maxTokens - this.budget.usedTokens - this.budget.reserveTokens;
    }
}

function validateAndOptimizePlan(steps: any[]): any[] {
    const seen = new Set<string>();
    const optimized: any[] = [];
    for (const step of steps) {
        const stepKey = JSON.stringify(step);
        if (!seen.has(stepKey)) {
            seen.add(stepKey);
            optimized.push(step);
        }
    }
    return optimized;
}




async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries: number = 3, stepName: string = "operation"): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            if (attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw new Error(`${stepName} failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
}

/**
 * Orchestrates the end-to-end agent pipeline for code migration and review.
 * 1. Generates a plan using PlannerAgent (LLM-powered)
 * 2. Executes each plan step using FrappeProgrammerAgent
 * 3. Reviews the changes using ReviewerAgent
 * 4. Logs metrics and returns a result object
 */
export async function runAgentWithCheckpointing(params: RunAgentParams): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    const executionId = params.executionId || `exec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const checkpointManager = new CheckpointManager(params.sandbox?.workDir || '/tmp');
    // --- Token Management ---
    const tokenManager = new TokenManager(100000); // Set maxTokens as needed

    let {
        taskDescription,
        sandbox,
        issueNumber,
        taskTitle,
        maxRetries = 2,
        enableParallelExecution = true,
        enableIncrementalReview = false,
        resumeFromCheckpoint = true,
        checkpointInterval = 1
    } = params;

    let config = params.config ? { ...params.config } : {};
    if (!config.configurable) config.configurable = {};
    if (!config.configurable.thread_id || typeof config.configurable.thread_id !== 'string' || !config.configurable.thread_id.trim()) {
        config.configurable.thread_id = `thread_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    }

    const logger = new MetricsLogger();
    // State variables for checkpointing
    let finalMigrationLog = "";
    let finalTestResult = { exitCode: 1 };
    let filesModified: string[] = [];
    let totalTokensUsed = 0;
    let successfulSteps = 0;
    let failedSteps = 0;
    let currentGroupIndex = 0;
    let currentStepIndex = 0;
    let planSteps: any[] = [];
    let initialContext: any = null;

    // Parse target repository
    let targetRepositoryObj: { owner: string; repo: string; branch?: string } | undefined = undefined;
    if (typeof params.targetRepository === "string") {
        const [owner, repo] = params.targetRepository.split("/");
        targetRepositoryObj = { owner, repo };
    } else if (params.targetRepository) {
        targetRepositoryObj = { ...params.targetRepository };
    }
    if (targetRepositoryObj && params.targetBranch) {
        targetRepositoryObj.branch = params.targetBranch;
    }
    if (!targetRepositoryObj || !targetRepositoryObj.owner || !targetRepositoryObj.repo || !targetRepositoryObj.branch) {
        throw new Error("targetRepository (with owner, repo, and branch) must be provided.");
    }

    // --- CHECKPOINT RECOVERY ---
    let checkpoint: CheckpointState | null = null;
    if (resumeFromCheckpoint) {
        checkpoint = await checkpointManager.loadCheckpoint(executionId);
        if (checkpoint) {
            const checkpointAge = Date.now() - checkpoint.timestamp;
            const maxAge = (params.maxCheckpointAge || 60) * 60 * 1000;
            if (checkpointAge > maxAge) {
                console.log(`Checkpoint is too old (${Math.round(checkpointAge / 60000)} minutes), starting fresh`);
                checkpoint = null;
            } else {
                console.log(`Resuming from checkpoint at group ${checkpoint.currentGroupIndex}, step ${checkpoint.currentStepIndex}`);
                planSteps = checkpoint.planSteps;
                filesModified = checkpoint.filesModified;
                finalMigrationLog = checkpoint.migrationLog;
                finalTestResult = checkpoint.testResults;
                totalTokensUsed = checkpoint.totalTokensUsed;
                successfulSteps = checkpoint.successfulSteps;
                failedSteps = checkpoint.failedSteps;
                currentGroupIndex = checkpoint.currentGroupIndex;
                currentStepIndex = checkpoint.currentStepIndex;
                initialContext = checkpoint.contextSnapshot;
                config = checkpoint.config;
            }
        }
    }

    // --- PLAN GENERATION & CONTEXT LOADING (with checkpoint resume) ---
    try {
        if (!checkpoint) {
            // Plan generation (cached)
            const planCacheKey = `${issueNumber}-${taskDescription.slice(0, 100)}`;
            let cachedPlan = planCache.get(planCacheKey);
            if (cachedPlan) {
                console.log(`Plan cache hit for key: ${planCacheKey}`);
            } else {
                console.log(`Plan cache miss for key: ${planCacheKey}`);
            }
            if (!Array.isArray(cachedPlan)) {
                const planner = new PlannerAgent(sandbox, config);
                cachedPlan = await retryWithBackoff(
                    async () => planner.generatePlan(taskDescription, {
                        githubIssueId: issueNumber,
                        targetRepository: targetRepositoryObj,
                        targetBranch: params.targetBranch,
                    }),
                    maxRetries,
                    "Plan Generation"
                );
                planCache.set(planCacheKey, cachedPlan);
            }
            planSteps = validateAndOptimizePlan(cachedPlan || []);

            // Context loading (cached)
            const contextCacheKey = `${targetRepositoryObj.owner}-${targetRepositoryObj.repo}-${targetRepositoryObj.branch}`;
            let cachedContext = contextCache.get(contextCacheKey);
            if (cachedContext) {
                console.log(`Context cache hit for key: ${contextCacheKey}`);
            } else {
                console.log(`Context cache miss for key: ${contextCacheKey}`);
            }
            if (!cachedContext) {
                const planner = new PlannerAgent(sandbox, config);
                cachedContext = await planner.loadContext();
                contextCache.set(contextCacheKey, cachedContext);
            }
            initialContext = cachedContext;
        }
        // Save initial checkpoint after plan/context
        await checkpointManager.saveCheckpoint(executionId, {
            executionId,
            issueNumber,
            taskTitle,
            taskDescription,
            planSteps,
            completedStepIndices: [],
            completedGroupIndices: [],
            currentGroupIndex,
            currentStepIndex,
            filesModified,
            migrationLog: finalMigrationLog,
            testResults: finalTestResult,
            totalTokensUsed,
            successfulSteps,
            failedSteps,
            timestamp: Date.now(),
            contextSnapshot: initialContext,
            targetRepository: targetRepositoryObj,
            config
        });
    } catch (error) {
        const executionTime = Date.now() - startTime;
        const estimatedCost = (totalTokensUsed / 1000) * 0.06;
        const metrics = await logger.logFinalMetrics({
            status: 'failed',
            migrationLog: finalMigrationLog,
            testResults: finalTestResult,
            filesModified: filesModified,
            issueNumber,
            taskTitle,
            taskDescription,
            migrationsRun: finalMigrationLog ? 1 : 0,
            testSuccess: false
        });
        return {
            ...metrics,
            installationToken: sandbox?.installationToken || process.env.GITHUB_TOKEN || "dummy-token",
            sandboxWorkDir: sandbox?.workDir || "/tmp/sandbox-workdir",
            repoOwner: targetRepositoryObj.owner,
            repoName: targetRepositoryObj.repo,
            metrics: {
                totalSteps: planSteps.length,
                successfulSteps,
                failedSteps,
                totalTokensUsed,
                estimatedCost,
                executionTimeMs: executionTime
            }
        };
    }

    // --- STEP GROUP EXECUTION WITH CHECKPOINTING ---
    const programmer = new FrappeProgrammerAgent(sandbox, sandbox?.siteName || "onefm");
    const reviewer = enableIncrementalReview ? new ReviewerAgent() : null;
    const stepGroups = enableParallelExecution ? optimizeParallelGroups(planSteps) : planSteps.map(s => [s]);
    for (let groupIdx = currentGroupIndex; groupIdx < stepGroups.length; groupIdx++) {
        const group = stepGroups[groupIdx];
        const limit = pLimit(3);
        const groupResults = await Promise.allSettled(
            group.map((step, stepIdx) =>
                limit(async () => {
                    // Skip already completed steps when resuming
                    if (checkpoint && groupIdx === currentGroupIndex && stepIdx < currentStepIndex) {
                        console.log(`Step [${stepIdx}] in group [${groupIdx}] skipped due to checkpoint resume.`);
                        return { status: 'skipped', step };
                    }
                    // --- Step Result Cache: Check before execution ---
                    const cachedResult = getCachedStepResult(step, initialContext);
                    if (cachedResult) {
                        console.log(`Step cache hit for step [${stepIdx}] in group [${groupIdx}].`);
                        return cachedResult;
                    } else {
                        console.log(`Step cache miss for step [${stepIdx}] in group [${groupIdx}].`);
                    }
                    // --- Token Budget Enforcement ---
                    const estimatedTokens = step.estimatedTokens || 2000; // Default estimate if not provided
                    if (!tokenManager.canExecuteStep(estimatedTokens)) {
                        console.warn(`Token budget exceeded before executing step [${stepIdx}] in group [${groupIdx}]. Skipping step.`);
                        return { status: 'skipped', reason: 'token budget exceeded', step };
                    }
                    // Execute step if not cached
                    return retryWithBackoff(
                        async () => {
                            const result = await programmer.executeStep(step, initialContext);
                            // --- Step Result Cache: Store successful results ---
                            if (result && typeof result === 'object' && 'status' in result && result.status === 'success') {
                                setCachedStepResult(step, initialContext, result);
                                console.log(`Step result cached for step [${stepIdx}] in group [${groupIdx}].`);
                            }
                            // --- Token Usage Logging ---
                            if (
                                result &&
                                typeof result === 'object' &&
                                'tokensUsed' in result &&
                                typeof result.tokensUsed === 'number' &&
                                !isNaN(result.tokensUsed)
                            ) {
                                tokenManager.recordUsage(result.tokensUsed);
                                console.log(`Step [${stepIdx}] in group [${groupIdx}] used ${result.tokensUsed} tokens. Remaining: ${tokenManager.getRemainingBudget()}`);
                            }
                            currentStepIndex = stepIdx + 1;
                            return { ...result, step, stepIndex: stepIdx };
                        },
                        maxRetries,
                        `Step: ${step.description || step.type}`
                    );
                })
            )
        );
        for (let resultIdx = 0; resultIdx < groupResults.length; resultIdx++) {
            const result = groupResults[resultIdx];
            if (result.status === 'fulfilled') {
                const stepResult = result.value;
                if (stepResult && typeof stepResult === 'object' && 'status' in stepResult && stepResult.status !== 'skipped') {
                    successfulSteps++;
                    if ('filesModified' in stepResult && stepResult.filesModified) {
                        filesModified = [...new Set([...filesModified, ...stepResult.filesModified])];
                    }
                    if ('migrationLog' in stepResult && stepResult.migrationLog) {
                        finalMigrationLog += stepResult.migrationLog + "\n";
                    }
                    if ('testResults' in stepResult && stepResult.testResults) {
                        finalTestResult = stepResult.testResults;
                    }
                    if ('tokensUsed' in stepResult && typeof stepResult.tokensUsed === 'number' && !isNaN(stepResult.tokensUsed)) {
                        totalTokensUsed += stepResult.tokensUsed;
                    }
                }
            } else {
                failedSteps++;
            }
        }
        // Save checkpoint after each group
        if (groupIdx % checkpointInterval === 0 || groupIdx === stepGroups.length - 1) {
            const checkpointState: CheckpointState = {
                executionId,
                issueNumber,
                taskTitle,
                taskDescription,
                planSteps,
                completedStepIndices: [],
                completedGroupIndices: Array.from({ length: groupIdx + 1 }, (_, i) => i),
                currentGroupIndex: groupIdx + 1,
                currentStepIndex: 0,
                filesModified,
                migrationLog: finalMigrationLog,
                testResults: finalTestResult,
                totalTokensUsed,
                successfulSteps,
                failedSteps,
                timestamp: Date.now(),
                contextSnapshot: initialContext,
                targetRepository: targetRepositoryObj,
                config
            };
            await checkpointManager.saveCheckpoint(executionId, checkpointState);
        }
        // Incremental review
        if (reviewer && filesModified.length > 0) {
            const reviewPassed = await reviewer.review(
                filesModified,
                targetRepositoryObj,
                params.targetBranch
            );
            if (!reviewPassed) {
                throw new Error("Incremental review failed");
            }
        }
        currentStepIndex = 0;
    }

    // --- FINAL REVIEW, CLEANUP, AND RETURN ---
    if (!enableIncrementalReview) {
        const reviewer = new ReviewerAgent();
        const reviewPassed = await retryWithBackoff(
            async () => reviewer.review(filesModified, targetRepositoryObj, params.targetBranch),
            1,
            "Final Review"
        );
        if (!reviewPassed) {
            const executionTime = Date.now() - startTime;
            const estimatedCost = (totalTokensUsed / 1000) * 0.06;
            const metrics = await logger.logFinalMetrics({
                status: 'failed',
                migrationLog: finalMigrationLog,
                testResults: finalTestResult,
                filesModified: filesModified,
                issueNumber,
                taskTitle,
                taskDescription,
                migrationsRun: finalMigrationLog ? 1 : 0,
                testSuccess: false
            });
            return {
                ...metrics,
                installationToken: sandbox?.installationToken || process.env.GITHUB_TOKEN,
                sandboxWorkDir: sandbox?.workDir || "/tmp/sandbox-workdir",
                repoOwner: targetRepositoryObj.owner,
                repoName: targetRepositoryObj.repo,
                executionId,
                metrics: {
                    totalSteps: planSteps.length,
                    successfulSteps,
                    failedSteps,
                    totalTokensUsed,
                    estimatedCost,
                    executionTimeMs: executionTime
                }
            };
        }
    }
    await checkpointManager.deleteCheckpoint(executionId);
    const executionTime = Date.now() - startTime;
    const estimatedCost = (totalTokensUsed / 1000) * 0.06;
    const metrics = await logger.logFinalMetrics({
        status: 'completed',
        migrationLog: finalMigrationLog,
        testResults: finalTestResult,
        filesModified: filesModified,
        issueNumber,
        taskTitle,
        taskDescription,
        migrationsRun: finalMigrationLog ? 1 : 0,
        testSuccess: finalTestResult.exitCode === 0
    });
    return {
        ...metrics,
        installationToken: sandbox?.installationToken || process.env.GITHUB_TOKEN,
        sandboxWorkDir: sandbox?.workDir || "/tmp/sandbox-workdir",
        repoOwner: targetRepositoryObj.owner,
        repoName: targetRepositoryObj.repo,
        executionId,
        metrics: {
            totalSteps: planSteps.length,
            successfulSteps,
            failedSteps,
            totalTokensUsed,
            estimatedCost,
            executionTimeMs: executionTime
        }
    };
}

// --- Checkpointing: Resume from checkpoint ---

export async function resumeAgent(executionId: string, sandbox: any): Promise<AgentExecutionResult> {
    const checkpointManager = new CheckpointManager(sandbox?.workDir || '/tmp');
    const checkpoint = await checkpointManager.loadCheckpoint(executionId);
    if (!checkpoint) {
        throw new Error(`No checkpoint found for execution ID: ${executionId}`);
    }
    console.log(`Resuming execution ${executionId} from group ${checkpoint.currentGroupIndex}`);
    const resumeParams: RunAgentParams = {
        issueNumber: checkpoint.issueNumber,
        taskTitle: checkpoint.taskTitle,
        taskDescription: checkpoint.taskDescription,
        targetRepository: checkpoint.targetRepository,
        targetBranch: checkpoint.targetRepository.branch,
        sandbox,
        config: checkpoint.config,
        autoAcceptPlan: true,
        resumeFromCheckpoint: true,
        executionId: executionId
    };
    return runAgentWithCheckpointing(resumeParams);
}

// --- Helper: List available checkpoints ---
export async function listCheckpoints(workDir: string): Promise<Array<{executionId: string, timestamp: Date, status: string}>> {
    const checkpointManager = new CheckpointManager(workDir);
    const checkpointDir = path.join(workDir, '.checkpoints');
    if (!fs.existsSync(checkpointDir)) {
        return [];
    }
    const files = await fs.promises.readdir(checkpointDir);
    const checkpoints: Array<{executionId: string, timestamp: Date, status: string}> = [];
    for (const file of files) {
        if (file.endsWith('.json')) {
            try {
                const checkpoint = await checkpointManager.loadCheckpoint(file.replace('.json', ''));
                if (checkpoint) {
                    checkpoints.push({
                        executionId: checkpoint.executionId,
                        timestamp: new Date(checkpoint.timestamp),
                        status: 'unknown' // status property does not exist on CheckpointState
                    });
                }
            } catch (e) {
                console.error(`Error loading checkpoint ${file}:`, e);
            }
        }
    }
    return checkpoints;
}
