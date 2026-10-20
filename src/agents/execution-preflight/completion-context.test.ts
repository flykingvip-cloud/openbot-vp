import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  armCompletionHold,
  buildExecutionPreflight,
  disarmCompletionHold,
  hasDeliveryContext,
  issueValidationReceipt,
  noteDeliveryArtifactPath,
  readAttemptHoldActive,
  readDeliveryContextMetrics,
  registerTrustedValidator,
  releaseDeliveryContext,
  resetCompletionHoldsForTest,
  resetDeliveryArtifactsForTest,
  resetValidationStateForTest,
  resolveAttemptDelivery,
  sweepExpiredDeliveryContexts,
} from "./index.js";

function preflight(taskId: string, sessionId: string) {
  return buildExecutionPreflight({
    taskId,
    sessionId,
    message: "run sample-task",
    skills: [
      {
        name: "sample-primary",
        frontmatter: {
          "primary-engine": "sample-engine",
          "required-artifacts": "output.bin",
          "required-validators": "sample-validator",
          "delivery-blocked-until": "validator_passed",
          triggers: "sample-task",
          "allowed-tools": "read,write",
        },
      },
    ],
    policyToolNames: ["read", "write"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
}

describe("retained delivery context cleanup", () => {
  beforeEach(() => {
    resetCompletionHoldsForTest();
    resetDeliveryArtifactsForTest();
    resetValidationStateForTest();
    registerTrustedValidator({ id: "sample-validator", version: "1" });
  });

  it("releases after delivery, failure, and cancel, and the attempt unlock does not remove it", () => {
    const sessionKey = "agent:bot-clean:main";
    const first = preflight("task-clean", sessionKey);
    armCompletionHold({
      keys: [sessionKey],
      preflight: first,
      ttlMs: 60_000,
      now: 1_000,
    });
    expect(readAttemptHoldActive(sessionKey)).toBe(true);
    disarmCompletionHold([sessionKey, first.sessionId]);
    expect(readAttemptHoldActive(sessionKey)).toBe(false);
    expect(hasDeliveryContext("task-clean")).toBe(true);
    expect(readDeliveryContextMetrics().retained).toBe(1);

    expect(releaseDeliveryContext("task-clean", "delivered")).toBe(true);
    expect(hasDeliveryContext("task-clean")).toBe(false);
    expect(readDeliveryContextMetrics().cleaned.delivered).toBe(1);

    const failed = preflight("task-failed", sessionKey);
    armCompletionHold({ keys: [sessionKey], preflight: failed, ttlMs: 60_000, now: 2_000 });
    expect(releaseDeliveryContext("task-failed", "failed")).toBe(true);
    const cancelled = preflight("task-cancelled", sessionKey);
    armCompletionHold({ keys: [sessionKey], preflight: cancelled, ttlMs: 60_000, now: 3_000 });
    expect(releaseDeliveryContext("task-cancelled", "cancelled")).toBe(true);
    expect(readDeliveryContextMetrics()).toMatchObject({
      retained: 0,
      cleaned: { delivered: 1, failed: 1, cancelled: 1, timeout: 0 },
    });
  });

  it("expires only after the retain deadline", () => {
    const sessionKey = "agent:bot-ttl:main";
    const task = preflight("task-ttl", sessionKey);
    armCompletionHold({ keys: [sessionKey], preflight: task, ttlMs: 1_000, now: 10_000 });
    expect(sweepExpiredDeliveryContexts(10_500)).toBe(0);
    expect(hasDeliveryContext("task-ttl")).toBe(true);
    expect(sweepExpiredDeliveryContexts(11_000)).toBe(1);
    expect(hasDeliveryContext("task-ttl")).toBe(false);
    expect(readDeliveryContextMetrics().cleaned.timeout).toBe(1);
  });

  it("keeps concurrent tasks separate and does not reuse another task receipt", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "openbot-context-"));
    mkdirSync(path.join(workspace, "out"), { recursive: true });
    writeFileSync(path.join(workspace, "out/output.bin"), "v1");
    const sessionKey = "agent:bot-concurrent:main";
    const older = preflight("task-older", sessionKey);
    const newer = preflight("task-newer", sessionKey);
    noteDeliveryArtifactPath(older.taskId, older.attemptNumber, "out/output.bin");
    noteDeliveryArtifactPath(newer.taskId, newer.attemptNumber, "out/output.bin");
    issueValidationReceipt({
      validatorId: "sample-validator",
      taskId: older.taskId,
      artifactPath: "out/output.bin",
      artifactBytes: "v1",
    });
    armCompletionHold({
      keys: [sessionKey],
      preflight: older,
      workspaceDir: workspace,
      ttlMs: 60_000,
      now: 1,
    });
    armCompletionHold({
      keys: [sessionKey],
      preflight: newer,
      workspaceDir: workspace,
      ttlMs: 60_000,
      now: 2,
    });
    expect(readDeliveryContextMetrics().retained).toBe(2);
    const olderDelivery = resolveAttemptDelivery({ preflight: older, workspaceDir: workspace });
    const newerDelivery = resolveAttemptDelivery({ preflight: newer, workspaceDir: workspace });
    expect(olderDelivery.allowedToDeliver).toBe(true);
    expect(olderDelivery.decisionCode).toBe("delivery_allowed");
    expect(newerDelivery.allowedToDeliver).toBe(false);
    expect(newerDelivery.decisionCode).toBe("delivery_blocked");
    expect(newerDelivery.gateInput.taskId).toBe("task-newer");
  });
});
