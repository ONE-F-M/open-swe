// apps/cli/src/docker-exec-executor.ts
import execa from 'execa';
import { ExecutionResult } from "./sandbox-shell.js"; 

const BENCH_CONTAINER = process.env.DOCKER_CONTAINER_NAME || 'onefmfrappe-container';
const BENCH_PATH_CONTAINER = '/home/frappe/frappe-bench';
const FRAPPE_USER = 'frappe'; // The user inside the Docker container

/**
 * Executes a shell command directly inside a running Docker container 
 * using the local Docker CLI (used only in local development/testing mode).
 */
export async function executeInDockerExec(
  command: string,
  workDir: string = BENCH_PATH_CONTAINER
): Promise<ExecutionResult> {

  // Construct the command to run bash inside Docker as the frappe user
  const dockerExecCommand = `docker exec -u ${FRAPPE_USER} ${BENCH_CONTAINER} bash -lc "cd ${workDir} && ${command}"`;

  try {
    // execa runs the command on the host OS
    const result = await execa(dockerExecCommand, { 
        shell: true, 
        stdio: 'pipe' 
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  } catch (error: any) {
    // Capture the result even on failure (non-zero exit code)
    return {
        stdout: error.stdout || "",
        stderr: error.stderr || error.message,
        exitCode: error.exitCode || 1,
    };
  }
}