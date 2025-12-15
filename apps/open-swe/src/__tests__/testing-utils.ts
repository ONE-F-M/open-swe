import * as fs from 'fs/promises';
import * as path from 'path';
import { BENCH_PATH } from './testing-bench-utils.js';

// --- Dummy Sandbox Structures ---
interface Sandbox {
    id: string;
    execute: (command: string) => Promise<{ stdout: string; exitCode: number }>;
    readFile: (path: string) => Promise<string>;
    destroy: () => Promise<void>;
}

// --- Mock/Dummy Execution ---
/** Simulates launching the pre-warmed Golden Snapshot sandbox. */
export async function createFrappeSandbox(): Promise<Sandbox> {
    console.log("-> Sandbox created from Golden Snapshot.");
    // In a real environment, this calls a GCP/Daytona API to launch a VM
    return {
        id: 'sandbox-1234',
        execute: async (command) => { 
            // In a real test, this sends the command to the running VM
            console.log(`[EXECUTE]: ${command}`);
            return { stdout: `Mock output for: ${command}`, exitCode: 0 };
        },
        readFile: async (relativePath) => {
            // Always resolve relative to BENCH_PATH
            const absolutePath = path.join(BENCH_PATH, relativePath);
            console.log(`[READ FILE]: ${relativePath}`);
            console.log(`[ABSOLUTE PATH]: ${absolutePath}`);
            try {
                return await fs.readFile(absolutePath, 'utf8');
            } catch (err) {
                console.error(`Failed to read file: ${absolutePath}`, err);
                return "";
            }
        },
        destroy: async () => { console.log("-> Sandbox destroyed."); }
    };
}

/** * Simulates running the Planner/Programmer Agents end-to-end for a task.
 * In a real scenario, this involves LangGraph orchestration. 
 */
export async function runAgent(params: { task: string; sandbox: Sandbox; approveAll: boolean }) {
    console.log(`-> Running agent for task: ${params.task}`);
    // *** MOCKING SUCCESSFUL EXECUTION OF THE AGENT ***
    await params.sandbox.execute("Agent: Generated Plan...");
    await params.sandbox.execute("Agent: Wrote file changes...");

    // Mock result based on expected output for the three test cases
    let filesModified: string[] = [];
    let migrationLog = "migration complete";
    let testResults = { exitCode: 0 };

    if (params.task.includes('asset_name')) {
        filesModified = ["apps/one_fm/one_fm/one_fm/doctype/customer_asset/customer_asset.json"];
    } else if (
        params.task.includes('whitelisted API method') ||
        params.task.includes('initialize_firebase')
    ) {
        // Allow any whitelisted method in api.py to satisfy the test
        filesModified = ["apps/one_fm/one_fm/api/api.py"];
    } else if (params.task.includes('validates tax number')) {
        filesModified = ["apps/one_fm/one_fm/hooks.py", "apps/one_fm/one_fm/api/api.py"];
    }

    return {
        status: "success",
        filesModified: filesModified,
        migrationLog: migrationLog,
        testResults: testResults,
        // Include sandbox handle to allow validation checks against it
        sandbox: params.sandbox 
    };
}


// --- Validation Helpers (Used by the test assertions) ---

/** Reads and parses the DocType JSON from the sandbox. */
export async function readDocTypeSchema(sandbox: Sandbox, doctype: string): Promise<any> {
    const safeName = doctype.toLowerCase().replace(/\s+/g, '_');
    const relativePath = `apps/one_fm/one_fm/one_fm/doctype/${safeName}/${safeName}.json`;
    const content = await sandbox.readFile(relativePath);
    try {
        return JSON.parse(content);
    } catch (e) {
        throw new Error(`Failed to parse DocType JSON for ${doctype}`);
    }
}

/** Reads the content of a file from the sandbox. */
export async function checkFileContent(sandbox: Sandbox, path: string): Promise<string> {
    return sandbox.readFile(path);
}

// /** Simulates checking the database count via bench console/execute. */
// export async function checkDBRecordCount(sandbox: Sandbox, doctype: string): Promise<number> {
//     // In a real test, this would run: bench --site test_site execute "print(frappe.db.count('Customer'))"
//     // Mocking a successful count for test purposes
//     return 10; 
// }