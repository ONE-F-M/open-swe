// src/github/frappe-github-adapter.ts

import { FRAPPE_REPO_CONFIG, FrappeRepoConfig } from "./config/frappe-repos.js";
import execa from "execa";
import { Octokit } from "@octokit/rest";

// AdapterDependencies interface for injected runtime context
interface AdapterDependencies {
    installationToken: string;
    sandboxWorkDir: string;
    repoOwner: string;
    repoName: string;
}


export class FrappeGitHubAdapter {
    private config: FrappeRepoConfig;
    private octokit: Octokit;
    private appPath: string;
    private baseBranch: string;

    // The constructor now receives the necessary runtime dependencies
    constructor(deps: AdapterDependencies, config: FrappeRepoConfig = FRAPPE_REPO_CONFIG) {
        this.config = config;
        // Use the injected token for Octokit authentication
        this.octokit = new Octokit({ auth: deps.installationToken });
        // The appPath must be the sandbox's working directory
        this.appPath = deps.sandboxWorkDir;
        this.baseBranch = this.config.baseBranch || 'version-15';
        // repoOwner and repoName are available in deps if needed for future use
    }

    private getOwnerAndRepo(): [string, string] {
        const parts = this.config.customAppRepo.split('/');
        return [parts[0], parts[1]];
    }

    /**
     * Prepares the custom app repository for new commits (sets Git config, pulls base branch).
     * NOTE: This assumes the sandbox has already cloned the repo at 'this.appPath'.
     */
    async setupCustomAppRepo(): Promise<void> {
        console.log(`[GIT] Ensuring custom app repo is ready at: ${this.appPath}`);
        // Setup user config (required for commit)
        await execa('sh', ['-c', `git config user.email "agent@frappe.ai"`], { cwd: this.appPath, shell: true });
        await execa('sh', ['-c', `git config user.name "Frappe Agent"`], { cwd: this.appPath, shell: true });
        // Ensure clean state on the working branch (e.g., 'version-15' or 'staging')
        await execa('sh', ['-c', `git checkout ${this.baseBranch}`], { cwd: this.appPath, shell: true });
        await execa('sh', ['-c', 'git reset --hard'], { cwd: this.appPath, shell: true });
        await execa('sh', ['-c', 'git clean -fd'], { cwd: this.appPath, shell: true });
        await execa('sh', ['-c', `git pull origin ${this.baseBranch}`], { cwd: this.appPath, shell: true });
        console.log(`[GIT] Base branch ${this.baseBranch} is clean and updated.`);
    }

    /**
     * Commits all changes and pushes to a new branch, ready for PR.
     * NOTE: This is inherently safe as it commits to the new `branchName`.
     */
    async commitAndBranch(branchName: string, commitMessage: string): Promise<boolean> {
        console.log(`[GIT] Creating branch ${branchName} and committing changes.`);
        // 1. Create and switch to new branch from the current base branch
        await execa('sh', ['-c', `git checkout -b ${branchName}`], { cwd: this.appPath, shell: true });
        // 2. Add all modified files
        await execa('sh', ['-c', 'git add .'], { cwd: this.appPath, shell: true });
        // 3. Check for staged changes
        const { stdout: diffStdout } = await execa('git', ['diff', '--cached', '--name-only'], { cwd: this.appPath });
        let committed = false;
        if (diffStdout.trim().length > 0) {
            await execa('git', ['commit', '-m', commitMessage], { cwd: this.appPath });
            committed = true;
            // 4. Push the new branch to the remote
            await execa('sh', ['-c', `git push --set-upstream origin ${branchName}`], { cwd: this.appPath, shell: true });
            console.log(`[GIT] Changes committed and pushed successfully to ${branchName}.`);
        } else {
            console.log('[GIT] No staged changes to commit. Skipping commit and push.');
        }
        return committed;
    }

    /**
     * Creates a Pull Request against the custom app repository.
     */
    async createPullRequest(head: string, title: string, body: string, base: string = this.baseBranch): Promise<string> {
        const [owner, repo] = this.getOwnerAndRepo();
        const pr = await this.octokit.pulls.create({
            owner,
            repo,
            title,
            body,
            head: head,
            base: base
        });
        return pr.data.html_url;
    }

    /**
     * Posts a GitHub Issue comment (safer than trying to update the issue body).
     * Renamed from updateIssue to reflect safer operation.
     */
    async createIssueComment(issueNumber: number, comment: string): Promise<void> {
        const [owner, repo] = this.getOwnerAndRepo();
        await this.octokit.issues.createComment({
            owner,
            repo,
            issue_number: issueNumber,
            body: comment
        });
    }
}