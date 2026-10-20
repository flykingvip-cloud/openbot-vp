/**
 * ConversationTask Runtime — frozen domain contracts (P0).
 *
 * This module encodes the boundaries and four-layer decision contracts from
 * `.kiro/specs/conversation-task-runtime/execution-plan.md`. It is **offline /
 * shadow-only**: nothing here creates a real ConversationTask, writes a Progress
 * Ledger, starts an Agent, or changes `chat.send` / Cron behavior. P0 freezes the
 * types; P1 adds deterministic Detection + Qualification over these types.
 *
 * The fact chain this runtime feeds (implemented incrementally P2+):
 *
 *   Candidate -> Qualification -> Activation -> ConversationTask
 *     -> Execution Events -> Progress Ledger -> Evidence -> Acceptance -> Projection
 *
 * Reuse note: execution facts live in the existing Progress Ledger
 * (`src/progress-ledger`). ConversationTask never carries execution runtime state.
 */

/** Decision-logic version. Bump when detector/qualifier semantics change. */
export const CONVERSATION_TASK_DECISION_VERSION = "ct-decision-2026-08-24";

// ---------------------------------------------------------------------------
// §4 Work types
// ---------------------------------------------------------------------------

/**
 * Work type taxonomy. Only `l2_long_running` may (after Activation, P2) create a
 * long-running Progress Ledger. Future time / step count / deliverable / external
 * access are **not** independently sufficient to reach `l2_long_running`.
 */
export type WorkType =
  | "l0_chat"
  | "l1_short_action"
  | "reminder"
  | "scheduled_action"
  | "l2_long_running";

export const WORK_TYPES: readonly WorkType[] = [
  "l0_chat",
  "l1_short_action",
  "reminder",
  "scheduled_action",
  "l2_long_running",
] as const;

/** Work types that never create a long-running Ledger on their own. */
export const NON_LEDGER_WORK_TYPES: readonly WorkType[] = [
  "l0_chat",
  "l1_short_action",
  "reminder",
  "scheduled_action",
] as const;

// ---------------------------------------------------------------------------
// §6 Task signals — the frozen deterministic strong-signal set (exactly 8)
// ---------------------------------------------------------------------------

/**
 * Deterministic strong signals. This set is **frozen**: P1 extracts exactly
 * these, no Intent LLM. Constraints (see §6):
 *  - `hasFutureIntent` alone must not imply L2.
 *  - `hasWaitCondition` may be only a Turn Contract blocking gate.
 *  - `hasDeliverable` may also be L1.
 *  - external side effects do not enter duration classification (only Authorization).
 */
export type TaskSignals = {
  hasFutureIntent: boolean;
  hasWaitCondition: boolean;
  hasMultipleStages: boolean;
  hasRecurringIntent: boolean;
  hasDeliverable: boolean;
  hasCrossTurnDependency: boolean;
  hasExplicitAcceptance: boolean;
  hasPersistentState: boolean;
};

export const TASK_SIGNAL_KEYS: readonly (keyof TaskSignals)[] = [
  "hasFutureIntent",
  "hasWaitCondition",
  "hasMultipleStages",
  "hasRecurringIntent",
  "hasDeliverable",
  "hasCrossTurnDependency",
  "hasExplicitAcceptance",
  "hasPersistentState",
] as const;

/** All signals false — the L0 baseline. */
export function emptyTaskSignals(): TaskSignals {
  return {
    hasFutureIntent: false,
    hasWaitCondition: false,
    hasMultipleStages: false,
    hasRecurringIntent: false,
    hasDeliverable: false,
    hasCrossTurnDependency: false,
    hasExplicitAcceptance: false,
    hasPersistentState: false,
  };
}

export function countSignals(signals: TaskSignals): number {
  return TASK_SIGNAL_KEYS.reduce((n, key) => (signals[key] ? n + 1 : n), 0);
}

// ---------------------------------------------------------------------------
// Detection input (bounded conversation state)
// ---------------------------------------------------------------------------

/** Turn Contract mode (mirrors existing Turn Contract; not owned here). */
export type TurnMode = "deliver" | "ask" | "wait" | "quiet" | "repair";

/**
 * A single conversation turn to evaluate. `messageId` is the idempotency key:
 * re-delivering the same turn must yield the identical decision and must not
 * create a second candidate/event (see invariant CT8).
 */
export type ConversationTurnInput = {
  messageId: string;
  text: string;
  /** Bounded prior-turn text, newest last. Detection uses only limited state. */
  priorTurns?: readonly string[];
  /** True when the conversation already has an active task the turn may modify. */
  hasActiveTaskBinding?: boolean;
  /** Current Turn Contract mode, when known. */
  turnMode?: TurnMode;
};

// ---------------------------------------------------------------------------
// §5.1 Detection
// ---------------------------------------------------------------------------

export type DetectionConfidence = "high" | "medium" | "low";

/**
 * Detection answers "is the user proposing a work item?". P1 builds only a
 * high-precision strong-signal detector: misses are allowed, mass over-detection
 * for recall is forbidden.
 */
export type DetectionResult = {
  detected: boolean;
  signals: TaskSignals;
  confidence: DetectionConfidence;
  reasons: readonly string[];
};

// ---------------------------------------------------------------------------
// §5.2 Qualification
// ---------------------------------------------------------------------------

/** Qualification result kinds (§5.2). Pure, explainable, replayable. */
export type QualificationKind =
  | "chat"
  | "short_action"
  | "reminder"
  | "scheduled_action"
  | "long_running_candidate"
  | "needs_clarification";

export const QUALIFICATION_KINDS: readonly QualificationKind[] = [
  "chat",
  "short_action",
  "reminder",
  "scheduled_action",
  "long_running_candidate",
  "needs_clarification",
] as const;

/**
 * Qualification answers "what class is this work?". It must not create a task,
 * write a Ledger, or start an Agent — the result carries only a kind and
 * explanations (plus `missing` for clarification).
 */
export type QualificationResult =
  | { kind: "chat"; reasons: readonly string[] }
  | { kind: "short_action"; reasons: readonly string[] }
  | { kind: "reminder"; reasons: readonly string[] }
  | { kind: "scheduled_action"; reasons: readonly string[] }
  | { kind: "long_running_candidate"; reasons: readonly string[] }
  | { kind: "needs_clarification"; missing: readonly string[]; reasons: readonly string[] };

/** Map a qualification kind to its work type (long_running_candidate => l2). */
export function workTypeForQualification(kind: QualificationKind): WorkType | undefined {
  switch (kind) {
    case "chat":
      return "l0_chat";
    case "short_action":
      return "l1_short_action";
    case "reminder":
      return "reminder";
    case "scheduled_action":
      return "scheduled_action";
    case "long_running_candidate":
      return "l2_long_running";
    case "needs_clarification":
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// §5.3 Activation (contract only — no runtime in P0/P1)
// ---------------------------------------------------------------------------

/**
 * The three minimum Activation conditions (§5.3). All must hold before a
 * Candidate may become an active ConversationTask. Evaluated only from P2.
 */
export type ActivationConditions = {
  /** A clear, standalone goal exists. */
  hasClearGoal: boolean;
  /** There is a reason execution must continue beyond the current run. */
  hasContinuousExecutionReason: boolean;
  /** There is persistable state (acceptance/deadline/wait/next action/schedule/…). */
  hasPersistableState: boolean;
};

export type ActivationDecision = {
  /** True only when all three conditions hold. Never true in shadow mode. */
  canActivate: boolean;
  conditions: ActivationConditions;
  reasons: readonly string[];
};

// ---------------------------------------------------------------------------
// §5.4 Authorization (orthogonal to task duration)
// ---------------------------------------------------------------------------

/** Authorization is independent of whether/how long a task runs. */
export type AuthorizationState = "none" | "authorized" | "human_gate_required";

/**
 * External side-effect classification. Side effects never influence work-type /
 * duration; they only drive Authorization and, when unauthorized, a Human Gate.
 */
export type SideEffectClass = "none" | "outbound_message" | "external_write" | "broadcast";

export const SIDE_EFFECT_CLASSES: readonly SideEffectClass[] = [
  "none",
  "outbound_message",
  "external_write",
  "broadcast",
] as const;

/** Side-effect classes that require explicit authorization (fail closed). */
export function requiresAuthorization(sideEffect: SideEffectClass): boolean {
  return sideEffect !== "none";
}

// ---------------------------------------------------------------------------
// §3.1 Task Candidate (boundary)
// ---------------------------------------------------------------------------

/**
 * A Candidate only expresses that the system suspects persistent work may be
 * forming. It is **not** a task. It must never: appear in the formal task list,
 * create a Ledger, start an Agent / send notifications, occupy long-term task
 * quota, or hold any external side-effect permission (§3.1, invariant CT1).
 *
 * Note the deliberate absence of execution / authorization / ledger fields.
 */
export type TaskCandidate = {
  readonly kind: "candidate";
  candidateId: string;
  conversationId: string;
  /** The turn that produced the candidate (idempotency anchor). */
  sourceMessageId: string;
  detection: DetectionResult;
  qualification: QualificationResult;
  /** Lifecycle within the Candidate stage only. */
  status: TaskCandidateStatus;
  createdAtMs: number;
};

export type TaskCandidateStatus = "observing" | "discarded" | "classified";

/**
 * Capability names a Candidate must never carry. Used by the runtime guard in
 * `invariants.ts` to fail closed if a candidate object is ever built with them.
 */
export const CANDIDATE_FORBIDDEN_CAPABILITIES: readonly string[] = [
  "steps",
  "progress",
  "evidence",
  "ledger",
  "ledgerId",
  "agent",
  "agentId",
  "authorization",
  "sideEffectGrant",
  "notify",
  "quota",
] as const;

// ---------------------------------------------------------------------------
// §7 ConversationTask (contract) — identity, ownership, goal, lifecycle
// ---------------------------------------------------------------------------

export type ConversationTaskLifecycle = "draft" | "active" | "closed" | "cancelled";

export type AcceptanceRule = {
  id: string;
  text: string;
};

export type ScheduleSpec = {
  /** Cron expression or ISO instant; interpreted by the scheduler (P2+). */
  expression: string;
  timezone?: string;
};

export type DeliverySpec = {
  channel: string;
  target?: string;
};

/**
 * ConversationTask carries identity / ownership / goal / lifecycle / conversation
 * binding and Revision history only. It must **not** carry execution runtime
 * state (`steps`, `progress`, `evidence`, `waiting`, `blocked`, `running`) — those
 * live in the Progress Ledger. Enforced by invariant CT-NO-EXEC-STATE.
 */
export type ConversationTask = {
  id: string;
  conversationId: string;
  requesterId: string;
  ownerId?: string;
  goal: string;
  acceptanceRules: readonly AcceptanceRule[];
  lifecycle: ConversationTaskLifecycle;
  deadlineAtMs?: number;
  schedule?: ScheduleSpec;
  delivery?: DeliverySpec;
  createdAtMs: number;
  updatedAtMs: number;
};

/** Field names that must never appear on a ConversationTask (execution state). */
export const CONVERSATION_TASK_FORBIDDEN_FIELDS: readonly string[] = [
  "steps",
  "progress",
  "evidence",
  "waiting",
  "blocked",
  "running",
  "ledger",
] as const;

// ---------------------------------------------------------------------------
// §8 Revision (append-only, no history overwrite)
// ---------------------------------------------------------------------------

export type TaskRevisionField = "goal" | "acceptance" | "deadline" | "delivery";

export type TaskRevisionReason = "user_change" | "system_replan" | "authorization_change";

export type TaskRevisionEvent = {
  taskId: string;
  revision: number;
  field: TaskRevisionField;
  previousValue: unknown;
  nextValue: unknown;
  reason: TaskRevisionReason;
  actorId: string;
  atMs: number;
};

// ---------------------------------------------------------------------------
// §3.3 Mission (boundary marker) — P7 only, never in personal-assistant scope
// ---------------------------------------------------------------------------

/**
 * Mission covers multi-agent / multi-employee / collaboration / delegation / joint
 * delivery. It is out of scope for the personal assistant and must be shipped as
 * the separate P7 spec. Represented here only as a boundary marker so guards can
 * reject any attempt to mint one in personal scope (invariant CT-NO-MISSION).
 */
export type MissionBoundaryMarker = {
  readonly kind: "mission";
  readonly scope: "collaboration_only";
};

// ---------------------------------------------------------------------------
// §14 Shadow decision log — privacy-safe, never an activation
// ---------------------------------------------------------------------------

/**
 * Shadow-only decision record. Logs reason codes, a privacy-safe input
 * fingerprint, decision version and result — never raw sensitive text. The
 * `shadowOnly: true` literal makes it type-impossible to reuse as an activation.
 */
export type ShadowDecisionLog = {
  readonly shadowOnly: true;
  decisionVersion: string;
  /** Stable non-reversible fingerprint of the input; not the raw text. */
  inputFingerprint: string;
  detected: boolean;
  confidence: DetectionConfidence;
  qualification: QualificationKind;
  signals: TaskSignals;
  sideEffect: SideEffectClass;
  authorization: AuthorizationState;
  reasonCodes: readonly string[];
  atMs: number;
};
