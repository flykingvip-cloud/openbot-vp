/**
 * ConversationTask Runtime — Activation Gate (P2, per p2-design-freeze.md §5.3
 * and p2-ops-review.md O2).
 *
 * The gate turns a qualified `long_running_candidate` into an active
 * ConversationTask — exactly once — but only when: (a) all three minimum
 * activation conditions hold (CT6), (b) the `activation` flag is ON, and (c) the
 * caller passes the fail-closed ACL. It creates nothing else: no Progress Ledger,
 * no Agent, no notification, no external side effect.
 *
 * freeze-read-only (O2): when `activation` is OFF the gate computes the decision
 * in shadow but never writes. Existing active tasks stay readable and are neither
 * advanced nor deleted; `frozenActiveTaskCount` exposes how many active tasks are
 * currently frozen. Turning the flag back on is idempotent — re-running the gate
 * for an already-active tuple returns `already_active`, never a duplicate.
 */

import {
  assertConversationTaskAccess,
  assertDetectionScope,
  assertTenantStoreBinding,
  type ConversationTaskAccess,
} from "./acl.js";
import type { ActivationControlPlane } from "./control-plane.js";
import type { ConversationTaskFlags } from "./feature.js";
import {
  assertActivationRequiresAllConditions,
  assertConversationTaskBoundary,
  evaluateActivation,
} from "./invariants.js";
import { REASON } from "./reason-codes.js";
import { analyzeTurn, type TurnFeatures } from "./signals.js";
import type { StoredConversationTask, TaskStore } from "./store.js";
import type {
  ActivationConditions,
  ActivationDecision,
  ConversationTask,
  ConversationTurnInput,
  QualificationResult,
} from "./types.js";

export type ActivationMode =
  | "shadow_frozen" // activation flag OFF: decision computed, nothing written
  | "activated" // created a new active task this call
  | "already_active" // an active task for this tuple already existed (idempotent)
  | "not_eligible"; // qualification/conditions do not warrant a task

export type ActivationGateInput = {
  turn: ConversationTurnInput;
  qualification: QualificationResult;
  /** Precomputed features (defaults to `analyzeTurn(turn)`). */
  features?: TurnFeatures;
  access: ConversationTaskAccess;
  /**
   * Trusted identity of the conversation the source message belongs to, supplied
   * by the gateway (never derived from message content). Checked against the
   * bound conversation via `assertDetectionScope` before any write, so a message
   * smuggled from another conversation is refused.
   */
  messageConversationId: string;
  /** Monotonic activation epoch for this conversation goal (part of the key). */
  activationEpoch: number;
  ownerId?: string;
};

export type ActivationOutcome = {
  activated: boolean;
  mode: ActivationMode;
  decision: ActivationDecision;
  reasons: readonly string[];
  task?: StoredConversationTask;
};

/**
 * Derive the three minimum activation conditions from turn features. A clear goal
 * plus a continuation driver plus persistable state — never a lone signal.
 */
export function deriveActivationConditions(features: TurnFeatures): ActivationConditions {
  const { signals } = features;
  return {
    hasClearGoal: features.hasGoalOrAction || features.monitorIntent,
    hasContinuousExecutionReason:
      signals.hasRecurringIntent ||
      signals.hasWaitCondition ||
      signals.hasMultipleStages ||
      features.monitorIntent ||
      features.explicitWorkflow,
    // An explicit multi-step plan is persistable step-state across runs.
    hasPersistableState: signals.hasPersistentState || features.explicitWorkflow,
  };
}

/** Map a stored row to the domain ConversationTask (for CT2 boundary assertion). */
function toConversationTask(stored: StoredConversationTask): ConversationTask {
  return {
    id: String(stored.id),
    conversationId: stored.conversationId,
    requesterId: stored.requesterId,
    ownerId: stored.ownerId ?? undefined,
    goal: stored.goal,
    acceptanceRules: [],
    lifecycle: stored.lifecycle,
    createdAtMs: stored.createdAtMs,
    updatedAtMs: stored.updatedAtMs,
  };
}

/**
 * Run the Activation Gate. Pure with respect to everything except the (optional)
 * single `createTaskIfAbsent` write, which only happens when the flag is ON, the
 * ACL passes, and the decision can activate.
 */
export function runActivationGate(
  store: TaskStore,
  input: ActivationGateInput,
  flags: ConversationTaskFlags,
  controlPlane: ActivationControlPlane,
): ActivationOutcome {
  const features = input.features ?? analyzeTurn(input.turn);
  const conditions = deriveActivationConditions(features);
  const decision = evaluateActivation(conditions);
  assertActivationRequiresAllConditions(decision);

  // Only a long-running candidate can ever become a ConversationTask in P2.
  if (input.qualification.kind !== "long_running_candidate") {
    return {
      activated: false,
      mode: "not_eligible",
      decision,
      reasons: [REASON.SINGLE_ACTION_NO_PERSISTENT_STATE],
    };
  }

  // Effective activation = flag ON and not force-disabled in the shared, durable
  // control plane. The control plane is a REQUIRED argument, so this check cannot
  // be bypassed by omitting a parameter, and it reads the same state the degrade
  // controller writes (persists across restart / shared across instances).
  const forcedOff = controlPlane.isForcedOff();
  const activationEnabled = flags.activation && !forcedOff;

  // freeze-read-only: activation OFF (flag off or force-disabled) => compute
  // decision, write nothing.
  if (!activationEnabled) {
    return {
      activated: false,
      mode: "shadow_frozen",
      decision,
      reasons: [...decision.reasons, forcedOff ? "activation_force_off" : "activation_flag_off"],
    };
  }

  // Write path — enforce ALL fail-closed guards before any write:
  //  1. tenant / conversation / employee scope,
  //  2. access tenant must equal the opened store tenant (P0: cross-tenant write),
  //  3. detection secondary scope: the source message must be from the bound,
  //     authorized conversation (P0: cross-conversation input).
  assertConversationTaskAccess(input.access);
  assertTenantStoreBinding(input.access.tenantId, store.tenantId);
  assertDetectionScope(input.access, input.messageConversationId);

  if (!decision.canActivate) {
    return { activated: false, mode: "not_eligible", decision, reasons: decision.reasons };
  }

  const { created, task } = store.createTaskIfAbsent({
    conversationId: input.access.conversationId,
    goal: input.turn.text,
    sourceMessageId: input.turn.messageId,
    activationEpoch: input.activationEpoch,
    requesterId: input.access.requesterId,
    ownerId: input.ownerId,
    lifecycle: "active",
  });
  // CT2: a persisted task must never carry execution runtime state.
  assertConversationTaskBoundary(toConversationTask(task));

  return {
    activated: created,
    mode: created ? "activated" : "already_active",
    decision,
    reasons: decision.reasons,
    task,
  };
}

/**
 * Count active tasks that are currently frozen (activation OFF). Zero when
 * activation is ON. Exposed as the O2 "frozen task count" observability metric.
 */
export function frozenActiveTaskCount(
  store: TaskStore,
  flags: ConversationTaskFlags,
  controlPlane: ActivationControlPlane,
): number {
  const activationEnabled = flags.activation && !controlPlane.isForcedOff();
  return activationEnabled ? 0 : store.countTasksByLifecycle("active");
}
