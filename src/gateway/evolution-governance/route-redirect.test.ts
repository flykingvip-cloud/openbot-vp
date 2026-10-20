import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-route-redirect-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const runtime = await import("../agent-runtime-store.js");
const { applyGovernanceRuntimeAction } = await import("./runtime-actions.js");
const { applyGovernanceAgentRedirect, resolveGovernanceRedirectedAgentId } =
  await import("./route-redirect.js");
const { setGovernanceKillSwitch } = await import("./index.js");
const { resolveAgentRoute } = await import("../../routing/resolve-route.js");

function seedAgent(id: string) {
  const now = Date.now();
  runtime.upsertAgent({
    runtimeAgentId: id,
    name: id,
    runtimeVersion: "1",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: [],
    boundCapabilityCount: 0,
    activeSessionCount: 0,
    resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
    deployedAt: now,
    lastActiveAt: now,
  });
}

describe("governance route redirect", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    setGovernanceKillSwitch(false);
  });
  afterEach(() => {
    setGovernanceKillSwitch(false);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves redirect chain source → target", () => {
    seedAgent("src");
    seedAgent("dst");
    applyGovernanceRuntimeAction({
      runtimeAgentId: "src",
      action: "redirect",
      redirectTargetAgentId: "dst",
    });
    expect(applyGovernanceAgentRedirect("src")).toBe("dst");
    expect(resolveGovernanceRedirectedAgentId("src").redirectedFrom).toBe("src");
    expect(applyGovernanceAgentRedirect("dst")).toBe("dst");
  });

  it("resolveAgentRoute rewrites agentId and sessionKey under redirect", () => {
    seedAgent("main");
    seedAgent("backup");
    applyGovernanceRuntimeAction({
      runtimeAgentId: "main",
      action: "redirect",
      redirectTargetAgentId: "backup",
    });
    const route = resolveAgentRoute({
      cfg: {
        agents: {
          list: [{ id: "main", default: true }, { id: "backup" }],
        },
      } as never,
      channel: "telegram",
      accountId: "default",
      peer: { kind: "direct", id: "u1" },
    });
    // default agent is main → redirected to backup
    expect(route.agentId).toBe("backup");
    expect(route.redirectedFromAgentId).toBe("main");
    expect(route.sessionKey.startsWith("agent:backup:")).toBe(true);
  });
});
