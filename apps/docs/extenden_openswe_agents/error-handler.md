# Error Handler (`src/error-handler.ts`)

**Purpose:** Provides robust error formatting and handling for migration and test failures in Frappe/ERPNext automation.

**Key Features:**
- Formats migration errors into actionable, user-friendly messages.
- Detects common error types (data/type errors, integrity/constraint violations, etc.) and suggests actions.
- Parses test failures to extract function name, error, file, and line number.

**Usage:** Used by migration handlers and agents to report errors in a clear, developer-friendly format.

**Main Class:**
- `FrappeErrorHandler`: Contains methods for formatting migration errors and parsing test failures.
