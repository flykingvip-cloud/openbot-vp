/** Correlation-only state machine. All effects and authority remain in existing control planes. */
export type ActionIntentState =
  | "draft"
  | "needs_evidence"
  | "previewed"
  | "authorized"
  | "accepted"
  | "executing"
  | "effective"
  | "verified"
  | "rolled_back"
  | "failed"
  | "blocked"
  | "conflict"
  | "rejected";
export type IntentTarget = {
  controlPlane: string;
  targetType: string;
  targetId: string;
  scopeRef: string;
  expectedConfigVersion: string;
  diffDigest: string;
  previewRef: string;
  rollbackPointRef: string;
  rollbackExpectedVersion: string;
  rollbackDiffDigest: string;
};
export type IntentEvidence = {
  sampleRefs: readonly {
    sampleId: string;
    taskId: string;
    outcomeVersion: number;
    agentId?: string;
  }[];
  metricDictVersion: number;
  metricId: string;
  denominatorDefinition: string;
  cohortRef: string;
  window: { from: number; to: number };
  eligibility: "eligible" | "ineligible" | "unknown";
  improvementEligible: boolean;
  environment: "production" | "test";
  provenance: "live" | "injected" | "seed" | "unknown";
  reasons: readonly string[];
};
export type ApprovalEvidence = {
  approvalId: string;
  actorRef: string;
  source: "user";
  intentRevision: number;
  target: IntentTarget;
  issuedAt: number;
  expiresAt: number;
  revokedAt: number | null;
};
export type ControlReceipt = {
  receiptId: string;
  commandId: string;
  idempotencyKey: string;
  requestDigest: string;
  intentRevision: number;
  target: IntentTarget;
  status: "accepted" | "executing" | "succeeded" | "failed";
  at: number;
  actualVersion: string | null;
};
export type ConfigReadback = {
  readbackId: string;
  controlPlane: string;
  targetId: string;
  scopeRef: string;
  actualVersion: string;
  actualDiffDigest: string;
  observedAt: number;
};
export type VerificationEvidence = {
  verificationId: string;
  metricDictVersion: number;
  metricId: string;
  denominatorDefinition: string;
  cohortRef: string;
  baselineWindow: { from: number; to: number };
  candidateWindow: { from: number; to: number };
  baselineDenominator: number;
  candidateDenominator: number;
  eligible: boolean;
  passed: boolean;
  observedAt: number;
};
export type AssociationRecoveryMetadata = {
  authorizationId: string;
  actorRef: string;
  action: "restore_association";
  expectedRevision: number;
  originalCommandId: string;
  applicationId: string;
  proposalId: string;
  experimentId: string;
  agentId: string;
  scopeDigest: string;
  actualVersion: string;
  actualDiffDigest: string;
  recoveredAt: number;
  recoveryCommandId: string;
  requestDigest: string;
};
export type ActionIntent = {
  associationRecovery?: AssociationRecoveryMetadata;
  schemaVersion: 1;
  actionIntentId: string;
  revision: number;
  state: ActionIntentState;
  findingRef: { findingId: string; source: "rule_v1" | "reasoning" };
  evidence: IntentEvidence;
  target: IntentTarget;
  approval: ApprovalEvidence | null;
  authorizedRevision: number | null;
  command: { commandId: string; idempotencyKey: string; requestDigest: string } | null;
  receipts: readonly ControlReceipt[];
  readback: ConfigReadback | null;
  verification: VerificationEvidence | null;
  rollback: { receipt: ControlReceipt; readback: ConfigReadback } | null;
  createdAt: number;
  updatedAt: number;
};
export type IntentEvent =
  | { type: "needs_evidence" }
  | { type: "preview" }
  | { type: "authorize"; approval: ApprovalEvidence }
  | { type: "receipt"; receipt: ControlReceipt }
  | { type: "readback"; readback: ConfigReadback }
  | { type: "verify"; verification: VerificationEvidence }
  | { type: "rollback"; receipt: ControlReceipt; readback: ConfigReadback };
export type TransitionResult =
  | { ok: true; intent: ActionIntent; replayed: boolean }
  | { ok: false; reason: string; intent: ActionIntent };
function targetKey(t: IntentTarget): string {
  return JSON.stringify([
    t.controlPlane,
    t.targetType,
    t.targetId,
    t.scopeRef,
    t.expectedConfigVersion,
    t.diffDigest,
    t.previewRef,
    t.rollbackPointRef,
    t.rollbackExpectedVersion,
    t.rollbackDiffDigest,
  ]);
}
function evidenceReady(e: IntentEvidence): boolean {
  return (
    e.eligibility === "eligible" &&
    e.improvementEligible &&
    e.sampleRefs.length > 0 &&
    e.sampleRefs.every(
      (s) =>
        s.sampleId && s.taskId && Number.isSafeInteger(s.outcomeVersion) && s.outcomeVersion > 0,
    ) &&
    Number.isSafeInteger(e.metricDictVersion) &&
    e.metricDictVersion > 0 &&
    Boolean(e.cohortRef && e.metricId && e.denominatorDefinition) &&
    Number.isFinite(e.window.from) &&
    Number.isFinite(e.window.to) &&
    e.window.from < e.window.to &&
    ((e.environment === "test" && e.provenance === "injected") ||
      (e.environment === "production" && e.provenance === "live"))
  );
}
export function createActionIntent(
  input: Pick<ActionIntent, "actionIntentId" | "findingRef" | "evidence" | "target">,
  now: number,
): ActionIntent {
  if (!Number.isFinite(now) || !input.actionIntentId || !input.findingRef.findingId) {
    throw new Error("invalid_intent");
  }
  return {
    schemaVersion: 1,
    ...structuredClone(input),
    revision: 0,
    state: "draft",
    approval: null,
    authorizedRevision: null,
    command: null,
    receipts: [],
    readback: null,
    verification: null,
    rollback: null,
    createdAt: now,
    updatedAt: now,
  };
}
/** Explicit clocks and optimistic revisions; failures preserve all historical facts. */
function reduceActionIntent(
  intent: ActionIntent,
  event: IntentEvent,
  context: { now: number; expectedRevision: number; approval: ApprovalEvidence | null },
  trustedTest: boolean,
): TransitionResult {
  const fail = (reason: string): TransitionResult => ({ ok: false, reason, intent });
  const { now } = context;
  if (!Number.isFinite(now) || now < intent.updatedAt) {
    return fail("invalid_clock");
  }
  if (context.expectedRevision !== intent.revision) {
    return fail("revision_conflict");
  }
  const next = (patch: Partial<ActionIntent>): TransitionResult => ({
    ok: true,
    replayed: false,
    intent: structuredClone({ ...intent, ...patch, revision: intent.revision + 1, updatedAt: now }),
  });
  if (event.type === "needs_evidence") {
    return intent.state === "draft"
      ? next({ state: "needs_evidence" })
      : fail("illegal_transition");
  }
  if (event.type === "preview") {
    if (!["draft", "needs_evidence"].includes(intent.state)) {
      return fail("illegal_transition");
    }
    if (
      !trustedTest ||
      !evidenceReady(intent.evidence) ||
      intent.evidence.sampleRefs.some(
        (ref) => !ref.agentId || ref.agentId !== intent.target.targetId,
      )
    ) {
      return fail("needs_evidence");
    }
    if (Object.values(intent.target).some((v) => !v.trim())) {
      return fail("incomplete_preview");
    }
    return next({ state: "previewed" });
  }
  if (
    !trustedTest ||
    !evidenceReady(intent.evidence) ||
    intent.evidence.sampleRefs.some((ref) => !ref.agentId || ref.agentId !== intent.target.targetId)
  ) {
    return fail("needs_evidence");
  }
  const approval = event.type === "authorize" ? event.approval : context.approval;
  const approvedRevision = event.type === "authorize" ? intent.revision : intent.authorizedRevision;
  if (
    !approval ||
    approval.source !== "user" ||
    !approval.actorRef ||
    !approval.approvalId ||
    approval.intentRevision !== approvedRevision ||
    targetKey(approval.target) !== targetKey(intent.target) ||
    !Number.isFinite(approval.issuedAt) ||
    !Number.isFinite(approval.expiresAt) ||
    approval.issuedAt > now ||
    approval.expiresAt <= now ||
    approval.revokedAt !== null
  ) {
    return fail("approval_invalid");
  }
  if (intent.approval && approval.approvalId !== intent.approval.approvalId) {
    return fail("approval_mismatch");
  }
  if (event.type === "authorize") {
    return intent.state === "previewed"
      ? next({ state: "authorized", approval, authorizedRevision: intent.revision })
      : fail("illegal_transition");
  }
  if (event.type === "receipt" || event.type === "rollback") {
    const r = event.receipt;
    if (
      r.intentRevision !== intent.authorizedRevision ||
      targetKey(r.target) !== targetKey(intent.target) ||
      !r.commandId ||
      !r.receiptId ||
      !r.idempotencyKey ||
      !r.requestDigest ||
      !Number.isFinite(r.at) ||
      r.at > now ||
      r.at < approval.issuedAt
    ) {
      return fail("receipt_mismatch");
    }
    if (event.type === "receipt") {
      if (
        intent.command &&
        (r.commandId !== intent.command.commandId ||
          r.idempotencyKey !== intent.command.idempotencyKey ||
          r.requestDigest !== intent.command.requestDigest)
      ) {
        return fail("idempotency_conflict");
      }
      const prior = intent.receipts.find((p) => p.receiptId === r.receiptId);
      if (prior) {
        return JSON.stringify(prior) === JSON.stringify(r)
          ? { ok: true, intent, replayed: true }
          : fail("receipt_conflict");
      }
      if (!["authorized", "accepted", "executing"].includes(intent.state)) {
        return fail("illegal_transition");
      }
      const previous = intent.receipts.at(-1);
      const rank = { accepted: 0, executing: 1, succeeded: 2, failed: 2 };
      if (
        previous &&
        (r.at < previous.at ||
          rank[r.status] < rank[previous.status] ||
          previous.status === "succeeded" ||
          previous.status === "failed")
      ) {
        return fail("receipt_out_of_order");
      }
      return next({
        state:
          r.status === "failed" ? "failed" : r.status === "accepted" ? "accepted" : "executing",
        command: {
          commandId: r.commandId,
          idempotencyKey: r.idempotencyKey,
          requestDigest: r.requestDigest,
        },
        receipts: [...intent.receipts, r],
      });
    }
    if (!["effective", "verified"].includes(intent.state) || r.status !== "succeeded") {
      return fail("rollback_receipt_required");
    }
    const read = event.readback;
    if (
      read.actualVersion !== intent.target.rollbackExpectedVersion ||
      r.actualVersion !== intent.target.rollbackExpectedVersion ||
      !validReadback(read, intent, r, now) ||
      read.actualDiffDigest !== intent.target.rollbackDiffDigest
    ) {
      return fail("rollback_readback_mismatch");
    }
    return next({ state: "rolled_back", rollback: { receipt: r, readback: read } });
  }
  if (event.type === "readback") {
    const receipt = intent.receipts.at(-1);
    if (intent.state !== "executing" || receipt?.status !== "succeeded" || !receipt.actualVersion) {
      return fail("successful_receipt_required");
    }
    if (
      !validReadback(event.readback, intent, receipt, now) ||
      event.readback.actualVersion !== receipt.actualVersion ||
      event.readback.actualDiffDigest !== intent.target.diffDigest
    ) {
      return fail("readback_mismatch");
    }
    return next({ state: "effective", readback: event.readback });
  }
  const v = event.verification;
  if (intent.state !== "effective" || !intent.readback) {
    return fail("effective_required");
  }
  const e = intent.evidence;
  const duration = (w: { from: number; to: number }) => w.to - w.from;
  if (
    !v.verificationId ||
    v.metricDictVersion !== e.metricDictVersion ||
    v.metricId !== e.metricId ||
    v.denominatorDefinition !== e.denominatorDefinition ||
    v.baselineWindow.from !== e.window.from ||
    v.baselineWindow.to !== e.window.to ||
    v.cohortRef !== e.cohortRef ||
    !v.eligible ||
    !v.passed ||
    !Number.isFinite(v.observedAt) ||
    v.observedAt > now ||
    v.observedAt < intent.readback.observedAt ||
    ![v.baselineDenominator, v.candidateDenominator].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    ![
      v.baselineWindow.from,
      v.baselineWindow.to,
      v.candidateWindow.from,
      v.candidateWindow.to,
    ].every(Number.isFinite) ||
    duration(v.baselineWindow) <= 0 ||
    duration(v.baselineWindow) !== duration(v.candidateWindow) ||
    v.candidateWindow.from < intent.readback.observedAt ||
    v.candidateWindow.to > v.observedAt
  ) {
    return fail("verification_mismatch");
  }
  return next({ state: "verified", verification: v });
}
function validReadback(
  read: ConfigReadback,
  intent: ActionIntent,
  receipt: ControlReceipt,
  now: number,
): boolean {
  return (
    Boolean(read.readbackId) &&
    read.controlPlane === intent.target.controlPlane &&
    read.targetId === intent.target.targetId &&
    read.scopeRef === intent.target.scopeRef &&
    Number.isFinite(read.observedAt) &&
    read.observedAt >= receipt.at &&
    read.observedAt <= now
  );
}

export function transitionActionIntent(
  intent: ActionIntent,
  event: IntentEvent,
  context: { now: number; expectedRevision: number; approval: ApprovalEvidence | null },
): TransitionResult {
  return reduceActionIntent(intent, event, context, false);
}
function freezeIntent(intent: ActionIntent): ActionIntent {
  const freeze = (value: unknown): void => {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      for (const item of Object.values(value)) {
        freeze(item);
      }
      Object.freeze(value);
    }
  };
  freeze(intent);
  return intent;
}
/** Internal test-environment port. Never expose this factory through RPC parameters. */
export function createTestActionIntentFactory() {
  const owned = new WeakSet<ActionIntent>();
  return {
    create(input: Parameters<typeof createActionIntent>[0], now: number): ActionIntent {
      if (input.evidence.environment !== "test" || input.evidence.provenance !== "injected") {
        throw new Error("test_evidence_required");
      }
      const intent = freezeIntent(createActionIntent(input, now));
      owned.add(intent);
      return intent;
    },
    owns(intent: ActionIntent): boolean {
      return owned.has(intent);
    },
    transition(
      intent: ActionIntent,
      event: IntentEvent,
      context: { now: number; expectedRevision: number; approval: ApprovalEvidence | null },
    ): TransitionResult {
      const result = reduceActionIntent(intent, event, context, owned.has(intent));
      if (result.ok) {
        freezeIntent(result.intent);
        owned.add(result.intent);
      }
      return result;
    },
  };
}
