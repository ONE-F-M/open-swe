import { Daytona, Sandbox, SandboxState } from "@daytonaio/sdk";
import dotenv from "dotenv";
import path from "path";
import { createLogger, LogLevel } from "./logger.js";
import { GraphConfig, TargetRepository } from "@openswe/shared/open-swe/types";
import { DEFAULT_SANDBOX_CREATE_PARAMS } from "../constants.js";
import { getGitHubTokensFromConfig } from "./github-tokens.js";
import { cloneRepo } from "./github/git.js";
import { FAILED_TO_GENERATE_TREE_MESSAGE, getCodebaseTree } from "./tree.js";
import { isLocalMode } from "@openswe/shared/open-swe/local-mode";


// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), "open-swe/.env") });

const logger = createLogger(LogLevel.INFO, "Sandbox");

// READ and validate the API key and Org ID
const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY;
const DAYTONA_ORGANIZATION_ID = process.env.DAYTONA_ORGANIZATION_ID;
if (!DAYTONA_API_KEY || !DAYTONA_ORGANIZATION_ID) {
  logger.error("Missing essential environment variables for Daytona client", {
    DAYTONA_API_KEY,
    DAYTONA_ORGANIZATION_ID,
    timestamp: new Date().toISOString(),
  });
}

// Singleton instance of Daytona
let daytonaInstance: Daytona | null = null;

/**
 * Returns a shared Daytona instance
 */
export function daytonaClient(): Daytona {
  if (!daytonaInstance) {
    // --- CHANGE IS HERE ---
    daytonaInstance = new Daytona({
      apiKey: DAYTONA_API_KEY, // Use the correct property for your API Key
      organizationId: DAYTONA_ORGANIZATION_ID, // Pass this just in case it's needed
    });
  }
  return daytonaInstance;
}

/**
 * Stops the sandbox. Either pass an existing sandbox client, or a sandbox session ID.
 * If no sandbox client is provided, the sandbox will be connected to.
 
 * @param sandboxSessionId The ID of the sandbox to stop.
 * @param sandbox The sandbox client to stop. If not provided, the sandbox will be connected to.
 * @returns The sandbox session ID.
 */
export async function stopSandbox(sandboxSessionId: string): Promise<string> {
  const sandbox = await daytonaClient().get(sandboxSessionId);
  if (
    sandbox.state === SandboxState.STOPPED ||
    sandbox.state === SandboxState.ARCHIVED
  ) {
    return sandboxSessionId;
  } else if (sandbox.state === "started") {
    await daytonaClient().stop(sandbox);
  }

  return sandbox.id;
}

/**
 * Creates a new sandbox.
 * @param attempt The attempt number (for logging and retry logic).
 * @returns The created sandbox, or null if creation failed.
 */
async function createSandbox(attempt: number): Promise<Sandbox | null> {
  try {
    logger.info("Attempting to create sandbox", {
      attempt,
      params: DEFAULT_SANDBOX_CREATE_PARAMS,
      timestamp: new Date().toISOString(),
    });
    return await daytonaClient().create(DEFAULT_SANDBOX_CREATE_PARAMS, {
      timeout: 100, // 100s timeout on creation. Adjust as needed.
    });
  } catch (e) {
    logger.error("Failed to create sandbox", {
      attempt,
      params: DEFAULT_SANDBOX_CREATE_PARAMS,
      ...(e instanceof Error
        ? {
            name: e.name,
            message: e.message,
            stack: e.stack,
          }
        : {
            error: e,
          }),
      timestamp: new Date().toISOString(),
    });
    return null;
  }
}

/**
 * Deletes the sandbox.
 * @param sandboxSessionId The ID of the sandbox to delete.
 * @returns True if the sandbox was deleted, false if it failed to delete.
 */
export async function deleteSandbox(
  sandboxSessionId: string,
): Promise<boolean> {
  try {
    const sandbox = await daytonaClient().get(sandboxSessionId);
    await daytonaClient().delete(sandbox);
    return true;
  } catch (error) {
    logger.error("Failed to delete sandbox", {
      sandboxSessionId,
      error,
      timestamp: new Date().toISOString(),
    });
    return false;
  }
}

export async function getSandboxWithErrorHandling(
  sandboxSessionId: string | undefined,
  targetRepository: TargetRepository,
  branchName: string,
  config: GraphConfig,
): Promise<{
  sandbox: Sandbox;
  codebaseTree: string | null;
  dependenciesInstalled: boolean | null;
}> {
  if (isLocalMode(config)) {
    // Use a lightweight mock for local mode
    const mockSandbox = {
      id: sandboxSessionId || "local-mock-sandbox",
      state: "started",
    } as Sandbox;
    return {
      sandbox: mockSandbox,
      codebaseTree: null,
      dependenciesInstalled: null,
    };
  }
  try {
    if (!sandboxSessionId) {
      throw new Error("No sandbox ID provided.");
    }

    logger.info("Getting sandbox.", {
      sandboxSessionId,
      timestamp: new Date().toISOString(),
    });
    // Try to get existing sandbox
    const sandbox = await daytonaClient().get(sandboxSessionId);

    // Check sandbox state
    const state = sandbox.state;

    if (state === "started") {
      return {
        sandbox,
        codebaseTree: null,
        dependenciesInstalled: null,
      };
    }

    if (state === "stopped" || state === "archived") {
      logger.info("Starting stopped/archived sandbox", {
        sandboxSessionId,
        state,
        timestamp: new Date().toISOString(),
      });
      await sandbox.start();
      return {
        sandbox,
        codebaseTree: null,
        dependenciesInstalled: null,
      };
    }

    // For any other state, recreate sandbox
    throw new Error(`Sandbox in unrecoverable state: ${state}`);
  } catch (error) {
    // Recreate sandbox if any step fails
    logger.info("Recreating sandbox due to error or unrecoverable state", {
      error,
      sandboxSessionId,
      timestamp: new Date().toISOString(),
    });

    let sandbox: Sandbox | null = null;
    let numSandboxCreateAttempts = 0;
    // Exponential backoff for sandbox creation attempts
    while (!sandbox && numSandboxCreateAttempts < 5) {
      sandbox = await createSandbox(numSandboxCreateAttempts);
      if (!sandbox) {
        numSandboxCreateAttempts++;
        // Exponential backoff: wait 2^n * 1000ms
        const backoff = Math.pow(2, numSandboxCreateAttempts) * 1000;
        logger.info("Waiting before next sandbox creation attempt", {
          attempt: numSandboxCreateAttempts,
          backoff,
          timestamp: new Date().toISOString(),
        });
        await new Promise(res => setTimeout(res, backoff));
      }
    }

    if (!sandbox) {
      logger.error("Failed to create sandbox after multiple attempts", {
        attempts: numSandboxCreateAttempts,
        timestamp: new Date().toISOString(),
      });
      throw new Error("Failed to create sandbox after multiple attempts");
    }

    const { githubInstallationToken } = getGitHubTokensFromConfig(config);

    // Clone repository
    await cloneRepo(sandbox, targetRepository, {
      githubInstallationToken,
      stateBranchName: branchName,
    });

    // Get codebase tree
    const codebaseTree = await getCodebaseTree(
      config,
      sandbox.id,
      targetRepository,
      2
    );
    const codebaseTreeToReturn =
      codebaseTree === FAILED_TO_GENERATE_TREE_MESSAGE ? null : codebaseTree;

    logger.info("Sandbox created successfully", {
      sandboxId: sandbox.id,
      timestamp: new Date().toISOString(),
    });
    return {
      sandbox,
      codebaseTree: codebaseTreeToReturn,
      dependenciesInstalled: false,
    };
  }
}
