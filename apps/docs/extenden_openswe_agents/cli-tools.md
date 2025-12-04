# CLI Tools (`apps/cli/src/tools.ts`)

This file provides a set of standalone tools for automating Frappe/ERPNext operations via the command line, designed for use in agent workflows and automation scripts. Each tool wraps a common bench command and exposes a consistent interface for invocation and error handling.

---

## Main Tools & Their Purpose

### 1. `benchMigrateTool`
- **Purpose:** Runs `bench --site [site] migrate --skip-failing` to apply database migrations and patches for a Frappe site.
- **Usage:** Used after code changes to update the database schema.

### 2. `benchRunTestTool`
- **Purpose:** Runs `bench --site [site] run-tests --app [app] [--module module]` to execute tests for a Frappe/ERPNext app or module.
- **Usage:** Used to validate code changes and ensure tests pass.

### 3. `benchClearCacheTool`
- **Purpose:** Runs `bench --site [site] clear-cache` to clear the Frappe cache.
- **Usage:** Ensures a clean state before running tests or after migrations.

### 4. `benchConsoleTool`
- **Purpose:** Runs `bench --site [site] console --eval [code]` to execute arbitrary Python code in the Frappe context.
- **Usage:** Used for debugging, data inspection, or custom automation.

### 5. `benchGetDocInfoTool`
- **Purpose:** Fetches a single field value from a DocType document or retrieves the DocType definition as JSON.
- **Usage:** Used for data inspection, validation, and schema analysis.

### 6. `benchListAppsTool`
- **Purpose:** Lists installed apps for a Frappe site using `bench --site [site] list-apps`.
- **Usage:** Used to discover available apps and validate app installation.

### 7. `benchBackupTool`
- **Purpose:** Runs `bench --site [site] backup` to create a database backup for a Frappe site.
- **Usage:** Used before migrations or major changes to ensure data safety.

---

## How These Tools Work
- Each tool is implemented as a wrapper around a bench command, using the `executeInSandbox` utility to run commands in a controlled environment.
- Tools validate input parameters using Zod schemas and provide structured output, including exit codes, stdout, stderr, and result data.
- Errors are caught and reported with clear messages for debugging and automation reliability.

---

These CLI tools enable robust, scriptable automation for Frappe/ERPNext workflows, making it easy for agents and developers to perform migrations, testing, data inspection, and more.