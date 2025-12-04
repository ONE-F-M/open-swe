# frappe-api-index.json

**Purpose:** Serves as the root index for Frappe/ERPNext API metadata, enabling code intelligence, semantic search, and automation.

**Contents:**
- `version`: API version identifier.
- `modules`: Metadata for each module, including functions, classes, and whitelisting status.
- `doctypes`: Metadata for each DocType, including app ownership, schema, controller path, and hooks.
- `hooks`: Metadata for hooks, including signature, description, and examples.

**Usage:**
- Used by agents and context modules to reason about the codebase, find relevant functions/classes, and understand DocType schemas.
- Enables semantic and direct search for code elements.
