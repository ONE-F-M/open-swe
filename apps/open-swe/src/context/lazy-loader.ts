
import { FrappeAPISearch } from "./api-search.js";

// Singleton cache for FrappeAPISearch instance to avoid repeated expensive initialization
let cachedApiSearcher: FrappeAPISearch | null = null;
// Path to the API index JSON file (can be overridden by environment variable)
const INDEX_PATH = process.env.FRAPPE_API_INDEX_PATH || "../../frappe-api-index.json";

export class LazyContextLoader {

  // Tracks which modules have already been loaded to avoid redundant context loading
  private loadedModules = new Set<string>();
  // Caches loaded module content for fast repeated access
  private contextCache = new Map<string, string>();

  async loadOnDemand(
    importStatement: string,
    currentTokenCount: number,
    maxTokens: number = 180000 // Claude Sonnet 4 limit
  ): Promise<string | null> {
    // Parse the module path from the import statement
    const modulePath = this.parseModulePath(importStatement);
    // Return cached content if already loaded
    if (this.loadedModules.has(modulePath)) {
      return this.contextCache.get(modulePath) || null;
    }

    // Get the singleton API search instance (expensive initialization only once)
    const apiSearch = await this.getFrappeAPISearch();
    // Retrieve the module's code/content from the API index
    let moduleContent = await apiSearch.getModuleContent(modulePath);

    // Estimate tokens and check if loading this module would exceed the token budget
    let estimatedTokens = this.estimateTokens(moduleContent);
    const HARD_CAP = 5000; // Lower max tokens per module context
    if (estimatedTokens > HARD_CAP) {
      // Truncate: Only include the first and last 20 lines, with a warning and summary
      const lines = moduleContent.split('\n');
      const head = lines.slice(0, 20);
      const tail = lines.slice(-20);
      moduleContent = head.join('\n') + '\n...\n[TRUNCATED: Module too large, only showing first and last 20 lines]\n' + tail.join('\n') + `\n[Summary: Module ${modulePath} is too large. See documentation for details.]`;
      estimatedTokens = this.estimateTokens(moduleContent);
      // Only log if not in production
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[LazyContextLoader] Module ${modulePath} exceeded ${HARD_CAP} tokens. Truncated context.`);
      }
    }
    if (currentTokenCount + estimatedTokens > maxTokens) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[LazyContextLoader] Token budget exceeded. Skipping ${modulePath}`);
      }
      return null;
    }

    // Cache the loaded module for future requests
    this.loadedModules.add(modulePath);
    this.contextCache.set(modulePath, moduleContent);
    return moduleContent;
  }

  async preloadEssentials(): Promise<string> {
    // Minimized essentials: Only load the bare minimum required for most tasks
    const essential = [
      "frappe.db",
      "frappe.throw"
    ];
    let context = "";
    for (const module of essential) {
      // Use Infinity for maxTokens to guarantee essentials are always loaded
      const loaded = await this.loadOnDemand(`from ${module} import *`, 0, Infinity); 
      if (loaded) context += loaded;
    }
    return context;
  }

  // Returns the singleton FrappeAPISearch instance, initializing it if needed
  private async getFrappeAPISearch(): Promise<FrappeAPISearch> {
    if (cachedApiSearcher) {
      return cachedApiSearcher;
    }
    // Expensive, one-time initialization of the API searcher
    const searcher = new FrappeAPISearch();
    await searcher.initialize(INDEX_PATH); 
    cachedApiSearcher = searcher;
    return searcher;
  }

  // Parses the module path from an import statement (e.g., 'from frappe.utils import ...')
  private parseModulePath(importStatement: string): string {
    // Simple parser: 'from frappe.model.document import get_doc' → 'frappe.model.document'
    const match = importStatement.match(/from ([\w\.]+)/);
    return match ? match[1] : importStatement;
  }

  // Estimates the number of tokens in a module's content (1 token ≈ 4 chars for code)
  private estimateTokens(moduleContent: string): number {
    // Rough estimate: 1 token ≈ 4 chars (for code)
    return Math.ceil(moduleContent.length / 4);
  }
}