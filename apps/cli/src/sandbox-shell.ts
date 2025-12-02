// apps/cli/src/sandbox-shell.ts
import { Sandbox } from "@daytonaio/sdk";
import { executeInDockerExec } from "./docker-exec-executor.js";
import { isLocalMode } from "@openswe/shared/open-swe/local-mode";

// Interface for standard command results
export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// CRITICAL FIX 1: Extend the Sandbox type to include the missing shell method.
// This tells TypeScript that although the public definition might be missing it, 
// the runtime object supports this method.
interface ExtendedSandbox extends Sandbox {
    shell: (command: string, options: { user: string, timeout: number }) => Promise<{
        stdout: string;
        stderr: string;
        exitCode: number | undefined;
    }>;
}

/**
 * Executes a shell command using the appropriate method (Daytona API or local Docker exec).
 * The `Sandbox` object passed here is the live Daytona connection or the local mock.
 */
export async function executeInSandbox(
  // Use the extended interface to satisfy the compiler
  sandbox: ExtendedSandbox, 
  command: string,
  workDir: string = "/home/frappe/frappe-bench"
): Promise<ExecutionResult> {
  // CRITICAL FIX 2: We must cast the object to 'any' to bypass the TypeScript error (TS2353) 
  // on the GraphConfig's 'configurable' property, as 'sandbox' is a dynamic runtime property.
  const isLocal = isLocalMode({ configurable: { sandbox } } as any);
  
  if (isLocal) {
    // 1. LOCAL MODE (Docker Exec fallback)
    // NOTE: This relies on the host having Docker installed and the container running.
    // We assume executeInDockerExec handles the frappe user and workDir internally.
    return executeInDockerExec(command, workDir);
    
  } else {
    // 2. REMOTE/CLOUD MODE (Daytona SDK API)
    
    // The command must be run as the 'frappe' user in the correct directory.
    const fullCommand = `cd ${workDir} && ${command}`;
    
    try {
      // Daytona SDK's shell execution API call
      const result = await sandbox.shell(fullCommand, {
        user: "frappe", // Critical for Frappe execution
        // Setting a generous timeout for migrations/tests
        timeout: 300000 // 5 minutes
      });
      
      // Daytona SDK results are clean JSON objects, but we extract to our standard interface
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode ?? 0,
      };
    } catch (error: any) {
      // Capture remote errors (timeouts, network disconnects)
      return {
        stdout: error.stdout || "",
        stderr: error.stderr || error.message || "Remote execution failed.",
        exitCode: error.exitCode || 1,
      };
    }
  }
}