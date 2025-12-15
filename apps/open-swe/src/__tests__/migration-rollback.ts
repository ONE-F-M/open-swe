import { MigrationHandler } from '../../../cli/src/migration/migration-handler.js';
import { createFrappeSandbox, getCustomerCount, CUSTOMER_DOCTYPE_PATH } from './testing-bench-utils.js';

describe('Migration Rollback (Task 9.2)', () => {
  it('should restore database state after a failed migration attempt', async () => {
    // 1. Setup Sandbox and Baseline
    const sandbox = await createFrappeSandbox();
    
    // Create baseline backup before introducing the error
    await sandbox.execute(`bench --site ${sandbox.site} backup`);
    
    // Get initial record count to compare after rollback
    const initialCount = await getCustomerCount(sandbox);
    console.log(`Initial Customer record count: ${initialCount}`);

    // 2. Introduce Invalid Migration (e.g., duplicate fieldname, which is a structural error)
  const invalidDocTypeContent = JSON.stringify({
    name: "Customer Asset",
        fields: [
          { fieldname: 'duplicate_field', fieldtype: 'Data', label: 'Duplicate 1' },
          { fieldname: 'duplicate_field', fieldtype: 'Data', label: 'Duplicate 2' } // ERROR (MySQL will fail this)
        ]
    });
    
    await sandbox.writeFile(
      CUSTOMER_DOCTYPE_PATH,
      invalidDocTypeContent
    );

    // 3. Attempt Migration
    const handler = new MigrationHandler();
    // The handler should auto-detect the JSON change (due to CUSTOMER_DOCTYPE_PATH)
    const result = await handler.handlePostCodeChange([CUSTOMER_DOCTYPE_PATH]);

    // 4. Validate Failure and Rollback Assertions
    
    // ASSERTION A: Handler should fail and flag manual intervention
    expect(result.success).toBe(false);
    expect(result.requiresManualIntervention).toBe(true);
    
    // ASSERTION B: Database state must be restored (record count remains the same)
    const afterCount = await getCustomerCount(sandbox);
    console.log(`Customer record count after failed migration and rollback: ${afterCount}`);
    
    // The key test: the count must be identical, proving the restore worked
    expect(afterCount).toBe(initialCount);

    // ASSERTION C: Site should still be functional (critical check post-restore)
    // Running a simple command like list-apps should succeed, proving the bench isn't broken
    const listApps = await sandbox.execute(`bench --site ${sandbox.site} list-apps`);
    expect(listApps.exitCode).toBe(0);
    expect(listApps.stdout).toContain('frappe');
  },60000);
});