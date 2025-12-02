import { describe, it, expect, jest } from '@jest/globals';
import execa from 'execa';

// Helper to run bench command in the correct Docker sandbox
async function runBenchInSandbox({ site, funcPath, funcArgs = '[]', container = process.env.DOCKER_CONTAINER }: { site: string, funcPath: string, funcArgs?: string, container?: string }) {
  // Activate the venv and run bench as frappe user, just like manual steps
  const benchCommand = `source env/bin/activate && bench --site ${site} execute ${funcPath} --args '${funcArgs}'`;
  const resolvedContainer = container || process.env.DOCKER_CONTAINER || 'adoring_wiles';
  const dockerCmd: string[] = [
    'exec',
    '-u', 'frappe',
    '-w', '/home/frappe/frappe-bench',
    resolvedContainer,
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
        error: (err as any).stderr || (err as any).message,
        exitCode: (err as any).exitCode
      };
    }
    return { success: false, output: '', error: err instanceof Error ? err.message : String(err), exitCode: -1 };
  }
}

// Mock for non-docker mode
if (!process.env.USE_DOCKER) {
  jest.unstable_mockModule('../src/sandbox-shell.ts', () => ({
    executeInSandbox: jest.fn(async (_sandbox, command) => {
      const testSite = process.env.TEST_SITE || 'onefm';
      const testFunc = process.env.TEST_FUNC || 'frappe.utils.now_datetime';
      if (String(command).includes(`bench --site ${testSite} execute ${testFunc}`)) {
        return { stdout: `2025-11-29 12:34:56.789012\n`, stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: 'Unknown error', exitCode: 1 };
    })
  }));
}

const fakeSandbox = {};

describe('benchConsoleTool', () => {
  const isDocker = !!process.env.USE_DOCKER;
  const site = process.env.TEST_SITE || 'onefm';
  const funcPath = process.env.TEST_FUNC || 'frappe.utils.now_datetime';
  const funcArgs = process.env.TEST_FUNC_ARGS || '[]';

  it('should successfully run a Frappe function using bench execute', async () => {
    let result;
    if (isDocker) {
      result = await runBenchInSandbox({ site, funcPath, funcArgs });
      console.log('benchConsoleTool result:', result);
      expect(result.success).toBe(true);
      expect(result.output).toMatch(/\d{4}-\d{2}-\d{2}/); // Should look like a datetime string
    } else {
      // In mock mode, use the tool's invoke method
      const { benchConsoleTool } = await import('../tools.js');
      // Simulate the tool calling bench execute
      // Cast to 'any' to bypass schema mismatch until types are unified
      result = await benchConsoleTool.invoke({ site, funcPath, funcArgs, sandbox: fakeSandbox } as any);
      expect(result).toEqual({ success: true, output: '2025-11-29 12:34:56.789012\n' });
    }
  });

  it('should throw an error if the sandbox command fails', async () => {
    if (isDocker) {
      // In real Docker mode, this test may not be meaningful, so just skip or expect failure
      return;
    }
    const { executeInSandbox } = await import('../sandbox-shell.ts');
    // @ts-expect-error: Jest mock method
    executeInSandbox.mockResolvedValueOnce({ stdout: '', stderr: 'Bench execute failed', exitCode: 1 });
    const { benchConsoleTool } = await import('../tools.js');
    // Cast to 'any' to bypass schema mismatch until types are unified
    await expect(benchConsoleTool.invoke({ site, funcPath, funcArgs, sandbox: fakeSandbox } as any)).rejects.toThrow(
      /Bench execute failed/
    );
  });
});
