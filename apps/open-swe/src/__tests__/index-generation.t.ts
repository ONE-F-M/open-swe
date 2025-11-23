import { createFrappeSandbox, BENCH_PATH, SITE_NAME } from "./testing-bench-utils.js";
import * as fs from 'fs/promises';
import * as path from 'path';

// Define the expected output location of the index file relative to BENCH_PATH
// NOTE: This path must match where your Python script saves the file.
const INDEX_RELATIVE_PATH = "/Users/samdani/Desktop/onefm_bench/apps/one_fm/one_fm/frappe-api-index.json"; 
const INDEX_FULL_PATH = path.join(BENCH_PATH, INDEX_RELATIVE_PATH);

describe('API Index Generation (Story S4)', () => {
    let sandbox: Awaited<ReturnType<typeof createFrappeSandbox>>;

    beforeAll(async () => {
        // Initialize local sandbox (connects to Docker container: funny_liskov)
        sandbox = await createFrappeSandbox();
    }, 30000);

    afterAll(async () => {
        if (sandbox && sandbox.destroy) await sandbox.destroy();
    });

    it('should successfully generate the API index from the Frappe environment', async () => {
        // ARRANGE: The command to run the Python script inside the Docker container
        const pythonModulePath = "one_fm.scripts.build_api_index";
        
        // CRITICAL ACT: Execute the Python script via bench execute
        // The script saves the index file to the volume-mounted path.
        const command = `bench --site ${SITE_NAME} execute ${pythonModulePath}`;
        
        console.log(`[TEST] Running index generation command inside Docker: ${command}`);
        const result = await sandbox.execute(command);

        // ASSERT 1: The command must exit successfully (exitCode 0)
        expect(result.exitCode).toBe(0);

        // ASSERT 2: The host machine should be able to read the newly generated file
        // This validates that the Docker volume mount worked correctly for file writing/reading.
        const fileContent = await fs.readFile(INDEX_FULL_PATH, 'utf8');

        // ASSERT 3: Validate the content structure (must contain the DocType section)
        let indexJson;
        try {
            indexJson = JSON.parse(fileContent);
        } catch (e) {
            throw new Error(`Generated index file is not valid JSON: ${e}`);
        }

        expect(indexJson).toBeDefined();
        expect(indexJson.modules.length).toBeGreaterThan(5); // Should have many modules
        expect(indexJson.doctypes['Client']).toBeDefined(); // Should contain core DocTypes

    }, 300000); // Allow sufficient time for the Python script and bench context loading
});