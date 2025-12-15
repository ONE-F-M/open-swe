// src/github/frappe-repos.ts
// Configuration for the Frappe Agent's GitHub integration (Phase 4, Task 10.1)
import 'dotenv/config';
// Defines the configuration required by the FrappeGitHubAdapter.
export interface FrappeRepoConfig {
    /** The main repository where the custom app code resides (e.g., "org/one-fm-repo"). */
    customAppRepo: string;
    /** The local path within the bench environment (e.g., "apps/one_fm"). */
    customAppPath: string;
    /** Map of core apps for path validation (frappe -> frappe/frappe). */
    frameworkRepos: Map<string, string>;
    configurable: Record<string, any>;
}

// Default configuration settings.
export const FRAPPE_REPO_CONFIG: FrappeRepoConfig = {
    customAppRepo: process.env.CUSTOM_APP_REPO || "ONE-F-M/one_fm",
    customAppPath: "apps/one_fm",
    frameworkRepos: new Map([
        ["frappe", "frappe/frappe"],
        ["erpnext", "frappe/erpnext"],
        ["hrms", "frappe/hrms"]
    ]),
    configurable: {
        "x-github-installation-id": process.env.X_GITHUB_INSTALLATION_ID || "93987691",
        langgraph_auth_user: { display_name: "samdanikouser" },
        // Add any other static or env-based config here
    },
};