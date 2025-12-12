// src/github/label-handler.ts
import { FrappeGitHubAdapter } from "./frappe-github-adapter.js";

// --- Agent Execution Interface (Simulated) ---
interface AgentConfig {
    mode: 'standard' | 'auto' | 'max';
    requiresPlanApproval: boolean;
    model: string;
}

/** * Simulates the launch of the core agent workflow.
 */
async function launchFrappeAgent(params: { issueNumber: number; description: string; config: AgentConfig }): Promise<void> {
    console.log(`[AGENT MANAGER] Launching agent for Issue #${params.issueNumber}...`);
    console.log(`[AGENT MANAGER] Mode: ${params.config.mode}, Model: ${params.config.model}`);
    
    // In a real scenario, this would be: 
    // await ManagerAgent.run({ taskId: params.issueNumber, prompt: params.description });
    
    // For this POC, this simulates the agent running its full E2E workflow.
}

// --- Label Definitions (Task 10.2) ---

const FRAPPE_LABELS: Record<string, AgentConfig> = {
    'frappe-agent': {
        mode: 'standard',
        requiresPlanApproval: true,
        model: 'claude-sonnet-4'
    },
    'frappe-agent-auto': {
        mode: 'auto',
        requiresPlanApproval: false, // Agent auto-approves the plan
        model: 'claude-sonnet-4'
    },
    'frappe-agent-max': {
        mode: 'max',
        requiresPlanApproval: true,
        model: 'claude-opus-4.1'
    }
};

// --- Webhook Handler (Entry Point) ---

/**
 * Handles incoming GitHub webhook payload when an issue is labeled.
 */
export async function handleIssueLabeled(payload: any): Promise<void> {
    const labels: string[] = payload.issue.labels.map((l: any) => l.name);
    const frappeLabel = labels.find(l => l.startsWith('frappe-agent'));

    if (!frappeLabel || !FRAPPE_LABELS[frappeLabel]) {
        return;
    }

    const config = FRAPPE_LABELS[frappeLabel];
    // You must provide the required AdapterDependencies for the adapter
    const adapter = new FrappeGitHubAdapter({
        installationToken: process.env.GITHUB_TOKEN || "YOUR_TOKEN_HERE",
        sandboxWorkDir: "/tmp/sandbox", // or the correct work dir
        repoOwner: payload.repository.owner.login || "OWNER",
        repoName: payload.repository.name || "REPO"
    });

    // 1. Create Tracking Comment (Inform user agent has started)
    const commentBody = `Frappe Agent started on this issue (triggered by '${frappeLabel}'). 
- Mode: ${config.mode}
- Model: ${config.model}
- Plan approval: ${config.requiresPlanApproval ? 'REQUIRED' : 'auto-approved'}
I'll update this issue with progress...`;
    
    await adapter.createIssueComment(payload.issue.number, commentBody);

    // 2. Launch the Agent
    await launchFrappeAgent({
        issueNumber: payload.issue.number,
        description: payload.issue.body,
        config
    });
}