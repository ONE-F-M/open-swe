import { LazyContextLoader } from "../../context/lazy-loader.js";
import { MigrationHandler } from "../../migration/migration-handler.js";
import { benchClearCacheTool, benchRunTestTool } from '../../../../cli/src/tools.js';
import { Sandbox } from "@daytonaio/sdk";
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

  constructor(sandbox: Sandbox, siteName: string) {
    this.sandbox = sandbox;
    this.siteName = siteName;
    this.migrationHandler = new MigrationHandler(this.sandbox, this.siteName);
  }

  // Executes a plan step: modifies code, runs migrations, and/or tests as required.
  async executeStep(
    step: PlanStep,
    currentContext: string
  ): Promise<{ filesModified: string[]; migrationLog: string; testResults: { exitCode: number; output?: string } }> {
    // Combine the programmer instructions prompt with the current context and step instruction
    // const fullPrompt = `${FRAPPE_PROGRAMMER_INSTRUCTIONS}\n\nCurrent context: ${currentContext}\n\nInstruction: ${step.instruction}`;
    // Use fullPrompt in your LLM or code generation logic as needed
    // Summarize file changes and load additional context for new imports
    const codeToWrite = this.summarizeFileChanges(step);
    const newImports = this.extractImports(codeToWrite);
    for (const importStmt of newImports) {
      const additionalContext = await this.contextLoader.loadOnDemand(
        importStmt,
        this.getCurrentTokenCount(currentContext),
        180000
      );
      if (additionalContext) {
        currentContext += `\n\n${additionalContext}`;
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
    for (const filePath of Object.keys(step.fileChanges)) {
        written.push(filePath);
    }
    return written;
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
        lastError = `Tests failed.\nSTDOUT:\n${testOutput}\nSTDERR:\n${testStderr}\nERROR:\n${testError || ""}`;
        attempts++;
      }
    }
    throw new Error(
      `Tests failed after ${FrappeProgrammerAgent.MAX_TEST_RETRIES} attempts. Last error: ${lastError}`
    );
  }
}