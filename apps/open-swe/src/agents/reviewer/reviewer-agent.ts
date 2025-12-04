import { graph as reviewerGraph } from "../../graphs/reviewer/index.js";
import { FRAPPE_REVIEWER_CHECKS } from "./frappe-reviewer-prompt.js";

// ReviewerAgent is responsible for running code quality checks using the reviewer graph (LLM-powered)
export class ReviewerAgent {
  constructor() {}

  // Runs the reviewer graph to check code quality for the given files and repo context
  async review(files: string[], targetRepository?: { owner: string; repo: string; branch?: string }, branch?: string): Promise<boolean> {
    // Prepare the initial state for the reviewer graph, including custom review rules
    const initialState = {
      reviewerMessages: [
        { role: "user", content: `Review the following files: ${files.join(", ")}` }
      ],
      filesToReview: files,
      targetRepository,
      branchName: branch,
      customRules: { generalRules: FRAPPE_REVIEWER_CHECKS },
    };

    // Optionally log the initial state for debugging
    // console.log('[DEBUG][ReviewerAgent.review] initialState:', JSON.stringify(initialState, null, 2));

    // Invoke the reviewer graph workflow (LLM-powered)
    const result = await reviewerGraph.invoke(initialState);

    // The result is a complex state object; extract the reviewPassed flag
    const finalState = result as any;
    // Return the review result (default to true if not present)
    return finalState.reviewPassed ?? true;
  }
}