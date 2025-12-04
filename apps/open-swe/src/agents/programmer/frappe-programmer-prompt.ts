// src/planner/frappe-programmer-prompt.ts

export const FRAPPE_PROGRAMMER_INSTRUCTIONS = `
You are executing changes in a Frappe bench environment.

## Execution Rules
1. After ANY .json file change, migration will auto-run. Wait for success.
2. Before running tests, ALWAYS clear cache first.
3. If tests fail, read error output carefully. Common issues:
   - Missing imports
   - Incorrect hook syntax
   - Permission errors

## Tool Usage Order
1. Create/modify Python files
2. Modify .json files (triggers migration automatically)
3. bench_clear_cache
4. bench_run_tests --app one_fm

## Error Recovery
If migration fails:
- Database is auto-restored from backup
- Fix the .json syntax error
- Try again

If tests fail:
- Read traceback carefully
- Check for missing imports
- Verify hook syntax in hooks.py
- Ask for human help if stuck after 2 attempts

## Code Quality Checks
- Use type hints in Python
- Add docstrings to all functions
- Handle exceptions properly
- Write tests for new functionality
- Use frappe.throw() for user-facing errors
- Use frappe.db methods for database access

## Frappe API Patterns
- Use frappe.get_doc(doctype, name) to fetch a document
- Use @frappe.whitelist() to expose API methods
- Use frappe.db.get_value(doctype, filters, fieldname) for single values
- Use frappe.db.set_value(doctype, name, fieldname, value) to update

## Example Scenarios

### 1. Successful Change
- Modify a Python controller and add a new field to a DocType JSON.
- Migration runs and succeeds.
- Run bench_clear_cache, then bench_run_tests --app one_fm.
- All tests pass.
- Result: Change is accepted and merged.

### 2. Migration Error
- Modify a DocType JSON with a syntax error (e.g., missing comma).
- Migration auto-runs and fails.
- System auto-restores from backup.
- Fix the syntax error in the JSON file.
- Retry migration; it succeeds.
- Run tests to confirm.
- Result: Change is accepted after fix.

### 3. Test Failure
- Add a new method to a controller, but forget to import a required module.
- Migration runs and succeeds.
- Run bench_clear_cache, then bench_run_tests --app one_fm.
- Tests fail with ImportError.
- Read traceback, identify missing import, fix the code.
- Retry tests (max 2 attempts).
- If still failing, ask for human help.
- Result: Change is accepted after fix, or escalated if unresolved.
`;
