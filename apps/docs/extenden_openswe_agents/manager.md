# Manager Agent

**Role:**
- Orchestrates the overall workflow and coordinates the other agents.
- Handles session state, error recovery, and high-level decision making.

**Invocation:**
- Triggered at the start of a workflow or when a new user request is received.
- Invokes Planner, Programmer, and Reviewer agents as needed.

**Code Description:**
- The manager agent is typically implemented as a class or module that receives user requests and manages the orchestration logic.
- It maintains the workflow state, tracks progress, and handles errors or retries.
- The manager invokes other agents by calling their respective methods or nodes, passing relevant context and data.
- Example responsibilities include starting a new session, handling interruptions, and finalizing results.

**Process / Workflow:**
1. **Receive User Request:** The manager agent receives a new request or task from the user or system.
2. **Initialize Session State:** It sets up the session context, including user info, environment, and any required metadata.
3. **Invoke Planner Agent:** The manager calls the planner agent to generate a step-by-step plan for the request.
4. **Review Plan:** It validates the plan, checks for forbidden actions, and may request revisions if needed.
5. **Invoke Programmer Agent:** The manager passes the approved plan to the programmer agent, which performs code changes, migrations, or other actions.
6. **Monitor Progress:** It tracks the execution of each step, handling errors, retries, or interruptions as needed.
7. **Invoke Reviewer Agent:** After code changes, the manager calls the reviewer agent to validate the output, run tests, and ensure quality.
8. **Finalize Workflow:** Once all steps are complete and validated, the manager finalizes the session, records results, and returns output to the user.
9. **Error Handling:** At any point, the manager can catch errors, roll back changes, or restart the workflow as needed.

**Context for Developers:**
- The manager agent is the entry point for most flows and is responsible for delegating tasks to specialized agents.
- It does not perform direct tool calls but manages the sequence and error handling for the other agents.
- Understanding the manager's workflow is key to extending or customizing orchestration logic in the system.