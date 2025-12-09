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
const DEFAULT_EXCLUDE_PATTERNS = [
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

function globToRegex(glob: string): RegExp {
  // Convert simple glob to regex (supports * wildcard)
  let regexStr = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&'); // Escape regex chars
  regexStr = regexStr.replace(/\*/g, '.*');
  return new RegExp(`^${regexStr}$`);
}

function shouldExclude(line: string, excludePatterns: string[] = DEFAULT_EXCLUDE_PATTERNS): boolean {
  return excludePatterns.some((pat) => globToRegex(pat).test(line.trim()));
}

// Simple LRU cache eviction for codebaseTreeCache
const MAX_CACHE_SIZE = 20;
function setCache(key: string, value: string) {
  if (Object.keys(codebaseTreeCache).length >= MAX_CACHE_SIZE) {
    // Remove oldest entry
    const oldestKey = Object.keys(codebaseTreeCache)[0];
    delete codebaseTreeCache[oldestKey];
  }
  codebaseTreeCache[key] = value;
}

export async function getCodebaseTree(
  config: GraphConfig,
  sandboxSessionId_?: string,
  targetRepository_?: TargetRepository,
  depth: number = 2,
  excludePatterns: string[] = DEFAULT_EXCLUDE_PATTERNS
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
        .filter((line) => !shouldExclude(line, excludePatterns))
        .join('\n');
      setCache('local', tree);
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
      return FAILED_TO_GENERATE_TREE_MESSAGE;
    }
    if (!targetRepository) {
      logger.error("Failed to generate tree: No target repository provided");
      return FAILED_TO_GENERATE_TREE_MESSAGE;
    }

    const cacheKey = `${sandboxSessionId}-${targetRepository.repo}-${depth}-${excludePatterns.join(',')}`;
    if (codebaseTreeCache[cacheKey]) {
      return codebaseTreeCache[cacheKey];
    }

    const executor = createShellExecutor(config);
    const repoDir = `${SANDBOX_ROOT_DIR}/${targetRepository.repo}`;
    const response = await executor.executeCommand({
      command,
      workdir: repoDir,
      timeout: TIMEOUT_SEC,
      sandboxSessionId,
    });

    if (response.exitCode !== 0) {
      logger.error("Failed to generate tree", {
        exitCode: response.exitCode,
        result: response.result ?? response.artifacts?.stdout,
      });
      return FAILED_TO_GENERATE_TREE_MESSAGE;
    }

    // Filter output lines
    const filteredTree = response.result
      .split('\n')
      .filter((line) => !shouldExclude(line, excludePatterns))
      .join('\n');
    setCache(cacheKey, filteredTree);
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
  depth = 2,
  excludePatterns: string[] = DEFAULT_EXCLUDE_PATTERNS
): Promise<string> {
  try {
    const command = `git ls-files | tree --fromfile -L ${depth}`;
    const executor = createShellExecutor(config);
    const response = await executor.executeCommand({
      command,
      timeout: TIMEOUT_SEC,
    });
    if (response.exitCode !== 0) {
      logger.error("Failed to generate tree in local mode", {
        exitCode: response.exitCode,
        result: response.result,
      });
      return FAILED_TO_GENERATE_TREE_MESSAGE;
    }
    return response.result
      .split('\n')
      .filter((line) => !shouldExclude(line, excludePatterns))
      .join('\n');
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