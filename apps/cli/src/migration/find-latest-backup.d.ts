/**
 * Returns the absolute path to the most recent .sql.gz backup file for the given site.
 * Looks in the site's private/backups directory and sorts by mtime.
 */
export declare function findLatestBackup(site: string, benchPath: string): Promise<string | null>;
