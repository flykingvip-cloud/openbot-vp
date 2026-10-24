import { describe, expect, it } from "vitest";
import { CANONICAL_STEP_STATUS_UNKNOWN_OUTCOME } from "../progress-ledger/execution-step-canonical.js";
import {
  ACTION_IDEMPOTENCY_SCHEMA_VERSION,
  ACTION_OUTCOME_UNKNOWN,
  buildActionIdempotencyKey,
  createActionIdempotencyRegistry,
  digestActionParams,
} from "./action-idempotency.js";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";

describe("WP-07 action-idempotency helper", () => {
  it("keeps LIVE invoke false and exposes schema version", () => {
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(ACTION_IDEMPOTENCY_SCHEMA_VERSION).toBe(1);
  });

  it("builds a stable key from tenant+taskId+logicalActionId", () => {
    const a = buildActionIdempotencyKey({
      tenantId: "t1",
      taskId: "task-1",
      logicalActionId: "action.send",
    });
    const b = buildActionIdempotencyKey({
      tenantId: "t1",
      taskId: "task-1",
      logicalActionId: "action.send",
    });
    const c = buildActionIdempotencyKey({
      tenantId: "t2",
      taskId: "task-1",
      logicalActionId: "action.send",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("digests params stably and rejects same-key different digest", () => {
    const digestA = digestActionParams({ to: "a@example.com", body: "hi" });
    const digestB = digestActionParams({ to: "a@example.com", body: "bye" });
    expect(digestA).not.toBe(digestB);

    const registry = createActionIdempotencyRegistry();
    const first = registry.register({
      tenantId: "t1",
      taskId: "task-1",
      logicalActionId: "action.send",
      paramDigest: digestA,
      nowMs: 1_000,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.reused).toBe(false);

    const reuse = registry.register({
      tenantId: "t1",
      taskId: "task-1",
      logicalActionId: "action.send",
      paramDigest: digestA,
      nowMs: 2_000,
    });
    expect(reuse.ok).toBe(true);
    if (reuse.ok) {
      expect(reuse.reused).toBe(true);
      expect(reuse.key).toBe(first.key);
    }

    const conflict = registry.register({
      tenantId: "t1",
      taskId: "task-1",
      logicalActionId: "action.send",
      paramDigest: digestB,
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.reason).toBe("param_digest_conflict");
      expect(conflict.key).toBe(first.key);
      expect(conflict.existingParamDigest).toBe(digestA);
    }
    expect(registry.size()).toBe(1);
    expect(registry.lookup(first.key)?.paramDigest).toBe(digestA);
  });

  it("rejects empty taskId / logicalActionId / paramDigest", () => {
    const registry = createActionIdempotencyRegistry();
    expect(
      registry.register({
        taskId: "  ",
        logicalActionId: "a",
        paramDigest: "x",
      }).ok,
    ).toBe(false);
    expect(
      registry.register({
        taskId: "t",
        logicalActionId: "",
        paramDigest: "x",
      }).ok,
    ).toBe(false);
    expect(
      registry.register({
        taskId: "t",
        logicalActionId: "a",
        paramDigest: " ",
      }).ok,
    ).toBe(false);
  });

  it("exposes unknown_outcome guidance (not failed-then-auto-retry)", () => {
    expect(ACTION_OUTCOME_UNKNOWN).toBe("unknown_outcome");
    expect(ACTION_OUTCOME_UNKNOWN).toBe(CANONICAL_STEP_STATUS_UNKNOWN_OUTCOME);
    // Retries keep same logicalActionId + idempotencyKey (same registry key);
    // attemptId is Step-level (new attemptId). Unclear outcomes must not be
    // rewritten to failed for a blind auto-retry.
    const registry = createActionIdempotencyRegistry();
    const digest = digestActionParams({ to: "a@example.com" });
    const first = registry.register({
      tenantId: "t1",
      taskId: "task-1",
      logicalActionId: "action.send",
      paramDigest: digest,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const reuse = registry.register({
      tenantId: "t1",
      taskId: "task-1",
      logicalActionId: "action.send",
      paramDigest: digest,
    });
    expect(reuse.ok).toBe(true);
    if (reuse.ok) {
      expect(reuse.reused).toBe(true);
      expect(reuse.key).toBe(first.key);
    }
  });
});
