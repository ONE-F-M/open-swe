// import { FrappeAPISearch } from "./api-search.js";
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ContextDemand {
  frameworkModules: string[]; // e.g., ["frappe.model.document"]
  doctypeSchemas: string[];   // e.g., ["Customer", "Sales Invoice"]
  customAppFiles: string[];   // All files in custom app
  estimatedTokens: number;
}

// Define the root of the Frappe bench for file operations (adjust as needed for your sandbox)
export const BENCH_ROOT = process.env.BENCH_PATH || '/home/frappe/frappe-bench';
const CUSTOM_APP_NAME = "one_fm/one_fm"; 
const CUSTOM_APP_FOLDER = path.join(BENCH_ROOT, "apps", CUSTOM_APP_NAME); 

export class ContextDemandAnalyzer {
  constructor(
    // private apiSearch: FrappeAPISearch,
    private taskDescription: string
  ) {}

  async analyze(): Promise<ContextDemand> {
    const demand: ContextDemand = {
      frameworkModules: [],
      doctypeSchemas: [],
      customAppFiles: await this.getAllCustomAppFiles(),
      estimatedTokens: 0,
    };

    // Step 1: Extract mentioned DocTypes from task
    const mentionedDoctypes = this.extractDoctypes(this.taskDescription);
    demand.doctypeSchemas = mentionedDoctypes;

    // Step 2: Analyze custom app imports (relies on file reading)
    const customAppImports = await this.analyzeCustomAppImports();
    demand.frameworkModules = customAppImports;

    // Step 3: Estimate token count
    demand.estimatedTokens = this.estimateTokens(demand);

    return demand;
  }

 private extractDoctypes(text: string): string[] {
  // Pattern match common DocType references, supporting multi-word names
  const patterns = [
    /add (?:a )?(?:custom )?field [^']*'[^']+' to ([\w ]+) DocType/gi,
    /modify ([\w ]+) DocType/gi,
    /([\w ]+ Invoice)/gi,
    /([\w ]+ Order)/gi,
  ];
  const doctypes = new Set<string>();
  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      doctypes.add(match[1].trim());
    }
  }
  return Array.from(doctypes);
}

  private async analyzeCustomAppImports(): Promise<string[]> {
    // Scan all .py files in custom_app for framework imports
    const imports = new Set<string>();
    
    // Use the actual file listing method
    const pythonFiles = await this.getPythonFiles(CUSTOM_APP_FOLDER);

    for (const file of pythonFiles) {
      try {
        const content = await this.readFile(file);
        const fileImports = this.extractImports(content);
        fileImports.forEach(imp => imports.add(imp));
      } catch (e) {
        console.warn(`Could not read file ${file} for import analysis: ${e}`);
      }
    }
    return Array.from(imports);
  }

  private extractImports(pythonCode: string): string[] {
    // Parse: from frappe.model.document import get_doc (captures the module path)
    // NOTE: We only care about frappe.* imports, as per the pattern
    const importPattern = /from (frappe\.[\w\.]+) import/g;
    const matches = pythonCode.matchAll(importPattern);
    return Array.from(matches, m => m[1]);
  }

  private estimateTokens(demand: ContextDemand): number {
    let tokens = 0;
    // Custom app: ~500 tokens per file (average)
    tokens += demand.customAppFiles.length * 500;
    // Framework modules: ~2000 tokens per module (signatures + docstrings)
    tokens += demand.frameworkModules.length * 2000;
    // DocType schemas: ~1000 tokens per DocType
    tokens += demand.doctypeSchemas.length * 1000;
    return tokens;
  }

  // --- Helpers for file system (Implemented with fs/promises) ---

  private async getAllCustomAppFiles(): Promise<string[]> {
    // Since Python files are the primary source of context, we reuse the Python file finder.
    // We return paths relative to the bench root for logging consistency.
    return this.getPythonFiles(CUSTOM_APP_FOLDER);
  }

  private async getPythonFiles(startPath: string): Promise<string[]> {
    let results: string[] = [];
    try {
        const files = await fs.readdir(startPath, { withFileTypes: true });

        for (const file of files) {
            const fullPath = path.join(startPath, file.name);
            if (file.isDirectory()) {
                // Ignore hidden directories and common vendor folders
                if (file.name.startsWith('.') || file.name === 'node_modules' || file.name === 'env') {
                    continue;
                }
                results = results.concat(await this.getPythonFiles(fullPath));
            } else if (file.name.endsWith('.py')) {
                // Return path relative to bench root for consistent analysis/logging
                results.push(path.relative(BENCH_ROOT, fullPath));
            }
        }
    } catch (e) {
        // Handle case where directory doesn't exist (e.g., if CUSTOM_APP_FOLDER is wrong)
        console.error(`Error reading directory ${startPath}: ${e}`);
    }
    return results;
  }

  private async readFile(filePath: string): Promise<string> {
    // Ensure filePath is absolute; if not, resolve relative to BENCH_ROOT
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(BENCH_ROOT, filePath);
    return fs.readFile(absPath, 'utf-8');
}

}