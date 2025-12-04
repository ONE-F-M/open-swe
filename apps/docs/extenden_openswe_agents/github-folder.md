# GitHub Folder (`src/github`)

**Purpose:** Contains adapters and utilities for integrating with GitHub, including repository management, authentication, and API interactions.

**Key Files:**
- `frappe-github-adapter.ts`: Main adapter for interacting with GitHub repositories, handling authentication, branch management, commits, and pull requests.
- `config/`: Configuration files for GitHub integration.
- `delivery/`: Utilities for delivery and deployment via GitHub.
- `label-handler.ts`: Handles GitHub label management for issues and PRs.

**Usage:**
- Used by agents to push code changes, create branches, open pull requests, and manage repository state.
- Provides a bridge between Frappe/ERPNext automation and GitHub workflows.
