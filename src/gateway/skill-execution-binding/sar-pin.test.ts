import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-sar-pin-${Date.now()}`);
vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const {
  editPersonalSkillAsset,
  listRobotSkillAssets,
  resetSkillHealthWindowsCacheForTests,
  saveSkillAsset,
  upgradeRobotSkillAsset,
} = await import("../skill-lifecycle-store.js");
const {
  ensureSkillExecutionBindingHooksRegistered,
  readSarExecutionPin,
  resetSkillExecutionBindingHooksForTests,
  syncSkillExecutionBinding,
  writeSarExecutionPin,
} = await import("./index.js");
const { resolveBoundSkillDir } = await import("./paths.js");

function clean() {
  resetSkillExecutionBindingHooksForTests();
  resetSkillHealthWindowsCacheForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  ensureSkillExecutionBindingHooksRegistered();
}

describe("SAR execution pin", () => {
  beforeEach(clean);
  afterEach(() => {
    resetSkillExecutionBindingHooksForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps the pinned version and digest when the catalog head is upgraded", () => {
    const saved = saveSkillAsset({
      sourceAgentId: "robot-alpha",
      lifecycle: "private",
      profile: {
        name: "网站技能",
        summary: "读取已验证的网站能力",
        assetType: "capability",
        visibility: "private",
      },
      runtimeDefinition: {
        prompts: ["使用钉死的制品。"],
      },
    });
    writeSarExecutionPin({
      agentId: "robot-alpha",
      skillId: saved.skillId,
      skillName: "网站技能",
      installedVersion: "1.0.0",
      artifactDigest: "digest-pinned",
      enabled: true,
      materialisedPath: "",
      updatedAtMs: 1,
    });
    editPersonalSkillAsset({
      skillId: saved.skillId,
      profile: saved.detail.profile,
      summary: "目录升级",
    });
    const upgraded = upgradeRobotSkillAsset({ agentId: "robot-alpha", skillId: saved.skillId });
    syncSkillExecutionBinding({ agentId: "robot-alpha", skillId: saved.skillId });

    expect(upgraded.installedVersion).toBe("1.0.1");
    expect(listRobotSkillAssets("robot-alpha")[0]?.latestVersion).toBe("1.0.1");
    const pin = readSarExecutionPin({ agentId: "robot-alpha", skillId: saved.skillId });
    expect(pin?.installedVersion).toBe("1.0.0");
    expect(pin?.artifactDigest).toBe("digest-pinned");
    const markdown = fs.readFileSync(
      path.join(resolveBoundSkillDir("robot-alpha", saved.skillId), "SKILL.md"),
      "utf8",
    );
    expect(markdown).toContain('openbot.skillVersion: "1.0.0"');
    expect(markdown).toContain('openbot.artifactDigest: "digest-pinned"');
    expect(markdown).not.toContain('openbot.skillVersion: "1.0.1"');
  });
});
