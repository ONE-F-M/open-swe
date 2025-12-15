// src/agent/manager-runner.ts
import { FrappeProgrammerAgent } from "./programmer-agent.js";
import { MetricsLogger } from "../utils/metrics-logger.js"; 
import { PlannerAgent } from "./planner-agent.js";
import { ReviewerAgent } from "./reviewer-agent.js";

// --- Agent Result Interface (Contract for the Delivery Orchestrator) ---
interface AgentExecutionResult {
    status: 'completed' | 'failed';
    migrationLog: string;
    testResults: { exitCode: number; output?: string };
    filesModified: string[];
    issueNumber: number;        
    taskTitle: string;          
    taskDescription: string;    
}

// These are the input parameters required to start the run.
interface RunAgentParams {
    issueNumber: number;
    taskTitle: string;
    taskDescription: string;
    targetRepository?: string | { owner: string; repo: string; branch?: string };
    targetBranch?: string;     
    sandbox: any;
    config?: any;
    autoAcceptPlan: boolean;    
}

/**
 * Runs the simplified end-to-end agent pipeline.
 * This function acts as the execution entry point for the LangGraph state machine.
 */
export async function runAgent(params: RunAgentParams): Promise<AgentExecutionResult> {
    const { taskDescription, sandbox, issueNumber, taskTitle } = params;
    // Defensive config/configurable propagation for checkpointer
    let config = params.config ? { ...params.config } : {};
    if (!config.configurable) config.configurable = {};
    if (!config.configurable.thread_id || typeof config.configurable.thread_id !== 'string' || !config.configurable.thread_id.trim()) {
        config.configurable.thread_id = `thread_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    }

    // --- 1. Initialize Metrics Logger and State ---
    const logger = new MetricsLogger(); 
    let finalMigrationLog = ""; 
    let finalTestResult = { exitCode: 1 };
    let filesModified: string[] = [];

    // --- Phase 1: Planning (LLM Call) ---
    // ...existing code...
    const planner = new PlannerAgent(sandbox, config);
    const initialContext = await planner.loadContext();

    // Ensure targetRepository is always an object { owner, repo, branch }
    let targetRepositoryObj: { owner: string; repo: string; branch?: string } | undefined = undefined;
    if (typeof params.targetRepository === "string") {
        const [owner, repo] = params.targetRepository.split("/");
        targetRepositoryObj = { owner, repo };
    } else if (params.targetRepository) {
        targetRepositoryObj = { ...params.targetRepository };
    }
    // Always set branch if targetBranch is provided
    if (targetRepositoryObj && params.targetBranch) {
        targetRepositoryObj.branch = params.targetBranch;
    }

    // Pass githubIssueId and always pass targetRepository for downstream graph state
    const planSteps = await planner.generatePlan(
        taskDescription,
        {
            githubIssueId: issueNumber,
            // Defensive: always pass targetRepository as object if possible
            targetRepository: targetRepositoryObj,
            targetBranch: params.targetBranch,
            // Do NOT nest config/configurable here; PlannerAgent already puts configurable at root
        }
    );

    // --- Phase 2: Execution (Programmer) ---
    const programmer = new FrappeProgrammerAgent(sandbox);

    try {
        for (const step of planSteps) {
            // FIX: If planSteps is empty (mock planner error), we exit gracefully.
            if (step.actionType === 'MODIFY_CODE' || step.actionType === 'VALIDATE_TEST') {
                const stepResult = await programmer.executeStep(step, initialContext); 
                
                // Collect results from the programmer's run
                if (stepResult.filesModified) { filesModified = stepResult.filesModified; }
                if (stepResult.migrationLog) { finalMigrationLog = stepResult.migrationLog; }
                if (stepResult.testResults) { finalTestResult = stepResult.testResults; }
            }
        }
    } catch (e: any) {
        console.error(`[PROGRAMMER ERROR] Task failed during execution: ${e.message}`);
        
        // --- Log Metrics on Failure ---
        const metrics = await logger.logFinalMetrics({
            status: 'failed',
            migrationLog: finalMigrationLog || "Migration handler was not run or failed to report log.",
            testResults: finalTestResult,
            filesModified: filesModified,
            issueNumber,
            taskTitle,
            taskDescription,
            migrationsRun: finalMigrationLog ? 1 : 0, 
            testSuccess: false 
        });

        // Return failure status using the generated metrics data
        return {
            status: metrics.status,
            migrationLog: metrics.migrationLog,
            testResults: metrics.testResults,
            filesModified: metrics.filesModified,
            issueNumber,
            taskTitle,
            taskDescription,
        };
    }

    // --- Phase 3: Review (LLM Call) ---
    const reviewer = new ReviewerAgent();
    // NOTE: In production, this calls the LLM to review code quality.
    // Always pass targetRepository and branch to reviewer for downstream graph nodes
    const reviewPassed = await reviewer.review(filesModified, targetRepositoryObj, params.targetBranch);

    if (!reviewPassed) {
        console.warn("[MANAGER] Review failed. Code quality checks require iteration.");
        
        // --- Log Metrics on Review Failure ---
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

        return { status: metrics.status, migrationLog: metrics.migrationLog, testResults: metrics.testResults, filesModified: metrics.filesModified, issueNumber, taskTitle, taskDescription };
    }

    // --- Final Status (SUCCESS) ---
    // --- Log Metrics on Success ---
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
        status: metrics.status,
        migrationLog: metrics.migrationLog,
        testResults: metrics.testResults,
        filesModified: metrics.filesModified,
        issueNumber,
        taskTitle,
        taskDescription,
    };
}
