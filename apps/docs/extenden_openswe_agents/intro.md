# Agents Overview

This section covers the core agents in the Open-SWE system: Manager, Planner, Programmer, and Reviewer. Each agent is responsible for a distinct part of the automation and orchestration flow. The following pages provide high-level descriptions of each agent's role, invocation, and the tools they use, helping developers understand and extend the system efficiently.

---

## Installation & Startup

To set up and run Open-SWE, follow these steps from the root directory:

1. **Install dependencies:**
   ```sh
   yarn install
   ```
2. **Build the project:**
   ```sh
   yarn build
   ```
3. **Start the development server:**
   ```sh
   yarn dev
   ```

This will install all required packages, build the codebase, and start the Open-SWE application for development.

---

## How Open-SWE Works: Agent Workflow & File Flow

Open-SWE orchestrates automation through four main agents, each responsible for a specific part of the workflow. Here’s how the system processes a user request:

1. **Manager Agent** (`src/agents/manager/manager-agent.ts`):
   - Entry point for new requests.
   - Initializes session state and coordinates the workflow.
   - Invokes planner, programmer, and reviewer agents as needed.
   - Handles errors and manages session lifecycle.
   - Key files: `manager-agent.ts`, `manager-runner.ts`, `manager-graph.ts`.

2. **Planner Agent** (`src/agents/planner/planner-agent.ts`):
   - Receives context from the manager and generates a step-by-step plan.
   - Breaks down user requests into actionable steps.
   - Uses LLMs and custom tools to generate plans.
   - Key files: `planner-agent.ts`, `planner-graph.ts`, `graphs/planner/nodes/generate-plan/index.ts`, `graphs/planner/nodes/generate-plan/prompt.js`.

3. **Programmer Agent** (`src/agents/programmer/programmer-agent.ts`):
   - Executes the plan steps, making code changes and running migrations.
   - Handles file modifications, code generation, and migration commands.
   - Uses tools for file writing, migration, and LLM-driven code changes.
   - Key files: `programmer-agent.ts`, `migration/migration-handler.ts`, `utils/codegen.ts`, `utils/file-write.ts`.

4. **Reviewer Agent** (`src/agents/reviewer/reviewer-agent.ts`):
   - Validates changes made by the programmer agent.
   - Runs linting, tests, and code review tools to ensure quality.
   - Approves or requests changes before finalizing the workflow.
   - Key files: `reviewer-agent.ts`, `utils/review-tools.ts`, `utils/linting.ts`.

### Workflow Example
- The manager agent receives a user request and sets up the session.
- It calls the planner agent, which generates a plan using LLMs and custom logic.
- The programmer agent receives the plan, modifies files, and runs migrations.
- The reviewer agent checks the changes, runs tests, and ensures quality.
- The manager finalizes the workflow and returns results to the user.

This modular flow allows developers to extend, customize, or fork Open-SWE by modifying the relevant agent files and their supporting utilities.