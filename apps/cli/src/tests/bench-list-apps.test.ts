
import { describe, it, expect, jest } from '@jest/globals';
import execa from 'execa';

// Helper to run bench list-apps in Docker as frappe user with correct env
async function runBenchListAppsInDocker({ site, container = process.env.DOCKER_CONTAINER || process.env.BENCH_CONTAINER || 'adoring_wiles' }: { site: string, container?: string }) {
  const benchCommand = `source env/bin/activate && bench --site ${site} list-apps`;
  const dockerCmd = [
    'exec',
    '-u', 'frappe',
    '-w', '/home/frappe/frappe-bench',
    container,
    'bash', '-c',
    benchCommand
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

// Mock for non-docker mode
if (!process.env.USE_DOCKER) {
  jest.unstable_mockModule('../sandbox-shell.ts', () => ({
    executeInSandbox: jest.fn(async (_sandbox, command) => {
      const testSite = process.env.TEST_SITE || 'onefm';
      if (String(command).includes(`bench --site ${testSite} list-apps`)) {
        return { stdout: 'frappe\nerpnext\none_fm', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: 'Unknown error', exitCode: 1 };
    })
  }));
}

const fakeSandbox = {};

describe('benchListAppsTool', () => {
  const isDocker = !!process.env.USE_DOCKER;
  const site = process.env.TEST_SITE || 'onefm';

  it('should successfully list installed apps for the specified site', async () => {
    let result;
    if (isDocker) {
      result = await runBenchListAppsInDocker({ site });
      console.log('benchListAppsTool result:', result);
      expect(result.success).toBe(true);
      expect(result.output).toMatch(/frappe/); // Should list at least frappe
    } else {
      const { benchListAppsTool } = await import('../tools.js');
      result = await benchListAppsTool.invoke({ site, sandbox: fakeSandbox } as any);
      expect(result).toEqual({ success: true, output: 'frappe\nerpnext\none_fm' });
    }
  });

  it('should handle errors gracefully', async () => {
    if (isDocker) {
      // In Docker mode, simulate a bad site name
      const badSite = 'nonexistent_site';
      const result = await runBenchListAppsInDocker({ site: badSite });
      expect(result.success).toBe(false);
      expect(result.error || result.output).toMatch(/not exist|error|fail/i);
    } else {
      const { executeInSandbox } = await import('../sandbox-shell.ts');
      // @ts-expect-error: Jest mock method
      executeInSandbox.mockResolvedValueOnce({ stdout: '', stderr: 'Bench list-apps failed', exitCode: 1 });
      const { benchListAppsTool } = await import('../tools.js');
      await expect(benchListAppsTool.invoke({ site: 'badsite', sandbox: fakeSandbox } as any)).rejects.toThrow(/Bench list-apps failed/);
    }
  });
});
