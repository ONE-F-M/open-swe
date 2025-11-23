import dotenv from 'dotenv';
dotenv.config();
import { execaCommand } from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';

export const BENCH_PATH = process.env.BENCH_PATH || '/home/frappe/frappe-bench';
export const SITE_NAME = process.env.SITE_NAME || 'onefm';
const BENCH_CONTAINER = process.env.BENCH_CONTAINER || 'onefmfrappe-container';

// --- Sandbox & Execution Helpers ---

interface Sandbox {
    execute: (command: string) => Promise<{ stdout: string; exitCode: number; stderr?: string }>;
    writeFile: (relativePath: string, content: string) => Promise<void>;
    readFile: (relativePath: string) => Promise<string>;
    destroy: () => Promise<void>;
    site: string;
}

/**
 * Creates a mock sandbox object that runs commands against the local bench.
 * NOTE: In a real POC, this would launch a remote VM/container.
 */
export async function createFrappeSandbox(): Promise<Sandbox> {
    console.log(`[TEST SETUP] Initializing Frappe bench interaction at: ${BENCH_PATH}`);
    // Ensure the site exists before returning the sandbox
    const siteCreateCmd = `bench new-site ${SITE_NAME} --mariadb-root-password root --admin-password admin --no-input || true`;
    const dockerCmd = [
      'docker', 'exec', '-u', 'frappe', '-w', BENCH_PATH, BENCH_CONTAINER,
      'bash', '-c', `'${siteCreateCmd.replace(/'/g, "'\\''")}'`
    ];
    try {
      await execaCommand(dockerCmd.join(' '), { shell: true });
      console.log(`[TEST SETUP] Ensured site '${SITE_NAME}' exists in container '${BENCH_CONTAINER}'.`);
    } catch (err) {
      console.warn(`[TEST SETUP] Could not create site '${SITE_NAME}':`, err);
    }
    return {
        site: SITE_NAME,
        /** Runs a bench command within the defined BENCH_PATH */
        async execute(command: string) {
            try {
                // Run the command inside the Docker container as the frappe user
                const dockerCmd = [
                  'docker', 'exec', '-u', 'frappe', '-w', BENCH_PATH, BENCH_CONTAINER,
                  'bash', '-c', `'${command.replace(/'/g, "'\\''")}'`
                ];
                const result = await execaCommand(dockerCmd.join(' '), { shell: true });
                return { stdout: result.stdout, exitCode: typeof result.exitCode === 'number' ? result.exitCode : 0 };
            } catch (error: any) {
                // Return failure details without throwing, as tests expect failure
                return { 
                    stdout: error.stdout ?? '', 
                    exitCode: typeof error.exitCode === 'number' ? error.exitCode : 1, 
                    stderr: error.stderr ?? '' 
                };
            }
        },
        /** Writes content to a file in the bench environment, but only if it already exists */
        async writeFile(relativePath: string, content: string) {
            const fullPath = path.join(BENCH_PATH, relativePath);
            try {
                await fs.access(fullPath);
            } catch (err) {
                throw new Error(`[TEST SETUP] File does not exist, not updating: ${fullPath}`);
            }
            await fs.writeFile(fullPath, content, 'utf8');
            console.log(`[TEST SETUP] Updated content in: ${fullPath}`);
        },
        /** Reads content from a file in the bench environment, throws if not found */
        async readFile(relativePath: string) {
            const fullPath = path.join(BENCH_PATH, relativePath);
            try {
                await fs.access(fullPath);
                return await fs.readFile(fullPath, 'utf8');
            } catch (err) {
                throw new Error(`[TEST] File does not exist: ${fullPath}`);
            }
        },
        /** No-op destroy method for compatibility with tests */
        async destroy() {
            // No-op for local test, but present for compatibility
        }
    };
}

/**
 * Executes a Python snippet via 'bench execute' to interact with the database.
 */
async function executeBenchPython(sandbox: Sandbox, pythonCode: string): Promise<string> {
    // The command uses 'bench execute' to run Python code on the site
    const command = `bench --site ${sandbox.site} execute "${pythonCode}"`;
    const result = await sandbox.execute(command);
    
    if (result.exitCode !== 0) {
        throw new Error(`Bench Execute Failed for DB Count. Stderr: ${result.stderr}`);
    }
    
    // stdout often includes function name in Frappe; try to extract the last printed line.
    return result.stdout.trim().split('\n').pop() || '0';
}

/**
 * Runs a bench command to count records for any DocType, used for state validation.
 */
export async function getDocTypeCount(sandbox: Sandbox, doctype: string): Promise<number> {
    // frappe.db.count(doctype) returns the number of records in the given DocType
    const pythonCode = `print(frappe.db.count('${doctype}'))`;
    try {
        const countStr = await executeBenchPython(sandbox, pythonCode);
        return parseInt(countStr) || 0;
    } catch (e) {
        console.warn(`Could not retrieve DB count for ${doctype}. Assuming 0. Error: ${e}`);
        return 0;
    }
}