import { benchMigrateTool } from '../tools.js';
import { execaCommand } from 'execa';
import { findLatestBackup } from './find-latest-backup.js';
// --- Configuration Constants ---
const BENCH_PATH = '/Users/samdani/Desktop/onefm_bench';
const SITE_NAME = 'onefm.localhost'; // Using the hardcoded site name from the original snippet
// --- Helper Functions for Bench Interaction ---
/**
 * Executes a Python snippet within the Frappe bench context to interact with the database.
 * @param pythonCode The code snippet to execute (e.g., frappe.db.count('DocType')).
 */
async function executeBenchPython(pythonCode) {
    // The command uses 'bench execute' to run Python code on the site
    const command = `bench --site ${SITE_NAME} execute "${pythonCode}"`;
    try {
        const { stdout } = await execaCommand(command, { cwd: BENCH_PATH, shell: true });
        // stdout often includes a newline and function name in Frappe; trim it.
        return stdout.trim().split('\n').pop() || '';
    }
    catch (error) {
        throw new Error(`Bench Execute Failed: ${error.message}`);
    }
}
// --- MigrationHandler (Standard Logic) ---
export class MigrationHandler {
    // ... (handlePostCodeChange, backupSite, restoreSite remain the same) ...
    async handlePostCodeChange(changedFiles) {
        // Detect if migrations are needed
        const needsMigration = changedFiles.some(file => file.includes('.json') && file.includes('doctype'));
        if (!needsMigration) {
            return { success: true, migrationsRun: [], requiresManualIntervention: false };
        }
        // Backup before migration
        await this.backupSite(SITE_NAME);
        let migrationTimedOut = false;
        let migrationError = null;
        let result = null;
        const MIGRATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
        try {
            // Run migration with timeout
            result = await Promise.race([
                benchMigrateTool.invoke({ site: SITE_NAME }),
                new Promise((_, reject) => setTimeout(() => {
                    migrationTimedOut = true;
                    reject(new Error('Migration timed out after 5 minutes'));
                }, MIGRATION_TIMEOUT_MS))
            ]);
        }
        catch (error) {
            migrationError = error;
        }
        // Detect foreign key violation or other DB errors
        const errorMessages = [];
        let requiresManualIntervention = false;
        if (migrationTimedOut) {
            errorMessages.push('Migration timed out. Please check for long-running operations or deadlocks.');
            requiresManualIntervention = true;
        }
        else if (migrationError) {
            errorMessages.push(migrationError.message);
            // Check for foreign key violation
            if (/foreign key constraint|foreign key violation|FOREIGN KEY/.test(migrationError.message)) {
                errorMessages.push('Foreign key violation detected. Manual database intervention may be required.');
                requiresManualIntervention = true;
            }
            requiresManualIntervention = true;
        }
        else if (result && result.stderr) {
            // Check for foreign key violation in stderr
            if (/foreign key constraint|foreign key violation|FOREIGN KEY/.test(result.stderr)) {
                errorMessages.push('Foreign key violation detected during migration. Manual database intervention may be required.');
                requiresManualIntervention = true;
            }
        }
        if (migrationTimedOut || migrationError || requiresManualIntervention) {
            // Migration failed or timed out - restore backup
            await this.restoreSite(SITE_NAME);
            return {
                success: false,
                errors: errorMessages.length ? errorMessages : [migrationError?.message || 'Unknown migration failure'],
                requiresManualIntervention: true,
                migrationsRun: [],
            };
        }
        // Success
        return {
            success: result.success,
            migrationsRun: Array.isArray(result.migrationsRun)
                ? result.migrationsRun.map(String)
                : typeof result.migrationsRun === 'number'
                    ? [result.migrationsRun.toString()]
                    : [],
            requiresManualIntervention: false,
        };
    }
    async backupSite(site) {
        // Create quick database dump (no files)
        await execaCommand(`bench --site ${site} backup`, { cwd: BENCH_PATH, shell: true });
    }
    async restoreSite(site) {
        // Restore from latest backup
        const latestBackup = await findLatestBackup(site, BENCH_PATH);
        if (!latestBackup) {
            throw new Error(`No backup file found for site ${site}`);
        }
        await execaCommand(`bench --site ${site} restore ${latestBackup}`, { cwd: BENCH_PATH, shell: true });
    }
}
// --- AdvancedMigrationHandler (Edge Case Logic) ---
export class AdvancedMigrationHandler extends MigrationHandler {
    async handleComplexMigration(changes) {
        // Detect complex scenarios
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
        // Standard migration
        return super.handlePostCodeChange(changes.map(c => c.path));
    }
    // Handle adding required field to existing DocType
    async handleRequiredFieldAddition(changes) {
        // Required fields need defaults on existing records
        const field = this.extractNewRequiredField(changes);
        // Check if DocType has existing records
        const count = await this.countExistingRecords(field.doctype);
        // Safety check: if records exist AND field is required AND no default value is set
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
        // Proceed with migration
        return super.handlePostCodeChange(changes.map(c => c.path));
    }
    /**
     * REAL LOGIC: Counts the number of existing records in the database for a DocType.
     */
    async countExistingRecords(doctype) {
        try {
            // Use frappe.db.count() via bench execute
            const pythonCode = `print(frappe.db.count('${doctype}'))`;
            const countStr = await executeBenchPython(pythonCode);
            return parseInt(countStr) || 0;
        }
        catch (e) {
            // If DocType doesn't exist yet, count will be 0.
            return 0;
        }
    }
    /**
     * REAL LOGIC: Extracts properties of a new required field from JSON changes.
     * NOTE: This is simplified to assume only one required field change for POC.
     */
    extractNewRequiredField(changes) {
        const defaultOutput = { fieldname: '', doctype: '', reqd: false };
        for (const change of changes) {
            if (!change.path.endsWith('.json') || !change.newContent)
                continue;
            // Simplified: DocType name from path: custom_app/.../doctype/DocName/DocName.json
            const parts = change.path.split('/');
            const doctypeName = parts[parts.length - 2];
            try {
                // const newSchema = JSON.parse(change.newContent);
                const diff = this.parseDiff(change); // Use the parser utility
                // Find the newly added required field
                const newRequiredField = diff.fieldsAdded.find((f) => f.reqd === 1);
                if (newRequiredField) {
                    return {
                        fieldname: newRequiredField.fieldname,
                        doctype: doctypeName,
                        default: newRequiredField.default,
                        reqd: true
                    };
                }
            }
            catch (e) {
                console.error("Error parsing JSON schema in extractNewRequiredField", e);
            }
        }
        return defaultOutput;
    }
    // Dummy: Handle field rename (Complexity delegated to manual intervention/custom script)
    async handleFieldRename(_changes) {
        return {
            success: false,
            requiresManualIntervention: true,
            migrationsRun: [],
            errors: [
                "Field Rename Detected: Frappe's schema tools do not automatically migrate data on rename. Manual intervention required to run a custom data migration script."
            ]
        };
    }
    // Dummy: Handle fieldtype change (Complexity delegated to manual intervention/custom script)
    async handleFieldtypeChange(_changes) {
        return {
            success: false,
            requiresManualIntervention: true,
            migrationsRun: [],
            errors: [
                "Field Type Change Detected: Changing field types (e.g., Data to Link) may cause data loss. Manual intervention required to review data integrity before proceeding."
            ]
        };
    }
    // REAL LOGIC (Simplified): Parse diff from change (Requires newContent and oldContent in FileChange)
    parseDiff(change) {
        // This requires a full DocType Diffing engine (complex). 
        // For POC, we simulate the output based on new content only, assuming the Planner supplies the diff metadata.
        if (!change.newContent)
            return { fieldsAdded: [], fieldsModified: [] };
        try {
            const newSchema = JSON.parse(change.newContent);
            // This is a placeholder that assumes 'fieldsAdded' is the difference between the old and new schema.
            // In reality, this would require loading the 'oldContent' JSON and computing the difference.
            // Safety check for ADD_REQUIRED_FIELD_TO_EXISTING_DOCTYPE:
            const addedRequiredFields = newSchema.fields.filter((f) => 
            // Simplified detection: checks if field has reqd=1 and assumes it's 'added' 
            // if we can't reliably read the old state.
            f.reqd === 1);
            return {
                fieldsAdded: addedRequiredFields,
                fieldsModified: [],
                // Other fields like 'oldFieldname', 'newFieldname' would be here
            };
        }
        catch (e) {
            console.error(`Failed to parse DocType JSON for diff: ${change.path}`);
            return { fieldsAdded: [], fieldsModified: [] };
        }
    }
    detectScenarios(changes) {
        // Analyze JSON diffs to detect migration patterns
        const scenarios = [];
        for (const change of changes) {
            if (!change.path.endsWith('.json'))
                continue;
            const diff = this.parseDiff(change);
            // Detect adding required field (simplified based on parseDiff output)
            if (diff.fieldsAdded && diff.fieldsAdded.some((f) => f.reqd === 1)) {
                scenarios.push('ADD_REQUIRED_FIELD_TO_EXISTING_DOCTYPE');
            }
            // These are still hard-coded to rely on a complete diff parser that must be implemented
            if (diff.fieldsModified && diff.fieldsModified.some((f) => f.oldFieldname !== f.newFieldname)) {
                scenarios.push('RENAME_FIELD');
            }
            if (diff.fieldsModified && diff.fieldsModified.some((f) => f.oldFieldtype !== f.newFieldtype)) {
                scenarios.push('CHANGE_FIELDTYPE');
            }
        }
        return scenarios;
    }
}
