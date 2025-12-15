import { FrappeGitHubAdapter } from "../github/frappe-github-adapter.js";
import { FRAPPE_REPO_CONFIG } from "../github/config/frappe-repos.js";
import { execaCommand } from 'execa';
import * as path from 'path';

// --- Test Setup Constants ---
const TEST_ISSUE_NUMBER = 42;
const TEST_BRANCH_NAME = `feature/issue-${TEST_ISSUE_NUMBER}-add-field`;
const COMMIT_MESSAGE = `feat: Add tax_id field to Customer DocType [Ref: #${TEST_ISSUE_NUMBER}]`;

// NOTE: This test requires a functioning Git setup in the bench path.
const BENCH_PATH = '/Users/samdani/Desktop/onefm_bench'; 
const APP_PATH = path.join(BENCH_PATH, FRAPPE_REPO_CONFIG.customAppPath);

describe('Phase 4: GitHub Workflow Integration (Story S1)', () => {
    let adapter: FrappeGitHubAdapter;

    beforeAll(async () => {
        // Pass BENCH_PATH and APP_PATH to the adapter
        adapter = new FrappeGitHubAdapter(FRAPPE_REPO_CONFIG, BENCH_PATH, APP_PATH);
        // 1. Ensure the repo is set up locally (sets user.name/email)
        await adapter.setupCustomAppRepo();
        
        // 2. Mock a successful file change in the local bench that the agent created
        await execaCommand(`mkdir -p ${APP_PATH}/one_fm/one_fm/doctype/customer_asset/`, { shell: true });
        await execaCommand(`echo '{"fieldname": "test_field"}' > ${APP_PATH}/one_fm/one_fm/doctype/customer_asset/customer_asset.json`, { shell: true });
    }, 60000); // Allow time for bench setup

    it('should successfully commit changes, push a new branch, and create a PR', async () => {
        const PR_BODY = "Agent successfully implemented code and passed all tests.";
        
        // 1. ACT: Commit and Branch
        // This is the primary action that runs Git commands against the local bench folder
        try {
            await adapter.commitAndBranch(TEST_BRANCH_NAME, COMMIT_MESSAGE);
        } catch (e) {
            console.error("Git Command Failed. Ensure bench path is correct and Git is initialized.");
            throw e;
        }

        // 2. ACT: Create Pull Request (API Call)
        const prUrl = await adapter.createPullRequest(
            TEST_BRANCH_NAME,
            "FEAT: Add tax_id field [Agent Run]",
            PR_BODY
        );
        
        // 3. ASSERT: Verify PR Creation
        expect(prUrl).toMatch(/https:\/\/github\.com\/ONE-F-M\/one_fm\/pull\/\d+/);

        // 4. ACT & ASSERT: Update tracking issue (simulated final report)
        await adapter.updateIssue(TEST_ISSUE_NUMBER, "Completed: PR created.");
        // We rely on the console logs inside the adapter to confirm API calls were made.
    }, 60000); // 1-minute timeout for execution
    
    afterAll(async () => {
        // Clean up: switch back to the staging branch and delete the test branch locally
        await execaCommand(`git checkout staging`, { cwd: APP_PATH });
        try {
            await execaCommand(`git branch -D ${TEST_BRANCH_NAME}`, { cwd: APP_PATH });
        } catch (e) {
            // Ignore error if branch didn't exist
        }
        console.log(`[CLEANUP] Deleted local branch ${TEST_BRANCH_NAME}`);
    });
});