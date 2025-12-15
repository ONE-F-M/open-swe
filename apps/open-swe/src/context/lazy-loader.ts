import { FrappeAPISearch } from "./api-search.js";

// --- Singleton Cache for FrappeAPISearch (Optimization for Task 11.2) ---
let cachedApiSearcher: FrappeAPISearch | null = null;
const INDEX_PATH = "../../frappe-api-index.json"; // Centralized path definition

export class LazyContextLoader {
  private loadedModules = new Set<string>();
  private contextCache = new Map<string, string>();

  async loadOnDemand(
    importStatement: string,
    currentTokenCount: number,
    maxTokens: number = 180000 // Claude Sonnet 4 limit
  ): Promise<string | null> {
    const modulePath = this.parseModulePath(importStatement);
    // Already loaded?
    if (this.loadedModules.has(modulePath)) {
      return this.contextCache.get(modulePath) || null;
    }
    
    // Get the singleton API search instance
    const apiSearch = await this.getFrappeAPISearch();
    const moduleContent = await apiSearch.getModuleContent(modulePath);
    
    // Check token budget
    const estimatedTokens = this.estimateTokens(moduleContent);
    if (currentTokenCount + estimatedTokens > maxTokens) {
      console.warn(`Token budget exceeded. Skipping ${modulePath}`);
      return null;
    }
    
    // Load and cache
    this.loadedModules.add(modulePath);
    this.contextCache.set(modulePath, moduleContent);
    return moduleContent;
  }

  async preloadEssentials(): Promise<string> {
    // Always load these core modules (15k tokens total)
    const essential = [
      "frappe.model.document",
      "frappe.utils",
      "frappe.core.doctype.doctype.doctype"
    ];
    let context = "";
    for (const module of essential) {
      // NOTE: We pass Infinity as maxTokens for essentials to ensure they always load
      const loaded = await this.loadOnDemand(`from ${module} import *`, 0, Infinity); 
      if (loaded) context += loaded;
    }
    return context;
  }

  /**
   * Helper function to get the singleton API searcher instance.
   * Initializes it only once.
   */
  private async getFrappeAPISearch(): Promise<FrappeAPISearch> {
    if (cachedApiSearcher) {
      return cachedApiSearcher;
    }
    
    const searcher = new FrappeAPISearch();
    // This is the expensive, one-time initialization step
    await searcher.initialize(INDEX_PATH); 
    cachedApiSearcher = searcher;
    return searcher;
  }

  // --- Other Helper methods ---
  private parseModulePath(importStatement: string): string {
    // Simple parser: 'from frappe.model.document import get_doc' → 'frappe.model.document'
    const match = importStatement.match(/from ([\w\.]+)/);
    return match ? match[1] : importStatement;
  }

  private estimateTokens(moduleContent: string): number {
    // Rough estimate: 1 token ≈ 4 chars (for code)
    return Math.ceil(moduleContent.length / 4);
  }
}