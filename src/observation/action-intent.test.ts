import { describe, it, expect } from "vitest";
import {
  createActionIntent,
  createTestActionIntentFactory,
  transitionActionIntent,
  type ActionIntent,
  type ApprovalEvidence,
  type ControlReceipt,
  type IntentEvent,
} from "./action-intent.js";
const target = {
  controlPlane: "agent-runtime",
  targetType: "policy",
  targetId: "bot",
  scopeRef: "test-scope",
  expectedConfigVersion: "v1",
  diffDigest: "diff",
  previewRef: "preview",
  rollbackPointRef: "opaque-point",
  rollbackExpectedVersion: "v0",
  rollbackDiffDigest: "rollback-diff",
};
const evidence = {
  sampleRefs: [
    { sampleId: "injected-sample", taskId: "test-task", outcomeVersion: 1, agentId: "bot" },
  ],
  metricDictVersion: 1,
  metricId: "test.metric",
  denominatorDefinition: "eligible test samples",
  cohortRef: "injected-cohort",
  window: { from: 0, to: 10 },
  eligibility: "eligible" as const,
  improvementEligible: true,
  environment: "test" as const,
  provenance: "injected" as const,
  reasons: [],
};
const factory = createTestActionIntentFactory();
const fresh = () =>
  factory.create(
    {
      actionIntentId: "intent",
      findingRef: { findingId: "finding", source: "rule_v1" },
      evidence,
      target,
    },
    10,
  );
const step = (
  intent: ActionIntent,
  event: IntentEvent,
  approval: ApprovalEvidence | null = null,
  now = 20,
) => factory.transition(intent, event, { now, expectedRevision: intent.revision, approval });
function good(result: ReturnType<typeof step>): ActionIntent {
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.intent;
}
function approved() {
  const preview = good(step(fresh(), { type: "preview" }));
  const approval: ApprovalEvidence = {
    approvalId: "approval",
    actorRef: "test-user",
    source: "user",
    intentRevision: preview.revision,
    target,
    issuedAt: 10,
    expiresAt: 100,
    revokedAt: null,
  };
  return { approval, intent: good(step(preview, { type: "authorize", approval })) };
}
function receipt(status: ControlReceipt["status"], at = 20): ControlReceipt {
  return {
    receiptId: status,
    commandId: "command",
    idempotencyKey: "key",
    requestDigest: "request",
    intentRevision: 1,
    target,
    status,
    at,
    actualVersion: status === "succeeded" ? "v2" : null,
  };
}
function effective() {
  const { approval, intent } = approved();
  const running = good(step(intent, { type: "receipt", receipt: receipt("succeeded") }, approval));
  const readback = {
    readbackId: "read",
    controlPlane: target.controlPlane,
    targetId: target.targetId,
    scopeRef: target.scopeRef,
    actualVersion: "v2",
    actualDiffDigest: "diff",
    observedAt: 21,
  };
  return {
    approval,
    readback,
    intent: good(step(running, { type: "readback", readback }, approval, 22)),
  };
}
describe("pure ActionIntent state machine (injected test environment)", () => {
  it("blocks P1 ineligible evidence even with approval", () => {
    const i = { ...fresh(), evidence: { ...evidence, improvementEligible: false } };
    expect(step(i, { type: "preview" })).toMatchObject({ ok: false, reason: "needs_evidence" });
    expect(step(i, { type: "needs_evidence" })).toMatchObject({
      ok: true,
      intent: { state: "needs_evidence" },
    });
  });
  it("keeps accepted, executing and effective distinct", () => {
    const { approval, intent } = approved();
    const accepted = good(
      step(intent, { type: "receipt", receipt: receipt("accepted") }, approval),
    );
    expect(accepted.state).toBe("accepted");
    const executing = good(
      step(accepted, { type: "receipt", receipt: receipt("executing") }, approval),
    );
    expect(executing.state).toBe("executing");
    expect(effective().intent.state).toBe("effective");
  });
  it("rejects stale revisions and expired, revoked, mismatched approvals without erasing history", () => {
    const { approval, intent } = approved();
    for (const bad of [
      { ...approval, expiresAt: 20 },
      { ...approval, revokedAt: 19 },
      { ...approval, target: { ...target, scopeRef: "other" } },
      { ...approval, intentRevision: 0 },
    ]) {
      const r = step(intent, { type: "receipt", receipt: receipt("accepted") }, bad);
      expect(r).toMatchObject({ ok: false });
      expect(r.intent).toBe(intent);
    }
    expect(
      transitionActionIntent(
        intent,
        { type: "preview" },
        { now: 20, expectedRevision: 0, approval },
      ),
    ).toMatchObject({ ok: false, reason: "revision_conflict" });
  });
  it("handles identical receipt replay and idempotency conflicts", () => {
    const { approval, intent } = approved();
    const r = receipt("accepted");
    const accepted = good(step(intent, { type: "receipt", receipt: r }, approval));
    expect(step(accepted, { type: "receipt", receipt: r }, approval)).toMatchObject({
      ok: true,
      replayed: true,
    });
    expect(
      step(
        accepted,
        { type: "receipt", receipt: { ...receipt("executing"), requestDigest: "other" } },
        approval,
      ),
    ).toMatchObject({ ok: false, reason: "idempotency_conflict" });
  });
  it("rejects receipt regression and fabricated effectiveness", () => {
    const { approval, intent } = approved();
    const executing = good(
      step(intent, { type: "receipt", receipt: receipt("executing") }, approval),
    );
    expect(
      step(executing, { type: "receipt", receipt: receipt("accepted") }, approval),
    ).toMatchObject({ ok: false, reason: "receipt_out_of_order" });
    const e = effective();
    expect(step(executing, { type: "readback", readback: e.readback }, approval, 22)).toMatchObject(
      { ok: false, reason: "successful_receipt_required" },
    );
  });
  it("requires matching actual version and content readback", () => {
    const { approval, intent } = approved();
    const executed = good(
      step(intent, { type: "receipt", receipt: receipt("succeeded") }, approval),
    );
    const e = effective();
    for (const readback of [
      { ...e.readback, actualVersion: "v3" },
      { ...e.readback, actualDiffDigest: "wrong" },
    ]) {
      expect(step(executed, { type: "readback", readback }, approval, 22)).toMatchObject({
        ok: false,
        reason: "readback_mismatch",
      });
    }
  });
  it("requires same metric/cohort and valid comparison denominators", () => {
    const e = effective();
    const verification = {
      verificationId: "verify",
      metricDictVersion: 1,
      metricId: "test.metric",
      denominatorDefinition: "eligible test samples",
      cohortRef: "injected-cohort",
      baselineWindow: { from: 0, to: 10 },
      candidateWindow: { from: 22, to: 32 },
      baselineDenominator: 10,
      candidateDenominator: 10,
      eligible: true,
      passed: true,
      observedAt: 33,
    };
    expect(good(step(e.intent, { type: "verify", verification }, e.approval, 34)).state).toBe(
      "verified",
    );
    for (const bad of [
      { ...verification, metricDictVersion: 2 },
      { ...verification, candidateDenominator: 0 },
      { ...verification, cohortRef: "other" },
    ]) {
      expect(step(e.intent, { type: "verify", verification: bad }, e.approval, 34)).toMatchObject({
        ok: false,
        reason: "verification_mismatch",
      });
    }
  });
  it("requires a separate successful rollback receipt and version readback", () => {
    const e = effective();
    const rollbackReceipt = {
      ...receipt("succeeded", 23),
      receiptId: "rollback",
      commandId: "rollback-command",
      requestDigest: "rollback-diff",
      actualVersion: "v0",
    };
    const readback = {
      ...e.readback,
      readbackId: "rollback-read",
      actualVersion: "v0",
      actualDiffDigest: "rollback-diff",
      observedAt: 24,
    };
    expect(
      good(step(e.intent, { type: "rollback", receipt: rollbackReceipt, readback }, e.approval, 25))
        .state,
    ).toBe("rolled_back");
    expect(
      step(
        e.intent,
        {
          type: "rollback",
          receipt: rollbackReceipt,
          readback: { ...readback, actualVersion: "wrong" },
        },
        e.approval,
        25,
      ),
    ).toMatchObject({ ok: false, reason: "rollback_readback_mismatch" });
  });
  it("retains failed control receipts as history", () => {
    const { approval, intent } = approved();
    const result = step(intent, { type: "receipt", receipt: receipt("failed") }, approval);
    expect(result.intent.receipts).toHaveLength(1);
    expect(result.intent.state).toBe("failed");
  });
  it("isolates the intent from mutable caller input", () => {
    const mutable = { ...target };
    const intent = createActionIntent(
      {
        actionIntentId: "copy",
        findingRef: { findingId: "f", source: "rule_v1" },
        evidence,
        target: mutable,
      },
      10,
    );
    mutable.diffDigest = "changed";
    expect(intent.target.diffDigest).toBe("diff");
  });
  it("does not trust forged test environment strings or another factory", () => {
    const forged = createActionIntent(
      {
        actionIntentId: "forged",
        findingRef: { findingId: "f", source: "rule_v1" },
        evidence,
        target,
      },
      10,
    );
    expect(
      transitionActionIntent(
        forged,
        { type: "preview" },
        { now: 20, expectedRevision: 0, approval: null },
      ),
    ).toMatchObject({ ok: false, reason: "needs_evidence" });
    expect(
      factory.transition(
        forged,
        { type: "preview" },
        { now: 20, expectedRevision: 0, approval: null },
      ),
    ).toMatchObject({ ok: false, reason: "needs_evidence" });
    expect(createTestActionIntentFactory().owns(fresh())).toBe(false);
  });
  it("binds verification metric and denominator definition to baseline evidence", () => {
    const e = effective();
    const verification = {
      verificationId: "v",
      metricDictVersion: 1,
      metricId: "test.metric",
      denominatorDefinition: "eligible test samples",
      cohortRef: "injected-cohort",
      baselineWindow: { from: 0, to: 10 },
      candidateWindow: { from: 22, to: 32 },
      baselineDenominator: 10,
      candidateDenominator: 10,
      eligible: true,
      passed: true,
      observedAt: 33,
    };
    for (const bad of [
      { ...verification, metricId: "other" },
      { ...verification, denominatorDefinition: "all calls" },
      { ...verification, baselineWindow: { from: 1, to: 11 } },
    ]) {
      expect(step(e.intent, { type: "verify", verification: bad }, e.approval, 34)).toMatchObject({
        ok: false,
        reason: "verification_mismatch",
      });
    }
  });
  it("prevents owned intent mutation and refuses restored forged verified records", () => {
    const intent = fresh();
    expect(Reflect.set(intent, "state", "verified")).toBe(false);
    expect(Reflect.set(intent.target, "diffDigest", "forged")).toBe(false);
    const restored = JSON.parse(JSON.stringify({ ...intent, state: "verified" })) as ActionIntent;
    expect(factory.owns(restored)).toBe(false);
    expect(step(restored, { type: "preview" }).ok).toBe(false);
  });
  it("blocks legacy missing-agent and cross-agent sample references", () => {
    for (const agentId of [undefined, "other"]) {
      const intent = factory.create(
        {
          actionIntentId: "legacy",
          findingRef: { findingId: "f", source: "rule_v1" },
          target,
          evidence: {
            ...evidence,
            sampleRefs: evidence.sampleRefs.map((ref) => ({ ...ref, agentId })),
          },
        },
        10,
      );
      expect(step(intent, { type: "preview" })).toMatchObject({
        ok: false,
        reason: "needs_evidence",
      });
    }
  });
});
