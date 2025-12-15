// Output structure for parsed test failures
export interface ParsedFailure {
  name: string;   // The name of the test function that failed (e.g., test_validation_error)
  error: string;  // The actual error message (e.g., ValueError, AssertionError)
  file: string;   // The file path where the error occurred
  line: number;   // The line number in that file
}
// src/error-handler.ts
// Error formatter for common agent failures in Frappe/ERPNext automation

export class FrappeErrorHandler {
  formatMigrationError(error: string): string {
    // Parse common migration errors
    if (error.includes('DataError')) {
      return `
Migration failed: Invalid data type in field definition.
Common fixes:
- Check fieldtype is valid: Data, Link, Select, etc.
- Ensure default values match fieldtype
- Required fields need defaults when adding to existing DocType

Raw error: ${error}
`;
    }

    if (error.includes('IntegrityError')) {
      return `
Migration failed: Database constraint violation.
Likely causes:
- Adding UNIQUE constraint to field with duplicate values
- Foreign key reference to non-existent record
- NOT NULL constraint on field with NULL values

Suggestion: Add data migration to clean up before schema change.

Raw error: ${error}
`;
    }

    return `Migration failed: ${error}`;
  }

  formatTestError(output: string): string {
    // Extract relevant test failure info
    const failedTests = this.parseTestOutput(output);

    return `
Tests failed (${failedTests.length} failures):
${failedTests.map(t => `
- ${t.name}
  Error: ${t.error}
  File: ${t.file}:${t.line}
`).join('\n')}

Common fixes:
- Check for missing imports
- Verify test site has required data
- Clear cache before running: bench --site test_site clear-cache
`;
  }

  // Parses test output to extract failure details
  private parseTestOutput(output: string): ParsedFailure[] {
    const failures: ParsedFailure[] = [];

    // Regex 1: Matches the start of a traceback block showing the file/line where the failure was *raised*.
    // It looks for a sequence of lines ending with a test function name and the error type.
    const failureBlockRegex = /FAIL: ([\w\.]+\.([\w]+)) \([\w\.]+\)\n(?:.|\n)*?\nFile \"(.+?)\", line (\d+), in ([\w]+)/g;

    // Regex 2: Matches the final error line, typically at the end of the block.
    const errorMessageRegex = /(?:AssertionError|Exception|ValueError|TypeError): (.+)\n/g;

    let match;
    while ((match = failureBlockRegex.exec(output)) !== null) {
      // Group 1: Full test path (e.g., custom_app.tests.test_api.TestAPI.test_method)
      // Group 2: Test method name (e.g., test_method)
      // Group 3: File path (e.g., apps/custom_app/api.py)
      // Group 4: Line number
      // Group 5: Function name (e.g., on_submit)

      const fullBlock = match[0];
      let testName = match[1]; 
      let filePath = match[3];
      let lineNumber = parseInt(match[4], 10);
      
      // Find the actual error message within the block
      let errorMessage = "Error details unavailable. Check full traceback.";
      const errorMatch = errorMessageRegex.exec(fullBlock);
      if (errorMatch) {
        errorMessage = errorMatch[1].trim().split('\n')[0];
      }

      failures.push({
        name: testName.split('.').pop() || testName,
        error: errorMessage,
        file: filePath,
        line: lineNumber,
      });
    }

    return failures;
  }
}
