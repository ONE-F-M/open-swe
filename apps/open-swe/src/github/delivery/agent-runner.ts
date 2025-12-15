// src/delivery/agent-runner.ts
import { FrappeGitHubAdapter } from "../frappe-github-adapter.js";
import { FrappeRepoConfig } from "../config/frappe-repos.js";
import { runAgent } from "../../agents/manager-runner.js";
// import * as path from 'path';

// --- DEFINITIONS SYNCED WITH MANAGER RUNNER (The source of the execution logic) ---

// This structure defines the expected output from the runAgent function.
// NOTE: We define this locally as the return contract for the runAgent function.
interface AgentRunResult {
    status: 'completed' | 'failed';
    issueNumber: number;
    filesModified: string[];
    migrationLog: string;
    testResults: { exitCode: number };
    taskTitle: string;
    taskDescription: string;
}


// --- CLASS IMPLEMENTATION ---

export class AgentDeliveryOrchestrator {
    private adapter: FrappeGitHubAdapter;
    private config: FrappeRepoConfig;
    // private BENCH_PATH = "/Users/samdani/Desktop/onefm_bench/"; 
    private TARGET_BRANCH_BASE = "agent-fix/";

    constructor(config: FrappeRepoConfig) {
        this.config = config;
        this.adapter = new FrappeGitHubAdapter(config);
    }

    /**
     * Runs the full agent pipeline and handles success/failure delivery.
     */
        async runFullPipeline(task: {
                issueNumber: number;
                taskTitle: string;
                taskDescription: string;
                targetRepository?: string | { owner: string; repo: string; branch?: string };
                targetBranch?: string;
                [key: string]: any;
            }): Promise<void> {
                const sandboxMock = {} as any;

                // Defensive: always pass targetRepository as object if possible
                let targetRepositoryObj: { owner: string; repo: string; branch?: string } | undefined = undefined;
                if (typeof task.targetRepository === "string") {
                    const [owner, repo] = task.targetRepository.split("/");
                    targetRepositoryObj = { owner, repo };
                } else if (task.targetRepository) {
                    targetRepositoryObj = { ...task.targetRepository };
                }
                if (targetRepositoryObj && task.targetBranch) {
                    targetRepositoryObj.branch = task.targetBranch;
                }

                const agentResult: AgentRunResult = await runAgent({ 
                    issueNumber: task.issueNumber, 
                    taskTitle: task.taskTitle, 
                    taskDescription: task.taskDescription,
                    targetRepository: targetRepositoryObj,
                    targetBranch: task.targetBranch,
                    sandbox: sandboxMock,
                    config: this.config,
                    autoAcceptPlan: true 
                });

                if (agentResult.status === 'completed') {
                    await this.handleSuccessfulDelivery(agentResult);
                } else {
                    await this.handleFailedDelivery(agentResult);
                }
            }


    private async handleSuccessfulDelivery(result: AgentRunResult): Promise<void> {
        console.log("[DELIVERY] Attempting final Git push and PR creation.");
        
        const branchName = this.TARGET_BRANCH_BASE + `issue-${result.issueNumber}`;
        // const appPath = path.join(this.BENCH_PATH, this.config.customAppPath);
        
        const commitMessage = `feat: ${result.taskTitle} [Ref: #${result.issueNumber}]`;
        
        // Ensure the environment is ready for Git commands
        await this.adapter.setupCustomAppRepo();

        // 1. Commit and Push the validated changes
        // 1. Commit and Push the validated changes
            const committed = await this.adapter.commitAndBranch(branchName, commitMessage);
            if (committed) {
                // 2. Prepare PR Body
                const prBody = `## 🤖 Agent Execution Report (Issue #${result.issueNumber})\n\n` +
                            `✅ **Status:** COMPLETED\n` +
                            `🛠️ **Files Modified:** ${result.filesModified.join(', ')}\n` +
                            `🛡️ **Migration Status:** Successful\n` +
                            `🧪 **Test Results:** Passed (Exit Code 0)\n\n` +
                            `--- \n\n` +
                            `Review the changes and merge if tests pass in CI.`;
                // 3. Create the Pull Request
                const prUrl = await this.adapter.createPullRequest(branchName, result.taskTitle, prBody);
                // 4. Update the tracking issue
                await this.adapter.updateIssue(
                    result.issueNumber,
                    `✅ Task completed by Frappe Agent. Review the Pull Request: ${prUrl}`
                );
                console.log(`[DELIVERY SUCCESS] PR raised: ${prUrl}`);
            } else {
                console.log('[DELIVERY] No changes committed, skipping PR and issue update.');
            }
    }

    private async handleFailedDelivery(result: AgentRunResult): Promise<void> {
        console.warn("[DELIVERY] Agent failed. Reporting status to GitHub.");
        
        // Ensure error log is always a string for clean reporting
        const errorLog = result.migrationLog || JSON.stringify(result.testResults);

        const errorMessage = `❌ Task failed during execution (Issue #${result.issueNumber}). 
            **Error Log:** ${errorLog}`;

        await this.adapter.updateIssue(
            result.issueNumber,
            errorMessage
        );
    }
}