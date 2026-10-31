/**
 * P1 #164 final hardening — confirm binds first-persisted same contract/version.
 *
 * (A) Confirm with identical message/goal/constraints/candidates → may publish.
 * (B) Field changes on confirm → activation_contract_conflict (must revise explicitly;
 *     silent replace on confirm is forbidden).
 * Does NOT claim a full user-facing confirm UX; proves activate(humanConfirmed)
 * cannot overwrite the first-persisted activationKey.
 */
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
import { activateCollaborationTask } from "./activate-collaboration-task.js";
import { controlledDiscussToTask } from "./controlled-discuss-to-task.js";
import { clearDiscussToTaskSourceBindingsForTests } from "./discuss-to-task-source-binding.js";
import { createTrustedGroupStores } from "./team-resource-auth.js";

const tempDirs: string[] = [];
const saved = {
  state: process.env.OPENBOT_STATE_DIR,
  cfg: process.env.OPENBOT_CONFIG_PATH,
  claw: process.env.OPENCLAW_CONFIG_PATH,
  sec: process.env.OPENBOT_SECURITY_PROFILE,
  leg: process.env.OPENCLAW_SECURITY_PROFILE,
};

afterEach(async () => {
  clearDiscussToTaskSourceBindingsForTests();
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  const restore = (key: keyof typeof saved, env: string) => {
    const v = saved[key];
    if (v === undefined) {
      delete process.env[env];
    } else {
      process.env[env] = v;
    }
  };
  restore("state", "OPENBOT_STATE_DIR");
  restore("cfg", "OPENBOT_CONFIG_PATH");
  restore("claw", "OPENCLAW_CONFIG_PATH");
  restore("sec", "OPENBOT_SECURITY_PROFILE");
  restore("leg", "OPENCLAW_SECURITY_PROFILE");
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

function flagConfig(root: string): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { claimContract: true },
    },
  } as OpenBotConfig;
}

async function useTrusted() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-d2t-confirm-bind-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  await fs.mkdir(path.join(root, "collaboration", "groups"), { recursive: true });
  const groupsRoot = path.join(root, "collaboration", "groups");
  const groupLocator = path.join(groupsRoot, "grp_confirm_bind");
  await fs.mkdir(groupLocator, { recursive: true });
  return { root, cfg, trusted: { groupsRoot, groupLocator } };
}

const TITLE = "P1 confirm-bind short markdown";
const MESSAGE =
  "请两名成员协作完成短 Markdown 提纲\n验收标准：\n- 有标题\n- 有正文\n请团队正式开展";
const GOAL = "产出有标题与正文的短 Markdown 提纲";
const ACCEPTANCE = ["有标题", "有正文"] as const;
const CONSTRAINTS = ["不得编造来源"] as const;
const CLAIMANTS = ["bot-a", "bot-b"] as const;

function activationKeyTag(task: Task | null | undefined): string {
  const tag = (task?.tags ?? []).find((row) => row.startsWith("activationKey:"));
  return tag ? tag.slice("activationKey:".length) : "";
}

describe("P1 #164 confirm binds first-persisted contract", () => {
  it("A: confirm with same message/goal/constraints/candidates keeps activationKey and may publish", async () => {
    const { cfg, trusted } = await useTrusted();
    const established = await controlledDiscussToTask({
      sourceMessageId: "confirm-bind-same-src",
      groupId: "grp_confirm_bind",
      tenantId: "_local",
      actor: "human:owner",
      title: TITLE,
      message: MESSAGE,
      goal: GOAL,
      acceptanceCriteria: [...ACCEPTANCE],
      constraints: [...CONSTRAINTS],
      suggestedClaimantIds: [...CLAIMANTS],
      forceExplicit: true,
      trusted,
      cfg,
    });
    expect(established.attempted).toBe(true);
    expect(established.taskId).toBeTruthy();
    expect(established.activationKey).toBeTruthy();
    expect(
      established.statusCode === "formal_task_needs_confirm" ||
        established.activation?.status === "needs_confirm" ||
        established.stages.boardPublished === false,
    ).toBe(true);

    const stores = createTrustedGroupStores({
      groupsRoot: trusted.groupsRoot,
      groupLocator: trusted.groupLocator,
    });
    const before = await stores.objectStorage.readObject<Task>(
      "grp_confirm_bind",
      "task",
      established.taskId!,
    );
    const firstKey = activationKeyTag(before);
    expect(firstKey).toBeTruthy();
    expect(firstKey).toBe(established.activationKey);

    const confirmed = await activateCollaborationTask({
      groupId: "grp_confirm_bind",
      taskId: established.taskId!,
      title: TITLE,
      message: MESSAGE,
      actor: "human:owner",
      goal: GOAL,
      acceptanceCriteria: [...ACCEPTANCE],
      constraints: [...CONSTRAINTS],
      suggestedClaimantIds: [...CLAIMANTS],
      humanConfirmed: true,
      requireHumanConfirm: true,
      trusted,
      cfg,
    });
    expect(confirmed.reason === "activation_contract_conflict").toBe(false);
    expect(confirmed.activationKey).toBe(firstKey);
    const after = await stores.objectStorage.readObject<Task>(
      "grp_confirm_bind",
      "task",
      established.taskId!,
    );
    expect(activationKeyTag(after)).toBe(firstKey);
    expect(
      confirmed.status === "activated" ||
        confirmed.boardPublished ||
        confirmed.status === "needs_confirm" ||
        confirmed.status === "partial_success",
    ).toBe(true);
  });

  it("B: confirm must not silently replace fields — different contract → activation_contract_conflict", async () => {
    const { cfg, trusted } = await useTrusted();
    const established = await controlledDiscussToTask({
      sourceMessageId: "confirm-bind-mutate-src",
      groupId: "grp_confirm_bind",
      tenantId: "_local",
      actor: "human:owner",
      title: TITLE,
      message: MESSAGE,
      goal: GOAL,
      acceptanceCriteria: [...ACCEPTANCE],
      constraints: [...CONSTRAINTS],
      suggestedClaimantIds: [...CLAIMANTS],
      forceExplicit: true,
      trusted,
      cfg,
    });
    expect(established.taskId).toBeTruthy();
    expect(established.activationKey).toBeTruthy();
    const firstKey = established.activationKey!;

    const mutated = await activateCollaborationTask({
      groupId: "grp_confirm_bind",
      taskId: established.taskId!,
      title: TITLE,
      message: "请为短 Markdown 提纲报告发布看板并分工，验收两段有来源底稿",
      actor: "human:owner",
      goal: "产出有来源的短 Markdown 提纲报告",
      acceptanceCriteria: [...ACCEPTANCE],
      constraints: ["不得编造来源", "正文不少于三句"],
      suggestedClaimantIds: ["bot-a"],
      humanConfirmed: true,
      requireHumanConfirm: true,
      trusted,
      cfg,
    });
    expect(mutated.status).toBe("blocked");
    expect(mutated.reason).toBe("activation_contract_conflict");
    expect(mutated.boardPublished).toBe(false);
    expect(mutated.activationKey).not.toBe(firstKey);

    const stores = createTrustedGroupStores({
      groupsRoot: trusted.groupsRoot,
      groupLocator: trusted.groupLocator,
    });
    const after = await stores.objectStorage.readObject<Task>(
      "grp_confirm_bind",
      "task",
      established.taskId!,
    );
    expect(activationKeyTag(after)).toBe(firstKey);
  });

  it("B2: message-only / goal-only / claimants-only drift each conflict (explicit revise required)", async () => {
    const { cfg, trusted } = await useTrusted();
    const base = {
      groupId: "grp_confirm_bind",
      tenantId: "_local",
      actor: "human:owner",
      title: TITLE,
      message: MESSAGE,
      goal: GOAL,
      acceptanceCriteria: [...ACCEPTANCE],
      constraints: [...CONSTRAINTS],
      suggestedClaimantIds: [...CLAIMANTS],
      forceExplicit: true as const,
      trusted,
      cfg,
    };
    const cases: Array<{ label: string; patch: Record<string, unknown> }> = [
      { label: "message", patch: { message: `${MESSAGE}\n（附注不得静默替换）` } },
      { label: "goal", patch: { goal: `${GOAL}（修订目标）` } },
      { label: "constraints", patch: { constraints: [...CONSTRAINTS, "额外约束"] } },
      { label: "candidates", patch: { suggestedClaimantIds: ["bot-a"] } },
    ];
    for (const [idx, c] of cases.entries()) {
      const established = await controlledDiscussToTask({
        ...base,
        sourceMessageId: `confirm-bind-field-${c.label}-${idx}`,
      });
      expect(established.taskId, c.label).toBeTruthy();
      const mutated = await activateCollaborationTask({
        groupId: "grp_confirm_bind",
        taskId: established.taskId!,
        title: TITLE,
        message: MESSAGE,
        actor: "human:owner",
        goal: GOAL,
        acceptanceCriteria: [...ACCEPTANCE],
        constraints: [...CONSTRAINTS],
        suggestedClaimantIds: [...CLAIMANTS],
        humanConfirmed: true,
        requireHumanConfirm: true,
        trusted,
        cfg,
        ...c.patch,
      });
      expect(mutated.status, c.label).toBe("blocked");
      expect(mutated.reason, c.label).toBe("activation_contract_conflict");
    }
  });
});
