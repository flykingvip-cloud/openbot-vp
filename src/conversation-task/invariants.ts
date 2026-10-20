/**
 * ConversationTask Runtime — invariants + threat model (P0).
 *
 * These invariants freeze the boundaries so the system can never (a) run a dual
 * state machine alongside the Progress Ledger, (b) escalate privilege via task
 * activation, or (c) open an execution account for ordinary chat. Each invariant
 * is a machine-checkable pure function; P1 uses them as guards and tests pin them
 * with positive/negative examples.
 *
 * Threat model (what each invariant defends against):
 *  - CT1  Candidate escalation: a "candidate" quietly carrying execution / ledger
 *         / agent / authorization capability, i.e. a task in disguise.
 *  - CT2  Dual state: ConversationTask growing execution runtime fields, forking a
 *         second progress truth away from the Progress Ledger.
 *  - CT3  Impure qualification: a classifier that also mutates / creates state.
 *  - CT4  Over-upgrade: a single strong signal (future / wait / recurring /
 *         deliverable) minting an L2 long-running task. Over-upgrade destroys
 *         Upgrade Precision and floods users with false tasks.
 *  - CT5  Side-effect leakage into duration: "send to everyone" making a task
 *         look long-running instead of a short action needing authorization.
 *  - CT6  Activation shortcut: activating without all three minimum conditions.
 *  - CT7  Authorization confusion: treating an active task as authorized to cause
 *         external side effects. Fail closed.
 *  - CT8  Idempotency loss: a redelivered message creating duplicate candidates /
 *         decisions.
 *  - CT9  Self-report as fact: a model claim of completion changing acceptance.
 *  - CT10 Shadow escape: a shadow decision being usable as a real activation, or a
 *         forbidden flag (activation/projection/authorization) enabled in P0/P1.
 *  - CT11 Mission smuggling: minting a collaboration Mission inside the personal
 *         assistant scope (must be the separate P7 spec).
 */

import { ConversationTaskInvariantError } from "./errors.js";
import { SHADOW_FORBIDDEN_FLAGS, type ConversationTaskFlags } from "./feature.js";
import { REASON, type ReasonCode } from "./reason-codes.js";
import {
  CANDIDATE_FORBIDDEN_CAPABILITIES,
  CONVERSATION_TASK_FORBIDDEN_FIELDS,
  countSignals,
  type ActivationConditions,
  type ActivationDecision,
  type AuthorizationState,
  type ConversationTask,
  type QualificationKind,
  type QualificationResult,
  type ShadowDecisionLog,
  type SideEffectClass,
  type TaskCandidate,
  type TaskSignals,
} from "./types.js";

export type ConversationTaskInvariantId =
  | "CT1"
  | "CT2"
  | "CT3"
  | "CT4"
  | "CT5"
  | "CT6"
  | "CT7"
  | "CT8"
  | "CT9"
  | "CT10"
  | "CT11";

export type InvariantViolation = {
  id: ConversationTaskInvariantId;
  message: string;
};

function fail(id: ConversationTaskInvariantId, message: string): never {
  throw new ConversationTaskInvariantError(id, message);
}

// ---------------------------------------------------------------------------
// CT1 — Candidate boundary
// ---------------------------------------------------------------------------

/** A Candidate must not carry any execution / ledger / agent / auth capability. */
export function assertCandidateBoundary(candidate: TaskCandidate): void {
  const record = candidate as unknown as Record<string, unknown>;
  for (const cap of CANDIDATE_FORBIDDEN_CAPABILITIES) {
    if (record[cap] !== undefined) {
      fail("CT1", `candidate must not carry capability "${cap}"`);
    }
  }
  if (candidate.kind !== "candidate") {
    fail("CT1", `candidate.kind must be "candidate"`);
  }
}

// ---------------------------------------------------------------------------
// CT2 — ConversationTask carries no execution runtime state
// ---------------------------------------------------------------------------

export function assertConversationTaskBoundary(task: ConversationTask): void {
  const record = task as unknown as Record<string, unknown>;
  for (const field of CONVERSATION_TASK_FORBIDDEN_FIELDS) {
    if (record[field] !== undefined) {
      fail("CT2", `ConversationTask must not carry execution field "${field}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// CT3 — Qualification is pure (result shape only)
// ---------------------------------------------------------------------------

const QUALIFICATION_ALLOWED_KEYS: ReadonlySet<string> = new Set(["kind", "reasons", "missing"]);

export function assertQualificationPure(result: QualificationResult): void {
  for (const key of Object.keys(result)) {
    if (!QUALIFICATION_ALLOWED_KEYS.has(key)) {
      fail("CT3", `qualification result carries side-channel key "${key}"`);
    }
  }
  if (result.kind === "needs_clarification" && !("missing" in result)) {
    fail("CT3", "needs_clarification must list missing fields");
  }
}

// ---------------------------------------------------------------------------
// CT4/CT5/CT6 — no single strong signal upgrades to L2
// ---------------------------------------------------------------------------

/**
 * A duration-suggestive signal on its own must never yield
 * `long_running_candidate`. This is the core precision guard: future intent,
 * wait condition, recurring intent, and deliverable are each individually
 * insufficient (§6).
 */
export function assertNoInsufficientUpgrade(signals: TaskSignals, kind: QualificationKind): void {
  if (kind !== "long_running_candidate") {
    return;
  }
  // A genuine L2 needs persistent evaluation state, or an explicit multi-step
  // plan (hasMultipleStages), plus a continuation driver. One lone duration
  // signal (future / wait / recurring / deliverable) is still not enough.
  const continuationDrivers =
    Number(signals.hasRecurringIntent) +
    Number(signals.hasWaitCondition) +
    Number(signals.hasMultipleStages);
  if (!signals.hasPersistentState && !signals.hasMultipleStages) {
    fail("CT4", "long_running_candidate requires persistent state or an explicit multi-step plan");
  }
  if (continuationDrivers === 0) {
    fail("CT5", "long_running_candidate requires a continuation driver");
  }
  if (countSignals(signals) < 2 && !signals.hasMultipleStages) {
    fail("CT6", "long_running_candidate requires more than one strong signal");
  }
}

// ---------------------------------------------------------------------------
// CT7 — side effect is orthogonal to duration; authorization fails closed
// ---------------------------------------------------------------------------

/**
 * Adding/removing an external side effect must not change the qualification kind.
 * Callers pass the kind computed with and without the side effect.
 */
export function assertSideEffectOrthogonal(
  kindWithoutSideEffect: QualificationKind,
  kindWithSideEffect: QualificationKind,
): void {
  if (kindWithoutSideEffect !== kindWithSideEffect) {
    fail(
      "CT7",
      `side effect changed qualification (${kindWithoutSideEffect} -> ${kindWithSideEffect})`,
    );
  }
}

/**
 * Resolve authorization from side-effect class. Fail closed: any side effect
 * without an explicit grant requires a Human Gate. Task duration never appears
 * here (§5.4).
 */
export function resolveAuthorization(
  sideEffect: SideEffectClass,
  granted: boolean,
): AuthorizationState {
  if (sideEffect === "none") {
    return "none";
  }
  return granted ? "authorized" : "human_gate_required";
}

// ---------------------------------------------------------------------------
// CT6-activation — Activation requires all three minimum conditions
// ---------------------------------------------------------------------------

export function evaluateActivation(conditions: ActivationConditions): ActivationDecision {
  const reasons: string[] = [];
  if (!conditions.hasClearGoal) {
    reasons.push(REASON.MISSING_GOAL);
  }
  if (!conditions.hasContinuousExecutionReason) {
    reasons.push(REASON.FUTURE_INTENT_ALONE_NOT_L2);
  }
  if (!conditions.hasPersistableState) {
    reasons.push(REASON.SINGLE_ACTION_NO_PERSISTENT_STATE);
  }
  const canActivate =
    conditions.hasClearGoal &&
    conditions.hasContinuousExecutionReason &&
    conditions.hasPersistableState;
  if (canActivate) {
    reasons.push(REASON.PERSISTENT_STATE_WITH_CONTINUATION);
  }
  return { canActivate, conditions, reasons };
}

export function assertActivationRequiresAllConditions(decision: ActivationDecision): void {
  const { conditions, canActivate } = decision;
  const all =
    conditions.hasClearGoal &&
    conditions.hasContinuousExecutionReason &&
    conditions.hasPersistableState;
  if (canActivate !== all) {
    fail("CT6", "activation must hold iff all three minimum conditions hold");
  }
}

// ---------------------------------------------------------------------------
// CT8 — idempotency across redelivered messages
// ---------------------------------------------------------------------------

/**
 * Given decision logs keyed by message id, the same message id must always carry
 * the identical decision. Detects duplicate-delivery drift.
 */
export function assertIdempotentDecisions(
  entries: readonly { messageId: string; log: ShadowDecisionLog }[],
): void {
  const seen = new Map<string, ShadowDecisionLog>();
  for (const { messageId, log } of entries) {
    const prior = seen.get(messageId);
    if (!prior) {
      seen.set(messageId, log);
      continue;
    }
    if (
      prior.qualification !== log.qualification ||
      prior.detected !== log.detected ||
      prior.inputFingerprint !== log.inputFingerprint
    ) {
      fail("CT8", `message ${messageId} produced non-idempotent decisions`);
    }
  }
}

// ---------------------------------------------------------------------------
// CT9 — model self-claims are not facts
// ---------------------------------------------------------------------------

const COMPLETION_CLAIM_PATTERNS: readonly RegExp[] = [
  /已经?[^,，。]{0,6}(完成|做完|处理完|生成好|发出去|发送完|搞定|弄好|办好)/,
  /(完成|做完|发出去|搞定|弄好|办好|处理完)(了|啦)/,
  /\bdone\b/i,
  /\bcompleted\b/i,
  /\bfinished\b/i,
];

/** True when text looks like a self-reported completion claim. */
export function isModelCompletionClaim(text: string): boolean {
  return COMPLETION_CLAIM_PATTERNS.some((re) => re.test(text));
}

/**
 * A completion claim must map to a no-op decision (chat, with the claim ignored
 * reason). It must never flip acceptance or write a ledger.
 */
export function assertCompletionClaimIgnored(
  kind: QualificationKind,
  reasonCodes: readonly ReasonCode[],
): void {
  if (kind === "long_running_candidate" || kind === "scheduled_action") {
    fail("CT9", "a model completion claim must not create/advance a task");
  }
  if (!reasonCodes.includes(REASON.MODEL_SELF_CLAIM_IGNORED)) {
    fail("CT9", "a model completion claim must be explicitly marked ignored");
  }
}

// ---------------------------------------------------------------------------
// CT10 — shadow-only
// ---------------------------------------------------------------------------

export function assertShadowOnly(log: ShadowDecisionLog, flags: ConversationTaskFlags): void {
  if (!log.shadowOnly) {
    fail("CT10", "decision log must be shadow-only");
  }
  for (const flag of SHADOW_FORBIDDEN_FLAGS) {
    if (flags[flag]) {
      fail("CT10", `flag "${flag}" must stay OFF during P0/P1 shadow mode`);
    }
  }
}

// ---------------------------------------------------------------------------
// CT11 — no Mission in personal-assistant scope
// ---------------------------------------------------------------------------

export function assertNoMissionInPersonalScope(kind: string): void {
  if (kind === "mission") {
    fail("CT11", "personal assistant scope must not mint a Mission (P7 only)");
  }
}
