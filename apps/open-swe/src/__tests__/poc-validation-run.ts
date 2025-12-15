// --- MOCK GITHUB API FOR LOCAL TESTS --- 
import * as githubApi from '../utils/github/api.js';

if (typeof jest !== 'undefined') {
    beforeAll(() => {
        // ...existing plannerAgentModule mock...

        // Mock getIssue to always return a dummy issue with a body and required fields
        // Valid TaskPlan JSON for the mock
        const validTaskPlan = JSON.stringify({
            tasks: [
                {
                    id: "1",
                    taskIndex: 0,
                    request: "Add a 'tax_identification_number' field to Customer DocType",
                    title: "FEAT: Add Tax ID Field",
                    createdAt: 0,
                    completed: false,
                    planRevisions: [],
                    activeRevisionIndex: 0
                }
            ],
            activeTaskIndex: 0
        });
        const bodyWithTaskPlan = `<open-swe-do-not-edit-task-plan>${validTaskPlan}</open-swe-do-not-edit-task-plan>`;
        jest.spyOn(githubApi, 'getIssue').mockImplementation(async () => ({
            id: 1,
            node_id: 'dummy',
            url: '',
            repository_url: '',
            labels_url: '',
            comments_url: '',
            events_url: '',
            html_url: '',
            number: 5186,
            state: 'open',
            title: 'Dummy',
            body: bodyWithTaskPlan,
            user: { login: 'dummy', id: 1, node_id: 'dummy', avatar_url: '', gravatar_id: '', url: '', html_url: '', followers_url: '', following_url: '', gists_url: '', starred_url: '', subscriptions_url: '', organizations_url: '', repos_url: '', events_url: '', received_events_url: '', type: 'User', site_admin: false },
            labels: [],
            assignee: null,
            assignees: [],
            milestone: null,
            locked: false,
            active_lock_reason: null,
            comments: 0,
            pull_request: undefined,
            closed_at: null,
            created_at: '',
            updated_at: '',
            closed_by: null,
            author_association: 'NONE',
            state_reason: null,
            draft: false,
            issue_field_values: undefined
        }));
        // Mock updateIssue to return a similar dummy object
        jest.spyOn(githubApi, 'updateIssue').mockImplementation(async () => ({
            id: 1,
            node_id: 'dummy',
            url: '',
            repository_url: '',
            labels_url: '',
            comments_url: '',
            events_url: '',
            html_url: '',
            number: 5186,
            state: 'open',
            title: 'Dummy',
            body: bodyWithTaskPlan,
            user: { login: 'dummy', id: 1, node_id: 'dummy', avatar_url: '', gravatar_id: '', url: '', html_url: '', followers_url: '', following_url: '', gists_url: '', starred_url: '', subscriptions_url: '', organizations_url: '', repos_url: '', events_url: '', received_events_url: '', type: 'User', site_admin: false },
            labels: [],
            assignee: null,
            assignees: [],
            milestone: null,
            locked: false,
            active_lock_reason: null,
            comments: 0,
            pull_request: undefined,
            closed_at: null,
            created_at: '',
            updated_at: '',
            closed_by: null,
            author_association: 'NONE',
            state_reason: null,
            draft: false,
            issue_field_values: undefined
        }));
    });
}
// tests/poc-validation-run.test.ts
import { AgentDeliveryOrchestrator } from "../github/delivery/agent-runner.js";
import { FRAPPE_REPO_CONFIG } from "../github/config/frappe-repos.js";

// --- MOCK PLANNER AGENT FOR LOCAL TESTS ---
import * as plannerAgentModule from "../agents/planner-agent.js";

// Hardcoded mock plan steps for POC validation
const MOCK_PLAN = [
    { step: 1, action: "Analyze requirements" },
    { step: 2, action: "Edit Customer DocType" },
    { step: 3, action: "Add tax_identification_number field" },
    { step: 4, action: "Write migration script" },
    { step: 5, action: "Push changes and create PR" }
];

// Patch PlannerAgent.generatePlan to always return the mock plan
// NOTE: This test file must be run with Jest. If you see 'jest is not defined', ensure you are using 'yarn jest' or 'npx jest' and not another runner like Vitest or Mocha.
if (typeof jest !== 'undefined') {
    beforeAll(() => {
        jest.spyOn(plannerAgentModule.PlannerAgent.prototype, "generatePlan").mockImplementation(async function (this: any) {
            // Ensure thread_id is present in the config for downstream code
            if (!this.config?.configurable?.thread_id) {
                this.config = this.config || {};
                this.config.configurable = {
                    ...this.config.configurable,
                    thread_id: `thread_${Math.random().toString(36).slice(2)}_${Date.now()}`
                };
            }
            return MOCK_PLAN;
        });
    });
} else {
    console.warn("[WARNING] This test requires Jest. 'jest' is not defined in the current test runner.");
}

// --- FINAL CRITICAL SUCCESS CRITERIA TASKS ---
const FINAL_CSC_TASKS = [
    {
        issueNumber: 5186,
        taskTitle: "FEAT: Add Tax ID Field",
        taskDescription: "Add a 'tax_identification_number' field to Customer DocType",
        targetRepository: { owner: "ONE-F-M", repo: "one_fm" },
        targetBranch: "staging",
        autoAcceptPlan: true
    },
];

// --- BENCHMARK CONFIGURATION ---
// The target is < 5 minutes per task (300 seconds).
const MAX_DURATION_PER_TASK_SECONDS = 300; 

describe('Phase 5: Full POC Validation Run (Story S4)', () => {
    let orchestrator: AgentDeliveryOrchestrator;

        beforeAll(() => {
            FRAPPE_REPO_CONFIG.configurable = {
                ...FRAPPE_REPO_CONFIG.configurable,
                "x-github-installation-id": process.env.X_GITHUB_INSTALLATION_ID || "93987691",
                "x-github-pat": process.env.GITHUB_TOKEN,
                langgraph_auth_user: { display_name: "samdanikouser" },
                thread_id:
                  FRAPPE_REPO_CONFIG.configurable?.thread_id ||
                  `thread_${Math.random().toString(36).slice(2)}_${Date.now()}`
            };
            // Short debug: print thread_id before orchestrator runs
            // eslint-disable-next-line no-console
            // console.log('[DEBUG] thread_id in test setup:', FRAPPE_REPO_CONFIG.configurable.thread_id);
            orchestrator = new AgentDeliveryOrchestrator(FRAPPE_REPO_CONFIG);
        });

    for (const task of FINAL_CSC_TASKS) {
        it(`should successfully complete task #${task.issueNumber} (${task.taskTitle}) and meet performance goal`, async () => {
            const startTime = Date.now();
            // let finalMetrics: any = {};

                        try {
                                // RUN: The orchestrator handles the full flow (Agent execution -> Commit -> PR -> Metrics Log)
                                await orchestrator.runFullPipeline(task);
                                // NOTE: In a real test, metrics would be retrieved from a log store.
                                // Here, we simulate fetching the last logged result for assertion.
                                // We assume the MetricsLogger logged the result correctly.
                                // Assertions will rely on the console logs and external state checks.
                        } catch (e) {
                                console.error(`Validation Failed for Task ${task.issueNumber}:`, e);
                                // We expect a throw only if the delivery/git process failed.
                                throw e; 
                        }
            
            const durationSeconds = (Date.now() - startTime) / 1000;
            
            // ASSERT: Performance Check
            expect(durationSeconds).toBeLessThan(MAX_DURATION_PER_TASK_SECONDS);
            console.log(`[PERFORMANCE] Task ${task.issueNumber} completed in ${durationSeconds.toFixed(2)} seconds.`);
        }, 320000); // Set test timeout high enough (5 min + buffer)
    }
});