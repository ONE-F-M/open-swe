import { FrappeProgrammerAgent } from "../programmer/programmer-agent.js";
import { MetricsLogger } from "../../utils/metrics-logger.js"; 
import { PlannerAgent } from "../planner/planner-agent.js";
import { ReviewerAgent } from "../reviewer/reviewer-agent.js";

// Result object returned after agent pipeline execution
export interface AgentExecutionResult {
    status: 'completed' | 'failed'; // Final status of the run
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
}

// Input parameters required to start the agent pipeline
interface RunAgentParams {
    issueNumber: number; // Issue/task number
    taskTitle: string;   // Task title
    taskDescription: string; // Task description
    targetRepository?: string | { owner: string; repo: string; branch?: string }; // Target repo info
    targetBranch?: string;     // Target branch name
    sandbox: any;              // Sandbox context for isolated execution
    config?: any;              // Optional config for agents
    autoAcceptPlan: boolean;   // Whether to auto-accept the generated plan
}

/**
 * Orchestrates the end-to-end agent pipeline for code migration and review.
 * 1. Generates a plan using PlannerAgent (LLM-powered)
 * 2. Executes each plan step using FrappeProgrammerAgent
 * 3. Reviews the changes using ReviewerAgent
 * 4. Logs metrics and returns a result object
 */
export async function runAgent(params: RunAgentParams): Promise<AgentExecutionResult> {
    const { taskDescription, sandbox, issueNumber, taskTitle } = params;
    // Defensive: ensure config object and thread_id are set for downstream agents
    let config = params.config ? { ...params.config } : {};
    if (!config.configurable) config.configurable = {};
    if (!config.configurable.thread_id || typeof config.configurable.thread_id !== 'string' || !config.configurable.thread_id.trim()) {
        config.configurable.thread_id = `thread_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    }

    // Metrics logger and state tracking for reporting
    const logger = new MetricsLogger(); 
    let finalMigrationLog = ""; 
    let finalTestResult = { exitCode: 1 };
    let filesModified: string[] = [];

    // Step 1: Generate a plan of steps to accomplish the task
    const planner = new PlannerAgent(sandbox, config);
    const initialContext = await planner.loadContext();

    // Normalize and validate targetRepository for downstream compatibility
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
    // Enforce that targetRepository is present and valid
    if (!targetRepositoryObj || !targetRepositoryObj.owner || !targetRepositoryObj.repo || !targetRepositoryObj.branch) {
        throw new Error("targetRepository (with owner, repo, and branch) must be provided in params for planner agent.");
    }

    // Step 2: Robust plan execution with routing logic
    const programmer = new FrappeProgrammerAgent(sandbox, sandbox?.siteName || "onefm");
    let plan = await planner.generatePlan(
        taskDescription,
        {
            githubIssueId: issueNumber,
            targetRepository: targetRepositoryObj,
            targetBranch: params.targetBranch,
        }
    );
    let state = { currentStep: 0, completed: false, failed: false, retries: 0 };
    const MAX_RETRIES = 2;
    while (!state.completed && !state.failed) {
        if (state.currentStep >= plan.length) {
            state.completed = true;
            break;
        }
        const step = plan[state.currentStep];
        try {
            const stepResult = await programmer.executeStep(step, initialContext);
            if (stepResult?.filesModified) { filesModified = stepResult.filesModified; }
            if (stepResult?.migrationLog) { finalMigrationLog = stepResult.migrationLog; }
            if (stepResult?.testResults) { finalTestResult = stepResult.testResults; }
            state.currentStep++;
            state.retries = 0;
        } catch (e: any) {
            if (state.retries < MAX_RETRIES) {
                state.retries++;
                console.log(`Step ${state.currentStep} failed, retrying (${state.retries}/${MAX_RETRIES})...`);
                continue;
            } else {
                // Optionally, re-plan if step is critical and failed
                if (step.critical && planner.canReplan) {
                    console.log(`Step ${state.currentStep} failed after retries, attempting to re-plan...`);
                    plan = await planner.generatePlan(taskDescription, {
                        githubIssueId: issueNumber,
                        targetRepository: targetRepositoryObj,
                        targetBranch: params.targetBranch,
                    });
                    state.currentStep = 0;
                    state.retries = 0;
                    continue;
                }
                state.failed = true;
                break;
            }
        }
    }
    if (state.failed) {
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
        console.log('Manager session ended with status: failed');
        return {
            status: metrics.status,
            migrationLog: metrics.migrationLog,
            testResults: metrics.testResults,
            filesModified: metrics.filesModified,
            issueNumber,
            taskTitle,
            taskDescription,
            installationToken: sandbox?.installationToken || process.env.GITHUB_TOKEN || "dummy-token",
            sandboxWorkDir: sandbox?.workDir || "/tmp/sandbox-workdir",
            repoOwner: (targetRepositoryObj && targetRepositoryObj.owner) || "unknown-owner",
            repoName: (targetRepositoryObj && targetRepositoryObj.repo) || "unknown-repo",
        };
    }

    // Step 3: Review the modified files using the ReviewerAgent
    const reviewer = new ReviewerAgent();
    const reviewPassed = await reviewer.review(filesModified, targetRepositoryObj, params.targetBranch);
    if (!reviewPassed) {
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
        console.log('Manager session ended with status: failed (review did not pass)');
        return {
            status: metrics.status,
            migrationLog: metrics.migrationLog,
            testResults: metrics.testResults,
            filesModified: metrics.filesModified,
            issueNumber,
            taskTitle,
            taskDescription,
            installationToken: sandbox?.installationToken || process.env.GITHUB_TOKEN,
            sandboxWorkDir: sandbox?.workDir || "/tmp/sandbox-workdir",
            repoOwner: (targetRepositoryObj && targetRepositoryObj.owner) || "samdanikouser",
            repoName: (targetRepositoryObj && targetRepositoryObj.repo) || "one_fm",
        };
    }

    // Step 4: If all steps and review pass, log metrics and return a successful result
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
    console.log('Manager session ended with status: completed');
    // Optionally update session state here if available
    // session.status = 'completed'; session.endedAt = new Date();
    return {
        status: metrics.status,
        migrationLog: metrics.migrationLog,
        testResults: metrics.testResults,
        filesModified: metrics.filesModified,
        issueNumber,
        taskTitle,
        taskDescription,
        installationToken: sandbox?.installationToken || process.env.GITHUB_TOKEN,
        sandboxWorkDir: sandbox?.workDir || "/tmp/sandbox-workdir",
        repoOwner: (targetRepositoryObj && targetRepositoryObj.owner) || "unknown-owner",
        repoName: (targetRepositoryObj && targetRepositoryObj.repo) || "unknown-repo",
    };
}
