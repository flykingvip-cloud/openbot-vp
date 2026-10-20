import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-mcp-sync-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const probeMock = vi.fn();
vi.mock("./mcp-health-probe.js", () => ({
  probeMcpAssetBindingHealth: (...args: unknown[]) => probeMock(...args),
}));

const { saveSkillAsset, resetSkillHealthWindowsCacheForTests, getPersonalSkillAssetDetail } =
  await import("../skill-lifecycle-store.js");
const { syncExecutableAssetBinding } = await import("./sync.js");

function clean() {
  resetSkillHealthWindowsCacheForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  probeMock.mockReset();
}

describe("syncExecutableAssetBinding health probe", () => {
  beforeEach(clean);
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records skill health sample after MCP upsert", () => {
    probeMock.mockReturnValue({
      ok: true,
      latencyMs: 42,
      listedTools: 2,
      toolNames: ["search", "ping"],
      sampleCall: { tool: "search", ok: true, latencyMs: 10 },
    });
    const saved = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name: "GitHub",
        summary: "读仓库",
        assetType: "mcp",
        visibility: "private",
      },
      runtimeDefinition: {
        mcpBinding: {
          serverName: "github",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
        },
      },
    });
    const result = syncExecutableAssetBinding({
      skillId: saved.skillId,
      op: "install",
      configDir: tmpDir,
      agentId: "robot-alpha",
      healthProbeEnabled: true,
    });
    expect(result.action).toBe("mcp-upserted");
    expect(result.healthProbe?.ok).toBe(true);
    expect(probeMock).toHaveBeenCalledOnce();
    const detail = getPersonalSkillAssetDetail(saved.skillId);
    expect(detail.health.lastVerifiedAt).not.toBeNull();
    expect(detail.health.status).toBe("healthy");
  });

  it("still upserts MCP config when health probe fails", () => {
    probeMock.mockReturnValue({
      ok: false,
      latencyMs: 99,
      listedTools: 1,
      toolNames: ["send_message"],
      failureReason: "KeyError: 'message'",
      sampleCall: {
        tool: "send_message",
        ok: false,
        failureReason: "KeyError: 'message'",
        latencyMs: 50,
      },
    });
    const saved = saveSkillAsset({
      sourceAgentId: "robot-beta",
      lifecycle: "private",
      profile: {
        name: "CO MCP",
        summary: "协作 MCP",
        assetType: "mcp",
        visibility: "private",
      },
      runtimeDefinition: {
        mcpBinding: {
          serverName: "co-mcp",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          toolAllowlist: ["send_message"],
        },
      },
    });
    const result = syncExecutableAssetBinding({
      skillId: saved.skillId,
      op: "install",
      configDir: tmpDir,
      agentId: "robot-beta",
      healthProbeEnabled: true,
    });
    expect(result.action).toBe("mcp-upserted");
    expect(result.healthProbe?.ok).toBe(false);
    const detail = getPersonalSkillAssetDetail(saved.skillId);
    expect(detail.health.status).toBe("broken");
    expect(detail.health.failureReasons).toContain("KeyError: 'message'");
  });
});
