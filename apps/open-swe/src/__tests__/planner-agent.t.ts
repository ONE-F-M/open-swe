// Load environment variables from .env using process.cwd() for compatibility
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), "open-swe/.env") });

const GITHUB_INSTALLATION_ID = process.env.X_GITHUB_INSTALLATION_ID || process.env.GITHUB_APP_ID;
const GITHUB_INSTALLATION_TOKEN = process.env.GITHUB_TOKEN;
const DAYTONA_ORGANIZATION_ID = process.env.DAYTONA_ORGANIZATION_ID;

import { PlannerAgent } from "../agents/planner-agent.js";
import { HumanMessage } from "@langchain/core/messages";

describe("PlannerAgent", () => {
  const mockSandbox = {};
  const mockConfig = { configurable: { user: "samdanikouser" } };

  it("should generate a plan for GitHub issue #5229 (Add Tax ID Field)", async () => {
    const agent = new PlannerAgent(mockSandbox, mockConfig);
    // Use the real GitHub issue data as the task
    const task = "Add a 'tax_identification_number' field to Customer DocType. Create a new Data field named tax_identification_number with label 'Tax Identification Number' in the Customer DocType. Use Frappe's Custom Field feature to add this field to the existing Customer form, placing it in an appropriate section. Set the field as optional unless business requirements specify otherwise. Also, create a comprehensive test file to verify the field can be set, saved, retrieved, and validated properly, including edge cases such as empty values, long strings, and special characters.";
    // Use the real issue number and repo
    const extraState = {
      configurable: {
        githubIssueId: 5229,
        targetRepository: { owner: "ONE-F-M", repo: "one_fm", branch: "version-15" },
        "x-github-installation-id": GITHUB_INSTALLATION_ID,
        "x-github-installation-token": GITHUB_INSTALLATION_TOKEN,
        userLogin: "samdanikouser",
        "x-github-user-login": "samdanikouser",
        login: "samdanikouser",
        GITHUB_USER_LOGIN_HEADER: "samdanikouser",
        user: "samdanikouser",
        langgraph_auth_user: { display_name: "samdanikouser" },
        // frappeMode removed: now uses process.env.PROGRAMMER_FRAPPE_MODE directly
        daytonaOrganizationId: DAYTONA_ORGANIZATION_ID
      },
      githubIssueId: 5229,
      targetRepository: { owner: "ONE-F-M", repo: "one_fm", branch: "version-15" },
      messages: [new HumanMessage({ content: task })]
    };
    const plan = await agent.generatePlan(task, extraState);
    expect(Array.isArray(plan)).toBe(true);
  }, 180000);
});
