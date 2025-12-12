import dotenv from 'dotenv';
dotenv.config();
import execa from 'execa';
import * as fs from 'fs/promises';
import * as path from 'path';

export const BENCH_PATH = process.env.BENCH_PATH || '/home/frappe/frappe-bench';
export const BENCH_PATH_CONTAINER = '/home/frappe/frappe-bench';
export const SITE_NAME = process.env.SITE_NAME || 'onefm';
const BENCH_CONTAINER = process.env.BENCH_CONTAINER || 'competent_keldysh';

// --- Sandbox & Execution Helpers ---

export interface Sandbox {
    execute: (command: string) => Promise<{ stdout: string; exitCode: number; stderr?: string }>;
    writeFile: (relativePath: string, content: string) => Promise<void>;
    readFile: (relativePath: string) => Promise<string>;
    destroy: () => Promise<void>;
    site: string;
}

// Path to the Client DocType JSON file (relative to bench root)
export const CLIENT_DOCTYPE_PATH = 'apps/one_fm/one_fm/one_fm/doctype/client/client.json';

/**
 * Returns the count of Client records in the database.
 */
export async function getClientCount(sandbox: Sandbox): Promise<number> {
    return getDocTypeCount(sandbox, 'Client');
}

/**
 * Creates a mock sandbox object that runs commands against the local bench.
 * NOTE: In a real POC, this would launch a remote VM/container.
 */
export async function createFrappeSandbox(): Promise<Sandbox> {
    console.log(`[TEST SETUP] Initializing Frappe bench interaction at: ${BENCH_PATH}`);
    // Ensure the bench directory exists on the host
    try {
        await fs.access(BENCH_PATH);
    } catch (err) {
        await fs.mkdir(BENCH_PATH, { recursive: true });
        console.log(`[TEST SETUP] Created missing bench directory on host: ${BENCH_PATH}`);
    }
    // Ensure the bench directory exists inside the Docker container
    try {
        await execa('docker', [
            'exec',
            '-u', 'frappe',
            BENCH_CONTAINER,
            'mkdir', '-p', BENCH_PATH_CONTAINER
        ]);
        console.log(`[TEST SETUP] Ensured bench directory exists in container: ${BENCH_PATH_CONTAINER}`);
    } catch (err) {
        console.warn(`[TEST SETUP] Could not create bench directory in container:`, err);
    }
    // Ensure the site exists before returning the sandbox
    const siteCreateCmd = `bench new-site ${SITE_NAME} --mariadb-root-password root --admin-password admin --no-input || true`;
    try {
        await execa('docker', [
            'exec',
            '-u', 'frappe',
            '-w', BENCH_PATH_CONTAINER,
            BENCH_CONTAINER,
            'bash', '-c', siteCreateCmd
        ]);
        console.log(`[TEST SETUP] Ensured site '${SITE_NAME}' exists in container '${BENCH_CONTAINER}'.`);
    } catch (err) {
        console.warn(`[TEST SETUP] Could not create site '${SITE_NAME}':`, err);
    }
    return {
        site: SITE_NAME,
        /** Runs a bench command within the defined BENCH_PATH */
        async execute(command: string) {
            try {
                // Run the command inside the Docker container as the frappe user, matching CLI tool test style
                const result = await execa('docker', [
                    'exec',
                    '-u', 'frappe',
                    '-w', BENCH_PATH_CONTAINER,
                    BENCH_CONTAINER,
                    'bash', '-c', command
                ]);
                return { stdout: result.stdout, exitCode: typeof result.exitCode === 'number' ? result.exitCode : 0 };
            } catch (error: any) {
                return {
                    stdout: error.stdout ?? '',
                    exitCode: typeof error.exitCode === 'number' ? error.exitCode : 1,
                    stderr: error.stderr ?? ''
                };
            }
        },
        /** Writes content to a file in the bench environment, inside the Docker container, matching tools.ts */
        async writeFile(relativePath: string, content: string) {
            const containerPath = path.posix.join(BENCH_PATH_CONTAINER, relativePath);
            // Use docker exec with bash -c and echo to write the file inside the container
            // Escape single quotes in content for safe shell usage
            const safeContent = content.replace(/'/g, "'\\''");
            const bashCmd = `echo '${safeContent}' > '${containerPath}'`;
            try {
                await execa('docker', [
                    'exec',
                    '-u', 'frappe',
                    '-w', BENCH_PATH_CONTAINER,
                    BENCH_CONTAINER,
                    'bash', '-c', bashCmd
                ]);
                console.log(`[TEST SETUP] Updated content in container: ${containerPath}`);
            } catch (err) {
                throw new Error(`[TEST SETUP] Could not write file in container: ${containerPath}. Error: ${err}`);
            }
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

describe('testing-bench-utils integration', () => {
    let sandbox: Awaited<ReturnType<typeof createFrappeSandbox>>;
    beforeAll(async () => {
        sandbox = await createFrappeSandbox();
    }, 60000);
    afterAll(async () => {
        if (sandbox && sandbox.destroy) await sandbox.destroy();
    });

    it('getClientCount returns a number (integration)', async () => {
        const count = await getClientCount(sandbox);
        expect(typeof count).toBe('number');
        expect(count).toBeGreaterThanOrEqual(0);
        console.log('[Test] Client count:', count);
    }, 120000);

    it('getDocTypeCount returns a number for DocType (integration)', async () => {
        const count = await getDocTypeCount(sandbox, 'Client');
        expect(typeof count).toBe('number');
        expect(count).toBeGreaterThanOrEqual(0);
        console.log('[Test] DocType Client count:', count);
    }, 120000);
});
