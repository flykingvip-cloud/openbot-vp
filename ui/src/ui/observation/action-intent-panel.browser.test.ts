import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { ActionIntent } from "../../../../src/observation/action-intent.js";
import { renderActionIntent } from "./action-intent-panel.ts";
describe("readonly action intent panel", () => {
  it("never claims verification without evidence or offers actions", () => {
    const container = document.createElement("div");
    render(renderActionIntent(null, 50), container);
    expect(container.textContent).toContain("状态未核验");
    expect(container.querySelectorAll("button,input,form,a")).toHaveLength(0);
    const invalid = {
      schemaVersion: 1,
      state: "verified",
      approval: null,
    } as unknown as ActionIntent;
    render(renderActionIntent(invalid, 50), container);
    expect(container.textContent).toContain("approval_mismatch");
  });
});
function fixture(state: "accepted" | "executing" | "effective" = "effective"): ActionIntent {
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

describe("rollback panel evidence", () => {
  it("renders only matching rollback evidence as rolled back", () => {
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
    const container = document.createElement("div");
    render(renderActionIntent(intent, 50), container);
    expect(container.textContent).toContain("已回滚");
    expect(container.textContent).toContain("回滚实际版本：v0");
    expect(container.querySelectorAll("button,input,form,a")).toHaveLength(0);
    intent.rollback.readback.actualVersion = "wrong";
    render(renderActionIntent(intent, 50), container);
    expect(container.textContent).toContain("状态未核验");
    expect(container.textContent).not.toContain("改善动作 · 已回滚");
  });
});
