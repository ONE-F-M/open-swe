// src/github/frappe-github-adapter.ts
import { FRAPPE_REPO_CONFIG, FrappeRepoConfig } from "./config/frappe-repos.js";
import { execa, execaCommand } from 'execa';
import * as path from 'path';
import { Octokit } from "@octokit/rest";

export class FrappeGitHubAdapter {
    private config: FrappeRepoConfig;
    private octokit; 
    private benchPath: string;
    private appPath: string;

    constructor(config: FrappeRepoConfig = FRAPPE_REPO_CONFIG, benchPath?: string, appPath?: string) {
        this.config = config;
        this.benchPath = benchPath || "/Users/samdani/Desktop/onefm_bench";
        this.appPath = appPath || path.join(this.benchPath, this.config.customAppPath);
        this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    }

    private getOwnerAndRepo(): [string, string] {
        const parts = this.config.customAppRepo.split('/');
        if (parts.length !== 2) {
            throw new Error(`Invalid customAppRepo format: ${this.config.customAppRepo}`);
        }
        return [parts[0], parts[1]];
    }

    /**
     * Prepares the custom app repository for new commits (sets Git config, pulls staging).
     */
    async setupCustomAppRepo(): Promise<void> {
        console.log(`[GIT] Ensuring custom app repo is ready: ${this.config.customAppRepo}`);
        // Setup user config (required for commit)
        await execaCommand(`git config user.email "agent@frappe.ai"`, { cwd: this.appPath });
        await execaCommand(`git config user.name "Frappe Agent"`, { cwd: this.appPath });
        // Ensure clean state (Checkout and Pull simulate Golden Snapshot readiness)
        await execaCommand(`git checkout staging`, { cwd: this.appPath });
        await execaCommand('git reset --hard', { cwd: this.appPath });
        await execaCommand('git clean -fd', { cwd: this.appPath });
        await execaCommand(`git pull upstream staging`, { cwd: this.appPath });
    }

    /**
     * Commits all changes and pushes to a new branch, ready for PR.
     */
    async commitAndBranch(branchName: string, commitMessage: string): Promise<boolean> {
        console.log(`[GIT] Creating branch ${branchName} and committing changes.`);

        // Delete the branch if it already exists
        try {
            await execaCommand(`git branch -D ${branchName}`, { cwd: this.appPath });
        } catch (e) {
            // Ignore error if branch doesn't exist
        }
        // 1. Create and switch to new branch
        await execaCommand(`git checkout -b ${branchName}`, { cwd: this.appPath });
        // 2. Add all modified files
        await execaCommand('git add .', { cwd: this.appPath });
        // 3. Only commit if there are staged changes
        const { stdout: diffStdout } = await execa('git', ['diff', '--cached', '--name-only'], { cwd: this.appPath });

        let committed = false;
        if (diffStdout.trim().length > 0) {
            await execa('git', ['commit', '-m', commitMessage], { cwd: this.appPath });
            committed = true;
        } else {
            console.log('[GIT] No staged changes to commit. Skipping commit.');
        }
        if (committed) {
            await execaCommand(`git push upstream ${branchName}`, { cwd: this.appPath });
            console.log(`[GIT] Changes committed and pushed successfully.`);
        } else {
            console.log('[GIT] No changes to push or PR to create.');
        }
        return committed;
    }

    /**
     * Creates a Pull Request against the custom app repository (Task 10.1).
     */
    async createPullRequest(branch: string, title: string, body: string): Promise<string> {
        const [owner, repo] = this.getOwnerAndRepo();

        const pr = await this.octokit.pulls.create({
            owner,
            repo,
            title,
            body,
            head: branch,
            base: 'staging'
        });

        return pr.data.html_url;
    }

    /**
     * Updates a GitHub Issue with a comment (e.g., status updates).
     */
    async updateIssue(issueNumber: number, comment: string): Promise<void> {
        const [owner, repo] = this.getOwnerAndRepo();

        await this.octokit.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body: comment
        });
    }
}