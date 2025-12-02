import axios from "axios";

const DAYTONA_API_URL = process.env.DAYTONA_API_URL || "https://app.daytona.io/api";
const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY!;
const SNAPSHOT_ID = process.env.DAYTONA_GOLDEN_SNAPSHOT_ID || "onefm-frappe-bench-golden-v1-1764650366";
const TIMEOUT_SEC = 45 * 1000;

interface Sandbox {
  id: string;
  state: string;
}

test(
  "sandbox launches from snapshot and is functional (REST)",
  async () => {
    const headers = {
      Authorization: `Bearer ${DAYTONA_API_KEY}`,
      "Content-Type": "application/json",
      "X-Daytona-Source": "rest-test",
    };

    // 1. Launch sandbox from snapshot
    const start = Date.now();
    const createResp = await axios.post(
      `${DAYTONA_API_URL}/sandbox`,
      {
        name: "test-bench-snapshot-launch",
        snapshot: SNAPSHOT_ID,
        language: "python",
      },
      { headers }
    );
    const sandbox: Sandbox = createResp.data;

    // 2. Wait for sandbox to be started
    let elapsed = 0;
    let state = sandbox.state;
    while (state !== "STARTED" && elapsed < TIMEOUT_SEC) {
      await new Promise((r) => setTimeout(r, 2000));
      const statusResp = await axios.get(`${DAYTONA_API_URL}/sandbox/${sandbox.id}`, { headers });
      state = statusResp.data.state;
      elapsed = Date.now() - start;
    }
    expect(state).toBe("STARTED");
    expect(elapsed).toBeLessThan(TIMEOUT_SEC);

    // 3. Smoke check: run bench list-apps
    const shellResp = await axios.post(
      `${DAYTONA_API_URL}/sandbox/${sandbox.id}/shell`,
      {
        command: "bench list-apps",
        user: "frappe",
        timeout: 30000,
      },
      { headers }
    );
    const result = shellResp.data.output || shellResp.data.result || "";
    expect(result).toMatch(/erpnext|one_fm/);

    // 4. Clean up
    await axios.delete(`${DAYTONA_API_URL}/sandbox/${sandbox.id}`, { headers });
  },
  TIMEOUT_SEC + 20000
);