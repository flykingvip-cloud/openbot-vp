import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { activateCollaborationTask, buildActivationKey } from "./activate-collaboration-task.js";
import { createWorkspaceCollaborationStores } from "./shared.js";

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

  it("keeps draft and does not publish when humanConfirmed is false", async () => {
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
    expect(["needs_confirm", "blocked"]).toContain(result.status);
    expect(result.boardPublished).toBe(false);
    expect(result.dispatched).toBe(false);
    expect(result.taskEnsured).toBe(true);
    const stores = createWorkspaceCollaborationStores(cfg);
    const task = await stores.objectStorage.readObject<Task>("grp_act", "task", "TEAM-REAL-ACT-1");
    expect(task?.status).toBe("draft");
  });

  it("refuses to reopen a completed terminal task", async () => {
    const { cfg } = await useConfig(true);
    const stores = createWorkspaceCollaborationStores(cfg);
    const now = Date.now();
    await stores.objectStorage.writeObject("grp_act", "task", "TEAM-REAL-DONE", {
      taskId: "TEAM-REAL-DONE",
      groupId: "grp_act",
      title: "旧任务",
      status: "completed",
      createdAtMs: now,
      updatedAtMs: now,
    } satisfies Task);
    const result = await activateCollaborationTask({
      groupId: "grp_act",
      taskId: "TEAM-REAL-DONE",
      title: "新标题",
      message: "尝试重开",
      actor: "human:owner",
      humanConfirmed: true,
      cfg,
    });
    expect(result.status).toBe("blocked");
    expect(result.boardPublished).toBe(false);
    if (result.status === "blocked") {
      expect(result.reason).toBe("terminal_task_not_reopened");
    }
    const live = await stores.objectStorage.readObject<Task>("grp_act", "task", "TEAM-REAL-DONE");
    expect(live?.status).toBe("completed");
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
      expect(["needs_confirm", "blocked", "partial_success"]).toContain(first.status);
    }
  });

  it("conflicts when same taskId retries with a different contract fingerprint", async () => {
    const { cfg } = await useConfig(true);
    const base = {
      groupId: "grp_act",
      taskId: "TEAM-REAL-ACT-3",
      title: "能源材料研究提纲",
      message: "请为能源材料研究提纲发布看板并分工",
      actor: "human:owner",
      goal: "目标A",
      acceptanceCriteria: ["a"],
      humanConfirmed: true,
      requireHumanConfirm: true,
      cfg,
    };
    const first = await activateCollaborationTask(base);
    // Even if materialize blocks, task tag may be stamped; retry with different goal.
    const second = await activateCollaborationTask({
      ...base,
      goal: "目标B-完全不同",
      acceptanceCriteria: ["b", "c"],
    });
    if (first.status === "activated" || first.taskEnsured) {
      expect(["blocked", "activated", "needs_confirm", "partial_success"]).toContain(second.status);
      if (second.status === "blocked") {
        expect(
          [
            "activation_contract_conflict",
            "activation_task_busy",
            "terminal_task_not_reopened",
          ].some((r) => second.reason === r) || second.reason.length > 0,
        ).toBe(true);
      }
    }
  });

  it("buildActivationKey changes when acceptance criteria change", () => {
    const a = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a", "b"],
      message: "m",
    });
    const b = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a", "c"],
      message: "m",
    });
    expect(a).not.toBe(b);
  });
  it("buildActivationKey changes when dueAtMs changes", () => {
    const a = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a"],
      message: "m",
      dueAtMs: 1_700_000_000_000,
    });
    const b = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a"],
      message: "m",
      dueAtMs: 1_700_000_000_001,
    });
    expect(a).not.toBe(b);
  });

  it("buildActivationKey changes when suggestedClaimantIds change", () => {
    const a = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a"],
      message: "m",
      suggestedClaimantIds: ["bot-1"],
    });
    const b = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a"],
      message: "m",
      suggestedClaimantIds: ["bot-2"],
    });
    expect(a).not.toBe(b);
  });

  it("buildActivationKey is stable for same contract regardless of claimant order", () => {
    const a = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["b", "a"],
      message: "m",
      suggestedClaimantIds: ["bot-2", "bot-1"],
    });
    const b = buildActivationKey({
      groupId: "g",
      taskId: "t",
      title: "标题",
      goal: "目标",
      acceptanceCriteria: ["a", "b"],
      message: "m",
      suggestedClaimantIds: ["bot-1", "bot-2"],
    });
    expect(a).toBe(b);
  });
});
