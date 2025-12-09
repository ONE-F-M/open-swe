import { LazyContextLoader } from "../../context/lazy-loader.js";
import { MigrationHandler } from "../../migration/migration-handler.js";
import { benchClearCacheTool, benchRunTestTool } from '../../../../cli/src/tools.js';
import { Sandbox } from "@daytonaio/sdk";
import { createLogger, LogLevel } from "../../utils/logger.js";
import { readFile, writeFile } from "../../utils/read-write.js";
// import { formatCustomRulesPrompt, getRelevantCustomRules } from "../../utils/custom-rules.js";
// import { getCurrentPlanItem } from "../../utils/current-task.js";
// import { getActivePlanItems } from "@openswe/shared/open-swe/tasks";
// import { FRAPPE_PROGRAMMER_INSTRUCTIONS } from "./frappe-programmer-prompt.js";

// PlanStep describes a single actionable instruction for the programmer agent
export interface PlanStep {
  stepId: number;
  instruction: string;
  actionType: 'MODIFY_CODE' | 'RUN_MIGRATION' | 'VALIDATE_TEST' | 'FINAL_REVIEW';
  fileChanges?: Record<string, string>;
  appToTest?: string;
  moduleToTest?: string;
  migrationExpected?: boolean;
}

// FrappeProgrammerAgent executes plan steps in a Frappe/ERPNext environment, handling code changes, migrations, and tests.
export class FrappeProgrammerAgent {
  private contextLoader = new LazyContextLoader();
  private migrationHandler: MigrationHandler;
  private static readonly CUSTOM_APP_NAME = "one_fm/one_fm";
  private static readonly MAX_TEST_RETRIES = 3;
  private sandbox: Sandbox;
  private siteName: string;
  private logger = createLogger(LogLevel.INFO, "FrappeProgrammerAgent");
  public targetRepository: { owner: string; repo: string; branch: string };
  // public taskPlan: any;
  // public customRules: any;

  constructor(sandbox: Sandbox, siteName: string) {
    this.sandbox = sandbox;
    this.siteName = siteName;
    this.migrationHandler = new MigrationHandler(this.sandbox, this.siteName);
    this.targetRepository = {
      owner: process.env.REPO_OWNER || "ONE-F-M",
      repo: process.env.REPO_NAME || "one_fm",
      branch: process.env.REPO_BRANCH || "version-15"
    };
  }

  // Executes a plan step: modifies code, runs migrations, and/or tests as required.
  async executeStep(
    step: PlanStep,
    currentContext: string
  ): Promise<{ filesModified: string[]; migrationLog: string; testResults: { exitCode: number; output?: string } }> {
    // Build the programmer instructions prompt with custom rules injected
    // const originalPrompt = `${FRAPPE_PROGRAMMER_INSTRUCTIONS}\n\nCurrent context: ${currentContext}\n\nInstruction: ${step.instruction}\n\n{CUSTOM_RULES}`;
    // const customRulesStr = formatCustomRulesPrompt(
    //   getRelevantCustomRules(
    //     getCurrentPlanItem(getActivePlanItems(this.taskPlan))?.plan ?? "",
    //     this.customRules
    //   )
    // );
    // const promptWithCustomRules = originalPrompt.replaceAll("{CUSTOM_RULES}", customRulesStr);
    // Use promptWithCustomRules for logging, display, or passing to other functions
    // this.logger.info(promptWithCustomRules);

    // Summarize file changes and load additional context for new imports
    const codeToWrite = this.summarizeFileChanges(step);
    const newImports = this.extractImports(codeToWrite);
    // Conditional context loading: only load if not already present
    for (const importStmt of newImports) {
      if (!currentContext.includes(importStmt)) {
        const additionalContext = await this.contextLoader.loadOnDemand(
          importStmt,
          this.getCurrentTokenCount(currentContext),
          180000
        );
        if (additionalContext) {
          currentContext += `\n\n${additionalContext}`;
        }
      }
    }

    let writtenFiles: string[] = [];
    let migrationResult: any = { migrationLog: "", success: true };
    let testResult: { exitCode: number; output?: string } = { exitCode: 0 };

    try {
      // Only perform local business logic for each action type
      if (step.actionType === "MODIFY_CODE") {
        writtenFiles = await this.writeFilesFromStep(step);
        migrationResult = await this.migrationHandler.handlePostCodeChange(writtenFiles);
        if (!migrationResult.success) {
          throw new Error(
            `Migration failed and rollback attempted. Errors: ${migrationResult.errors?.join('; ')}`
          );
        }
        await this.runTestLoop(step.appToTest || FrappeProgrammerAgent.CUSTOM_APP_NAME, step.moduleToTest);
        testResult = { exitCode: 0 };
      } else if (step.actionType === "RUN_MIGRATION") {
        migrationResult = await this.migrationHandler.handlePostCodeChange([]);
        if (!migrationResult.success) {
          throw new Error(
            `Migration failed and rollback attempted. Errors: ${migrationResult.errors?.join('; ')}`
          );
        }
      } else if (step.actionType === "VALIDATE_TEST") {
        await this.runTestLoop(step.appToTest || FrappeProgrammerAgent.CUSTOM_APP_NAME, step.moduleToTest);
        testResult = { exitCode: 0 };
      }
      // FINAL_REVIEW is a no-op
    } catch (err: any) {
      throw err;
    }

    return {
      filesModified: writtenFiles,
      migrationLog: migrationResult.migrationLog || "",
      testResults: testResult
    };
  }

  // Summarizes file changes for context loading
  private summarizeFileChanges(step: PlanStep): string {
    if (!step.fileChanges) return "";
    return Object.entries(step.fileChanges)
      .map(([path, content]) => `// ${path}\n${content}`)
      .join("\n\n");
  }

  // Extracts Python import statements for context loading
  private extractImports(code: string): string[] {
    const importPattern = /from ([\w\.]+) import/g;
    const matches = code.matchAll(importPattern);
    return Array.from(matches, m => `from ${m[1]} import`);
  }

  // Estimates token count for a given context string
  private getCurrentTokenCount(context: string): number {
    return Math.ceil(context.length / 4);
  }

  // Writes or merges files as specified in the plan step
  private async writeFilesFromStep(step: PlanStep): Promise<string[]> {
    if (!step.fileChanges) return [];
    const written: string[] = [];
    for (const [filePath, content] of Object.entries(step.fileChanges)) {
      // Check if the file content is different before writing
      const existingContent = await this.getFileContent(filePath);
      if (existingContent !== content) {
        await this.writeFile(filePath, content);
        written.push(filePath);
      }
    }
    return written;
  }

  // Reads file content using utility
  private async getFileContent(filePath: string): Promise<string> {
    try {
      const result = await readFile({
        sandbox: this.sandbox,
        filePath,
        config: {},
      });
      return result.success ? result.output : "";
    } catch (err) {
      // Only log errors for failures
      this.logger.error(`Error reading file ${filePath}: ${err}`);
      return "";
    }
  }

  // Writes file content using utility
  private async writeFile(filePath: string, content: string): Promise<void> {
    try {
      const result = await writeFile({
        sandbox: this.sandbox,
        filePath,
        content,
        config: undefined,
      });
      if (!result.success) {
        // Only log errors for failures
        this.logger.error(`Error writing file ${filePath}: ${result.output}`);
      }
    } catch (err) {
      // Only log errors for failures
      this.logger.error(`Exception writing file ${filePath}: ${err}`);
    }
  }

  // Runs tests for the app, with retries and cache clearing
  private async runTestLoop(appName: string, module?: string): Promise<void> {
    let attempts = 0;
    let lastError: any = null;
    while (attempts < FrappeProgrammerAgent.MAX_TEST_RETRIES) {
      const siteName = this.siteName;
      const clearResult = await benchClearCacheTool.invoke({ site: siteName, sandbox: this.sandbox });
      const clearStderr = (typeof clearResult === 'object' && 'stderr' in clearResult && typeof clearResult.stderr === 'string') ? clearResult.stderr : '';
      const clearError = (typeof clearResult === 'object' && 'error' in clearResult && clearResult.error) ? clearResult.error : '';
      if (!("success" in clearResult) || !clearResult.success) {
        lastError = `Cache clear failed: ${clearStderr || clearError || "Unknown error"}`;
        attempts++;
        continue;
      }
      const testResult = await benchRunTestTool.invoke({ site: siteName, app: appName, module, sandbox: this.sandbox });
      const testOutput = (typeof testResult === 'object' && 'output' in testResult && typeof testResult.output === 'string') ? testResult.output : '';
      const testStderr = (typeof testResult === 'object' && 'stderr' in testResult && typeof testResult.stderr === 'string') ? testResult.stderr : '';
      const testError = (typeof testResult === 'object' && 'error' in testResult && testResult.error) ? testResult.error : '';
      if ("passed" in testResult && testResult.passed) {
        return;
      } else {
        // Only log errors for failures
        this.logger.error(`Test failed for ${appName} module ${module}. Output: ${testOutput}, Errors: ${testError}`);
        lastError = `Tests failed.\nSTDOUT:\n${testOutput}\nSTDERR:\n${testStderr}\nERROR:\n${testError || ""}`;
        attempts++;
      }
    }
    throw new Error(
      `Tests failed after ${FrappeProgrammerAgent.MAX_TEST_RETRIES} attempts. Last error: ${lastError}`
    );
  }
}