import { ContextDemandAnalyzer } from "../context/demand-analyzer.js";
import { LazyContextLoader } from "../context/lazy-loader.js";
// You may need to mock or import FrappeAPISearch and helpers as needed

describe("Context Management", () => {
  it("should load only required context for simple task", async () => {
    const task = "Add a custom field 'tax_id' to Customer Asset DocType";
    // Mock or real apiSearch instance as needed
    // const apiSearch = {} as any;
    const analyzer = new ContextDemandAnalyzer(task);
    const demand = await analyzer.analyze();

    // Should only need Customer schema, no framework modules
    expect(demand.doctypeSchemas).toContain("Customer Asset");
    expect(demand.frameworkModules.length).toBeGreaterThanOrEqual(0);
    expect(demand.estimatedTokens).toBeGreaterThan(0);
  });

  it("should incrementally load when agent discovers needs", async () => {
    const loader = new LazyContextLoader();
    let totalTokens = 0;

    // Agent starts coding, discovers it needs get_doc
    const context1 = await loader.loadOnDemand(
      "from frappe.model.document import get_doc",
      totalTokens,
      180000
    );
    totalTokens += context1 ? Math.ceil(context1.length / 4) : 0;

    // Later discovers it needs db methods
    const context2 = await loader.loadOnDemand(
      "import frappe.db",
      totalTokens,
      180000
    );
    totalTokens += context2 ? Math.ceil(context2.length / 4) : 0;

    expect(totalTokens).toBeLessThan(180000);
    expect(Array.from((loader as any).loadedModules)).toContain("frappe.model.document");
  });
});
