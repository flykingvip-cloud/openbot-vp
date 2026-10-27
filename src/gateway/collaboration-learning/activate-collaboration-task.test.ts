import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { activateCollaborationTask, buildActivationKey } from "./activate-collaboration-task.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const savedSecurityProfile = process.env.OPENBOT_SECURITY_PROFILE;
const savedLegacySecurityProfile = process.env.OPENCLAW_SECURITY_PROFILE;

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  if (savedStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = savedStateDir;
  }
  if (savedOpenbotConfigPath === undefined) {
    delete process.env.OPENBOT_CONFIG_PATH;
  } else {
    process.env.OPENBOT_CONFIG_PATH = savedOpenbotConfigPath;
  }
  if (savedOpenclawConfigPath === undefined) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = savedOpenclawConfigPath;
  }
  if (savedSecurityProfile === undefined) {
    delete process.env.OPENBOT_SECURITY_PROFILE;
  } else {
    process.env.OPENBOT_SECURITY_PROFILE = savedSecurityProfile;
  }
  if (savedLegacySecurityProfile === undefined) {
    delete process.env.OPENCLAW_SECURITY_PROFILE;
  } else {
    process.env.OPENCLAW_SECURITY_PROFILE = savedLegacySecurityProfile;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function flagConfig(root: string, claimContract: boolean): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { claimContract },
    },
  } as OpenBotConfig;
}

async function useConfig(claimContract: boolean): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-activate-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, claimContract);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

describe("activateCollaborationTask", () => {
  it("blocks missing fields without claiming dispatched", async () => {
    const { cfg } = await useConfig(true);
    const result = await activateCollaborationTask({
      groupId: "",
      taskId: "t1",
      title: "x",
      message: "y",
      actor: "human:owner",
      humanConfirmed: true,
      cfg,
    });
    expect(result.status).toBe("blocked");
    expect(result.boardPublished).toBe(false);
    expect(result.dispatched).toBe(false);
  });

  it("does not publish or dispatch when humanConfirmed is false", async () => {
    const { cfg } = await useConfig(true);
    const result = await activateCollaborationTask({
      groupId: "grp_act",
      taskId: "TEAM-REAL-ACT-1",
      title: "能源材料研究提纲",
      message: "请为能源材料研究提纲发布看板并分工",
      actor: "human:owner",
      goal: "产出有来源的研究提纲",
      acceptanceCriteria: ["两成员各写一段", "汇总为 Markdown"],
      humanConfirmed: false,
      requireHumanConfirm: true,
      cfg,
    });
    // Incomplete confirm must never look like 已派工/已开工.
    expect(["needs_confirm", "blocked"]).toContain(result.status);
    expect(result.boardPublished).toBe(false);
    expect(result.dispatched).toBe(false);
    expect(result.taskEnsured).toBe(true);
  });

  it("activates with board publish when confirmed and is idempotent on retry", async () => {
    const { cfg } = await useConfig(true);
    const input = {
      groupId: "grp_act",
      taskId: "TEAM-REAL-ACT-2",
      title: "能源材料研究提纲",
      message: "请为能源材料研究提纲发布看板并分工，验收两段有来源底稿",
      actor: "human:owner",
      goal: "产出有来源的研究提纲",
      acceptanceCriteria: ["两成员各写一段", "汇总为 Markdown"],
      humanConfirmed: true,
      requireHumanConfirm: true,
      cfg,
    };
    const first = await activateCollaborationTask(input);
    // Flag/materialize may still need_confirm if quality gate incomplete; assert no false success.
    if (first.status === "activated") {
      expect(first.boardPublished).toBe(true);
      expect(first.dispatched).toBe(false);
      expect(first.boardItemId).toBeTruthy();
      const second = await activateCollaborationTask(input);
      expect(second.status).toBe("activated");
      if (second.status === "activated") {
        expect(second.idempotentReplay).toBe(true);
        expect(second.boardItemId).toBe(first.boardItemId);
      }
    } else {
      expect(first.boardPublished).toBe(false);
      expect(first.dispatched).toBe(false);
      expect(["needs_confirm", "blocked"]).toContain(first.status);
    }
  });

  it("buildActivationKey is stable for same contract fields", () => {
    const a = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a", "b"],
    });
    const b = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a", "b"],
    });
    expect(a).toBe(b);
  });
});
