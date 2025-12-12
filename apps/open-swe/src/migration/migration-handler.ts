import { benchMigrateTool, benchConsoleTool, benchClearCacheTool, benchRestartTool, benchBackupTool } from '@openswe/cli/src/tools.js';
import { FrappeErrorHandler } from '../../../open-swe/src/error-handler.js';
import { findLatestBackup } from './find-latest-backup.js';
// Accept both SDK Sandbox and local test Sandbox for integration tests
export type CompatibleSandbox = import('@daytonaio/sdk').Sandbox | import('../__tests__/testing-bench-utils.test.js').Sandbox;
import { executeInSandbox } from '@openswe/cli/src/sandbox-shell.js';

// Default site name and migration timeout configuration
const SITE_NAME_DEFAULT = process.env.SITE_NAME || 'onefm';
const MIGRATION_TIMEOUT_MS_CHECK = 5 * 60 * 1000;


// Migration result and file change types for migration operations
export interface MigrationResult {
  success: boolean;
  migrationsRun: string[];
  errors?: string[];
  requiresManualIntervention: boolean;
}

export interface FileChange {
  path: string;
  newContent?: string;
  oldContent?: string;
}

// Helper function: Executes Python code in Frappe bench context using sandbox
async function executeBenchPython(sandbox: CompatibleSandbox, site: string, pythonCode: string): Promise<string> {
    const result = await benchConsoleTool.invoke({ site, code: `print(${pythonCode})`, sandbox } as any);
    const stdout = (result && typeof result === 'object' && 'stdout' in result) ? (result as any).stdout : '';
    return stdout.trim().split('\n').pop() || '';
}

// MigrationHandler: Handles post-code-change migration logic and error recovery
export class MigrationHandler {
  private errorHandler = new FrappeErrorHandler();
  public sandbox: CompatibleSandbox;
  public siteName: string;

  // Accepts a live Sandbox instance and optional site name
  constructor(sandbox: CompatibleSandbox, siteName?: string) {
    this.sandbox = sandbox as any;
    this.siteName = siteName || SITE_NAME_DEFAULT;
  }

  // Runs migration after code changes, backs up site, handles timeout and errors
  async handlePostCodeChange(changedFiles: string[]): Promise<MigrationResult> {
    // Check if migration is needed based on changed DocType JSON files
    const needsMigration = changedFiles.some(
      file => file.includes('.json') && file.includes('doctype')
    );
    if (!needsMigration) {
      return { success: true, migrationsRun: [], requiresManualIntervention: false };
    }

    // Backup site before running migration
    await this.backupSite();

    let migrationTimedOut = false;
    let migrationError: any = null;
    let result: any = null;

    try {
      // Run migration with timeout protection
      result = await Promise.race([
        benchMigrateTool.invoke({ site: this.siteName, sandbox: this.sandbox }),
        new Promise((_, reject) => setTimeout(() => {
          migrationTimedOut = true;
          reject(new Error('Migration timed out after 5 minutes'));
        }, MIGRATION_TIMEOUT_MS_CHECK))
      ]);

      // If migration succeeded, run clear-cache and restart
      if (result && result.success) {
        try {
          const clearCacheResult = await benchClearCacheTool.invoke({ site: this.siteName, sandbox: this.sandbox });
          if (!clearCacheResult.success) {
            console.warn(`[MigrationHandler] benchClearCacheTool failed.`);
          }
          const restartResult = await benchRestartTool.invoke({ site: this.siteName, sandbox: this.sandbox });
          if (!restartResult.success) {
            console.warn(`[MigrationHandler] benchRestartTool failed.`);
          }
        } catch (e) {
          console.warn(`[MigrationHandler] benchClearCacheTool or benchRestartTool invocation failed: ${e}`);
        }
      }
    } catch (error: any) {
      migrationError = error;
    }

    // If migration fails or times out, restore from backup and format error
    if (migrationTimedOut || migrationError) {
      await this.restoreSite();
      const errorMsg = migrationError ? this.errorHandler.formatMigrationError(String(migrationError)) : 'Migration timed out after 5 minutes';
      return {
        success: false,
        errors: [errorMsg],
        requiresManualIntervention: true,
        migrationsRun: [],
      };
    }

    // Return migration result
    return {
      success: result.success,
      migrationsRun: Array.isArray(result.migrationsRun) ? result.migrationsRun.map(String) : [],
      requiresManualIntervention: false,
    };
  }

  // Creates a database backup for the site before migration
  private async backupSite(): Promise<void> {
    try {
      const backupResult = await benchBackupTool.invoke({ site: this.siteName, sandbox: this.sandbox });
      if (!backupResult.success) {
        throw new Error(`Backup failed for site ${this.siteName}`);
      }
      console.log(`[MigrationHandler] Backup successful for site ${this.siteName}.`);
    } catch (e) {
      const errorMsg = this.errorHandler.formatMigrationError(String(e));
      throw new Error(`CRITICAL: Failed to create database backup before migration.\n${errorMsg}`);
    }
  }

  // Restores the site database from the latest backup if migration fails
  private async restoreSite(): Promise<void> {
    const benchPath = "/home/frappe/frappe-bench";
    const latestBackup = await findLatestBackup(this.siteName, benchPath);
    if (!latestBackup) {
      const errorMsg = this.errorHandler.formatMigrationError('No backup file found');
      throw new Error(`CRITICAL: No backup file found to restore site ${this.siteName}. Manual intervention required.\n${errorMsg}`);
    }
    const command = `bench --site ${this.siteName} restore ${latestBackup}`;
    try {
      await executeInSandbox(this.sandbox as any, command);
      console.log(`[MigrationHandler] Database restored successfully from ${latestBackup}.`);
    } catch (e) {
      const errorMsg = this.errorHandler.formatMigrationError(String(e));
      throw new Error(`FATAL: Restore failed. MANUAL INTERVENTION MANDATORY.\n${errorMsg}`);
    }
  }
}

// AdvancedMigrationHandler: Handles complex migration scenarios and edge cases
export class AdvancedMigrationHandler extends MigrationHandler {
  // Handles complex migration scenarios based on detected changes
  async handleComplexMigration(changes: FileChange[]): Promise<MigrationResult> {
    const scenarios = this.detectScenarios(changes);

    if (scenarios.includes('ADD_REQUIRED_FIELD_TO_EXISTING_DOCTYPE')) {
      return this.handleRequiredFieldAddition(changes);
    }

    if (scenarios.includes('RENAME_FIELD')) {
      return this.handleFieldRename(changes);
    }

    if (scenarios.includes('CHANGE_FIELDTYPE')) {
      return this.handleFieldtypeChange(changes);
    }

    // Fallback to standard migration if no complex scenario detected
    return super.handlePostCodeChange(changes.map(c => c.path));
  }

  // Handles addition of required field to existing DocType, checks for default value
  private async handleRequiredFieldAddition(changes: FileChange[]): Promise<MigrationResult> {
    const field = this.extractNewRequiredField(changes);
    const count = await this.countExistingRecords(field.doctype);
    // If records exist and field is required with no default, manual intervention is required
    if (count > 0 && field.reqd && !field.default) { 
      return {
        success: false,
        requiresManualIntervention: true,
        migrationsRun: [],
        errors: [
          `Cannot add required field '${field.fieldname}' to ${field.doctype} without default value. ` +
          `DocType has ${count} existing records. ` +
          `Either: 1) Add 'default' value to field, or 2) Make field non-required initially.`
        ]
      };
    }
    // Proceed with migration if safe
    return super.handlePostCodeChange(changes.map(c => c.path));
  }

  // Counts the number of existing records for a DocType in the database
  private async countExistingRecords(doctype: string): Promise<number> {
    try {
      const pythonCode = `print(frappe.db.count('${doctype}'))`;
      const countStr = await executeBenchPython(this.sandbox as any, this.siteName, pythonCode);
      return parseInt(countStr) || 0;
    } catch (e) {
      return 0;
    }
  }

  // Extracts properties of a new required field from JSON changes (simplified for POC)
  private extractNewRequiredField(changes: FileChange[]): { fieldname: string, doctype: string, default?: any, reqd: boolean } {
    const defaultOutput = { fieldname: '', doctype: '', reqd: false };
    for (const change of changes) {
        if (!change.path.endsWith('.json') || !change.newContent) continue;
        // Extract DocType name from file path
        const parts = change.path.split('/');
        const doctypeName = parts[parts.length - 2]; 
        try {
            const diff = this.parseDiff(change);
            // Find the newly added required field
            const newRequiredField = diff.fieldsAdded.find((f: any) => f.reqd === 1);
            if (newRequiredField) {
                return {
                    fieldname: newRequiredField.fieldname,
                    doctype: doctypeName,
                    default: newRequiredField.default,
                    reqd: true
                };
            }
        } catch (e) {
            console.error("Error parsing JSON schema in extractNewRequiredField", e);
        }
    }
    return defaultOutput;
  }

  // Handles field rename scenario, requires manual intervention
  private async handleFieldRename(_changes: FileChange[]): Promise<MigrationResult> {
    return {
        success: false,
        requiresManualIntervention: true,
        migrationsRun: [],
        errors: [
            "Field Rename Detected: Frappe's schema tools do not automatically migrate data on rename. Manual intervention required to run a custom data migration script."
        ]
    };
  }

  // Handles field type change scenario, requires manual intervention
  private async handleFieldtypeChange(_changes: FileChange[]): Promise<MigrationResult> {
    return {
        success: false,
        requiresManualIntervention: true,
        migrationsRun: [],
        errors: [
            "Field Type Change Detected: Changing field types (e.g., Data to Link) may cause data loss. Manual intervention required to review data integrity before proceeding."
        ]
    };
  }

  // Parses diff from file change, simulates DocType diffing for POC
  private parseDiff(change: FileChange): any {
    if (!change.newContent) return { fieldsAdded: [], fieldsModified: [] };
    try {
        const newSchema = JSON.parse(change.newContent);
        // Placeholder: assumes 'fieldsAdded' is the difference between old and new schema
        // Detects required fields added for migration scenario
        const addedRequiredFields = newSchema.fields.filter((f: any) => f.reqd === 1 );
        return {
            fieldsAdded: addedRequiredFields,
            fieldsModified: [],
        };
    } catch (e) {
        console.error(`Failed to parse DocType JSON for diff: ${change.path}`);
        return { fieldsAdded: [], fieldsModified: [] };
    }
  }

  // Detects migration scenarios by analyzing JSON diffs in file changes
  private detectScenarios(changes: FileChange[]): string[] {
    const scenarios: string[] = [];
    for (const change of changes) {
      if (!change.path.endsWith('.json')) continue;
      const diff = this.parseDiff(change);
      // Detect adding required field
      if (diff.fieldsAdded && diff.fieldsAdded.some((f: any) => f.reqd === 1)) {
        scenarios.push('ADD_REQUIRED_FIELD_TO_EXISTING_DOCTYPE');
      }
      // Detect field rename
      if (diff.fieldsModified && diff.fieldsModified.some((f: any) => f.oldFieldname !== f.newFieldname)) {
        scenarios.push('RENAME_FIELD');
      }
      // Detect field type change
      if (diff.fieldsModified && diff.fieldsModified.some((f: any) => f.oldFieldtype !== f.newFieldtype)) {
        scenarios.push('CHANGE_FIELDTYPE');
      }
    }
    return scenarios;
  }
}


