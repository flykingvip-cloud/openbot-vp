import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-asset-grants-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const { saveSkillAsset, resetSkillHealthWindowsCacheForTests } =
  await import("../skill-lifecycle-store.js");
const { ensureSkillExecutionBindingHooksRegistered, resetSkillExecutionBindingHooksForTests } =
  await import("../skill-execution-binding/index.js");
const { listInstalledToolAssetGrants, listInstalledMcpAssetBindings } = await import("./grants.js");
const { readMcpAssetMcporterServers } = await import("./mcp-config.js");

function clean() {
  process.env.OPENBOT_MCP_HEALTH_PROBE = "0";
  resetSkillExecutionBindingHooksForTests();
  resetSkillHealthWindowsCacheForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  ensureSkillExecutionBindingHooksRegistered();
}

describe("executable asset binding grants", () => {
  beforeEach(clean);
  afterEach(() => {
    resetSkillExecutionBindingHooksForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("grants catalog tools only after a Tool asset is executable on the robot", () => {
    saveSkillAsset({
      sourceAgentId: "robot-alpha",
      lifecycle: "draft",
      profile: {
        name: "网页检索草稿",
        summary: "还不能调用",
        assetType: "tool",
        visibility: "private",
      },
      runtimeDefinition: {
        toolBinding: { toolIds: ["web_search"] },
      },
    });
    expect(listInstalledToolAssetGrants("robot-alpha")).toEqual([]);

    saveSkillAsset({
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name: "网页检索",
        summary: "搜索公开网页",
        assetType: "tool",
        visibility: "private",
      },
      runtimeDefinition: {
        toolBinding: { toolIds: ["web_search", "read"] },
      },
    });
    expect(listInstalledToolAssetGrants("robot-alpha")).toEqual(["web_search", "read"]);
  });

  it("writes an MCP server into the mcporter bind file on install", () => {
    saveSkillAsset({
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

    expect(listInstalledMcpAssetBindings("robot-alpha")).toEqual([
      expect.objectContaining({
        skillId: expect.any(String),
        serverName: "github",
        command: "npx",
      }),
    ]);
    expect(readMcpAssetMcporterServers(tmpDir).github).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
    });
  });
});
