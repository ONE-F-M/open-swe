
import { getCurrentTaskInput } from "@langchain/langgraph";
import {
  GraphState,
  TargetRepository,
  GraphConfig,
} from "@openswe/shared/open-swe/types";
import { createLogger, LogLevel } from "./logger.js";
import { SANDBOX_ROOT_DIR, TIMEOUT_SEC } from "@openswe/shared/constants";
import { getSandboxErrorFields } from "./sandbox-error-fields.js";
import { isLocalMode } from "@openswe/shared/open-swe/local-mode";
import { createShellExecutor } from "./shell-executor/index.js";

const logger = createLogger(LogLevel.INFO, "Tree");

// Per-session cache for codebase trees
const codebaseTreeCache: Record<string, string> = {};

export const FAILED_TO_GENERATE_TREE_MESSAGE =
  "Failed to generate tree. Please try again.";

// Patterns to exclude from the codebase tree output
const EXCLUDE_PATTERNS = [
  // Node/JS/TS
  "node_modules",
  ".turbo",
  "dist",
  "coverage",
  "build",
  "*.log",
  "*.test.ts",
  "*.spec.ts",
  "*.test.js",
  "*.spec.js",
  "*.map",
  "yarn.lock",
  "package-lock.json",
  // Python
  "*.pyc",
  "__pycache__",
  "env",
  ".env",
  ".env.*",
  // Frappe/ERPNext
  "sites",
  "public",
  "private",
  "*.sqlite3",
  "*.db",
  // Tests
  "__mocks__",
  "__tests__",
  // Docs & configs
  "*.md",
  "*.rst",
  "*.csv",
  "*.xlsx",
  "*.json",
  // Images & binaries
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.svg",
  "*.gif",
  "*.ico",
  "*.pdf",
  "*.zip",
  "*.tar",
  "*.gz",
  // Misc
  ".git",
  ".DS_Store",
  "*.swp",
  "*.tmp",
  "Thumbs.db",
];

function shouldExclude(line: string): boolean {
  // Simple pattern matching: exclude if any pattern is a substring (can be improved with glob)
  return EXCLUDE_PATTERNS.some((pat) => {
    if (pat.startsWith("*")) {
      // Suffix match
      return line.trim().endsWith(pat.slice(1));
    } else if (pat.endsWith("*")) {
      // Prefix match
      return line.trim().startsWith(pat.slice(0, -1));
    } else {
      // Substring match
      return line.includes(pat);
    }
  });
}

export async function getCodebaseTree(
  config: GraphConfig,
  sandboxSessionId_?: string,
  targetRepository_?: TargetRepository,
  // targetDir: string = "apps/one_fm",
  depth: number = 2
): Promise<string> {
  try {
    // Run git ls-files from repo root and tree fromfile without redundant dir arg
    const command = `git ls-files | tree --fromfile -L ${depth}`;
    let sandboxSessionId = sandboxSessionId_;
    let targetRepository = targetRepository_;

    // Check if we're in local mode
    if (isLocalMode(config)) {
      // Use a single cache entry for local mode
      if (codebaseTreeCache['local']) {
        return codebaseTreeCache['local'];
      }
      let tree = await getCodebaseTreeLocal(config, depth);
      // Filter output lines
      tree = tree
        .split('\n')
        .filter((line) => !shouldExclude(line))
        .join('\n');
      codebaseTreeCache['local'] = tree;
      return tree;
    }

    // If sandbox session ID is not provided, try to get it from the current state.
    if (!sandboxSessionId || !targetRepository) {
      try {
        const state = getCurrentTaskInput<GraphState>();
        sandboxSessionId = sandboxSessionId ?? state.sandboxSessionId;
        targetRepository = targetRepository ?? state.targetRepository;
      } catch {
        // not executed in a LangGraph instance. continue.
      }
    }

    if (!sandboxSessionId) {
      logger.error("Failed to generate tree: No sandbox session ID provided");
      throw new Error("Failed generate tree: No sandbox session ID provided");
    }
    if (!targetRepository) {
      logger.error("Failed to generate tree: No target repository provided");
      throw new Error("Failed generate tree: No target repository provided");
    }

    // Use per-session cache
    if (codebaseTreeCache[sandboxSessionId]) {
      return codebaseTreeCache[sandboxSessionId];
    }


    const executor = createShellExecutor(config);
    // Always use the root bench directory as workdir, and apps/one_fm as the targetDir
    const workdir = SANDBOX_ROOT_DIR; // "/home/frappe/frappe-bench"
    const response = await executor.executeCommand({
      command,
      workdir,
      timeout: TIMEOUT_SEC,
      sandboxSessionId,
    });

    if (response.exitCode !== 0) {
      logger.error("Failed to generate tree", {
        exitCode: response.exitCode,
        result: response.result ?? response.artifacts?.stdout,
      });
      throw new Error(
        `Failed to generate tree: ${response.result ?? response.artifacts?.stdout}`,
      );
    }

    // Filter output lines
    let filteredTree = response.result
      .split('\n')
      .filter((line) => !shouldExclude(line))
      .join('\n');
    codebaseTreeCache[sandboxSessionId] = filteredTree;
    return filteredTree;
  } catch (e) {
    const errorFields = getSandboxErrorFields(e);
    logger.error("Failed to generate tree", {
      ...(errorFields ? { errorFields } : {}),
      ...(e instanceof Error
        ? {
          name: e.name,
          message: e.message,
          stack: e.stack,
        }
        : {}),
    });
    return FAILED_TO_GENERATE_TREE_MESSAGE;
  }
}

/**
 * Local version of getCodebaseTree using ShellExecutor
 */
async function getCodebaseTreeLocal(
  config: GraphConfig,
  // targetDir: string = "apps/one_fm",
  depth: number = 2
): Promise<string> {
  try {
    const executor = createShellExecutor(config);
    // Run git ls-files from repo root and tree fromfile without redundant dir arg
    const command = `git ls-files | tree --fromfile -L ${depth}`;

    const response = await executor.executeCommand({
      command,
      timeout: TIMEOUT_SEC,
    });

    if (response.exitCode !== 0) {
      logger.error("Failed to generate tree in local mode", {
        exitCode: response.exitCode,
        result: response.result,
      });
      throw new Error(
        `Failed to generate tree in local mode: ${response.result}`,
      );
    }

    // Filter output lines
    let filteredTree = response.result
      .split('\n')
      .filter((line) => !shouldExclude(line))
      .join('\n');
    return filteredTree;
  } catch (e) {
    logger.error("Failed to generate tree in local mode", {
      ...(e instanceof Error
        ? {
          name: e.name,
          message: e.message,
          stack: e.stack,
        }
        : { error: e }),
    });
    return FAILED_TO_GENERATE_TREE_MESSAGE;
  }
}
