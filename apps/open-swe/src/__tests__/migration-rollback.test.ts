import { MigrationHandler } from '../migration/migration-handler.js';
import { createFrappeSandbox, getClientCount } from './testing-bench-utils.test.js';
import { benchBackupTool, benchListAppsTool } from '../../../cli/src/tools.js';


describe('Migration Rollback (Task 9.2)', () => {
  /**
   * Integration Test Requirements:
   * - Docker must be running and accessible.
   * - Required environment variables for Frappe/ERPNext Docker setup must be set.
   * - The test will create a sandboxed site, perform a migration, and validate rollback.
   * - Only skip if no container is available or required env vars are missing.
   */
  it('should successfully restore DB state after a migration failure', async () => {
    // 1. Setup Sandbox and Baseline
    const sandbox = await createFrappeSandbox();
    
    // Create baseline backup before introducing the error
    await benchBackupTool.invoke({ site: sandbox.site, sandbox });
    
    // Get initial record count to compare after rollback (Assuming DocType is Client)
    const initialCount = await getClientCount(sandbox);
    console.log(`Initial Client record count: ${initialCount}`);

    // 2. Introduce a Guaranteed Migration Failure (Syntax Error or Duplicate Field)
    const invalidDocTypePath = 'apps/one_fm/one_fm/one_fm/doctype/client/client.json'; // Assumed correct path
    const invalidDocTypeContent = `
{
    "name": "Client",
    "fields": [
        // This structural error will force a migration failure
        { "fieldname": "duplicate_field", "fieldtype": "Data" }, 
        { "fieldname": "duplicate_field", "fieldtype": "Data" }
    ]
}
`;
    
    // Use the updated sandbox.writeFile which should handle path access checks
     await sandbox.writeFile(invalidDocTypePath, invalidDocTypeContent);

    // 3. Attempt Migration
      const handler = new MigrationHandler(sandbox, sandbox.site); // Pass sandbox and site name
      const result = await handler.handlePostCodeChange([invalidDocTypePath]);

    // 4. Validate Failure and Rollback Assertions
    
    // ASSERTION A: Handler should correctly report failure
    expect(result.success).toBe(false); 
    expect(result.requiresManualIntervention).toBe(true);
    
    // ASSERTION B: Database state must be restored (record count remains the same)
    const afterCount = await getClientCount(sandbox);
    console.log(`Client record count after failed migration and rollback: ${afterCount}`);
    
    // The key test: the count must be identical, proving the restore worked
    expect(afterCount).toBe(initialCount);

    // ASSERTION C: Site should still be functional (critical check post-restore)
    const listApps = await benchListAppsTool.invoke({ site: sandbox.site, sandbox });
    expect(listApps.exitCode).toBe(0);
  }, 60000);
});