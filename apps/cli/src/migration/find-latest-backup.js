import * as fs from 'fs/promises';
import * as path from 'path';
/**
 * Returns the absolute path to the most recent .sql.gz backup file for the given site.
 * Looks in the site's private/backups directory and sorts by mtime.
 */
export async function findLatestBackup(site, benchPath) {
    const backupDir = path.join(benchPath, 'sites', site, 'private', 'backups');
    let files;
    try {
        files = await fs.readdir(backupDir);
    }
    catch (err) {
        return null;
    }
    const sqlGzFiles = files.filter(f => f.endsWith('.sql.gz'));
    if (sqlGzFiles.length === 0)
        return null;
    // Get full paths and stats
    const stats = await Promise.all(sqlGzFiles.map(async (f) => {
        const fullPath = path.join(backupDir, f);
        const stat = await fs.stat(fullPath);
        return { file: fullPath, mtime: stat.mtime };
    }));
    // Sort by mtime descending
    stats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return stats[0].file;
}
