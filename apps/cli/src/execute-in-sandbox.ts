import execa from 'execa';

// Define the shape of the command output for standard tool execution
export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Executes a shell command inside the running Frappe Docker container.
 * * NOTE: This relies on the DOCKER_CONTAINER_NAME being set in the host environment.
 * In a real Daytona environment, this would use the Daytona SDK's shell execution API.
 */
export async function executeInSandbox(
  command: string,
  workDir: string = "/home/frappe/frappe-bench"
): Promise<ExecutionResult> {
  const containerName = process.env.DOCKER_CONTAINER || "onefmfrappe-container";
  const user = "frappe"; // The user running bench commands

  // The command must be run as the frappe user, inside the correct directory.
  const dockerArgs = [
    'exec',
    '-u', user,
    '-w', workDir,
    containerName,
    'bash', '-c', command
  ];
  console.log(`[executeInSandbox] Running: docker ${dockerArgs.join(' ')}`);
  try {
    const result = await execa('docker', dockerArgs);
    console.log(`[executeInSandbox] Success:`, result);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  } catch (error) {
    const execaResult = error as any;
    console.error(`[executeInSandbox] Command failed: docker ${dockerArgs.join(' ')}`, {
      stdout: execaResult.stdout,
      stderr: execaResult.stderr,
      exitCode: execaResult.exitCode,
    });
    return {
      stdout: execaResult.stdout || "",
      stderr: execaResult.stderr || execaResult.message,
      exitCode: execaResult.exitCode || 1,
    };
  }
}