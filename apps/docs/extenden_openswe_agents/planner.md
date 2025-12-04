# Planner Agent

**Role:**
- Generates a step-by-step plan to fulfill the user's request.
- Breaks down high-level goals into actionable steps for the programmer and reviewer.

**Invocation:**
- Called by the manager agent after receiving a user request.
- Invoked in the "generate message" or "generate action" node to produce a plan.

**Tools Provided:**
- Session plan tool (for plan generation)
- May receive context from previous messages, user prompts, and custom rules.

**Context for Developers:**
- The planner agent is responsible for decomposing tasks and ensuring the plan is feasible and safe.
- It is the first agent in the tool calling flow and sets the direction for subsequent agents.