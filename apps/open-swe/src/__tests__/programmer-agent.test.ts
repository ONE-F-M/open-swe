import { FrappeProgrammerAgent, PlanStep } from "../agents/programmer-agent.js";
import { PlannerAgent } from "../agents/planner-agent.js"; 
import { createFrappeSandbox } from "./testing-bench-utils.js";
import { HumanMessage } from "@langchain/core/messages";

// --- ENVIRONMENT & MOCK SETUP ---
// Read necessary environment variables for configuration
const GITHUB_INSTALLATION_ID = process.env.X_GITHUB_INSTALLATION_ID || process.env.GITHUB_APP_ID;
const GITHUB_INSTALLATION_TOKEN = process.env.GITHUB_TOKEN;
const DAYTONA_ORG_ID = process.env.DAYTONA_ORG_ID;



const TARGET_ISSUE_NUMBER = 5229;


describe('Planner-Programmer End-to-End Integration Test', () => {
    let programmer: FrappeProgrammerAgent;
    let planner: PlannerAgent;
    let sandbox: Awaited<ReturnType<typeof createFrappeSandbox>>;
    
    // Configuration object required by the Planner Agent graph (passed to loadContext/generatePlan)
    const TEST_CONFIG = {
        configurable: {
             githubIssueId: 5229,
            targetRepository: { owner: "ONE-F-M", repo: "one_fm", branch: "version-15" },
            "x-github-installation-id": GITHUB_INSTALLATION_ID,
            "x-github-installation-token": GITHUB_INSTALLATION_TOKEN,
            userLogin: "samdanikouser",
            "x-github-user-login": "samdanikouser",
            login: "samdanikouser",
            GITHUB_USER_LOGIN_HEADER: "samdanikouser",
            user: "samdanikouser",
            langgraph_auth_user: { display_name: "samdanikouser" },
            // frappeMode removed: now uses process.env.PROGRAMMER_FRAPPE_MODE directly
            DAYTONA_ORG_ID
        },
        githubIssueId: TARGET_ISSUE_NUMBER,
        targetRepository: { owner: "ONE-F-M", repo: "one_fm", branch: "version-15" },
        messages: [new HumanMessage({ content: "Placeholder Task" })]
    };

    beforeAll(async () => {
        // 1. Initialize the local/docker sandbox (must run first)
        // This is the source of the local execution context
        sandbox = await createFrappeSandbox();
        
        // 2. Initialize Agents with the sandbox object
        // The sandbox passed here is the local one from createFrappeSandbox.
        programmer = new FrappeProgrammerAgent(sandbox); 
        planner = new PlannerAgent(sandbox, TEST_CONFIG);
        
    }, 30000); 

    afterAll(async () => {
        // Clean up the sandbox
        if (sandbox && sandbox.destroy) await sandbox.destroy();
    });

    it(`should successfully generate and execute the plan for issue #${TARGET_ISSUE_NUMBER}`, async () => {
        
        const initialTaskDescription = "Add a 'tax_identification_number' field to the Client DocType.";
        
        // ACT 1: PLANNER PHASE (Calls the mocked methods)
        const initialContext = await planner.loadContext(); 
        const planSteps: PlanStep[] = await planner.generatePlan(initialTaskDescription, TEST_CONFIG);
        // Debug: Log the planner's output if no steps are generated
        if (!planSteps || planSteps.length === 0) {
            // eslint-disable-next-line no-console
            console.error('Planner did not generate any plan steps:', { initialTaskDescription, planSteps });
        }

        // ASSERT 1: Verify the Plan was generated (mocked data ensures success)
        expect(planSteps.length).toBeGreaterThan(0);
        expect(planSteps[0].actionType).toBe('MODIFY_CODE');

        // --- ACT 2: PROGRAMMER PHASE (Executes Plan Steps) ---
        let finalFilesModified: string[] = [];
        let finalTestPassed = false;

        for (const step of planSteps) {
            if (step.actionType === 'MODIFY_CODE' || step.actionType === 'VALIDATE_TEST') {
                const stepResult = await programmer.executeStep(step, initialContext);
                
                if (stepResult.filesModified) {
                    finalFilesModified.push(...stepResult.filesModified);
                }
                
                // Assertions rely on the bench tools returning exitCode 0
                if (stepResult.testResults && stepResult.testResults.exitCode === 0) {
                    finalTestPassed = true;
                }
            }
        }

        // --- FINAL ASSERTIONS (Execution Validation) ---

        // Extract all file paths that were modified in the plan steps
        const allPlannedFiles = planSteps
            .filter(step => step.fileChanges)
            .flatMap(step => Object.keys(step.fileChanges!));

        // ASSERT 2: At least one of the planned files should have been modified.
        for (const filePath of allPlannedFiles) {
            expect(finalFilesModified).toContain(filePath);
        }

        // ASSERT 3: The test loop should have run successfully.
        expect(finalTestPassed).toBe(true);

        // ASSERT 4: Verify the DocType file(s) were modified correctly (Content Check)
        for (const filePath of allPlannedFiles) {
            const content = await sandbox.readFile(filePath);
            expect(content).toContain('"fieldname": "project_link"');
            expect(content).toContain('"options": "Project"');
        }

    }, 320000); // Increased timeout to handle slow Docker/Bench commands
});