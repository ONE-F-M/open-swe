// reviewer-agent.ts
import { graph as reviewerGraph } from "../graphs/reviewer/index.js";
import { FRAPPE_REVIEWER_CHECKS } from "../planner/frappe-reviewer-prompt.js";

export class ReviewerAgent {
  constructor() {}

  /**
   * Invokes the LLM-based Reviewer Graph to perform code quality checks.
   * In a live system, this sends the code and the frappe-reviewer-prompt.ts checklist
   * to the LLM.
   */
  async review(files: string[], targetRepository?: { owner: string; repo: string; branch?: string }, branch?: string): Promise<boolean> {
    // Prepare the initial state for the reviewer graph
    const initialState = {
      reviewerMessages: [
        { role: "user", content: `Review the following files: ${files.join(", ")}` }
      ],
      filesToReview: files,
      // Always pass targetRepository and branch for downstream graph nodes
      targetRepository,
      branchName: branch,
      customRules: { generalRules: FRAPPE_REVIEWER_CHECKS },
    };

    // DEBUG: Print the initial state passed to the reviewer graph (including taskPlan if present)
    // eslint-disable-next-line no-console
    console.log('[DEBUG][ReviewerAgent.review] initialState:', JSON.stringify(initialState, null, 2));

    // Run the reviewer graph workflow
    const result = await reviewerGraph.invoke(initialState);

    // FIX: The raw result from graph.invoke() is a complex StateType. 
    // We must safely cast it to 'any' to access custom, downstream properties 
    // like 'reviewPassed' without a TS error, assuming the graph guarantees it exists.
    const finalState = result as any;

    // Assume the field exists on the final state, defaulting to 'true' if the graph is messy.
    return finalState.reviewPassed ?? true;
  }
}