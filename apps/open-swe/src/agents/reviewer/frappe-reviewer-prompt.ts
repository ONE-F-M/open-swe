// src/planner/frappe-reviewer-prompt.ts

export const FRAPPE_REVIEWER_CHECKS = `
When reviewing Frappe code changes, verify:

## Code Quality
- [ ] Type hints in function signatures
- [ ] Docstrings present for all functions
- [ ] frappe.throw() used instead of raise Exception
- [ ] frappe.db.sql() used only if no ORM exists

## Frappe Patterns
- [ ] API methods have @frappe.whitelist() decorator
- [ ] Avoid direct use of frappe.db.sql() for SELECT
- [ ] Use frappe.get_doc() and frappe.get_value() if needed
- [ ] No hardcoded site paths


## Hook Validation
- [ ] Hook syntax matches: {'DocType': {'event': 'path.to.method'}}
- [ ] All hook methods exist at specified paths
- [ ] Provide doc-specific hooks (avoid global hooks unless necessary)
- [ ] Hook methods are tested if logic is non-trivial


## Testing
- [ ] Tests written for all new or changed functionality
- [ ] Use frappe.test_runner.run() for test execution
- [ ] Test covers edge cases and error handling
- [ ] Test fails if expected exception is not raised


## Migrations
- [ ] All schema (.json) changes have no syntax errors
- [ ] Field names are unique within the DocType (Label, Link, Select, etc.)
- [ ] Required fields have default values if added to an existing DocType
- [ ] Migration files are reviewed for correctness and completeness
- [ ] No extraneous or unrelated changes in migration files

## Deliverables
- Reviewer checklist
- Comparison with previous keep
- Summarize review logic
`;
