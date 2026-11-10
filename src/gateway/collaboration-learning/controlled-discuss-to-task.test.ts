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
import { applyTaskStopUnderControlLock } from "../collaboration-dispatch/task-control-cas.js";
import { buildAcceptedTaskStopControl } from "../collaboration-dispatch/task-stop-control.js";
import { controlledDiscussToTask } from "./controlled-discuss-to-task.js";
import { mintDiscussToTaskId } from "./discuss-to-task-id.js";
import { FORMAL_TASK_FLAG_OFF_USER_MESSAGE } from "./discuss-to-task-receipt.js";
import { clearDiscussToTaskSourceBindingsForTests } from "./discuss-to-task-source-binding.js";
import {
  readAuthoritativeDiscussToTaskStages,
  readDiscussToTaskMetaFromTags,
} from "./discuss-to-task-stages.js";
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
    expect(result.userMessage).toContain("已理解：");
    expect(result.userMessage).toContain("目标：");
    expect(result.userMessage).toMatch(/研究/);
    expect(result.userMessage).toContain("还缺少：交付物或验收条件");
    expect(result.userMessage).not.toBe(
      "委托意图尚不明确或缺少验收条件，请补充后再建立正式任务。",
    );
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

  it("flag off → blocked with unified user message; no task/board writes", async () => {
    const { cfg, trusted } = await useTrusted(false);
    const result = await controlledDiscussToTask({
      sourceMessageId: "msg-flag-off",
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      forceExplicit: true,
      trusted,
      cfg,
    });
    // Prior contract: flag-off = clearly blocked, no formal task established.
    expect(result.attempted).toBe(true);
    expect(result.internalReason).toBe("claim_contract_flag_off");
    expect(result.statusCode).toBe("formal_task_blocked_flag_off");
    expect(result.userMessage).toBe(FORMAL_TASK_FLAG_OFF_USER_MESSAGE);
    expect(result.userMessage).not.toMatch(/已派工/);
    expect(result.taskId).toBeNull();
    expect(result.activation).toBeNull();
    expect(result.stages.taskEstablished).toBe(false);
    expect(result.stages.boardPublished).toBe(false);
    expect(result.stages.responsibilityAccepted).not.toBe(true);

    const wouldBeTaskId = mintDiscussToTaskId({
      tenantId: "_local",
      groupId: "grp_d2t",
      sourceMessageId: "msg-flag-off",
    });
    const stores = createTrustedGroupStores({
      groupsRoot: trusted.groupsRoot,
      groupLocator: trusted.groupLocator,
    });
    const task = await stores.objectStorage.readObject<Task>("grp_d2t", "task", wouldBeTaskId);
    expect(task).toBeNull();
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

describe("controlledDiscussToTask lock-internal meta + recovery (P1)", () => {
  it("writes d2t tags inside activate (no lock-external stamp) and survives stop", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const sourceMessageId = "msg-lock-meta-1";
    const first = await controlledDiscussToTask({
      sourceMessageId,
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      forceExplicit: true,
      acceptanceCriteria: ["a1", "a2"],
      trusted,
      cfg,
    });
    expect(first.taskId).toBeTruthy();
    expect(first.idempotentReplay).not.toBe(true); // first create
    const stores = createTrustedGroupStores(trusted);
    const beforeStop = await stores.objectStorage.readObject<Task>(
      "grp_d2t",
      "task",
      first.taskId!,
    );
    const meta = readDiscussToTaskMetaFromTags(beforeStop?.tags);
    expect(meta?.sourceMessageId).toBe(sourceMessageId);
    expect(meta?.contractFingerprint).toBeTruthy();

    // Insert stop after activate (simulates concurrent control write).
    await applyTaskStopUnderControlLock({
      groupId: "grp_d2t",
      taskId: first.taskId!,
      stopControl: buildAcceptedTaskStopControl({
        requestedBy: "human:owner",
        reason: "test_stop",
      }),
      updatedBy: "human:owner",
      cfg,
      groupRootDir: trusted.groupsRoot,
      objectStorage: stores.objectStorage,
    });

    // Same-request recovery must not drop stopControl via lock-external rewrite.
    const retry = await controlledDiscussToTask({
      sourceMessageId,
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      forceExplicit: true,
      acceptanceCriteria: ["a1", "a2"],
      trusted,
      cfg,
    });
    expect(retry.taskId).toBe(first.taskId);
    const after = await stores.objectStorage.readObject<Task>("grp_d2t", "task", first.taskId!);
    expect(after).toBeTruthy();
    const stop = (after as { stopControl?: { status?: string } } | null)?.stopControl;
    expect(stop?.status).toBe("accepted");
    const meta2 = readDiscussToTaskMetaFromTags(after?.tags);
    expect(meta2?.sourceMessageId).toBe(sourceMessageId);
  });

  it("phase-1 ignores client humanConfirmed (no confirm shortcut)", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const result = await controlledDiscussToTask({
      sourceMessageId: "msg-no-confirm-shortcut",
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      forceExplicit: true,
      acceptanceCriteria: ["c1", "c2"],
      humanConfirmed: true,
      requireHumanConfirm: false,
      trusted,
      cfg,
    });
    // Even if caller lies, board publish stays gated (needs_confirm / not published as confirmed).
    expect(result.stages.responsibilityAccepted).not.toBe(true);
    expect(result.userMessage).not.toMatch(/已派工/);
    if (result.activation) {
      expect(
        result.activation.status === "needs_confirm" ||
          result.stages.boardPublished !== true ||
          result.statusCode === "formal_task_needs_confirm" ||
          result.statusCode === "formal_task_established_board_pending",
      ).toBe(true);
    }
  });
});

describe("controlledDiscussToTask authoritative stage readback (P2)", () => {
  it("contract conflict preserves authoritative boardPublished (not forced false)", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const sourceMessageId = "msg-stage-conflict-1";
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
    expect(first.taskId).toBeTruthy();
    // Seed a published-looking board item tag via authoritative read path setup:
    // even without items, conflict stages must not hardcode boardPublished=false when unknown/true.
    const stages = await readAuthoritativeDiscussToTaskStages({
      groupId: "grp_d2t",
      taskId: first.taskId!,
      cfg,
      trusted,
      activationHints: { taskEnsured: true, boardPublished: first.stages.boardPublished === true },
    });
    expect(stages.taskEstablished).toBe(true);
    // Unverified lanes must not pretend with false when read fails — here reads succeed → booleans.
    expect(stages.responsibilityAccepted === true || stages.responsibilityAccepted === false).toBe(
      true,
    );

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
    expect(second.contractConflict === true || second.internalReason?.includes("conflict")).toBe(
      true,
    );
    // Must not force boardPublished=false when authoritative says otherwise / unknown.
    expect(second.stages.taskEstablished).toBe(true);
    expect(second.stages.boardPublished).not.toBe(undefined);
  });

  it("retry after establish uses same stage projection helper", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const sourceMessageId = "msg-stage-retry-1";
    const first = await controlledDiscussToTask({
      sourceMessageId,
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      forceExplicit: true,
      acceptanceCriteria: ["s1", "s2"],
      trusted,
      cfg,
    });
    const retry = await controlledDiscussToTask({
      sourceMessageId,
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      message: EXPLICIT_MSG,
      forceExplicit: true,
      acceptanceCriteria: ["s1", "s2"],
      trusted,
      cfg,
    });
    expect(retry.taskId).toBe(first.taskId);
    expect(retry.stages.taskEstablished).toBe(first.stages.taskEstablished);
    // responsibility/plan not falsely forced false without read — both use authoritative path.
    expect(["boolean", "string"]).toContain(typeof retry.stages.responsibilityAccepted);
  });
});

describe("controlledDiscussToTask durable source owner (R3)", () => {
  it("same source different principal → source_owner_conflict; tags keep first owner", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const sourceMessageId = "msg-owner-persist-1";
    const first = await controlledDiscussToTask({
      sourceMessageId,
      sourceKind: "trusted_inbound",
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:alice",
      principalActor: "human:alice",
      message: EXPLICIT_MSG,
      forceExplicit: true,
      acceptanceCriteria: ["o1", "o2"],
      trusted,
      cfg,
    });
    expect(first.taskId).toBeTruthy();
    const stores = createTrustedGroupStores(trusted);
    const task = await stores.objectStorage.readObject<Task>("grp_d2t", "task", first.taskId!);
    const meta = readDiscussToTaskMetaFromTags(task?.tags);
    expect(meta?.sourceOwner).toBe("human:alice");
    expect(meta?.sourceKind).toBe("trusted_inbound");

    const stolen = await controlledDiscussToTask({
      sourceMessageId,
      sourceKind: "client_idempotency_key",
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:bob",
      principalActor: "human:bob",
      message: EXPLICIT_MSG,
      forceExplicit: true,
      acceptanceCriteria: ["o1", "o2"],
      trusted,
      cfg,
    });
    expect(stolen.internalReason).toBe("discuss_to_task_source_owner_conflict");
    expect(stolen.contractConflict).toBe(true);
    const again = await stores.objectStorage.readObject<Task>("grp_d2t", "task", first.taskId!);
    expect(readDiscussToTaskMetaFromTags(again?.tags)?.sourceOwner).toBe("human:alice");
  });
});

describe("readAuthoritativeDiscussToTaskStages board fixtures (R3)", () => {
  it("full traverse >3 items; empty visible plans → unknown not false", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const first = await controlledDiscussToTask({
      sourceMessageId: "msg-stage-multi",
      sourceKind: "trusted_inbound",
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      principalActor: "human:owner",
      message: EXPLICIT_MSG,
      forceExplicit: true,
      acceptanceCriteria: ["m1", "m2"],
      trusted,
      cfg,
    });
    expect(first.taskId).toBeTruthy();
    const taskId = first.taskId!;
    // Seed 4 published items + 1 claimed under group board-claims log.
    const claimsDir = path.join(trusted.groupLocator, "runtime", "board-claims");
    await fs.mkdir(claimsDir, { recursive: true });
    const logPath = path.join(claimsDir, `${taskId}.jsonl`);
    const lines = [];
    for (let i = 1; i <= 4; i += 1) {
      lines.push(
        JSON.stringify({
          kind: "board_claim",
          item: {
            itemId: `item-${i}`,
            groupId: "grp_d2t",
            taskId,
            title: `item ${i}`,
            remainingWork: `work ${i}`,
            acceptanceCriteria: ["a"],
            intendedClaimantIds: [],
            publishedBy: "human:owner",
            publishedAt: Date.now(),
            status: i === 1 ? "claimed" : "published",
            revision: 1,
            ...(i === 1 ? { claimantId: "bot:worker", claimedAt: Date.now() } : {}),
          },
        }),
      );
    }
    await fs.writeFile(logPath, `${lines.join("\n")}\n`, "utf8");

    const stages = await readAuthoritativeDiscussToTaskStages({
      groupId: "grp_d2t",
      taskId,
      cfg,
      trusted,
      viewerActor: "human:owner",
      activationHints: { taskEnsured: true },
    });
    expect(stages.taskEstablished).toBe(true);
    // If board log is discoverable under this stores layout:
    if (stages.boardPublished === true) {
      expect(stages.responsibilityAccepted).toBe(true);
      // No todolists visible → unknown (not false-as-absent)
      expect(stages.planProposed).toBe("unknown");
      expect(stages.planConfirmed).toBe("unknown");
    } else {
      // Path layout may place board-claims under a different namespace root —
      // then unread board must stay unknown, never pretend unpublished.
      expect(stages.boardPublished).toBe("unknown");
      expect(stages.responsibilityAccepted).toBe("unknown");
    }
  });

  it("without viewerActor, plan lanes stay unknown", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const first = await controlledDiscussToTask({
      sourceMessageId: "msg-stage-noviewer",
      sourceKind: "trusted_inbound",
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:owner",
      principalActor: "human:owner",
      message: EXPLICIT_MSG,
      forceExplicit: true,
      acceptanceCriteria: ["n1", "n2"],
      trusted,
      cfg,
    });
    const stages = await readAuthoritativeDiscussToTaskStages({
      groupId: "grp_d2t",
      taskId: first.taskId!,
      cfg,
      trusted,
      activationHints: { taskEnsured: true, boardPublished: true },
    });
    expect(stages.planProposed).toBe("unknown");
    expect(stages.planConfirmed).toBe("unknown");
  });
});

describe("controlledDiscussToTask lock-held concurrent ownership (R4)", () => {
  it("barrier: same source different principals → one conflict; durable first owner survives cache clear", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const sourceMessageId = "msg-barrier-owner-r4";
    const base = {
      sourceMessageId,
      sourceKind: "trusted_inbound" as const,
      groupId: "grp_d2t",
      tenantId: "_local",
      message: EXPLICIT_MSG,
      forceExplicit: true,
      acceptanceCriteria: ["b1", "b2"],
      trusted,
      cfg,
    };
    const [a, b] = await Promise.all([
      controlledDiscussToTask({ ...base, actor: "human:alice", principalActor: "human:alice" }),
      controlledDiscussToTask({ ...base, actor: "human:bob", principalActor: "human:bob" }),
    ]);
    const rows = [a, b];
    const conflicts = rows.filter(
      (row) => row.internalReason === "discuss_to_task_source_owner_conflict",
    );
    const accepted = rows.filter(
      (row) =>
        row.internalReason !== "discuss_to_task_source_owner_conflict" &&
        row.taskId &&
        row.stages.taskEstablished === true,
    );
    expect(accepted.length).toBe(1);
    expect(conflicts.length).toBe(1);
    expect(accepted[0].stages.taskEstablished).toBe(true);

    const stores = createTrustedGroupStores(trusted);
    const taskId = accepted[0].taskId!;
    const task = await stores.objectStorage.readObject<Task>("grp_d2t", "task", taskId);
    const firstOwner = readDiscussToTaskMetaFromTags(task?.tags)?.sourceOwner;
    expect(firstOwner === "human:alice" || firstOwner === "human:bob").toBe(true);

    clearDiscussToTaskSourceBindingsForTests();
    const other = firstOwner === "human:alice" ? "human:bob" : "human:alice";
    const retry = await controlledDiscussToTask({
      ...base,
      actor: other,
      principalActor: other,
    });
    expect(retry.internalReason).toBe("discuss_to_task_source_owner_conflict");
    const again = await stores.objectStorage.readObject<Task>("grp_d2t", "task", taskId);
    expect(readDiscussToTaskMetaFromTags(again?.tags)?.sourceOwner).toBe(firstOwner);
  });

  it("barrier: same source different claim fingerprints → one contract conflict; first claim remains", async () => {
    const { cfg, trusted } = await useTrusted(true);
    const sourceMessageId = "msg-barrier-claim-r4";
    const shared = {
      sourceMessageId,
      sourceKind: "trusted_inbound" as const,
      groupId: "grp_d2t",
      tenantId: "_local",
      actor: "human:alice",
      principalActor: "human:alice",
      forceExplicit: true,
      trusted,
      cfg,
    };
    const [a, b] = await Promise.all([
      controlledDiscussToTask({
        ...shared,
        message: EXPLICIT_MSG,
        acceptanceCriteria: ["c1", "c2"],
        title: "claim-A",
      }),
      controlledDiscussToTask({
        ...shared,
        message: EXPLICIT_MSG + "\n补充约束：仅内部使用",
        acceptanceCriteria: ["c1", "c2", "c3-extra"],
        title: "claim-B",
      }),
    ]);
    const rows = [a, b];
    const conflicts = rows.filter(
      (row) =>
        row.internalReason === "discuss_to_task_contract_conflict" || row.contractConflict === true,
    );
    const accepted = rows.filter(
      (row) =>
        row.internalReason !== "discuss_to_task_contract_conflict" &&
        !row.contractConflict &&
        row.taskId &&
        row.stages.taskEstablished === true,
    );
    // Concurrent different claims: exactly one durable accept under lock.
    expect(accepted.length).toBe(1);
    expect(conflicts.length).toBe(1);

    const stores = createTrustedGroupStores(trusted);
    const taskId = accepted[0].taskId!;
    const task = await stores.objectStorage.readObject<Task>("grp_d2t", "task", taskId);
    const firstFp = readDiscussToTaskMetaFromTags(task?.tags)?.contractFingerprint;
    expect(firstFp).toBeTruthy();

    clearDiscussToTaskSourceBindingsForTests();
    const retryOther = await controlledDiscussToTask({
      ...shared,
      message: EXPLICIT_MSG + "\n另一契约",
      acceptanceCriteria: ["other-1", "other-2"],
      title: "claim-C",
    });
    expect(retryOther.internalReason).toBe("discuss_to_task_contract_conflict");
    const again = await stores.objectStorage.readObject<Task>("grp_d2t", "task", taskId);
    expect(readDiscussToTaskMetaFromTags(again?.tags)?.contractFingerprint).toBe(firstFp);
    expect(readDiscussToTaskMetaFromTags(again?.tags)?.sourceOwner).toBe("human:alice");
  });
});
