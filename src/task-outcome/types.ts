/**
 * TaskOutcome unified contract — frozen types (askOutcome P0).
 * Non-terminal query projection is always `incomplete`.
 * Durable terminals: success | failure | cancelled only.
 */

import type { TaskBudgetState } from "./budget.js";
import type { CapabilityModalitySnapshot } from "./capability-modality.js";

export const TASK_OUTCOME_SCHEMA_VERSION = "1.0.0" as const;
export const JUDGEMENT_POLICY_VERSION = "1.0.0" as const;

export type Lifecycle =
  | "active"
  | "awaiting_acceptance"
  | "awaiting_delivery"
  | "recovering"
  | "closed";

/** Durable terminals exclude incomplete. Incomplete is query projection only. */
export type TerminalJudgement = "success" | "failure" | "cancelled";
export type TaskJudgement = TerminalJudgement | "incomplete";

export type DecisiveRunStatus = "succeeded" | "failed" | "cancelled" | "timed_out" | "none";

export type DeliveryStatus =
  | "pending"
  | "blocked"
  | "delivered"
  | "delivery_unknown"
  | "failed"
  | "not_required";

export type AcceptanceStatus = "pending" | "passed" | "failed" | "not_required";

export type AcceptanceGate =
  | { status: "pending" | "passed" | "failed" }
  | { status: "not_required"; reason: string };

export type DeliveryGate =
  | { status: "pending" | "blocked" | "delivered" | "delivery_unknown" | "failed" }
  | { status: "not_required"; reason: string };

export type AttemptStatus = "succeeded" | "failed" | "cancelled" | "timed_out";

export type AttemptResult = {
  attemptId: string;
  runId: string;
  status: AttemptStatus;
  observedAt: string;
  toolObservations?: ReadonlyArray<{ toolName: string; ok: boolean; summary?: string }>;
  errorCode?: string;
};

export type RunResult = {
  runId: string;
  attemptIds: string[];
  effectiveAttemptId?: string;
  fencingToken: string;
  status: DecisiveRunStatus;
};

export type TrustedScope =
  | { kind: "personal"; personalDomainId: string; subjectRef: string; authzScopeRef: string }
  | {
      kind: "enterprise";
      enterpriseDomainId: string;
      tenantId: string;
      subjectRef: string;
      authzScopeRef: string;
    };

export type AcceptanceEvidence = {
  validatorId: string;
  validatorVersion: string;
  scope: string;
  /** Digest of accepted artifact or external receipt ref. */
  artifactDigestOrReceiptRef: string;
  taskContractVersion: string;
  executionVersion: string;
};

export type TaskContractKind =
  | "chat_turn"
  | "code"
  | "document"
  | "external_action"
  | "execution"
  | "unknown";

/**
 * W3: tip-durable task-type contract (same fields as chat-entry ResolvedTurnTaskContract).
 * Acceptance gates reuse resolveTurnTaskContract / resolveChatTurnCloseGates — do not fork.
 */
export type TaskContractIdentity = {
  id: string;
  version: string;
  kind: TaskContractKind;
  requiredValidators: readonly string[];
};

export type ChildAggregationPolicy =
  | { strategy: "all_required" }
  | { strategy: "quorum"; requiredCount: number }
  | { strategy: "any_required" };

export type ParentChildContract = {
  requiredChildTaskIds: string[];
  optionalChildTaskIds: string[];
  aggregation: ChildAggregationPolicy;
};

export type Entrypoint = "chat" | "gateway_agent" | "cron" | "cli" | "collab";

export type CloseReasonCode =
  | "accepted_and_delivered"
  | "acceptance_failed_stop"
  | "user_cancelled"
  | "authz_denied"
  | "provider_fault"
  | "delivery_failed"
  | "delivery_unconfirmed_close"
  | "prepare_failed"
  | "preflight_rejected"
  | "correction"
  | "run_failed"
  | "user_filtered"
  | "timeout"
  | "budget_exceeded"
  | "other";

export type TaskOutcomeRecord = {
  schemaVersion: typeof TASK_OUTCOME_SCHEMA_VERSION;
  taskContractVersion: string;
  judgementPolicyVersion: typeof JUDGEMENT_POLICY_VERSION;
  scope: TrustedScope;
  taskId: string;
  parentTaskId?: string;
  parentChild?: ParentChildContract;
  /**
   * W3: durable contract identity on tip; set_acceptance(not_required) refused when
   * kind≠chat_turn or validators present (gates still resolved via chat-entry).
   */
  taskContract?: TaskContractIdentity;
  /**
   * W3: tip projection of supervisor D-BUDGET (not a new ledger/prealloc/scheduler).
   * Exhaust → fail_closed(budget_exceeded); eligibility attribution=budget.
   */
  budget?: TaskBudgetState;
  entrypoint: Entrypoint;
  lifecycle: Lifecycle;
  decisiveRunStatus: DecisiveRunStatus;
  decisiveRunId?: string;
  decisiveAttemptId?: string;
  acceptance: AcceptanceGate;
  delivery: DeliveryGate;
  deliveryId?: string;
  acceptanceEvidence?: AcceptanceEvidence[];
  attempts: AttemptResult[];
  runs: RunResult[];
  reasonCode?: CloseReasonCode;
  reasonDetail?: string;
  /**
   * Structured capability modality (P1). Acceptance must consume this; do not
   * upgrade executor_unwired / incomplete into target-modality success from
   * reasonDetail strings alone.
   * Reuses CapabilityModalitySnapshot so persist / assess / transitions stay aligned.
   */
  capabilityModality?: CapabilityModalitySnapshot;
  outcomeVersion: number;
  previousOutcomeVersion?: number;
  revisionKind?: "new_execution" | "correction";
  revisionReason?: string;
  submittedBy: string;
  fencingToken?: string;
  leaseEpoch?: number;
  /** Only result service writes; incomplete when lifecycle !== closed. */
  taskJudgement: TaskJudgement;
  decidedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type OutcomeEventType =
  | "task.created"
  | "task.state_changed"
  | "task.closed"
  | "task.corrected";

export type OutcomeOutboxEvent = {
  eventId: string;
  taskId: string;
  outcomeVersion: number;
  eventType: OutcomeEventType;
  scopeKind: TrustedScope["kind"];
  scopeId: string;
  payloadRef: string;
  createdAt: string;
};

export type EvaluationEligibility = {
  countsSkillSuccessRate: boolean;
  countsGrowthNegative: boolean;
  countsModelStability: boolean;
  learningValue: "high" | "medium" | "low" | "none";
  attribution:
    | "capability"
    | "user_cancel"
    | "authz"
    | "provider"
    | "delivery"
    | "prepare"
    | "budget"
    | "other";
};

export type SubmitTransition =
  | {
      type: "create";
      entrypoint: Entrypoint;
      scope: TrustedScope;
      taskContractVersion: string;
      parentTaskId?: string;
      /** W3 optional tip contract identity. */
      taskContract?: TaskContractIdentity;
      /** W3 optional initial budget snapshot. */
      budget?: TaskBudgetState;
    }
  | {
      type: "record_attempt";
      attempt: AttemptResult;
      run: RunResult;
      expectedVersion: number;
      fencingToken: string;
    }
  | {
      type: "set_acceptance";
      acceptance: AcceptanceGate;
      evidence?: AcceptanceEvidence[];
      allowRetry: boolean;
      expectedVersion: number;
      fencingToken: string;
    }
  | {
      type: "set_delivery";
      delivery: DeliveryGate;
      deliveryId?: string;
      expectedVersion: number;
      fencingToken: string;
    }
  | {
      type: "cancel";
      expectedVersion: number;
      fencingToken?: string;
      reasonDetail?: string;
    }
  | {
      type: "close_unconfirmed_delivery";
      expectedVersion: number;
      fencingToken: string;
      reasonDetail: string;
    }
  | {
      type: "prepare_failed";
      reasonCode: "prepare_failed" | "preflight_rejected" | "authz_denied";
      reasonDetail?: string;
    }
  | {
      type: "fail_closed";
      reasonCode: CloseReasonCode;
      reasonDetail?: string;
      expectedVersion: number;
      fencingToken?: string;
    }
  | {
      type: "correction";
      expectedVersion: number;
      previousOutcomeVersion: number;
      authorizedBy: string;
      revisionReason: string;
      acceptance: AcceptanceGate;
      delivery: DeliveryGate;
      decisiveRunStatus?: DecisiveRunStatus;
    }
  | {
      /** W3: attach / replace tip task-type contract (acceptance identity). */
      type: "set_task_contract";
      taskContract: TaskContractIdentity;
      expectedVersion: number;
      fencingToken: string;
    }
  | {
      /** W3: set or replace tip budget snapshot (limits + spend). */
      type: "set_budget";
      budget: TaskBudgetState;
      expectedVersion: number;
      fencingToken: string;
    }
  | {
      /** W3: accumulate spend; tip updated; caller may then fail_closed on exhaustion. */
      type: "accumulate_budget_spend";
      costUsd?: number;
      iterations?: number;
      expectedVersion: number;
      fencingToken: string;
      nowMs?: number;
    }
  | {
      /**
       * Controlled path: mark target modality completed from real execution evidence.
       * Refuses executor_unwired / no_executable_candidates / unsupported.
       * Does not set acceptance — callers must still submit set_acceptance.
       */
      type: "mark_target_modality_completed";
      expectedVersion: number;
      fencingToken: string;
      evidence: {
        kind: "execution_artifact" | "run_completed" | "acceptance_artifact";
        digestOrRef: string;
        detail?: string;
      };
    };

export type SubmitFailure = {
  ok: false;
  code:
    | "version_conflict"
    | "stale_fencing"
    | "illegal_transition"
    | "terminal_protected"
    | "scope_mismatch"
    | "unauthorized_correction"
    | "evidence_stale"
    | "command_conflict"
    | "not_found";
  message: string;
  current?: TaskOutcomeRecord;
};

export type SubmitResult =
  | { ok: true; record: TaskOutcomeRecord; createdEvents: OutcomeOutboxEvent[] }
  | SubmitFailure;

export type { TaskBudgetState, TaskBudgetLimits } from "./budget.js";
