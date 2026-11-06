import { describe, expect, it } from "vitest";
import type { ActionIntent } from "../../../../src/observation/action-intent.js";
import { actionIntentModel } from "./action-intent-model.ts";
export function fixture(state: "accepted" | "executing" | "effective" = "effective"): ActionIntent {
  const target = {
    controlPlane: "test-control",
    targetType: "policy",
    targetId: "target",
    scopeRef: "scope",
    expectedConfigVersion: "v1",
    diffDigest: "diff",
    previewRef: "preview",
    rollbackPointRef: "point",
    rollbackExpectedVersion: "v0",
    rollbackDiffDigest: "old",
  };
  const command = { commandId: "cmd", idempotencyKey: "key", requestDigest: "request" };
  return {
    schemaVersion: 1,
    actionIntentId: "historical-intent",
    revision: 4,
    state,
    findingRef: { findingId: "finding", source: "rule_v1" },
    evidence: {
      sampleRefs: [{ sampleId: "sample", taskId: "task", outcomeVersion: 1 }],
      metricDictVersion: 1,
      metricId: "metric",
      denominatorDefinition: "eligible tips",
      cohortRef: "cohort",
      window: { from: 0, to: 10 },
      eligibility: "eligible",
      improvementEligible: true,
      environment: "production",
      provenance: "live",
      reasons: [],
    },
    target,
    approval: {
      approvalId: "approval",
      actorRef: "user",
      source: "user",
      intentRevision: 1,
      target,
      issuedAt: 10,
      expiresAt: 40,
      revokedAt: null,
    },
    authorizedRevision: 1,
    command,
    receipts: [
      {
        ...command,
        receiptId: "receipt",
        intentRevision: 1,
        target,
        status:
          state === "accepted" ? "accepted" : state === "executing" ? "executing" : "succeeded",
        at: 20,
        actualVersion: state === "effective" ? "v2" : null,
      },
    ],
    readback:
      state === "effective"
        ? {
            readbackId: "read",
            controlPlane: target.controlPlane,
            targetId: target.targetId,
            scopeRef: target.scopeRef,
            actualVersion: "v2",
            actualDiffDigest: "diff",
            observedAt: 21,
          }
        : null,
    verification: null,
    rollback: null,
    createdAt: 0,
    updatedAt: 22,
  };
}
describe("readonly action intent consistency", () => {
  it.each(["accepted", "executing", "effective"] as const)(
    "preserves complete production %s history",
    (state) => expect(actionIntentModel(fixture(state), 50).state).toBe(state),
  );
  it("does not erase history on later expiry or revocation", () => {
    const i = fixture();
    i.approval = { ...i.approval!, revokedAt: 30 };
    const model = actionIntentModel(i, 50);
    expect(model.state).toBe("effective");
    expect(model.authorization).toContain("失效");
  });
  it("rejects mismatched readback version", () => {
    const i = fixture();
    i.readback = { ...i.readback!, actualVersion: "wrong" };
    expect(actionIntentModel(i, 50).reason).toBe("readback_mismatch");
  });
  it("requires verification evidence", () =>
    expect(actionIntentModel({ ...fixture(), state: "verified" }, 50).reason).toBe(
      "verification_mismatch",
    ));
  it.each(["failed", "blocked", "conflict", "rejected"] as const)("has a label for %s", (state) => {
    const i = fixture();
    i.state = state;
    if (state === "failed") {
      i.receipts = [{ ...i.receipts[0], status: "failed" }];
    }
    expect(actionIntentModel(i, 50).state).toBe(state);
  });
});

describe("rollback evidence display", () => {
  function rolled(): ActionIntent {
    const intent = fixture();
    intent.state = "rolled_back";
    intent.rollback = {
      receipt: {
        ...intent.receipts[0],
        receiptId: "rollback",
        commandId: "rollback-command",
        idempotencyKey: "rollback-key",
        requestDigest: "rollback-request",
        at: 25,
        actualVersion: "v0",
      },
      readback: {
        ...intent.readback!,
        readbackId: "rollback-read",
        actualVersion: "v0",
        actualDiffDigest: "old",
        observedAt: 26,
      },
    };
    return intent;
  }
  it("preserves matching rollback history after later revocation", () => {
    const intent = rolled();
    intent.approval = { ...intent.approval!, revokedAt: 30 };
    expect(actionIntentModel(intent, 50).state).toBe("rolled_back");
  });
  it("requires rollback receipt and readback", () => {
    const intent = rolled();
    intent.rollback = null;
    expect(actionIntentModel(intent, 50).reason).toBe("rollback_evidence_missing");
  });
  it.each(["version", "digest", "scope", "order"])("rejects rollback %s mismatch", (kind) => {
    const intent = rolled();
    const back = intent.rollback!.readback;
    if (kind === "version") {
      back.actualVersion = "wrong";
    }
    if (kind === "digest") {
      back.actualDiffDigest = "wrong";
    }
    if (kind === "scope") {
      back.scopeRef = "other";
    }
    if (kind === "order") {
      back.observedAt = 24;
    }
    expect(actionIntentModel(intent, 50).reason).toBe("rollback_readback_mismatch");
  });
});
