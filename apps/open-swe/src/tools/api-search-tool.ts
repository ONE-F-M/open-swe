import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { FrappeAPISearch } from "../context/api-search.js";
import * as path from "path";


// --- Caching Layer (Optimization for Task 11.2) ---
let cachedSearcher: FrappeAPISearch | null = null;

async function getFrappeAPISearch(): Promise<FrappeAPISearch> {
  if (cachedSearcher) {
    return cachedSearcher;
  }
  
  // Initialize only once
  const searcher = new FrappeAPISearch();
  // NOTE: Adjust the index path as necessary for your runtime environment
  await searcher.initialize(
     process.env.FRAPPE_API_INDEX_PATH || path.resolve(__dirname, "../../frappe-api-index.json")
  );
  
  cachedSearcher = searcher;
  return searcher;
}

export const apiSearchTool = tool(
  async ({ query }: { query: string }) => {
    const searcher = await getFrappeAPISearch();
    const results = await searcher.search(query, 5);
    
    // Map results to a format easily consumed by the LLM
    return results.map(r => ({
      path: r.path,
      signature: r.signature,
      // Format the path for Python import: frappe.db.get_value -> import frappe.db \n get_value(...)
      usage: 
        `import ${r.path.split(".").slice(0, -1).join(".")}` +
        `\n${r.path.split(".").pop()}(...)`,
      relevance: r.relevance,
      context: r.context
    }));
  },
  {
    name: "search_frappe_api",
    description:
      "Search Frappe/ERPNext APIs by description. Use when you need to find the right function/method.",
    schema: z.object({
      query: z.string().describe(
        "What you want to do, e.g. 'get document by name'"
      ),
    }),
  }
);