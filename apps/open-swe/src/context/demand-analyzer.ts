import * as fs from 'fs/promises';
import * as path from 'path';

// Structure describing the context requirements for a code generation or analysis task
export interface ContextDemand {
  frameworkModules: string[]; // List of Frappe framework modules required
  doctypeSchemas: string[];   // List of DocTypes referenced in the task
  customAppFiles: string[];   // All Python files in the custom app
  estimatedTokens: number;    // Estimated total token count for the context
}

// Root directory of the Frappe bench (can be overridden by BENCH_PATH env variable)
export const BENCH_ROOT = process.env.BENCH_PATH || '/home/frappe/frappe-bench';
// Name and path of the custom app to analyze
const CUSTOM_APP_NAME = "one_fm/one_fm"; 
const CUSTOM_APP_FOLDER = path.join(BENCH_ROOT, "apps", CUSTOM_APP_NAME); 

export class ContextDemandAnalyzer {
  constructor(
    private taskDescription: string
  ) {}

  // Main entry: Analyze the task and return all context requirements
  async analyze(): Promise<ContextDemand> {
    const demand: ContextDemand = {
      frameworkModules: [],
      doctypeSchemas: [],
      customAppFiles: await this.getAllCustomAppFiles(),
      estimatedTokens: 0,
    };

    // Extract DocTypes mentioned in the task description
    const mentionedDoctypes = this.extractDoctypes(this.taskDescription);
    demand.doctypeSchemas = mentionedDoctypes;

    // Analyze all custom app files for Frappe framework imports
    const customAppImports = await this.analyzeCustomAppImports();
    demand.frameworkModules = customAppImports;

    // Estimate the total token count for the context
    demand.estimatedTokens = this.estimateTokens(demand);

    return demand;
  }

  // Extracts DocType names from the task description using regex patterns
 private extractDoctypes(text: string): string[] {
  // Optimized regex patterns for DocType references
  const patterns = [
    /(?:add|modify)\s+(?:a\s+)?(?:custom\s+)?field\s+[^']*'[^']+'\s+to\s+([\w ]+?)\s+DocType/gi,
    /(?:modify|add)\s+([\w ]+?)\s+DocType/gi,
    /([\w ]+? Invoice)/gi,
    /([\w ]+? Order)/gi,
  ];
  const doctypes = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) {
        doctypes.add(match[1].trim());
      }
    }
  }
  return Array.from(doctypes);
}

  // Scans all Python files in the custom app for Frappe framework imports
  private async analyzeCustomAppImports(): Promise<string[]> {
    const imports = new Set<string>();
    
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

  // Extracts Frappe import module paths from Python code
  private extractImports(pythonCode: string): string[] {
    // Parse: from frappe.model.document import get_doc (captures the module path)
    // NOTE: We only care about frappe.* imports, as per the pattern
    const importPattern = /from (frappe\.[\w\.]+) import/g;
    const matches = pythonCode.matchAll(importPattern);
    return Array.from(matches, m => m[1]);
  }

  // Estimates the total token count for the context demand
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

  // Returns all Python files in the custom app (relative to bench root)
  private async getAllCustomAppFiles(): Promise<string[]> {
    return this.getPythonFiles(CUSTOM_APP_FOLDER);
  }

  // Recursively finds all Python files under a directory, skipping hidden and vendor folders
  private async getPythonFiles(startPath: string): Promise<string[]> {
    let results: string[] = [];
    try {
      const files = await fs.readdir(startPath, { withFileTypes: true });
      for (const file of files) {
        const fullPath = path.join(startPath, file.name);
        if (file.isDirectory()) {
          if (file.name.startsWith('.') || file.name === 'node_modules' || file.name === 'env') {
            continue;
          }
          const subResults = await this.getPythonFiles(fullPath);
          results.push(...subResults);
        } else if (file.name.endsWith('.py')) {
          results.push(path.relative(BENCH_ROOT, fullPath));
        }
      }
    } catch (e) {
      console.error(`Error reading directory ${startPath}: ${e}`);
    }
    return results;
  }

  // Reads a file as UTF-8, resolving relative paths from BENCH_ROOT
  private async readFile(filePath: string): Promise<string> {
    // Ensure filePath is absolute; if not, resolve relative to BENCH_ROOT
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(BENCH_ROOT, filePath);
    return fs.readFile(absPath, 'utf-8');
  }
}