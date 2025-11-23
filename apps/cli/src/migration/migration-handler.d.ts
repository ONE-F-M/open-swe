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
export declare class MigrationHandler {
    handlePostCodeChange(changedFiles: string[]): Promise<MigrationResult>;
    private backupSite;
    private restoreSite;
}
export declare class AdvancedMigrationHandler extends MigrationHandler {
    handleComplexMigration(changes: FileChange[]): Promise<MigrationResult>;
    private handleRequiredFieldAddition;
    /**
     * REAL LOGIC: Counts the number of existing records in the database for a DocType.
     */
    private countExistingRecords;
    /**
     * REAL LOGIC: Extracts properties of a new required field from JSON changes.
     * NOTE: This is simplified to assume only one required field change for POC.
     */
    private extractNewRequiredField;
    private handleFieldRename;
    private handleFieldtypeChange;
    private parseDiff;
    private detectScenarios;
}
