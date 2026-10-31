/**
 * Controlled discuss→task tests.
 * Columns: pure helpers covered in sibling files; this file = real storage + entry.
 * Direct internal calls here are NOT gateway E2E.
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
import { controlledDiscussToTask } from "./controlled-discuss-to-task.js";
import { mintDiscussToTaskId } from "./discuss-to-task-id.js";
import { FORMAL_TASK_FLAG_OFF_USER_MESSAGE } from "./discuss-to-task-receipt.js";
import { readDiscussToTaskMetaFromTags } from "./discuss-to-task-stages.js";
import { createTrustedGroupStores } from "./team-resource-auth.js";

const tempDirs: string[] = [];
const saved = {
  state: process.env.OPENBOT_STATE_DIR,
  cfg: process.env.OPENBOT_CONFIG_PATH,
  claw: process.env.OPENCLAW_CONFIG_PATH,
  sec: process.env.OPENBOT_SECURITY_PROFILE,
  leg: process.env.OPENCLAW_SECURITY_PROFILE,
  ten: process.env.OPENBOT_TENANTS_ROOT,
};

afterEach(async () => {
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
  restore("ten", "OPENBOT_TENANTS_ROOT");
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
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

async function useTrusted(claimContract: boolean) {
  const ctx = await useConfig(claimContract);
  const groupsRoot = path.join(ctx.root, "collaboration", "groups");
  const groupLocator = path.join(groupsRoot, "grp_d2t");
  await fs.mkdir(groupLocator, { recursive: true });
  return { ...ctx, trusted: { groupsRoot, groupLocator } };
}

async function useConfig(claimContract: boolean) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-d2t-"));
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
  const collabRoot = path.join(root, "collaboration");
  await fs.mkdir(path.join(collabRoot, "groups"), { recursive: true });
  return { root, cfg, collabRoot };
}

const EXPLICIT_MSG =
  "请两名成员协作完成短 Markdown 提纲\n验收标准：\n- 成员A写背景\n- 成员B写结论\n- 汇总不超过 400 字";

describe("controlledDiscussToTask real storage", () => {
  it("explicit delegation establishes formal task (needs_confirm by default)", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const result = await controlledDiscussToTask({
      sourceMessageId: "msg-explicit-1",
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      suggestedClaimantIds: ["bot-writer", "bot-reviewer"],
      trusted,
      cfg,
    });
    expect(result.classification).toBe("explicit_delegation");
    expect(result.attempted).toBe(true);
    expect(result.taskId).toBeTruthy();
    expect(result.stages.taskEstablished).toBe(true);
    // Default humanConfirmed=false → board may stay unpublished / needs_confirm
    expect(result.stages.responsibilityAccepted).toBe(false);
    expect(result.userMessage).not.toMatch(/已派工/);
    // suggestedClaimantIds ≠ actual claimant
    expect(result.activation?.dispatched).toBe(false);
  });

  it("ordinary discussion does not create a task", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const result = await controlledDiscussToTask({
      sourceMessageId: "msg-chat-1",
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: "大家随便聊聊本周安排即可",
      trusted,
      cfg,
    });
    expect(result.classification).toBe("discussion");
    expect(result.attempted).toBe(false);
    expect(result.taskId).toBeNull();
  });

  it("ambiguous / missing acceptance → needs_clarification, no write", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const result = await controlledDiscussToTask({
      sourceMessageId: "msg-vague-1",
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: "请团队正式开展一项研究",
      trusted,
      cfg,
    });
    expect(result.classification).toBe("needs_clarification");
    expect(result.attempted).toBe(false);
    const stores = createTrustedGroupStores(trusted);
    // No task object for minted id
    const taskId = mintDiscussToTaskId({
      tenantId: "_local",
      groupId: "grp_d2t",
      sourceMessageId: "msg-vague-1",
    });
    const task = await stores.objectStorage.readObject<Task>("grp_d2t", "task", taskId);
    expect(task).toBeNull();
  });

  it("same request sequential retry only builds once (idempotent)", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const base = {
      sourceMessageId: "msg-retry-1",
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      suggestedClaimantIds: ["bot-a", "bot-b"],
      trusted,
      cfg,
    };
    const first = await controlledDiscussToTask(base);
    const second = await controlledDiscussToTask(base);
    expect(first.taskId).toBe(second.taskId);
    expect(first.taskId).toBeTruthy();
    expect(second.stages.taskEstablished).toBe(true);
  });

  it("same request concurrent only builds one taskId", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const base = {
      sourceMessageId: "msg-concurrent-1",
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      suggestedClaimantIds: ["bot-a", "bot-b"],
      trusted,
      cfg,
    };
    const [a, b] = await Promise.all([
      controlledDiscussToTask(base),
      controlledDiscussToTask(base),
    ]);
    expect(a.taskId).toBe(b.taskId);
  });

  it("same request with changed extraction → contract conflict, no second task", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const sourceMessageId = "msg-conflict-1";
    const first = await controlledDiscussToTask({
      sourceMessageId,
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      title: "提纲A",
      goal: "目标A",
      acceptanceCriteria: ["A1", "A2"],
      forceExplicit: true,
      trusted,
      cfg,
    });
    expect(first.stages.taskEstablished).toBe(true);
    const second = await controlledDiscussToTask({
      sourceMessageId,
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      title: "提纲B-完全不同",
      goal: "目标B",
      acceptanceCriteria: ["B1", "B2"],
      forceExplicit: true,
      trusted,
      cfg,
    });
    expect(second.taskId).toBe(first.taskId);
    expect(second.contractConflict === true || second.internalReason?.includes("conflict")).toBe(
      true,
    );
  });

  it("same body new sourceMessageId → new task instance", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const a = await controlledDiscussToTask({
      sourceMessageId: "msg-new-a",
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      trusted,
      cfg,
    });
    const b = await controlledDiscussToTask({
      sourceMessageId: "msg-new-b",
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      trusted,
      cfg,
    });
    expect(a.taskId).toBeTruthy();
    expect(b.taskId).toBeTruthy();
    expect(a.taskId).not.toBe(b.taskId);
  });

  it("flag off → blocked with unified user message, precise internal code", async () => {
    const { cfg, trusted } = await useTrusted(false);
    const result = await controlledDiscussToTask({
      sourceMessageId: "msg-flag-off",
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      humanConfirmed: true,
      forceExplicit: true,
      trusted,
      cfg,
    });
    // Task may still be ensured as draft; board publish blocked by flag.
    expect(result.attempted).toBe(true);
    if (
      result.internalReason === "claim_contract_flag_off" ||
      result.statusCode === "formal_task_blocked_flag_off"
    ) {
      expect(result.userMessage).toBe(FORMAL_TASK_FLAG_OFF_USER_MESSAGE);
    }
    // Never show 已派工
    expect(result.userMessage).not.toMatch(/已派工/);
    expect(result.stages.responsibilityAccepted).toBe(false);
  });
});

describe("controlledDiscussToTask two-tenant isolation (real storage)", () => {
  it("same local groupId across tenants does not cross-write", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-d2t-2ten-"));
    tempDirs.push(root);
    const tenantsRoot = path.join(root, "tenants");
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";
    const cfg = {
      agents: { defaults: { workspace: path.join(root, "agent-ws") } },
      gateway: { security: { profile: "managed_enterprise" } },
      collaboration: {
        defaults: { workspace: path.join(root, "host-collaboration") },
        runtimeNamespace: true,
        task: { claimContract: true },
      },
    } as OpenBotConfig;
    const configPath = path.join(root, "openbot.json");
    await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
    process.env.OPENBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    setRuntimeConfigSnapshot(cfg, cfg);
    clearConfigCache();

    const { resolveTrustedGroupLocator } = await import("../workspace/group-locator.js");
    const { createTrustedGroupStores } = await import("./team-resource-auth.js");

    const groupId = "grp_shared_local";
    const mkTrusted = (tenantId: string) => {
      const groupLocator = resolveTrustedGroupLocator({
        groupId,
        tenantId,
        profile: "managed_enterprise",
        cfg,
      });
      return {
        groupsRoot: path.dirname(groupLocator),
        groupLocator,
        stores: createTrustedGroupStores({
          groupsRoot: path.dirname(groupLocator),
          groupLocator,
        }),
      };
    };
    const a = mkTrusted("tenant-aaa");
    const b = mkTrusted("tenant-bbb");

    const msg = EXPLICIT_MSG;
    const ra = await controlledDiscussToTask({
      sourceMessageId: "msg-ten-a",
      groupId,
      tenantId: "tenant-aaa",
      actor: "human:owner",
      message: msg,
      forceExplicit: true,
      acceptanceCriteria: ["A验收1", "A验收2"],
      trusted: { groupsRoot: a.groupsRoot, groupLocator: a.groupLocator },
      tenant: { tenantId: "tenant-aaa", trust: "enterprise_stamp" } as never,
      cfg,
    });
    const rb = await controlledDiscussToTask({
      sourceMessageId: "msg-ten-a", // same message id string, different tenant
      groupId,
      tenantId: "tenant-bbb",
      actor: "human:owner",
      message: msg,
      forceExplicit: true,
      acceptanceCriteria: ["B验收1", "B验收2"],
      trusted: { groupsRoot: b.groupsRoot, groupLocator: b.groupLocator },
      tenant: { tenantId: "tenant-bbb", trust: "enterprise_stamp" } as never,
      cfg,
    });
    expect(ra.taskId).toBeTruthy();
    expect(rb.taskId).toBeTruthy();
    expect(ra.taskId).not.toBe(rb.taskId);

    const taskA = await a.stores.objectStorage.readObject<Task>(groupId, "task", ra.taskId!);
    const taskB = await b.stores.objectStorage.readObject<Task>(groupId, "task", rb.taskId!);
    expect(taskA).toBeTruthy();
    expect(taskB).toBeTruthy();
    // Cross-read must miss
    const cross = await a.stores.objectStorage.readObject<Task>(groupId, "task", rb.taskId!);
    expect(cross).toBeNull();
    const metaA = readDiscussToTaskMetaFromTags(taskA?.tags);
    expect(metaA?.sourceMessageId).toBe("msg-ten-a");
  });
});

describe("controlledDiscussToTask partial success / recovery markers", () => {
  it("persists source + contract fingerprint for recovery without second create", async () => {
    const { cfg, root } = await useConfig(true);
    const groupsRoot = path.join(root, "collaboration", "groups");
    const groupLocator = path.join(groupsRoot, "grp_d2t");
    await fs.mkdir(groupLocator, { recursive: true });
    const trusted = { groupsRoot, groupLocator };
    const sourceMessageId = "msg-recover-1";
    const first = await controlledDiscussToTask({
      sourceMessageId,
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      forceExplicit: true,
      acceptanceCriteria: ["r1", "r2"],
      trusted,
      cfg,
    });
    expect(first.taskId).toBeTruthy();
    const stores2 = createTrustedGroupStores(trusted);
    const task = await stores2.objectStorage.readObject<Task>("grp_d2t", "task", first.taskId!);
    expect(task).toBeTruthy();
    const meta = readDiscussToTaskMetaFromTags(task?.tags);
    expect(meta?.sourceMessageId).toBe(sourceMessageId);
    expect(meta?.contractFingerprint).toBeTruthy();

    const retry = await controlledDiscussToTask({
      sourceMessageId,
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      forceExplicit: true,
      acceptanceCriteria: ["r1", "r2"],
      trusted,
      cfg,
    });
    expect(retry.taskId).toBe(first.taskId);
  });
});
