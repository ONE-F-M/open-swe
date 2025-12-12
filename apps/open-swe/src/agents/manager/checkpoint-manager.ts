import fs from 'fs';
import path from 'path';

export interface CheckpointState {
    executionId: string;
    issueNumber: number;
    taskTitle: string;
    taskDescription: string;
    planSteps: any[];
    completedStepIndices: number[];
    completedGroupIndices: number[];
    currentGroupIndex: number;
    currentStepIndex: number;
    filesModified: string[];
    migrationLog: string;
    testResults: { exitCode: number; output?: string };
    totalTokensUsed: number;
    successfulSteps: number;
    failedSteps: number;
    timestamp: number;
    contextSnapshot: any;
    targetRepository: { owner: string; repo: string; branch?: string };
    config: any;
}

export class CheckpointManager {
    private checkpointDir: string;
    constructor(workDir: string) {
        this.checkpointDir = path.join(workDir, '.checkpoints');
        this.ensureCheckpointDir();
    }
    private ensureCheckpointDir(): void {
        if (!fs.existsSync(this.checkpointDir)) {
            fs.mkdirSync(this.checkpointDir, { recursive: true });
        }
    }
    async saveCheckpoint(executionId: string, state: CheckpointState): Promise<void> {
        const checkpointFile = path.join(this.checkpointDir, `${executionId}.json`);
        const compressedState = await this.compressState(state);
        await fs.promises.writeFile(
            checkpointFile,
            JSON.stringify(compressedState, null, 2),
            'utf8'
        );
        await this.cleanupOldCheckpoints(executionId);
    }
    async loadCheckpoint(executionId: string): Promise<CheckpointState | null> {
        const checkpointFile = path.join(this.checkpointDir, `${executionId}.json`);
        if (!fs.existsSync(checkpointFile)) {
            return null;
        }
        try {
            const data = await fs.promises.readFile(checkpointFile, 'utf8');
            const compressedState = JSON.parse(data);
            return await this.decompressState(compressedState);
        } catch (error) {
            console.warn(`Failed to load checkpoint ${executionId}:`, error);
            return null;
        }
    }
    async deleteCheckpoint(executionId: string): Promise<void> {
        const checkpointFile = path.join(this.checkpointDir, `${executionId}.json`);
        if (fs.existsSync(checkpointFile)) {
            await fs.promises.unlink(checkpointFile);
        }
    }
    private async compressState(state: CheckpointState): Promise<any> {
        return {
            ...state,
            contextSnapshot: state.contextSnapshot ?
                await this.compressObject(state.contextSnapshot) : null,
            planSteps: await this.compressObject(state.planSteps)
        };
    }
    private async decompressState(compressedState: any): Promise<CheckpointState> {
        return {
            ...compressedState,
            contextSnapshot: compressedState.contextSnapshot ?
                await this.decompressObject(compressedState.contextSnapshot) : null,
            planSteps: await this.decompressObject(compressedState.planSteps)
        };
    }
    private async compressObject(obj: any): Promise<string> {
        const zlib = await import('zlib');
        const jsonString = JSON.stringify(obj);
        return zlib.gzipSync(jsonString).toString('base64');
    }
    private async decompressObject(compressed: string): Promise<any> {
        const zlib = await import('zlib');
        const buffer = Buffer.from(compressed, 'base64');
        const decompressed = zlib.gunzipSync(buffer).toString();
        return JSON.parse(decompressed);
    }
    private async cleanupOldCheckpoints(executionId: string): Promise<void> {
        const files = await fs.promises.readdir(this.checkpointDir);
        const executionFiles = files
            .filter(f => f.startsWith(executionId) && f.endsWith('.json'))
            .map(f => ({
                name: f,
                path: path.join(this.checkpointDir, f),
                mtime: fs.statSync(path.join(this.checkpointDir, f)).mtime
            }))
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        const toDelete = executionFiles.slice(5);
        for (const file of toDelete) {
            await fs.promises.unlink(file.path);
        }
    }
}
