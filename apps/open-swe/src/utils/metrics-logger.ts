// src/utils/metrics-logger.ts

/**
 * Interface defining the final, archived result of a successful agent run.
 * This structure tracks the KPIs required by the project plan.
 */
export interface AgentMetrics {
    issueNumber: number;
    taskTitle: string;
    status: 'completed' | 'failed' | 'partial';
    durationSeconds: number;
    tokensUsed: number; // Placeholder for actual LLM token count
    migrationsRun: number;
    testSuccess: boolean;
    archivedArtifactsUrl: string;

    // --- ADDED PROPERTIES TO SYNCHRONIZE WITH AGENT EXECUTION RESULT ---
    filesModified: string[]; // List of files changed
    migrationLog: string;    // Full log output of migration handler
    testResults: { exitCode: number; output?: string }; // Detailed test result object
    taskDescription: string;
}

/**
 * Tracks and logs agent performance metrics and archives artifacts.
 * In a real scenario, this would send data to LangSmith/GCP Monitoring.
 */
export class MetricsLogger {
    private startTime: number;

    constructor() {
        this.startTime = Date.now();
    }

    /**
     * Calculates duration and generates the final metrics object.
     * @param finalData The required data collected from the agent run.
     */
    public async logFinalMetrics(finalData: Omit<AgentMetrics, 'durationSeconds' | 'tokensUsed' | 'archivedArtifactsUrl'>): Promise<AgentMetrics> {
        
        const durationSeconds = (Date.now() - this.startTime) / 1000;
        
        // --- 1. Calculate Estimated Tokens Used (Simulation) ---
        const estimatedTokens = this.estimateTokens(finalData.taskTitle) * (finalData.testSuccess ? 1.5 : 2.5); // Higher cost if tests failed (retry/debugging cost)

        // --- 2. Archive Artifacts (Simulation) ---
        const artifactsUrl = await this.archiveArtifacts(finalData.issueNumber);

        const finalMetrics: AgentMetrics = {
            ...finalData,
            durationSeconds,
            tokensUsed: Math.ceil(estimatedTokens),
            archivedArtifactsUrl: artifactsUrl,
        };

        // --- 3. Log to Console (Simulating LangSmith/GCP Logging) ---
        console.log("=========================================");
        console.log(`🤖 AGENT RUN REPORT (Issue #${finalMetrics.issueNumber})`);
        console.log(`STATUS: ${finalMetrics.status.toUpperCase()}`);
        console.log(`TIME: ${finalMetrics.durationSeconds.toFixed(2)} seconds`);
        console.log(`MIGRATIONS: ${finalMetrics.migrationsRun}`);
        console.log(`TOKENS ESTIMATED: ${finalMetrics.tokensUsed.toLocaleString()}`);
        console.log(`ARTIFACTS: ${finalMetrics.archivedArtifactsUrl}`);
        console.log("=========================================");

        return finalMetrics;
    }

    /**
     * Simulates zipping up logs, generated code, and context files for storage.
     */
    private async archiveArtifacts(issueNumber: number): Promise<string> {
        // In a real deployment, this would zip up files and upload them to GCP Cloud Storage.
        return `gs://frappe-agent-artifacts/run-${issueNumber}_${Date.now()}.zip`;
    }

    /**
     * Simple heuristic for token estimation based on task complexity.
     */
    private estimateTokens(taskTitle: string): number {
        if (taskTitle.includes('field') || taskTitle.includes('DocType')) {
            return 8000; // Simple DocType change is lower token usage
        }
        if (taskTitle.includes('API') || taskTitle.includes('hook')) {
            return 15000; // Complex logic requires more context and thinking
        }
        return 10000;
    }
}