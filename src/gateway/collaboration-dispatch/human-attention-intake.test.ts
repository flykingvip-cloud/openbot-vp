import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearConfigCache, setRuntimeConfigSnapshot } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { publishBoardItem } from "./claim-contract.js";
import { progressFingerprint } from "./group-task-heartbeat.js";
import { actHumanAttentionCard } from "./human-attention-actions.js";
import {
  assertsNoBlindRetryOption,
  buildHumanAttentionCard,
  humanAttentionIdempotencyKey,
  optionsForHumanAttentionFailureKind,
  parseHumanAttentionFence,
  resolveHumanAttentionFailureKind,
} from "./human-attention-card.js";
import {
  humanAttentionTodoId,
  listHumanAttentionTodos,
  resetHumanAttentionInboxForTests,
  resolveHumanAttentionTodo,
  upsertHumanAttentionTodo,
} from "./human-attention-inbox.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority } from "./runtime-authority.js";
import { sanitizeDispatchError, sanitizeDispatchErrorMessage } from "./sanitize-dispatch-error.js";

const tempDirs: string[] = [];

afterEach(async () => {
  resetHumanAttentionInboxForTests();
  clearConfigCache();
  delete process.env.OPENBOT_STATE_DIR;
  delete process.env.OPENBOT_CONFIG_PATH;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.OPENBOT_SECURITY_PROFILE;
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

async function seedAuthorityWithBoard(params: {
  groupId: string;
  taskId: string;
  itemHint?: string;
}): Promise<{
  cfg: OpenBotConfig;
  authority: ReturnType<typeof createRuntimeAuthority>;
  itemId: string;
  fingerprint: string;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ha-intake-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  const cfg = {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        wakeContract: true,
        wakeContractGroupAllowlist: [params.groupId],
        claimContract: true,
        selfAdvance: { mode: "execute", executeGroupAllowlist: [params.groupId] },
        groupTaskHeartbeat: {
          mode: "observe",
          emitGroupAllowlist: [params.groupId],
          scanIntervalMs: 1_000,
          escalateAfterConsecutiveNoResponse: 2,
        },
      },
    },
  } as OpenBotConfig;
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_ha_intake" },
  );
  const authority = createRuntimeAuthority({
    snapshot,
    episodeId: "ep_ha_intake",
    tenant: { tenantId: null, trust: "none" },
    groupId: params.groupId,
    profile: "personal_local",
    cfg,
  });
  const published = await publishBoardItem(
    authority,
    {
      groupId: params.groupId,
      taskId: params.taskId,
      remainingWork: params.itemHint ?? "work",
      acceptanceCriteria: ["ok"],
      intendedClaimantIds: ["bot:analyst"],
      publishedBy: "human:amy",
    },
    { cfg, nowMs: 100 },
  );
  if (!published.ok) {
    throw new Error(`publishBoardItem failed: ${published.reason}`);
  }
  return {
    cfg,
    authority,
    itemId: published.value.itemId,
    fingerprint: progressFingerprint(published.value),
  };
}

describe("human-attention card options by failure kind", () => {
  it("not_started offers fix-retry / transfer / cancel — never blind immediate retry id", () => {
    const ids = optionsForHumanAttentionFailureKind("not_started").map((o) => o.id);
    expect(ids).toEqual(["retry_after_fix", "transfer", "cancel_task"]);
  });

  it("side_effect_unknown forbids blind retry and requires evidence path", () => {
    const opts = optionsForHumanAttentionFailureKind("side_effect_unknown");
    const ids = opts.map((o) => o.id);
    expect(ids).toContain("view_evidence");
    expect(ids).toContain("confirm_completed");
    expect(ids).toContain("release_after_verify");
    expect(ids).not.toContain("retry_after_fix");
    const card = buildHumanAttentionCard({
      todoId: "g|i|fp",
      groupId: "g",
      taskId: "t",
      boardItemId: "i",
      fingerprint: "fp",
      version: 1,
      failureKind: "side_effect_unknown",
      reason: "started_or_unknown",
      ownerIds: ["human:owner"],
      recoveryHint: "verify first",
    });
    expect(card).not.toBeNull();
    expect(assertsNoBlindRetryOption(card!)).toBe(true);
  });

  it("awaiting_review and retries_exhausted match acceptance buttons", () => {
    expect(optionsForHumanAttentionFailureKind("awaiting_review").map((o) => o.id)).toEqual([
      "view_artifact",
      "accept_submission",
      "return_submission",
    ]);
    expect(optionsForHumanAttentionFailureKind("retries_exhausted").map((o) => o.id)).toEqual([
      "view_failure_reason",
      "transfer",
      "take_over",
    ]);
  });
});

describe("human-attention inbox + card loop", () => {
  it("dedupes by groupId|itemId|fingerprint and bumps version on material change", () => {
    const first = upsertHumanAttentionTodo({
      groupId: "group-a",
      itemId: "item-1",
      taskId: "task-1",
      fingerprint: "fp-1",
      reason: "nudge_failures_exhausted:x",
      ownerIds: ["human:amy"],
      recoveryHint: "fix then retry",
      source: "nudge_failures_exhausted",
      boardStatus: "in_progress",
      nowMs: 1_000,
    });
    expect(first.created).toBe(true);
    expect(first.todo.version).toBe(1);
    expect(first.todo.id).toBe(
      humanAttentionTodoId({ groupId: "group-a", itemId: "item-1", fingerprint: "fp-1" }),
    );

    const again = upsertHumanAttentionTodo({
      groupId: "group-a",
      itemId: "item-1",
      taskId: "task-1",
      fingerprint: "fp-1",
      reason: "nudge_failures_exhausted:x",
      ownerIds: ["human:amy"],
      recoveryHint: "fix then retry",
      source: "nudge_failures_exhausted",
      boardStatus: "in_progress",
      nowMs: 2_000,
    });
    expect(again.deduped).toBe(true);
    expect(again.todo.version).toBe(1);

    const bumped = upsertHumanAttentionTodo({
      groupId: "group-a",
      itemId: "item-1",
      taskId: "task-1",
      fingerprint: "fp-1",
      reason: "escalate_failures_exhausted:y",
      ownerIds: ["human:amy"],
      recoveryHint: "take over",
      source: "escalate_failures_exhausted",
      boardStatus: "in_progress",
      nowMs: 3_000,
    });
    expect(bumped.deduped).toBe(true);
    expect(bumped.todo.version).toBe(2);
    expect(listHumanAttentionTodos({ actorId: "amy" })).toHaveLength(1);
  });

  it("reopens terminal todo with bumped version so open card idempotency key is fresh", async () => {
    const first = upsertHumanAttentionTodo({
      groupId: "group-reopen",
      itemId: "item-reopen",
      taskId: "task-reopen",
      fingerprint: "fp-reopen",
      reason: "escalate_failures_exhausted:stalled",
      ownerIds: ["human:amy"],
      recoveryHint: "take over then resume",
      source: "escalate_failures_exhausted",
      boardStatus: "applied",
      nowMs: 10_000,
    });
    expect(first.created).toBe(true);
    expect(first.todo.version).toBe(1);
    expect(first.todo.status).toBe("open");

    const openCardV1 = buildHumanAttentionCard({
      todoId: first.todo.id,
      groupId: first.todo.groupId,
      taskId: first.todo.taskId,
      boardItemId: first.todo.itemId,
      fingerprint: first.todo.fingerprint,
      version: first.todo.version,
      failureKind: first.todo.failureKind,
      reason: first.todo.reason,
      ownerIds: first.todo.ownerIds,
      recoveryHint: first.todo.recoveryHint,
      boardStatus: first.todo.boardStatus,
      status: first.todo.status,
    });
    expect(openCardV1).not.toBeNull();
    expect(humanAttentionIdempotencyKey(openCardV1!)).toBe(`human-attention:${first.todo.id}:v1`);

    const resolved = await resolveHumanAttentionTodo({
      id: first.todo.id,
      actorId: "amy",
      action: "take_over",
      result: "人工接管完成",
      nowMs: 20_000,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.todo.status).toBe("resolved");
    expect(resolved.todo.version).toBe(1);
    expect(resolved.todo.resolution?.action).toBe("take_over");

    const receipt = buildHumanAttentionCard({
      todoId: resolved.todo.id,
      groupId: resolved.todo.groupId,
      taskId: resolved.todo.taskId,
      boardItemId: resolved.todo.itemId,
      fingerprint: resolved.todo.fingerprint,
      version: resolved.todo.version,
      failureKind: resolved.todo.failureKind,
      reason: resolved.todo.reason,
      ownerIds: resolved.todo.ownerIds,
      recoveryHint: resolved.todo.recoveryHint,
      boardStatus: resolved.todo.boardStatus,
      status: resolved.todo.status,
      resolution: resolved.todo.resolution,
    });
    expect(receipt?.title).toBe("任务人工处理结果");

    const reopened = upsertHumanAttentionTodo({
      groupId: "group-reopen",
      itemId: "item-reopen",
      taskId: "task-reopen",
      fingerprint: "fp-reopen",
      reason: "escalate_failures_exhausted:stalled_again",
      ownerIds: ["human:amy"],
      recoveryHint: "needs human again",
      source: "escalate_failures_exhausted",
      boardStatus: "applied",
      nowMs: 30_000,
    });
    expect(reopened.created).toBe(true);
    expect(reopened.todo.status).toBe("open");
    expect(reopened.todo.version).toBe(2);
    expect(reopened.todo.resolution).toBeUndefined();

    const openCardV2 = buildHumanAttentionCard({
      todoId: reopened.todo.id,
      groupId: reopened.todo.groupId,
      taskId: reopened.todo.taskId,
      boardItemId: reopened.todo.itemId,
      fingerprint: reopened.todo.fingerprint,
      version: reopened.todo.version,
      failureKind: reopened.todo.failureKind,
      reason: reopened.todo.reason,
      ownerIds: reopened.todo.ownerIds,
      recoveryHint: reopened.todo.recoveryHint,
      boardStatus: reopened.todo.boardStatus,
      status: reopened.todo.status,
    });
    expect(openCardV2).not.toBeNull();
    expect(openCardV2?.title).toBe("任务需要你处理");
    expect(humanAttentionIdempotencyKey(openCardV2!)).toBe(
      `human-attention:${reopened.todo.id}:v2`,
    );
    expect(humanAttentionIdempotencyKey(openCardV2!)).not.toBe(
      humanAttentionIdempotencyKey(openCardV1!),
    );
    expect(listHumanAttentionTodos({ actorId: "amy" })).toHaveLength(1);
  });

  it("side_effect_unknown action rejects blind retry; release_after_verify needs note", async () => {
    const { todo } = upsertHumanAttentionTodo({
      groupId: "g",
      itemId: "i",
      taskId: "t",
      fingerprint: "fp",
      reason: "Bearer sk-abcdefghijklmnopqrstuvwxyz012345 side effect",
      ownerIds: ["human:amy"],
      recoveryHint: "verify",
      source: "side_effect_unknown",
      sideEffectClass: "started_or_unknown",
      nowMs: 10,
    });
    expect(todo.failureKind).toBe("side_effect_unknown");
    expect(todo.reason).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");

    const banned = await actHumanAttentionCard({
      todoId: todo.id,
      action: "retry_after_fix",
      actorId: "amy",
      expectedVersion: todo.version,
      expectedFingerprint: todo.fingerprint,
    });
    expect(banned.ok).toBe(false);
    if (!banned.ok) {
      expect(banned.reason).toBe("blind_retry_forbidden");
    }

    const missingNote = await actHumanAttentionCard({
      todoId: todo.id,
      action: "release_after_verify",
      actorId: "amy",
      expectedVersion: todo.version,
      expectedFingerprint: todo.fingerprint,
    });
    expect(missingNote.ok).toBe(false);
    if (!missingNote.ok) {
      expect(missingNote.reason).toBe("verification_note_required");
    }

    // confirm_completed requires a bound wake-op with prior receipt — without it,
    // the todo must stay open (no false "recovered").
    const confirm = await actHumanAttentionCard({
      todoId: todo.id,
      action: "confirm_completed",
      actorId: "amy",
      expectedVersion: todo.version,
      expectedFingerprint: todo.fingerprint,
    });
    expect(confirm.ok).toBe(false);
    if (!confirm.ok) {
      expect(confirm.reason).toMatch(/missing_wake_op|authority_required/);
    }
  });

  it("transfer keeps status open and card options (terminal uses status not resolution)", async () => {
    const seeded = await seedAuthorityWithBoard({ groupId: "g", taskId: "t2" });
    const { todo } = upsertHumanAttentionTodo({
      groupId: "g",
      itemId: seeded.itemId,
      taskId: "t2",
      fingerprint: seeded.fingerprint,
      reason: "exhausted",
      ownerIds: ["human:amy"],
      recoveryHint: "transfer",
      source: "nudge_failures_exhausted",
      boardStatus: "in_progress",
      nowMs: 20,
    });
    const transferred = await actHumanAttentionCard({
      todoId: todo.id,
      action: "transfer",
      actorId: "amy",
      expectedVersion: todo.version,
      expectedFingerprint: todo.fingerprint,
      transferOwnerId: "human:bob",
      authority: seeded.authority,
      cfg: seeded.cfg,
    });
    expect(transferred.ok).toBe(true);
    if (!transferred.ok) {
      return;
    }
    expect(transferred.todo.status).toBe("open");
    expect(transferred.todo.ownerIds).toEqual(["human:bob"]);
    expect(transferred.todo.ownerOverride).toBe(true);
    expect(transferred.todo.resolution).toBeUndefined();
    const card = buildHumanAttentionCard({
      todoId: transferred.todo.id,
      groupId: transferred.todo.groupId,
      taskId: transferred.todo.taskId,
      boardItemId: transferred.todo.itemId,
      fingerprint: transferred.todo.fingerprint,
      version: transferred.todo.version,
      failureKind: transferred.todo.failureKind,
      reason: transferred.todo.reason,
      ownerIds: transferred.todo.ownerIds,
      recoveryHint: transferred.todo.recoveryHint,
      status: transferred.todo.status,
      resolution: transferred.todo.resolution,
    });
    expect(card?.options.length).toBeGreaterThan(0);
    expect(card?.title).toBe("任务需要你处理");
  });

  it("formats fence that parses back with bound todoId/version/fingerprint", () => {
    const card = buildHumanAttentionCard({
      todoId: "g|i|fp",
      groupId: "g",
      taskId: "t",
      boardItemId: "i",
      fingerprint: "fp",
      version: 3,
      failureKind: "retries_exhausted",
      reason: "escalate_failures_exhausted",
      ownerIds: ["human:amy"],
      recoveryHint: "take over",
      taskTitle: "Demo",
      boardStatus: "in_progress",
    });
    expect(card).not.toBeNull();
    const text = [
      "责任人 — 任务需要你处理",
      "",
      "```human-attention",
      JSON.stringify(card, null, 2),
      "```",
    ].join("\n");
    const parsed = parseHumanAttentionFence(text);
    expect(parsed?.todoId).toBe("g|i|fp");
    expect(parsed?.version).toBe(3);
    expect(parsed?.fingerprint).toBe("fp");
  });
});

describe("P2 sanitizeDispatchError end-to-end surfaces", () => {
  it("redacts secrets in sanitize helpers used by Mode B / wake / human reason paths", () => {
    const msg = sanitizeDispatchErrorMessage(
      "failed Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz012345 extra",
      240,
    );
    expect(msg.toLowerCase()).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    const fromErr = sanitizeDispatchError(
      new Error("token ghp_abcdefghijklmnopqrstuvwxyz0123456789"),
      240,
    );
    expect(fromErr.message).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });

  it("maps failure kinds for card button sets", () => {
    expect(
      resolveHumanAttentionFailureKind({
        source: "side_effect_unknown",
        sideEffectClass: "started_or_unknown",
      }),
    ).toBe("side_effect_unknown");
    expect(
      resolveHumanAttentionFailureKind({
        source: "nudge_failures_exhausted",
        sideEffectClass: "not_started",
      }),
    ).toBe("retries_exhausted");
    expect(
      resolveHumanAttentionFailureKind({
        source: "manual",
        boardStatus: "submitted_for_review",
      }),
    ).toBe("awaiting_review");
  });
});
