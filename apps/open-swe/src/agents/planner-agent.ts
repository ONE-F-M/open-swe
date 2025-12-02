// open-swe-planner-agent.ts
import { graph as plannerGraph } from "../graphs/planner/index.js";
import { LazyContextLoader } from "../context/lazy-loader.js";
import { MemorySaver } from "@langchain/langgraph"; // Use MemorySaver for testing


export class PlannerAgent {
  sandbox: any;
  config: any;
  contextLoader: LazyContextLoader;
  checkpointer: MemorySaver;

  constructor(sandbox: any, config?: any) {
    this.sandbox = sandbox;
    this.config = config;
    this.contextLoader = new LazyContextLoader();
    this.checkpointer = new MemorySaver(); // Initialize it
  }

  async loadContext(): Promise<string> {
    // Preload essential modules using LazyContextLoader
    return await this.contextLoader.preloadEssentials();
  }


  /**
   * Invokes the LLM-based Planner Graph to generate a structured plan.
   * Accepts an optional extraState object for additional fields (e.g., githubIssueId).
   */
  async generatePlan(task: string, extraState?: Record<string, any>): Promise<any[]> {
    // Defensive merge: ensure configurable at root, merging config and extraState
    const mergedConfigurable = {
      ...((this.config?.configurable || {})),
      ...((extraState?.configurable || {})),
    };
    // Ensure thread_id is present and non-empty for checkpointer
    if (!mergedConfigurable.thread_id || typeof mergedConfigurable.thread_id !== 'string' || !mergedConfigurable.thread_id.trim()) {
      // Use a random UUID if not present
      mergedConfigurable.thread_id = `thread_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    }
    const initialState = {
      messages: [
        { role: "user", content: task }
      ],
      ...extraState,
      configurable: mergedConfigurable,
    };

    // CRITICAL: Pass configurable directly during invocation
    const result = await plannerGraph.invoke(initialState, {
      configurable: mergedConfigurable,
    });

    const finalState = result as any;
    // Debug: Log the full planner output for troubleshooting
    // eslint-disable-next-line no-console

    // Map plan steps from either finalState.plan or finalState.proposedPlan
    const planArray = Array.isArray(finalState.plan)
      ? finalState.plan
      : Array.isArray(finalState.proposedPlan)
        ? finalState.proposedPlan
        : [];

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
          stepId++;
          // If this is a code-modifying step, inject a migration step after
          if (actionType === 'MODIFY_CODE') {
            steps.push({ actionType: 'RUN_MIGRATION', description: 'Run bench migrate, clear-cache, and restart for the target site', stepId });
            stepId++;
          }
        }
        return steps;
    }
    return [];
  }
}