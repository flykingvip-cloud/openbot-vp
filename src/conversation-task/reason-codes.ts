/**
 * ConversationTask Runtime — stable, explainable reason codes (P0 contract).
 *
 * Every Detection / Qualification decision must be explainable by a fixed set of
 * reason codes so decisions are auditable and replayable (§5.2, §13). These are
 * part of the frozen contract: values are stable identifiers, safe to log in the
 * shadow decision log without leaking raw user text.
 */

export const REASON = {
  // Detection ---------------------------------------------------------------
  NO_STRONG_SIGNAL: "no_strong_signal",
  STRONG_SIGNAL_PRESENT: "strong_signal_present",
  SINGLE_SIGNAL_LOW_CONFIDENCE: "single_signal_low_confidence",
  MULTI_SIGNAL_HIGH_CONFIDENCE: "multi_signal_high_confidence",

  // Qualification: chat / short action -------------------------------------
  PLAIN_QUESTION_IS_CHAT: "plain_question_is_chat",
  COMPLETABLE_IN_CURRENT_RUN: "completable_in_current_run",
  SINGLE_ACTION_NO_PERSISTENT_STATE: "single_action_no_persistent_state",

  // Qualification: reminder / scheduled ------------------------------------
  REMINDER_HUMAN_NUDGE: "reminder_human_nudge",
  SCHEDULED_ONE_SHOT_ACTION: "scheduled_one_shot_action",
  RECURRING_FIXED_ACTION_NOT_L2: "recurring_fixed_action_not_l2",

  // Qualification: long-running candidate -----------------------------------
  PERSISTENT_STATE_WITH_CONTINUATION: "persistent_state_with_continuation",
  MULTI_CYCLE_MONITORING: "multi_cycle_monitoring",
  CANNOT_COMPLETE_IN_ONE_RUN: "cannot_complete_in_one_run",
  EXPLICIT_MULTI_STEP_WORKFLOW: "explicit_multi_step_workflow",

  // Single-signal insufficiency guards (§6) ---------------------------------
  FUTURE_INTENT_ALONE_NOT_L2: "future_intent_alone_not_l2",
  DELIVERABLE_ALONE_MAY_BE_L1: "deliverable_alone_may_be_l1",
  WAIT_CONDITION_IS_TURN_GATE: "wait_condition_is_turn_gate",
  RECURRING_ALONE_NOT_L2: "recurring_alone_not_l2",

  // Clarification -----------------------------------------------------------
  WAIT_WITHOUT_GOAL_NEEDS_CLARIFICATION: "wait_without_goal_needs_clarification",
  REVISION_WITHOUT_TARGET_TASK: "revision_without_target_task",
  MISSING_GOAL: "missing_goal",

  // Authorization / side effects (§5.4) -------------------------------------
  SIDE_EFFECT_REQUIRES_AUTHORIZATION: "side_effect_requires_authorization",
  SIDE_EFFECT_ORTHOGONAL_TO_DURATION: "side_effect_orthogonal_to_duration",
  BROADCAST_REQUIRES_HUMAN_GATE: "broadcast_requires_human_gate",

  // Robustness --------------------------------------------------------------
  MODEL_SELF_CLAIM_IGNORED: "model_self_claim_ignored",
  DUPLICATE_DELIVERY_IDEMPOTENT: "duplicate_delivery_idempotent",
} as const;

export type ReasonCode = (typeof REASON)[keyof typeof REASON];

/** All reason-code values, for validation/tests. */
export const ALL_REASON_CODES: readonly ReasonCode[] = Object.values(REASON);

const REASON_CODE_SET: ReadonlySet<string> = new Set(ALL_REASON_CODES);

export function isReasonCode(value: string): value is ReasonCode {
  return REASON_CODE_SET.has(value);
}
