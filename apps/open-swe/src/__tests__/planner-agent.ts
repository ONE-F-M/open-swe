import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), "open-swe/.env") });

const GITHUB_INSTALLATION_ID = process.env.X_GITHUB_INSTALLATION_ID || process.env.GITHUB_APP_ID;
const GITHUB_INSTALLATION_TOKEN = process.env.GITHUB_TOKEN;
const DAYTONA_ORGANIZATION_ID = process.env.DAYTONA_ORGANIZATION_ID;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER;
const USERNAME = process.env.USERNAME;

import { PlannerAgent } from "../agents/planner-agent.js";
import { HumanMessage } from "@langchain/core/messages";

describe("PlannerAgent", () => {
  const mockSandbox = {};
  const mockConfig = { configurable: { user: USERNAME } };

  it("should generate a plan for GitHub issue #1 (Add Tax ID Field)", async () => {
    const agent = new PlannerAgent(mockSandbox, mockConfig);
    const task = "Add a 'identification_number' field to the Client DocType in one_fm app";
    const extraState = {
      configurable: {
        githubIssueId: 10,
        targetRepository: { owner: GITHUB_REPO_OWNER, repo: "one_fm", branch: "version-15" },
        "x-github-installation-id": GITHUB_INSTALLATION_ID,
        "x-github-installation-token": GITHUB_INSTALLATION_TOKEN,
        userLogin: USERNAME,
        "x-github-user-login": USERNAME,
        login: USERNAME,
        GITHUB_USER_LOGIN_HEADER: USERNAME,
        user: USERNAME,
        langgraph_auth_user: { display_name: USERNAME },
        daytonaOrganizationId: DAYTONA_ORGANIZATION_ID
      },
      githubIssueId: 10,
      targetRepository: { owner: GITHUB_REPO_OWNER, repo: "one_fm", branch: "version-15" },
      messages: [new HumanMessage({ content: task })]
    };
    const plan = await agent.generatePlan(task, extraState);
    console.log("Generated plan:", plan);
    expect(Array.isArray(plan)).toBe(true);
  }, 180000);
});