import { graph as plannerGraph } from "../../graphs/planner/index.js";
import { LazyContextLoader } from "../../context/lazy-loader.js";
import { MemorySaver } from "@langchain/langgraph";

// PlannerAgent is responsible for generating a step-by-step plan for a given task using an LLM-powered planner graph.
export class PlannerAgent {
  sandbox: any; // Sandbox context for the agent
  config: any;  // Configuration for the agent and planner
  contextLoader: LazyContextLoader; // Loads required context/modules
  checkpointer: MemorySaver; // Used for state checkpointing (in-memory)
  canReplan: boolean; // Whether replanning is allowed

  constructor(sandbox: any, config?: any) {
    this.sandbox = sandbox;
    this.config = config;
    this.contextLoader = new LazyContextLoader();
    this.checkpointer = new MemorySaver();
    this.canReplan = true; // Default to true, can be set via config or externally
  }

  // Loads and returns essential context for planning (e.g., preloads modules)
  async loadContext(): Promise<string> {
    // Debug: No plan available in loadContext, skipping plan log.
    // No plan variable available in loadContext.

    return await this.contextLoader.preloadEssentials();
  }

  /**
   * Generates a structured plan for the given task using the planner graph.
   * Merges config and extraState, ensures thread_id, and invokes the planner LLM.
   * Returns an array of plan steps, each with an actionType and description.
   */
  async generatePlan(task: string, extraState?: Record<string, any>): Promise<any[]> {
      // Unique log to confirm invocation
      console.log('PLANNER_AGENT_START');
      // Debug: Log the task and extraState
      console.log('[PlannerAgent] Task:', task);
      console.log('[PlannerAgent] extraState:', JSON.stringify(extraState, null, 2));
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
      targetRepository: extraState?.targetRepository || this.config?.targetRepository || {
        owner: process.env.REPO_OWNER || "ONE-F-M",
        repo: process.env.REPO_NAME || "one_fm",
        branch: process.env.REPO_BRANCH || "version-15"
      }
    };

    // Invoke the planner graph (LLM) to get the plan
    const result = await plannerGraph.invoke(initialState, {
      configurable: mergedConfigurable,
    });

    const finalState = result as any;


    // Extract plan steps from either 'plan' or 'proposedPlan' fields
    let planArray = Array.isArray(finalState.plan)
      ? finalState.plan
      : Array.isArray(finalState.proposedPlan)
        ? finalState.proposedPlan
        : [];


    // Check if planArray is structured (array of objects with type/actionType)
    let isStructured = Array.isArray(planArray) && planArray.length > 0 && typeof planArray[0] === 'object' && (planArray[0].type || planArray[0].actionType);
    if (!isStructured && Array.isArray(planArray) && planArray.length > 0 && typeof planArray[0] === 'string') {
      // Fallback: convert string steps to structured step objects
      planArray = planArray.map((step) => {
        const lowerStep = step.toLowerCase();
        if (lowerStep.includes('migrate') || lowerStep.includes('bench migrate')) {
          return { actionType: 'RUN_MIGRATION', description: step };
        } else if (/validate|test/.test(lowerStep)) {
          return { actionType: 'VALIDATE_TEST', description: step };
        } else if (/review/.test(lowerStep)) {
          return { actionType: 'FINAL_REVIEW', description: step };
        }
        return { actionType: 'MODIFY_CODE', description: step };
      });
      isStructured = true;
    } else if (!isStructured) {
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
      for (let i = 0; i < planArray.length; i++) {
        const step = planArray[i];
        let actionType: 'MODIFY_CODE' | 'RUN_MIGRATION' | 'VALIDATE_TEST' | 'FINAL_REVIEW' = 'MODIFY_CODE';
        if (typeof step === 'object' && (step.type || step.actionType)) {
          actionType = step.type || step.actionType;
        } else if (/validate|test/i.test(step.description || step)) {
          actionType = 'VALIDATE_TEST';
        } else if (/review/i.test(step.description || step)) {
          actionType = 'FINAL_REVIEW';
        }
        const description = typeof step === 'string' ? step : step.description || JSON.stringify(step);
        steps.push({ actionType, description, stepId });
        stepId++;
        // After each code-modifying step, inject migration, clear-cache, and restart steps
        if (actionType === 'MODIFY_CODE' && isStructured) {
          // Post-processing: If this MODIFY_CODE step touches a .json file and the next step is not RUN_MIGRATION, inject it
          const touchesSchema = /\.json/.test(description);
          const nextStep = planArray[i + 1];
          const nextActionType = nextStep && (nextStep.type || nextStep.actionType);
          if (touchesSchema && nextActionType !== 'RUN_MIGRATION') {
            steps.push({ actionType: 'RUN_MIGRATION', description: 'Run bench migrate --skip-failing for the target site', stepId });
            stepId++;
            steps.push({ actionType: 'CLEAR_CACHE', description: 'Run bench clear-cache for the target site', stepId });
            stepId++;
            steps.push({ actionType: 'RESTART_SITE', description: 'Run bench restart for the target site', stepId });
            stepId++;
          } else if (!touchesSchema) {
            steps.push({ actionType: 'RUN_MIGRATION', description: 'Run bench migrate --skip-failing for the target site', stepId });
            stepId++;
            steps.push({ actionType: 'CLEAR_CACHE', description: 'Run bench clear-cache for the target site', stepId });
            stepId++;
            steps.push({ actionType: 'RESTART_SITE', description: 'Run bench restart for the target site', stepId });
            stepId++;
          }
        }
        // Always inject clear-cache and restart after any migration step
        if (actionType === 'RUN_MIGRATION' && isStructured) {
          steps.push({ actionType: 'CLEAR_CACHE', description: 'Run bench clear-cache for the target site', stepId });
          stepId++;
          steps.push({ actionType: 'RESTART_SITE', description: 'Run bench restart for the target site', stepId });
          stepId++;
        }
      }
      // Final post-processing: If any MODIFY_CODE step touched a .json file and no RUN_MIGRATION step exists, inject it at the end
      const hasMigration = steps.some(s => s.actionType === 'RUN_MIGRATION');
      const touchedSchema = steps.some(s => s.actionType === 'MODIFY_CODE' && /\.json/.test(s.description));
      if (touchedSchema && !hasMigration) {
        steps.push({ actionType: 'RUN_MIGRATION', description: 'Run bench migrate --skip-failing for the target site', stepId });
        stepId++;
        steps.push({ actionType: 'CLEAR_CACHE', description: 'Run bench clear-cache for the target site', stepId });
        stepId++;
        steps.push({ actionType: 'RESTART_SITE', description: 'Run bench restart for the target site', stepId });
        stepId++;
      }
      return steps;
    }
    return [];
  }
}