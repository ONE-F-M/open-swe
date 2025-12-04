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
    this.checkpointer = new MemorySaver();
  }

  // Loads and returns essential context for planning (e.g., preloads modules)
  async loadContext(): Promise<string> {
    return await this.contextLoader.preloadEssentials();
  }

  /**
   * Generates a structured plan for the given task using the planner graph.
   * Merges config and extraState, ensures thread_id, and invokes the planner LLM.
   * Returns an array of plan steps, each with an actionType and description.
   */
  async generatePlan(task: string, extraState?: Record<string, any>): Promise<any[]> {
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
    };

    // Invoke the planner graph (LLM) to get the plan
    const result = await plannerGraph.invoke(initialState, {
      configurable: mergedConfigurable,
    });

    const finalState = result as any;

    // Debug: Log the raw plan output
    console.log('[PlannerAgent] Raw plan output:', JSON.stringify(finalState, null, 2));

    // Extract plan steps from either 'plan' or 'proposedPlan' fields
    const planArray = Array.isArray(finalState.plan)
      ? finalState.plan
      : Array.isArray(finalState.proposedPlan)
        ? finalState.proposedPlan
        : [];

    // Map each plan step to a structured step object with actionType and description
    if (planArray.length > 0) {
      const steps: any[] = [];
      let stepId = 1;
      for (const step of planArray) {
        let actionType: 'MODIFY_CODE' | 'RUN_MIGRATION' | 'VALIDATE_TEST' | 'FINAL_REVIEW' = 'MODIFY_CODE';
        if (/validate|test/i.test(step)) {
          actionType = 'VALIDATE_TEST';
        } else if (/review/i.test(step)) {
          actionType = 'FINAL_REVIEW';
        }
        steps.push({ actionType, description: step, stepId });
        // Debug: Log each mapped step
        console.log(`[PlannerAgent] Step ${stepId}:`, { actionType, description: step });
        stepId++;
        // After each code-modifying step, inject migration, clear-cache, and restart steps
        if (actionType === 'MODIFY_CODE') {
          steps.push({ actionType: 'RUN_MIGRATION', description: 'Run bench migrate --skip-failing for the target site', stepId });
          console.log(`[PlannerAgent] Step ${stepId}: Injected RUN_MIGRATION`);
          stepId++;
          steps.push({ actionType: 'CLEAR_CACHE', description: 'Run bench clear-cache for the target site', stepId });
          console.log(`[PlannerAgent] Step ${stepId}: Injected CLEAR_CACHE`);
          stepId++;
          steps.push({ actionType: 'RESTART_SITE', description: 'Run bench restart for the target site', stepId });
          console.log(`[PlannerAgent] Step ${stepId}: Injected RESTART_SITE`);
          stepId++;
        }
      }
      return steps;
    }
    return [];
  }
}