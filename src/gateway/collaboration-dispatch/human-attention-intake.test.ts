import { afterEach, describe, expect, it } from "vitest";
import { actHumanAttentionCard } from "./human-attention-actions.js";
import {
  assertsNoBlindRetryOption,
  buildHumanAttentionCard,
  optionsForHumanAttentionFailureKind,
  parseHumanAttentionFence,
  resolveHumanAttentionFailureKind,
} from "./human-attention-card.js";
import {
  humanAttentionTodoId,
  listHumanAttentionTodos,
  resetHumanAttentionInboxForTests,
  upsertHumanAttentionTodo,
} from "./human-attention-inbox.js";
import { sanitizeDispatchError, sanitizeDispatchErrorMessage } from "./sanitize-dispatch-error.js";

afterEach(() => {
  resetHumanAttentionInboxForTests();
});

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

    const ok = await actHumanAttentionCard({
      todoId: todo.id,
      action: "confirm_completed",
      actorId: "amy",
      expectedVersion: todo.version,
      expectedFingerprint: todo.fingerprint,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.todo.resolution?.actorId).toBe("amy");
      expect(ok.todo.resolution?.result).toContain("确认结果已完成");
    }
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
