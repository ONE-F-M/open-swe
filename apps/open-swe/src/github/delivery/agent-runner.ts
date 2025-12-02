import { FrappeGitHubAdapter } from "../frappe-github-adapter.js";
import { FrappeRepoConfig } from "../config/frappe-repos.js";
import { runAgent } from "../../agents/manager-runner.js";
import type { AgentExecutionResult as AgentRunResult } from "../../agents/manager-runner.js";

export class AgentDeliveryOrchestrator {
    private adapter!: FrappeGitHubAdapter;
    private config: FrappeRepoConfig;
    private TARGET_BRANCH_BASE = "agent-fix/";

    constructor(config: FrappeRepoConfig) {
        this.config = config;
    }
    async runFullPipeline(task: {
        issueNumber: number;
        taskTitle: string;
        taskDescription: string;
        targetRepository?: string | { owner: string; repo: string; branch?: string };
        targetBranch?: string;
        [key: string]: any;
    }): Promise<void> {
        const sandboxMock = {} as any;
        let targetRepositoryObj: { owner: string; repo: string; branch?: string };
        const [defaultOwner, defaultRepo] = this.config.customAppRepo.split('/');

        if (typeof task.targetRepository === "string") {
            const [owner, repo] = task.targetRepository.split("/");
            targetRepositoryObj = { owner: owner || defaultOwner, repo: repo || defaultRepo };
        } else if (task.targetRepository) {
            targetRepositoryObj = {
                owner: task.targetRepository.owner || defaultOwner,
                repo: task.targetRepository.repo || defaultRepo,
                branch: task.targetRepository.branch
            };
        } else {
            targetRepositoryObj = { owner: defaultOwner, repo: defaultRepo };
        }
        if (task.targetBranch) {
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

        this.adapter = new FrappeGitHubAdapter({
            installationToken: agentResult.installationToken,
            sandboxWorkDir: agentResult.sandboxWorkDir,
            repoOwner: agentResult.repoOwner,
            repoName: agentResult.repoName,
        }, this.config);

        if (agentResult.status === 'completed') {
            await this.handleSuccessfulDelivery(agentResult);
        } else {
            await this.handleFailedDelivery(agentResult);
        }
    }

    private async handleSuccessfulDelivery(result: AgentRunResult): Promise<void> {
        console.log("[DELIVERY] Attempting final Git push and PR creation.");
        const branchName = this.TARGET_BRANCH_BASE + `issue-${result.issueNumber}`;
        const commitMessage = `feat: ${result.taskTitle} [Ref: #${result.issueNumber}]`;
        await this.adapter.setupCustomAppRepo();
        const committed = await this.adapter.commitAndBranch(branchName, commitMessage);
        if (committed) {
            const prBody = `## 🤖 Agent Execution Report (Issue #${result.issueNumber})\n\n` +
                `✅ **Status:** COMPLETED\n` +
                `🛠️ **Files Modified:** ${result.filesModified.join(', ')}\n` +
                `🛡️ **Migration Status:** Successful (Log: ${result.migrationLog || 'N/A'})\n` +
                `🧪 **Test Results:** Passed (Exit Code ${result.testResults.exitCode})\n\n` +
                `--- \n\n` +
                `Review the changes and merge if tests pass in CI.`;
            const prUrl = await this.adapter.createPullRequest(branchName, result.taskTitle, prBody);
            await this.adapter.createIssueComment(
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
        const errorLog = result.migrationLog || result.testResults.output || JSON.stringify(result.testResults);
        const errorMessage = `❌ Task failed during execution (Issue #${result.issueNumber}). \n            **Last Test Exit Code:** ${result.testResults.exitCode}\n            **Error Log/Details:** \`\`\`\n${errorLog}\n\`\`\``;
        await this.adapter.createIssueComment(
            result.issueNumber,
            errorMessage
        );
    }
}