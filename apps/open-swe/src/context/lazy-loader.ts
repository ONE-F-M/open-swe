
import { FrappeAPISearch } from "./api-search.js";

// Singleton cache for FrappeAPISearch instance to avoid repeated expensive initialization
let cachedApiSearcher: FrappeAPISearch | null = null;
// Path to the API index JSON file
const INDEX_PATH = "../../frappe-api-index.json";

// LRU cache implementation for contextCache
class LRUCache<K, V> {
  private maxSize: number;
  private cache: Map<K, V>;
  constructor(maxSize: number) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }
  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }
  set(key: K, value: V) {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value as K;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, value);
  }
}

export class LazyContextLoader {
  // Tracks which modules have already been loaded to avoid redundant context loading
  private loadedModules = new Set<string>();
  // Caches loaded module content for fast repeated access
  private contextCache = new LRUCache<string, string>(20);

  async loadOnDemand(
    importStatement: string,
    currentTokenCount: number,
    maxTokens: number = 180000 // Claude Sonnet 4 limit
  ): Promise<string | null> {
    // Parse the module path from the import statement
    const modulePath = this.parseModulePath(importStatement);
    // Return cached content if already loaded
    if (this.loadedModules.has(modulePath)) {
      const cached = this.contextCache.get(modulePath);
      if (cached) return cached;
      // If loaded but not cached, reload and cache
    }
    // Check cache before loading
    const cached = this.contextCache.get(modulePath);
    if (cached) {
      this.loadedModules.add(modulePath);
      return cached;
    }
    let moduleContent = "";
    try {
      // Get the singleton API search instance (expensive initialization only once)
      const apiSearch = await this.getFrappeAPISearch();
      // Retrieve the module's code/content from the API index
      moduleContent = await apiSearch.getModuleContent(modulePath);
    } catch (err) {
      // Only log errors for failures
      console.error(`Error reading module content for ${modulePath}:`, err);
      return null;
    }
    // Estimate tokens and check if loading this module would exceed the token budget
    let estimatedTokens = this.estimateTokens(moduleContent);
    const HARD_CAP = 5000; // Max tokens per module context
    if (estimatedTokens > HARD_CAP) {
      // Truncate: Only include the first and last 20 lines, with a warning
      const lines = moduleContent.split('\n');
      const head = lines.slice(0, 20);
      const tail = lines.slice(-20);
      moduleContent = head.join('\n') + '\n...\n[TRUNCATED: Module too large, only showing first and last 20 lines]\n' + tail.join('\n') + `\n[Summary: Module ${modulePath} is too large. See documentation for details.]`;
      estimatedTokens = this.estimateTokens(moduleContent);
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
    // Lazy-load only essential modules when needed
    const essential = [
       "frappe.db",
      "frappe.throw"
    ];
    let context = "";
    for (const module of essential) {
      if (!this.loadedModules.has(module)) {
        // Use Infinity for maxTokens to guarantee essentials are always loaded
        const loaded = await this.loadOnDemand(`from ${module} import *`, 0, Infinity);
        if (loaded) context += loaded;
      }
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