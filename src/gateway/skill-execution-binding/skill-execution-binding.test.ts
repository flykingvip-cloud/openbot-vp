import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-skill-binding-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const {
  installSkillToRobotAsset,
  saveSkillAsset,
  submitPersonalSkillToEnterprise,
  toggleRobotSkillAsset,
  removeRobotSkillAsset,
  resetSkillHealthWindowsCacheForTests,
} = await import("../skill-lifecycle-store.js");
const {
  ensureSkillExecutionBindingHooksRegistered,
  loadSkillExecutionBindingEntries,
  resetSkillExecutionBindingHooksForTests,
  skillExecutionSkillName,
  syncSkillExecutionBinding,
} = await import("./index.js");
function clean() {
  resetSkillExecutionBindingHooksForTests();
  resetSkillHealthWindowsCacheForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  ensureSkillExecutionBindingHooksRegistered();
}

function saveCapability(name = "Customer summary") {
  return saveSkillAsset({
    sourceAgentId: "robot-alpha",
    contextId: "customer-summary",
    // Runnable lifecycle required for auto-install + materialisation.
    lifecycle: "private",
    profile: {
      name,
      summary: "Summarizes customer conversations into a short brief.",
      assetType: "capability",
      tags: ["summary"],
      category: "writing",
      visibility: "private",
    },
    runtimeDefinition: {
      prompts: ["Always produce a 5-bullet customer brief."],
      tools: ["notes"],
      modelPreferences: { hidden: true },
    },
  });
}

describe("SkillExecutionBinding", () => {
  beforeEach(clean);
  afterEach(() => {
    resetSkillExecutionBindingHooksForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("materialises enabled capability skills so the next run can load them", () => {
    const saved = saveCapability();
    // save with sourceAgentId already creates relation + emits hook
    const bound = loadSkillExecutionBindingEntries({ agentId: "robot-alpha" });
    expect(bound.map((entry) => entry.skill.name)).toContain(
      skillExecutionSkillName(saved.skillId),
    );
    expect(
      bound.find((entry) => entry.skill.name === skillExecutionSkillName(saved.skillId))?.metadata
        ?.promptPriority,
    ).toBe(80);
    const skillFile = bound.find(
      (entry) => entry.skill.name === skillExecutionSkillName(saved.skillId),
    )?.skill.filePath;
    expect(skillFile && fs.existsSync(skillFile)).toBe(true);
    if (skillFile) {
      const markdown = fs.readFileSync(skillFile, "utf8");
      expect(markdown).toContain("Always produce a 5-bullet customer brief.");
    }
  });

  it("removes materialisation when disabled so the next run no longer loads the skill", () => {
    const saved = saveCapability();
    toggleRobotSkillAsset({ agentId: "robot-alpha", skillId: saved.skillId, enabled: false });
    const bound = loadSkillExecutionBindingEntries({ agentId: "robot-alpha" });
    expect(bound.map((entry) => entry.skill.name)).not.toContain(
      skillExecutionSkillName(saved.skillId),
    );
  });

  it("does not materialise knowledge deliverables as executable skills", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      profile: {
        name: "Meeting notes dump",
        summary: "A captured deliverable",
        assetType: "knowledge",
        visibility: "private",
      },
    });
    const result = syncSkillExecutionBinding({
      agentId: "robot-alpha",
      skillId: saved.skillId,
    });
    expect(result.action).toBe("removed");
    expect(loadSkillExecutionBindingEntries({ agentId: "robot-alpha" })).toHaveLength(0);
  });

  it("removes binding files when skill is uninstalled from the robot", () => {
    const saved = saveCapability();
    expect(loadSkillExecutionBindingEntries({ agentId: "robot-alpha" }).length).toBeGreaterThan(0);
    removeRobotSkillAsset({ agentId: "robot-alpha", skillId: saved.skillId });
    expect(loadSkillExecutionBindingEntries({ agentId: "robot-alpha" })).toHaveLength(0);
  });

  it("materialises MCP assets with mcporter bind instructions", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name: "Linear",
        summary: "查询 Linear 任务",
        assetType: "mcp",
        visibility: "private",
      },
      runtimeDefinition: {
        prompts: ["Use Linear MCP for issue lookup."],
        mcpBinding: {
          serverName: "linear",
          transport: "http",
          url: "https://mcp.linear.app",
          toolAllowlist: ["list_issues"],
        },
      },
    });
    const bound = loadSkillExecutionBindingEntries({ agentId: "robot-alpha" });
    const skillFile = bound.find(
      (entry) => entry.skill.name === skillExecutionSkillName(saved.skillId),
    )?.skill.filePath;
    expect(skillFile && fs.existsSync(skillFile)).toBe(true);
    if (skillFile) {
      const markdown = fs.readFileSync(skillFile, "utf8");
      expect(markdown).toContain("mcporter call linear.list_issues");
      expect(markdown).toContain("https://mcp.linear.app");
    }
    const mcporter = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "mcp-asset-bindings", "mcporter.json"), "utf8"),
    ) as { mcpServers: Record<string, { url?: string }> };
    expect(mcporter.mcpServers.linear?.url).toBe("https://mcp.linear.app");
  });

  it("re-materialises after reinstall", () => {
    const saved = saveCapability();
    removeRobotSkillAsset({ agentId: "robot-alpha", skillId: saved.skillId });
    installSkillToRobotAsset({ agentId: "robot-alpha", skillId: saved.skillId });
    expect(
      loadSkillExecutionBindingEntries({ agentId: "robot-alpha" }).map((e) => e.skill.name),
    ).toContain(skillExecutionSkillName(saved.skillId));
  });

  it("materialises reviewing MCP assets after explicit install", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      lifecycle: "reviewing",
      profile: {
        name: "打单参谋",
        summary: "会前推演",
        assetType: "mcp",
        visibility: "enterprise",
      },
      runtimeDefinition: {
        prompts: ["Call advisor.py for 会前推演."],
        mcpBinding: {
          serverName: "consult-win-advisor",
          transport: "stdio",
          command: "bash",
          args: ["/root/.openbot/mcp-servers/consult-win-advisor/scripts/openbot-launch.sh"],
          toolAllowlist: ["advisor_health", "advisor_chat"],
        },
      },
    });
    installSkillToRobotAsset({ agentId: "robot-secretary", skillId: saved.skillId });
    const bound = loadSkillExecutionBindingEntries({ agentId: "robot-secretary" });
    expect(bound.map((entry) => entry.skill.name)).toContain(
      skillExecutionSkillName(saved.skillId),
    );
    const skillFile = bound.find(
      (entry) => entry.skill.name === skillExecutionSkillName(saved.skillId),
    )?.skill.filePath;
    expect(skillFile && fs.existsSync(skillFile)).toBe(true);
    if (skillFile) {
      const markdown = fs.readFileSync(skillFile, "utf8");
      expect(markdown).toContain("Call advisor.py for 会前推演.");
      expect(markdown).toContain("mcporter call consult-win-advisor.advisor_health");
    }
  });

  it("keeps an installed binding after the owner submits the asset for enterprise review", () => {
    const saved = saveCapability();
    expect(loadSkillExecutionBindingEntries({ agentId: "robot-alpha" }).length).toBeGreaterThan(0);
    submitPersonalSkillToEnterprise(saved.skillId);
    expect(
      loadSkillExecutionBindingEntries({ agentId: "robot-alpha" }).map((entry) => entry.skill.name),
    ).toContain(skillExecutionSkillName(saved.skillId));
  });
});
