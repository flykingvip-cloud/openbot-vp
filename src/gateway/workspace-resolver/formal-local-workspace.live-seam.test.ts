import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { resolveFormalAgentWorkspace } from "./formal-deliverable-root.js";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
it("local anonymous trusted operator uses the configured execution workspace, not a fabricated owner tree", () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "local-delivery-seam-"));
  dirs.push(state);
  const workspace = path.join(state, "explicit-workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "report.txt"), "收入120，成本78，利润42");
  const root = resolveFormalAgentWorkspace({
    agentId: "main",
    sessionKey: "agent:main:uat",
    stateDir: state,
    cfg: {
      gateway: { security: { profile: "personal_local" } },
      agents: { defaults: { workspace } },
    },
    env: { OPENBOT_STATE_DIR: state },
  });
  expect(root?.rootPath).toBe(workspace);
});
it("managed missing tenant/owner never falls back to configured host workspace", () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "managed-delivery-seam-"));
  dirs.push(state);
  expect(
    resolveFormalAgentWorkspace({
      agentId: "main",
      stateDir: state,
      cfg: {
        data: { mode: "managed" },
        gateway: { security: { profile: "managed_enterprise" } },
        agents: { defaults: { workspace: state } },
      },
      env: { OPENBOT_STATE_DIR: state, OPENBOT_DATA_MODE: "managed", OPENBOT_MULTITENANT: "1" },
    }),
  ).toBeNull();
});
