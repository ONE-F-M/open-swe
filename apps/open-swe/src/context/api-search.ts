import { OpenAIEmbeddings } from "@langchain/openai";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import * as fs from 'fs';
import { FrappeAPIIndex } from "./api-index.js";

// Result returned by API search
export interface APISearchResult {
  type: "function" | "class" | "doctype";
  path: string;
  signature: string;
  relevance: number;
  context: string; 
}

// FrappeAPISearch provides semantic and direct search over the API index using embeddings and fast lookups
export class FrappeAPISearch {
  private vectorStore!: MemoryVectorStore;
  private apiIndex!: FrappeAPIIndex;
  private moduleContentCache = new Map<string, string>();

  // Returns the code/content for a given module path from the API index (for context loading)
  async getModuleContent(modulePath: string): Promise<string> {
    if (this.moduleContentCache.has(modulePath)) {
      return this.moduleContentCache.get(modulePath)!;
    }
    const module = this.apiIndex?.modules?.[modulePath];
    if (!module) return "";
    let contentArray: string[] = [];
    // Concatenate all function signatures and docstrings in the module
    if (Array.isArray(module.functions)) {
      for (const func of module.functions) {
        contentArray.push(`${func.signature}\n${func.docstring || ""}\n`);
      }
    }
    // Concatenate all class definitions in the module
    if (Array.isArray(module.classes)) {
      for (const cls of module.classes) {
        contentArray.push(`class ${cls.name} {\n${cls.docstring || ""}\n}`);
      }
    }
    const content = contentArray.join("");
    this.moduleContentCache.set(modulePath, content);
    return content;
  }

  // Batch search stub for future optimization
  async batchSearchModuleContents(modulePaths: string[]): Promise<string[]> {
    return Promise.all(modulePaths.map((p) => this.getModuleContent(p)));
  }

  // Loads the API index and builds the vector store for semantic search
  async initialize(indexPath: string): Promise<void> {
    console.log(`Initializing FrappeAPISearch from ${indexPath}...`);
    // 1. Load the structured index data
    this.apiIndex = await this.loadIndex(indexPath);
    
    // 2. Create embeddings for all API signatures and DocTypes
    const documents = this.prepareDocuments();
    
    // In production, use a persistent vector store (e.g., Pinecone/Qdrant) for scale
    this.vectorStore = await MemoryVectorStore.fromDocuments(
      documents,
      new OpenAIEmbeddings()
    );
    console.log(`FrappeAPISearch initialized with ${documents.length} documents.`);
  }

  // Performs a semantic search over the API index using embeddings
  async search(query: string, limit: number = 10): Promise<APISearchResult[]> {
    // Semantic search over function/class signatures and DocType definitions
    const results = await this.vectorStore.similaritySearchWithScore(query, limit);
    
    return results.map(([doc, score]) => ({
      type: doc.metadata.type,
      path: doc.metadata.path,
      signature: doc.pageContent,
      relevance: score ?? 0,
      context: this.getContext(doc.metadata.path) // Now calls the implemented context getter
    }));
  }

  // Performs a direct lookup by import statement (fastest for known imports)
  async searchByImport(importStatement: string): Promise<APISearchResult | null> {
    // Direct lookup: "from frappe import get_doc" -> function signature (fastest lookup)
    const parsed = this.parseImport(importStatement);
    if (!parsed.module || !parsed.name) return null;
    return this.lookupExact(parsed.module, parsed.name);
  }

  // Returns the schema for a given DocType name
  getDoctypeSchema(doctypeName: string): any | null {
    return this.apiIndex.doctypes[doctypeName]?.schema || null;
  }

  // Prepares all documents (functions, doctypes) for embedding and search
  private prepareDocuments(): any[] {
    const docs: any[] = [];
    
    // 1. Index all functions/methods
    for (const [modulePath, module] of Object.entries(this.apiIndex.modules)) {
      if (Array.isArray(module.functions)) {
        for (const func of module.functions) {
          docs.push({
            pageContent: `${func.signature}\n${func.docstring}`,
            metadata: {
              type: "function",
              path: `${modulePath}.${func.name}`,
              whitelisted: func.whitelisted,
              modulePath: modulePath
            }
          });
        }
      }
    }
    
    // 2. Index all DocTypes
    for (const [name, doctype] of Object.entries(this.apiIndex.doctypes)) {
      if (doctype && doctype.schema && Array.isArray(doctype.schema.fields)) {
        const fieldList = doctype.schema.fields
          .map((f: any) => `${f.fieldname}: ${f.fieldtype}`)
          .join(", ");
        docs.push({
          pageContent: `DocType: ${name} (${fieldList})`,
          metadata: {
            type: "doctype",
            path: name,
            app: doctype.app
          }
        });
      }
    }
    return docs;
  }

  // Loads the API index from a local JSON file
  private async loadIndex(indexPath: string): Promise<FrappeAPIIndex> {
    // Implementation for loading a local JSON file (assuming the index builder saved it locally)
    try {
      if (!fs.existsSync(indexPath)) {
        throw new Error(`Index file not found at local path: ${indexPath}`);
      }
      const data = fs.readFileSync(indexPath, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      console.error(`[loadIndex] Error loading index: ${e}`);
      throw new Error(`Failed to load and parse API index from ${indexPath}`);
    }
  }

  // Returns the context (surrounding code) for a given path
  private getContext(path: string): string {
    // Simple implementation: Retrieve the entire module content if the path points to a function/class.
    // This provides "surrounding code" by giving the whole file's context (signatures/docstrings).
    if (path.includes('.')) {
        // Path is 'module.function' or 'module.Class.method'
        const parts = path.split('.');
        // Find the module path (e.g., 'frappe.utils.document' from 'frappe.utils.document.get_doc')
        const modulePath = parts.slice(0, parts.length - 1).join('.'); 
        if (this.apiIndex.modules[modulePath]) {
            return `Context Module: ${modulePath}\n${this.getModuleContent(modulePath)}`;
        }
    }
    return "";
  }

  // Parses an import statement to extract module and name
  private parseImport(importStatement: string): { module: string; name: string } {
    // Parses: 'from frappe.db import get_value' or 'import frappe'
    
    // 1. Attempt 'from X import Y'
    const fromImportMatch = importStatement.match(/from ([\w\.]+) import ([\w]+)/);
    if (fromImportMatch) {
      return { module: fromImportMatch[1], name: fromImportMatch[2] };
    }

    // 2. Attempt 'import X' (assumes X is the module name and the imported name is the last part)
    // E.g., 'import frappe.utils' -> module: 'frappe.utils', name: 'utils' (not perfect but handles common cases)
    const importMatch = importStatement.match(/import ([\w\.]+)/);
    if (importMatch) {
        const fullModule = importMatch[1];
        const name = fullModule.split('.').pop() || fullModule;
        return { module: fullModule, name: name };
    }

    return { module: "", name: "" };
  }

  // Looks up a function or class method by exact module and name
  private lookupExact(modulePath: string, name: string): APISearchResult | null {
    // Direct lookup in the modules dictionary for efficiency
    const module = this.apiIndex.modules[modulePath];
    if (!module) return null;

    // 1. Look for function directly in the module
    const func = module.functions?.find((f: any) => f.name === name);
    if (func) {
      return {
        type: "function",
        path: `${modulePath}.${name}`,
        signature: func.signature,
        relevance: 1.0,
        context: func.docstring
      };
    }
    
    // 2. Look for the name as a class method (requires iterating classes)
    if (Array.isArray(module.classes)) {
        for (const cls of module.classes) {
            const method = cls.methods.find((m: any) => m.name === name);
            if (method) {
                return {
                    type: "function", // Treat method lookup as a function call for simplicity
                    path: `${modulePath}.${cls.name}.${name}`,
                    signature: method.signature,
                    relevance: 1.0,
                    context: `${cls.docstring}\n${method.docstring}`
                };
            }
        }
    }

    return null;
  }
}