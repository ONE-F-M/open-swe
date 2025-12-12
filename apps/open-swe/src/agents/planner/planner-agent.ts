/**
 * PlannerAgent Plan Step Contract:
 * Each plan step returned by generatePlan() must be an object:
 * {
 *   actionType: string, // e.g. 'MODIFY_CODE', 'RUN_MIGRATION', 'VALIDATE_TEST', 'FINAL_REVIEW', etc.
 *   description: string, // Human-readable step description
 *   stepId: number       // Unique step identifier
 * }
 * This contract must be maintained for compatibility with manager-runner.
 */
import { graph as plannerGraph } from "../../graphs/planner/index.js";
import { LazyContextLoader } from "../../context/lazy-loader.js";
import { MemorySaver } from "@langchain/langgraph";

// PlannerAgent is responsible for generating a step-by-step plan for a given task using an LLM-powered planner graph.
export class PlannerAgent {
  sandbox: any; // Sandbox context for the agent
  config: any;  // Configuration for the agent and planner
  contextLoader: LazyContextLoader; // Loads required context/modules
  checkpointer: MemorySaver; // Used for state checkpointing (in-memory)

  constructor(sandbox: any, config?: any) {
    this.sandbox = sandbox;
    this.config = config;
    this.contextLoader = new LazyContextLoader();
    // MemorySaver with limit for cost/memory optimization
    // Remove invalid maxSize option, use default constructor
    this.checkpointer = new MemorySaver();
  }

  // Loads and returns essential context for planning (e.g., preloads modules)
  async loadContext(): Promise<string> {
    // Lazy load context only when needed
    if (this.config?.lazyLoadContext) {
      // Provide required arguments and handle null return
      const loaded = await this.contextLoader.loadOnDemand(this.sandbox, this.config, 180000);
      return loaded ?? '';
    }
    return await this.contextLoader.preloadEssentials();
  }

  /**
   * Generates a structured plan for the given task using the planner graph.
   * Merges config and extraState, ensures thread_id, and invokes the planner LLM.
   * Returns an array of plan steps, each with an actionType and description.
   */
  async generatePlan(task: string, extraState?: Record<string, any>): Promise<any[]> {
        // --- Explicit Parameter Validation ---
        if (!task || typeof task !== 'string' || !task.trim()) {
          throw new Error('PlannerAgent.generatePlan: taskDescription must be a non-empty string.');
        }
        if (!extraState || typeof extraState !== 'object') {
          throw new Error('PlannerAgent.generatePlan: extraState must be an object.');
        }
        // Ensure targetRepository is present in extraState or config
        if (!extraState.targetRepository && !this.config?.targetRepository) {
          // Fallback: set default targetRepository from env or hardcoded values
          const defaultRepo = {
            owner: process.env.REPO_OWNER || "ONE-F-M",
            repo: process.env.REPO_NAME || "one_fm",
            branch: process.env.REPO_BRANCH || "version-15"
          };
          extraState.targetRepository = defaultRepo;
          // Optionally also set in config for downstream use
          if (this.config) {
            this.config.targetRepository = defaultRepo;
          }
        }
        
    // --- Configuration Validation ---
    if (!this.config || !this.config.targetRepository) {
      throw new Error('Invalid configuration: targetRepository must be specified.');
    }
    // Conditional logging helper
    const log = (level: 'debug'|'info'|'warn'|'error', ...args: any[]) => {
      // Only log warnings and errors to reduce cost
      if (level === 'warn') console.warn(...args);
      else if (level === 'error') console.error(...args);
    };
    // Removed info/debug logs for cost reduction
    // Merge config and extraState, ensuring 'configurable' is at the root
    const mergedConfigurable = {
      ...((this.config?.configurable || {})),
      ...((extraState?.configurable || {})),
    };
    // Ensure thread_id is present for checkpointing and reproducibility
    if (!mergedConfigurable.thread_id || typeof mergedConfigurable.thread_id !== 'string' || !mergedConfigurable.thread_id.trim()) {
      mergedConfigurable.thread_id = `thread_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    }
    // Initial state for the planner graph invocation
    const initialState = {
      messages: [
        { role: "user", content: task }
      ],
      ...extraState,
      configurable: mergedConfigurable,
      targetRepository: extraState?.targetRepository || this.config?.targetRepository
    };

    // --- Batch LLM Call Support ---
    let result: any;
    try {
      if (Array.isArray(task)) {
        // Batch process multiple tasks if array
        result = await Promise.all(task.map(t => plannerGraph.invoke({ ...initialState, messages: [{ role: "user", content: t }] }, { configurable: mergedConfigurable })));
        // Flatten results if needed
        result = result.flat();
      } else {
        result = await plannerGraph.invoke(initialState, { configurable: mergedConfigurable });
      }
    } catch (e) {
      log('error', '[PlannerAgent] Error invoking planner graph:', e);
      return [
        { actionType: 'MODIFY_CODE', description: 'Planner graph invocation failed. Default code modification step injected.' }
      ];
    }

    const finalState = result as any;
    log('debug', '[PlannerAgent] Raw plan output:', JSON.stringify(finalState, null, 2));

    // Extract plan steps from either 'plan' or 'proposedPlan' fields
    let planArray = Array.isArray(finalState.plan)
      ? finalState.plan
      : Array.isArray(finalState.proposedPlan)
        ? finalState.proposedPlan
        : [];
    log('debug', '[PlannerAgent] Steps after fallback mapping:', JSON.stringify(planArray, null, 2));
    log('debug', '[PlannerAgent] Extracted planArray:', JSON.stringify(planArray, null, 2));

    // Check if planArray is structured (array of objects with type/actionType)
    let isStructured = Array.isArray(planArray) && planArray.length > 0 && typeof planArray[0] === 'object' && (planArray[0].type || planArray[0].actionType);
    if (!isStructured && Array.isArray(planArray) && planArray.length > 0 && typeof planArray[0] === 'string') {
      log('warn', '[PlannerAgent] Fallback: Converting string plan steps to structured step objects. Migration steps will be injected.');
      planArray = planArray.map((step) => {
        const lowerStep = step.toLowerCase();
        switch (true) {
          case lowerStep.includes('migrate') || lowerStep.includes('bench migrate'):
            return { actionType: 'RUN_MIGRATION', description: step };
          case /validate|test/.test(lowerStep):
            return { actionType: 'VALIDATE_TEST', description: step };
          case /review/.test(lowerStep):
            return { actionType: 'FINAL_REVIEW', description: step };
          default:
            return { actionType: 'MODIFY_CODE', description: step };
        }
      });
      isStructured = true;
    } else if (!isStructured) {
      log('warn', '[PlannerAgent] WARNING: Plan is not structured as array of step objects with type/actionType. Attempting robust fallback.');
      // Robust fallback: If plan is empty or not structured, inject a default MODIFY_CODE step and migration steps
      planArray = [
        { actionType: 'MODIFY_CODE', description: 'No valid plan steps found. Default code modification step injected.' },
      ];
      isStructured = true;
    }

    // Map each plan step to a structured step object with actionType and description
    if (planArray.length > 0) {
      const steps: any[] = [];
      let stepId = 1;
      for (const step of planArray) {
        let actionType: 'MODIFY_CODE' | 'RUN_MIGRATION' | 'VALIDATE_TEST' | 'FINAL_REVIEW' = 'MODIFY_CODE';
        if (typeof step === 'object' && (step.type || step.actionType)) {
          actionType = step.type || step.actionType;
        } else {
          switch (true) {
            case /validate|test/i.test(step.description || step):
              actionType = 'VALIDATE_TEST';
              break;
            case /review/i.test(step.description || step):
              actionType = 'FINAL_REVIEW';
              break;
            default:
              actionType = 'MODIFY_CODE';
          }
        }
        steps.push({ actionType, description: typeof step === 'string' ? step : step.description || JSON.stringify(step), stepId });
        // Conditional debug log for each mapped step
        log('debug', `[PlannerAgent] Step ${stepId}:`, { actionType, description: typeof step === 'string' ? step : step.description || JSON.stringify(step) });
        stepId++;
        // After each code-modifying step, inject migration, clear-cache, and restart steps
        if (actionType === 'MODIFY_CODE' && isStructured) {
          steps.push({ actionType: 'RUN_MIGRATION', description: 'Run bench migrate --skip-failing for the target site', stepId });
          log('debug', `[PlannerAgent] Step ${stepId}: Injected RUN_MIGRATION`);
          stepId++;
          steps.push({ actionType: 'CLEAR_CACHE', description: 'Run bench clear-cache for the target site', stepId });
          log('debug', `[PlannerAgent] Step ${stepId}: Injected CLEAR_CACHE`);
          stepId++;
          steps.push({ actionType: 'RESTART_SITE', description: 'Run bench restart for the target site', stepId });
          log('debug', `[PlannerAgent] Step ${stepId}: Injected RESTART_SITE`);
          stepId++;
        }
        // Always inject clear-cache and restart after any migration step
        if (actionType === 'RUN_MIGRATION' && isStructured) {
          steps.push({ actionType: 'CLEAR_CACHE', description: 'Run bench clear-cache for the target site', stepId });
          log('debug', `[PlannerAgent] Step ${stepId}: Injected CLEAR_CACHE after RUN_MIGRATION`);
          stepId++;
          steps.push({ actionType: 'RESTART_SITE', description: 'Run bench restart for the target site', stepId });
          log('debug', `[PlannerAgent] Step ${stepId}: Injected RESTART_SITE after RUN_MIGRATION`);
          stepId++;
        }
      }
      // Final debug log before returning
      log('debug', '[PlannerAgent] FINAL steps to return:', JSON.stringify(steps, null, 2));
      return steps;
    }
    // Final debug log for empty steps
    log('debug', '[PlannerAgent] FINAL steps to return: []');
    return [];
  }
}