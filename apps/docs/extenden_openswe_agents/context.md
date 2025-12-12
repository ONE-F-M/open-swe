# Context Module Files in Open-SWE

This document explains the purpose and functionality of each file in `open-swe/src/context`, which provides context management, API metadata, and code intelligence for agent workflows.

---

## File List & Descriptions

### 1. `api-index.ts`
- **Purpose:** Defines the structure for Frappe/ERPNext API metadata, including modules, functions, classes, DocTypes, and hooks.
- **Usage:** Used for code intelligence, automation, and semantic search. Provides detailed metadata for functions, classes, and DocTypes, enabling agents to reason about the codebase.
- **Key Types:**
  - `FrappeAPIIndex`: Main index structure.
  - `FunctionSignature`, `ClassSignature`, `DoctypeSchema`: Metadata for code elements.

### 2. `api-search.ts`
- **Purpose:** Implements semantic and direct search over the API index using embeddings and fast lookups.
- **Usage:** Allows agents to find relevant functions, classes, or DocTypes by context or signature. Supports vector search and context loading for code generation and analysis.
- **Key Types/Classes:**
  - `APISearchResult`: Search result structure.
  - `FrappeAPISearch`: Main class for API searching and context retrieval.

### 3. `demand-analyzer.ts`
- **Purpose:** Analyzes the context requirements for a code generation or analysis task.
- **Usage:** Determines which modules, DocTypes, and files are needed for a given task. Estimates token usage and collects all relevant files for context-aware code generation.
- **Key Types/Classes:**
  - `ContextDemand`: Structure describing required context.
  - `ContextDemandAnalyzer`: Main class for analyzing and collecting context.

### 4. `lazy-loader.ts`
- **Purpose:** Provides on-demand, cached loading of module context for agents, optimizing token usage and performance.
- **Usage:** Loads module content only when needed, caches results, and ensures token budgets are respected. Used by agents to efficiently access code context during tool calls.
- **Key Classes:**
  - `LazyContextLoader`: Main class for lazy, budget-aware context loading.

---

## How These Files Work Together
- `api-index.ts` defines the metadata structure for all code elements.
- `api-search.ts` enables searching and retrieving relevant code context from the index.
- `demand-analyzer.ts` determines what context is needed for a given task and collects the necessary files.
- `lazy-loader.ts` loads and caches module context on demand, ensuring agents have the information they need without exceeding token limits.

Together, these files provide the backbone for context-aware automation, code intelligence, and efficient agent workflows in Open-SWE.
