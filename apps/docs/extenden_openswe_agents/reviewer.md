# Reviewer Agent

**Role:**
- Validates the changes made by the programmer agent.
- Ensures code quality, correctness, and adherence to project standards.

**Invocation:**
- Called by the manager after code changes are made.
- Invoked in the "generate message" or "generate action" node to review and approve changes.

**Tools Provided:**
- Code review tool
- Linting and test tools

**Context for Developers:**
- The reviewer agent is the final gatekeeper before changes are accepted.
- It checks for errors, style issues, and ensures the output meets requirements before finalizing the workflow.