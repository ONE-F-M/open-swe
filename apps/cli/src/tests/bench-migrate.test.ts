
import { describe, it, expect, jest } from '@jest/globals';
import execa from 'execa';

// Helper to run bench migrate in Docker as frappe user with correct env
async function runBenchMigrateInDocker({ site, container = process.env.DOCKER_CONTAINER || process.env.BENCH_CONTAINER || 'adoring_wiles' }: { site: string, container?: string }) {
  // Use the globally installed bench executable
  const benchExecutablePath = '/home/frappe/.local/bin/bench';
  const activatePath = '/home/frappe/frappe-bench/env/bin/activate';
  const finalBashCommand = `source ${activatePath} && cd /home/frappe/frappe-bench && ${benchExecutablePath} --site ${site} migrate`;
  const dockerCmd: string[] = [
    'exec',
    '-u', 'frappe',
    container,
    'bash', '-c',
    finalBashCommand
  ]; // Already using -u frappe, so this is correct
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

// Mock for non-docker mode
if (!process.env.USE_DOCKER) {
  jest.unstable_mockModule('../sandbox-shell.ts', () => ({
    executeInSandbox: jest.fn(async (_sandbox, command) => {
      const testSite = process.env.TEST_SITE || 'onefm';
      if (String(command).includes(`bench --site ${testSite} migrate`)) {
        return { stdout: 'Migrated successfully', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: 'Unknown error', exitCode: 1 };
    })
  }));
}

const fakeSandbox = {};

describe('benchMigrateTool', () => {
  const isDocker = !!process.env.USE_DOCKER;
  const site = process.env.TEST_SITE || 'onefm';

  it('should successfully migrate the specified site', async () => {
    let result;
    if (isDocker) {
      if (site === 'onefm') {
        // Only allow non-destructive tests on the golden snapshot site
        result = await runBenchMigrateInDocker({ site });
        // console.log('benchMigrateTool result:', result); // Removed to avoid logging after test
        expect(result.success).toBe(true);
        expect(result.output).toMatch(/Migrated|Success|Done|completed|ok/i);
      } else {
        throw new Error('Destructive tests must not use the golden snapshot site. Use a temporary site name.');
      }
    } else {
      const { benchMigrateTool } = await import('../tools.js');
      result = await benchMigrateTool.invoke({ site, sandbox: fakeSandbox } as any);
      expect(result).toEqual({ success: true, output: 'Migrated successfully' });
    }
  }, 120000); // Increased timeout to 2 minutes

  it('should handle errors gracefully', async () => {
    if (isDocker) {
      // In Docker mode, simulate a bad site name
      const badSite = 'nonexistent_site';
      const result = await runBenchMigrateInDocker({ site: badSite });
      expect(result.success).toBe(false);
      expect(result.error || result.output).toMatch(/not exist|error|fail|No such file or directory/i);
    } else {
      const { executeInSandbox } = await import('../sandbox-shell.ts');
      // @ts-expect-error: Jest mock method
      executeInSandbox.mockResolvedValueOnce({ stdout: '', stderr: 'Bench migrate failed', exitCode: 1 });
      const { benchMigrateTool } = await import('../tools.js');
      await expect(benchMigrateTool.invoke({ site: 'badsite', sandbox: fakeSandbox } as any)).rejects.toThrow(/Bench migrate failed/);
    }
  });
});