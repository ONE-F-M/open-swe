// Structure for parsed test failures from test output
export interface ParsedFailure {
  name: string;   // The name of the test function that failed (e.g., test_validation_error)
  error: string;  // The actual error message (e.g., ValueError, AssertionError)
  file: string;   // The file path where the error occurred
  line: number;   // The line number in that file
}

// Error handler for formatting migration and test errors in Frappe/ERPNext automation

export class FrappeErrorHandler {
  // Formats migration errors into actionable, user-friendly messages
  formatMigrationError(error: string): string {
    const lowerError = error.toLowerCase();

    // Detects data/type errors in migration output
    if (lowerError.includes('dataerror') || lowerError.includes('invalid field')) {
      return `
Migration Failed: Invalid Data Type or Value.
This is typically caused by providing an invalid default value, using a fieldtype incorrectly, or adding a field with data incompatible with existing records.

**Action:**
- Check the fieldtype, options, and default value in the affected DocType JSON.
Raw Error: \`${error.substring(0, 200)}...\`
`;
    }

    // Detects integrity/constraint violation errors in migration output
    if (lowerError.includes('integrityerror') || lowerError.includes('constraint violation') || lowerError.includes('foreign key')) {
      return `
Migration Failed: Database Constraint Violation.
The database schema change violated an existing rule, likely due to a Foreign Key constraint, a unique index, or a NOT NULL field being set on an existing DocType with null records.

**Action:**
- **Manual Database Review Required.**
- Check the DocType JSON for recently added required fields or unique constraints.
Raw Error: \`${error.substring(0, 200)}...\`
`;
    }
    
    // Detects Python/module loading errors in migration output
    if (lowerError.includes('modulenotfounderror') || lowerError.includes('syntaxerror')) {
      return `
Migration Failed: Python Execution Error.
The failure occurred before or during Frappe initialization, indicating an issue with Python syntax, a missing import, or a corrupted virtual environment.

**Action:**
- Check the Python file where the error occurred for syntax issues or missing imports.
Raw Error: \`${error.substring(0, 200)}...\`
`;
    }

    return `Migration failed: ${error}`;
  }

  // Formats test runner output into a concise, readable failure report
  formatTestError(output: string): string {
    const failedTests = this.parseTestOutput(output);
    const failureCount = failedTests.length;

    if (failureCount === 0) {
      // No specific failures parsed, fallback message
      return "Tests failed, but no specific failures were parsed. Check the full log.";
    }

    const failureDetails = failedTests.map(t => `
- **Test:** \`${t.name}\`
  **Error Type:** \`${t.error}\`
  **File:** \`${t.file}\` (Line ${t.line})
`).join('\n');

    return `
### ❌ Agent Test Failure Report (${failureCount} Failures)

The Programmer Agent failed to pass the required unit tests.

${failureDetails}

**Suggested Action:**
The Programmer Agent needs to fix the logic in the reported file(s) before proceeding.
`;
  }

  // Parses test output to extract failure details (compatible with Jest/pytest)
  private parseTestOutput(output: string): ParsedFailure[] {
    const failures: ParsedFailure[] = [];

    // Regex: Matches the start of a traceback showing the test function and the file/line where the failure was raised.
    // This regex is slightly simplified to be more compatible with Jest/pytest outputs.
    const failureBlockRegex = /FAIL: ([\w\.]+)\n(?:.|\n)*?File \"(.+?)\", line (\d+), in (?:[\w]+)?\n(?:\s{4})?(?:AssertionError|Exception|ValueError|TypeError): (.+?)\n/g;

    let match;
    while ((match = failureBlockRegex.exec(output)) !== null) {
      // Group 1: Full test path (e.g., custom_app.tests.test_api.TestAPI.test_method)
      // Group 2: File path (e.g., /home/frappe/frappe-bench/apps/custom_app/api.py)
      // Group 3: Line number
      // Group 4: The final error message
      
      const testNameParts = match[1].split('.');
      const testName = testNameParts.pop() || match[1];

      failures.push({
        name: testName,
        error: match[4].trim().split('\n')[0], // Take only the first line of the error message
        file: match[2].trim(),
        line: parseInt(match[3], 10),
      });
    }

    return failures;
  }
}