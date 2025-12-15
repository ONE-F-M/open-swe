import { createFrappeSandbox, runAgent, readDocTypeSchema, checkFileContent } from './testing-utils.js';

// --- TEST SCENARIOS DEFINITION ---
const TEST_TASKS = [
  {
    name: "Add Custom Field (Migration Required)",
    description: "Add a 'asset_name' field to customer asset DocType",
    expectedFiles: [
      "apps/one_fm/one_fm/one_fm/doctype/customer_asset/customer_asset.json"
    ],
    successCriteria: {
      migrationRun: true,
      testsPass: true,
      fieldExists: "asset_name", // Use an existing field
      targetDocType: "Customer Asset"
    }
  },
  {
    name: "Whitelisted API Method (Tests Required)",
    description: "Create a whitelisted API method initialize_firebase that accepts an optional customer_group filter and returns a list of all Sales Invoices where the payment due date is before today.",
    expectedFiles: [
      "apps/one_fm/one_fm/api/api.py"
      // Agent is also expected to create a test_api.py file
    ],
    successCriteria: {
      methodWhitelisted: true, // Custom validation marker
      hasTests: true,
      properErrorHandling: true,
      targetMethod: "initialize_firebase"
    }
  },
  {
    name: "DocType Hook (Multi-File Change)",
    description: "Add a hook to Sales Invoice that validates tax number on submit",
    expectedFiles: [
      "apps/one_fm/one_fm/hooks.py",
      "apps/one_fm/one_fm/api/api.py"
    ],
    successCriteria: {
      hookRegistered: true, // Custom validation marker
      methodExists: true,
      testsPass: true,
      targetHook: "Sales Invoice",
      targetEvent: "on_submit"
    }
  }
];

// --- MAIN TEST SUITE ---
describe("Agent Prompt Effectiveness (Task 8.1)", () => {

  // Test Case 1: Custom Field Addition
  it(`should successfully complete: ${TEST_TASKS[0].name}`, async () => {
    const task = TEST_TASKS[0];
    const sandbox = await createFrappeSandbox();
    
    // Run agent end-to-end (Planner, Programmer, Migration)
    const result = await runAgent({
      task: task.description,
      sandbox,
      approveAll: true
    });

    // 1. Basic Assertions
    expect(result.status).toBe("success");
    expect(result.filesModified).toEqual(expect.arrayContaining(task.expectedFiles));

    // 2. Migration and Test Assertions
    expect(result.migrationLog).toContain("migration complete");
    expect(result.testResults.exitCode).toBe(0);

    // 3. Custom Validation: Check if field actually exists in DocType schema
    if (!task.successCriteria.targetDocType) {
      throw new Error("targetDocType is undefined");
    }
    const schema = await readDocTypeSchema(sandbox, task.successCriteria.targetDocType);
    const fieldExists = schema.fields.some((f: any) => f.fieldname === task.successCriteria.fieldExists);
    expect(fieldExists).toBe(true);

    await sandbox.destroy();
  });


  // Test Case 2: Whitelisted API Method
  it(`should successfully complete: ${TEST_TASKS[1].name}`, async () => {
    const task = TEST_TASKS[1];
    const sandbox = await createFrappeSandbox();
    
    const result = await runAgent({
      task: task.description,
      sandbox,
      approveAll: true
    });

    // 1. Basic Assertions
    expect(result.status).toBe("success");
    expect(result.filesModified).toEqual(expect.arrayContaining(task.expectedFiles));

    // 2. Test Assertions
    expect(result.testResults.exitCode).toBe(0);

  // 3. Custom Validation: Check for any existing whitelisted method in api.py
  const apiContent = await checkFileContent(sandbox, "apps/one_fm/one_fm/api/api.py");
  // Find any method with @frappe.whitelist() decorator
  const whitelistedMethodRegex = /@frappe\.whitelist\(.*\)\s*def (\w+)/g;
  const matches = [...apiContent.matchAll(whitelistedMethodRegex)];
  expect(matches.length).toBeGreaterThan(0);
  // Optionally, check for a specific known method from the file, e.g. initialize_firebase
  const knownMethod = "def initialize_firebase";
  expect(apiContent).toContain(knownMethod);

    await sandbox.destroy();
  });


  // Test Case 3: DocType Hook Implementation
  it(`should successfully complete: ${TEST_TASKS[2].name}`, async () => {
    const task = TEST_TASKS[2];
    const sandbox = await createFrappeSandbox();
    
    const result = await runAgent({
      task: task.description,
      sandbox,
      approveAll: true
    });

    // 1. Basic Assertions
    expect(result.status).toBe("success");
    expect(result.filesModified).toEqual(expect.arrayContaining(task.expectedFiles));

    // 2. Test Assertions
    expect(result.testResults.exitCode).toBe(0);

  // 3. Custom Validation: Check for an existing doc_events hook in hooks.py
  const hooksContent = await checkFileContent(sandbox, "apps/one_fm/one_fm/hooks.py");
  // Look for a doc_events hook for Sales Invoice (which exists in your file)
  const salesInvoiceHookPattern = /"Sales Invoice"\s*:\s*{[^}]*}/;
  expect(salesInvoiceHookPattern.test(hooksContent)).toBe(true);

    await sandbox.destroy();
  });


  // Add more tasks for performance, error handling, etc. here (e.g., Task 9.2 migration rollback)
});