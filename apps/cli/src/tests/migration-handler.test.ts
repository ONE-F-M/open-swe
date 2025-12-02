

import { describe, it, expect, jest } from '@jest/globals';
import execa from 'execa';
import 'dotenv/config';

// Helper to run bench migrate in Docker as frappe user with correct env
async function runBenchMigrateInDocker({ site, container = process.env.DOCKER_CONTAINER || process.env.BENCH_CONTAINER || 'adoring_wiles' }: { site: string, container?: string }) {
  const benchExecutablePath = '/home/frappe/.local/bin/bench';
  const activatePath = '/home/frappe/frappe-bench/env/bin/activate';
  const finalBashCommand = `source ${activatePath} && cd /home/frappe/frappe-bench && ${benchExecutablePath} --site ${site} migrate`;
  const dockerCmd: string[] = [
    'exec',
    '-u', 'frappe',
    container,
    'bash', '-c',
    finalBashCommand
  ];
  try {
    const { stdout, stderr, exitCode } = await execa('docker', dockerCmd);
    return { success: exitCode === 0, output: stdout, error: stderr, exitCode };
  } catch (err) {
    if (err && typeof err === 'object' && err !== null && "stdout" in err && "stderr" in err && "exitCode" in err) {
      return {
        success: false,
        output: (err as any).stdout,
        error: (err as any).stderr || ((err as unknown as Error).message ?? String(err)),
        exitCode: (err as any).exitCode
      };
    }
    return { success: false, output: '', error: err instanceof Error ? err.message : String(err), exitCode: -1 };
  }
}




describe('MigrationHandler', () => {
  const isDocker = !!process.env.USE_DOCKER;
  const site = process.env.TEST_SITE || 'onefm';

  it('should handle post code change migrations successfully', async () => {
    const { MigrationHandler } = await import('../migration/migration-handler.js');
    const handler = new MigrationHandler({}, process.env.TEST_SITE || 'onefm');
    const changedFiles = ['apps/one_fm/one_fm/one_fm/doctype/client/client.json'];
    let result;
    if (isDocker) {
      // Actually run migration in Docker mode
      result = await handler.handlePostCodeChange(changedFiles);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    } else {
      result = await handler.handlePostCodeChange(changedFiles);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    }
  }, 120000); // 2 min timeout for integration

  it('should handle errors gracefully', async () => {
    const { MigrationHandler } = await import('../migration/migration-handler.js');
    const handler = new MigrationHandler({}, process.env.TEST_SITE || 'onefm');
    // Simulate an error by passing invalid input
    await expect(handler.handlePostCodeChange(undefined as any)).rejects.toThrow();
  });

  it('should restore from backup on migration failure', async () => {
    const { MigrationHandler } = await import('../migration/migration-handler.js');
    const handler = new MigrationHandler({}, process.env.TEST_SITE || 'onefm');
    // Mock backup and restore to succeed, but migration to fail
    jest.spyOn(handler as any, 'backupSite').mockResolvedValue(undefined);
    jest.spyOn(handler as any, 'restoreSite').mockResolvedValue(undefined);
    // Simulate migration failure by throwing in benchMigrateTool
    const benchMigrateTool = await import('../tools.js');
    jest.spyOn(benchMigrateTool.benchMigrateTool, 'invoke').mockImplementationOnce(() => {
      throw new Error('Simulated migration failure');
    });
    const changedFiles = ['apps/one_fm/one_fm/one_fm/doctype/client/client.json'];
    const result = await handler.handlePostCodeChange(changedFiles);
    expect(result.success).toBe(false);
    expect(result.requiresManualIntervention).toBe(true);
    expect(result.errors && result.errors[0]).toMatch(/Migration timed out|Migration Failed|Simulated migration failure/);
  });
});
