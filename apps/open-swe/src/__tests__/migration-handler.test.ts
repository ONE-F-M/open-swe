import { describe, it, expect, jest } from '@jest/globals';
import 'dotenv/config';

/**
 * Integration Test Requirements:
 * - Docker must be running and accessible.
 * - TEST_SITE and DOCKER_CONTAINER env vars must be set for real migrations.
 * - The test site must exist and be accessible in the container.
 * - Backup/restore operations require valid bench setup and permissions.
 */
// Minimal mock for Sandbox/ExtendedSandbox for tests
const mockSandbox: any = {
  shell: async (_command: string, _options: { user: string, timeout: number }) => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
  }),
};


describe('MigrationHandler', () => {
  const isDocker = !!process.env.USE_DOCKER;
  const site = process.env.TEST_SITE || 'onefm';

  it('should handle post code change migrations successfully', async () => {
    const { MigrationHandler } = await import('../migration/migration-handler.js');
    const handler = new MigrationHandler(mockSandbox, site);
    const changedFiles = ['apps/one_fm/one_fm/one_fm/doctype/client/client.json'];
    let result;
    if (isDocker) {
      // Actually run migration in Docker mode
      result = await handler.handlePostCodeChange(changedFiles);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.errors).toBeUndefined();
    } else {
      result = await handler.handlePostCodeChange(changedFiles);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.errors).toBeUndefined();
    }
  }, 120000); // 2 min timeout for integration

  it('should handle errors gracefully and format error messages', async () => {
    const { MigrationHandler } = await import('../migration/migration-handler.js');
    const handler = new MigrationHandler(mockSandbox, site);
    // Simulate an error by passing invalid input
    await expect(handler.handlePostCodeChange(undefined as any)).rejects.toThrow();
  });

  it('should restore from backup and return formatted error on migration failure', async () => {
    const { MigrationHandler } = await import('../migration/migration-handler.js');
    const handler = new MigrationHandler(mockSandbox, site);
    // Mock backup and restore to succeed, but migration to fail
    jest.spyOn(handler as any, 'backupSite').mockResolvedValue(undefined);
    jest.spyOn(handler as any, 'restoreSite').mockResolvedValue(undefined);
    // Simulate migration failure by throwing in benchMigrateTool
    const benchMigrateTool = await import('@openswe/cli/src/tools.js');
    jest.spyOn(benchMigrateTool.benchMigrateTool, 'invoke').mockImplementationOnce(() => {
      throw new Error('Simulated migration failure');
    });
    const changedFiles = ['apps/one_fm/one_fm/one_fm/doctype/client/client.json'];
    const result = await handler.handlePostCodeChange(changedFiles);
    expect(result.success).toBe(false);
    expect(result.requiresManualIntervention).toBe(true);
    expect(result.errors && result.errors[0]).toMatch(/Migration Failed|Simulated migration failure|timed out/);
  });
});
