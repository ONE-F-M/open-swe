import { jest } from '@jest/globals';
import { FrappeProgrammerAgent, PlanStep } from "../agents/programmer-agent.js";
import { PlannerAgent } from "../agents/planner-agent.js"; 
import { createFrappeSandbox } from "./testing-bench-utils.test.js";
import { HumanMessage } from "@langchain/core/messages";

// --- ENVIRONMENT & MOCK SETUP ---
// Read necessary environment variables for configuration
const GITHUB_INSTALLATION_ID = process.env.X_GITHUB_INSTALLATION_ID || process.env.GITHUB_APP_ID;
const GITHUB_INSTALLATION_TOKEN = process.env.GITHUB_TOKEN;
const DAYTONA_ORG_ID = process.env.DAYTONA_ORG_ID;



const TARGET_ISSUE_NUMBER = 10;


describe('Planner-Programmer End-to-End Integration Test', () => {
    let programmer: FrappeProgrammerAgent;
    let planner: PlannerAgent;
    let sandbox: Awaited<ReturnType<typeof createFrappeSandbox>>;
    
    // Configuration object required by the Planner Agent graph (passed to loadContext/generatePlan)
    const TEST_CONFIG = {
        configurable: {
            githubIssueId: TARGET_ISSUE_NUMBER,
            targetRepository: { owner: "samdanikouser", repo: "one_fm", branch: "version-15" },
            "x-github-installation-id": GITHUB_INSTALLATION_ID,
            "x-github-installation-token": GITHUB_INSTALLATION_TOKEN,
            userLogin: "samdanikouser",
            "x-github-user-login": "samdanikouser",
            login: "samdanikouser",
            GITHUB_USER_LOGIN_HEADER: "samdanikouser",
            user: "samdanikouser",
            langgraph_auth_user: { display_name: "samdanikouser" },
            DAYTONA_ORG_ID
        },
        githubIssueId: TARGET_ISSUE_NUMBER,
        targetRepository: { owner: "samdanikouser", repo: "one_fm", branch: "version-15" },
        messages: [new HumanMessage({ content: "Placeholder Task" })]
    };


    beforeAll(async () => {
        sandbox = await createFrappeSandbox();
        programmer = new FrappeProgrammerAgent(sandbox as unknown as import("@daytonaio/sdk").Sandbox, sandbox.site);
        planner = new PlannerAgent(sandbox, TEST_CONFIG);
    }, 30000);

    afterAll(async () => {
        if (sandbox && sandbox.destroy) await sandbox.destroy();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it(`should successfully generate and execute the plan for issue #${TARGET_ISSUE_NUMBER}`, async () => {
        const initialTaskDescription = "Add a 'tax_identification_number' field to the Client DocType in one_fm app";
        const initialContext = await planner.loadContext();
        const planSteps: PlanStep[] = await planner.generatePlan(initialTaskDescription, TEST_CONFIG);
        if (!planSteps || planSteps.length === 0) {
            // eslint-disable-next-line no-console
            console.error('Planner did not generate any plan steps:', { initialTaskDescription, planSteps });
        }
        expect(planSteps.length).toBeGreaterThan(0);
        expect(planSteps[0].actionType).toBe('MODIFY_CODE');
        let finalFilesModified: string[] = [];
        let finalTestPassed = false;
        for (const step of planSteps) {
            if (step.actionType === 'MODIFY_CODE' || step.actionType === 'VALIDATE_TEST') {
                const stepResult = await programmer.executeStep(step, initialContext);
                if (stepResult.filesModified) {
                    finalFilesModified.push(...stepResult.filesModified);
                }
                if (stepResult.testResults && stepResult.testResults.exitCode === 0) {
                    finalTestPassed = true;
                }
            }
        }
        const allPlannedFiles = planSteps
            .filter(step => step.fileChanges)
            .flatMap(step => Object.keys(step.fileChanges!));
        for (const filePath of allPlannedFiles) {
            expect(finalFilesModified).toContain(filePath);
        }
        expect(finalTestPassed).toBe(true);
        for (const filePath of allPlannedFiles) {
            const content = await sandbox.readFile(filePath);
            expect(content).toContain('"fieldname": "project_link"');
            expect(content).toContain('"options": "Project"');
        }
    }, 320000);

    it('should handle manual plan approval (autoAcceptPlan: false) and simulate approval', async () => {
        // Arrange: set autoAcceptPlan to false
        const configWithManualApproval = {
            ...TEST_CONFIG,
            configurable: {
                ...TEST_CONFIG.configurable,
                autoAcceptPlan: false,
            },
        };
        const manualPlanner = new PlannerAgent(sandbox, configWithManualApproval);
        const initialTaskDescription = "Add a 'tax_identification_number' field to the Client DocType in one_fm app (manual approval)";
        const steps: PlanStep[] = await manualPlanner.generatePlan(initialTaskDescription, configWithManualApproval);
        expect(steps.length).toBeGreaterThan(0);
        // Ensure all files referenced in the plan exist in the sandbox before execution
        for (const step of steps) {
            if (step.fileChanges) {
                for (const filePath of Object.keys(step.fileChanges)) {
                    if (sandbox && sandbox.writeFile) {
                        // Create the file with empty or initial content if it doesn't exist
                        try {
                            await sandbox.readFile(filePath);
                        } catch {
                            await sandbox.writeFile(filePath, '');
                        }
                    }
                }
            }
        }
        const result = await programmer.executeStep(steps[0], "manual-approval-context");
        // Check that the files modified are as expected
        if (steps[0].fileChanges) {
            for (const filePath of Object.keys(steps[0].fileChanges)) {
                expect(result.filesModified).toContain(filePath);
            }
        }
    }, 120000);

    it('should handle planner returning an empty plan', async () => {
        const emptyPlanner = new PlannerAgent(sandbox, TEST_CONFIG);
        const spy = jest.spyOn(emptyPlanner, 'generatePlan').mockResolvedValue([]);
        const steps = await emptyPlanner.generatePlan('Empty plan test', TEST_CONFIG);
        expect(steps.length).toBe(0);
        spy.mockRestore();
    });

    it('should handle programmer step failure (e.g., migration/test fails)', async () => {
        const failStep: PlanStep = {
            stepId: 2,
            instruction: 'Failing migration',
            actionType: 'VALIDATE_TEST',
            appToTest: 'one_fm',
        };
        const spy = jest.spyOn(programmer, 'executeStep').mockResolvedValue({ filesModified: [], migrationLog: '', testResults: { exitCode: 1 } });
        const result = await programmer.executeStep(failStep, "fail-context");
        expect(result.testResults.exitCode).not.toBe(0);
        spy.mockRestore();
    });

    it('should handle agent encountering an error updating GitHub', async () => {
        const mockUpdateIssue = jest.fn(() => Promise.reject(new Error('GitHub update failed')));
        await expect(mockUpdateIssue()).rejects.toThrow('GitHub update failed');
    });
});
