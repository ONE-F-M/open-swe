# Programmer Agent

**Role:**
- Implements the steps defined in the plan, making code changes and running migrations as needed.
- Handles file modifications, code generation, and execution of migration commands.

**Invocation:**
- Triggered by the manager after the planner produces a plan.
- Invoked in the "generate message" or "generate action" node to perform code changes and migrations.

**Tools Provided:**
- File write tool
- Migration tool
- Code generation tool (LLM)

**Context for Developers:**
- The programmer agent is responsible for all code-level changes and automation.
- It receives the plan steps and executes them, reporting results and errors back to the manager.