/**
 * ConversationTask Runtime — pure Qualification (P1).
 *
 * Answers "what class is this work?" as a pure, explainable, replayable function
 * of the turn features. It creates nothing, writes nothing, starts nothing — it
 * only returns a kind plus reason codes. Ordering encodes the precision guards:
 * a self-claim, a revision, or a reminder is resolved before any upgrade, and an
 * L2 upgrade requires persistent state plus a continuation driver plus a concrete
 * goal (never a lone future/recurring/wait/deliverable signal), or an explicit
 * multi-step / multi-flow plan named by the user or their prompt.
 */

import { assertNoInsufficientUpgrade } from "./invariants.js";
import { REASON, type ReasonCode } from "./reason-codes.js";
import { analyzeTurn, type TurnFeatures } from "./signals.js";
import type { ConversationTurnInput, QualificationResult } from "./types.js";

/**
 * 输出 / 阅读 / 请先 / 调研 are not enough to open new work.
 * A stronger imperative or an explicit new-task marker must be present.
 */
const WEAK_NEW_WORK_CUE_RE = /输出|阅读|请先|调研/u;
const STRONGER_THAN_WEAK_CUE_RE =
  /不要做刚才|别做刚才|先放下|换[一个]个?题|现在改做|新任务|请不要先问我|请使用\s*[\w.-]+|做一次|生成今日|先出|交接给|另外[帮再]|调研问题[:：]|任务目标[:：]|请做|整理|起草|写一|出一份|分析|制作|列出/u;

export function isWeakNewWorkCueOnly(text: string): boolean {
  const compact = text.replace(/\s+/g, "").trim();
  if (!compact || !WEAK_NEW_WORK_CUE_RE.test(compact)) {
    return false;
  }
  return !STRONGER_THAN_WEAK_CUE_RE.test(compact);
}

/**
 * Intra-turn one-shot dressed as "分三步翻译/查一下". Explicit workflow
 * labels must not upgrade work that still completes in the current run.
 */
function isIntraTurnOneShot(features: TurnFeatures): boolean {
  return (
    features.leadImmediateAction &&
    !features.produceSendVerb &&
    !features.monitorIntent &&
    !features.signals.hasDeliverable &&
    !features.signals.hasWaitCondition &&
    !features.signals.hasRecurringIntent &&
    !features.signals.hasPersistentState
  );
}

/** True when the turn is a genuine long-running (L2) candidate. */
export function isLongRunningCandidate(features: TurnFeatures): boolean {
  const { signals } = features;
  const driver =
    signals.hasRecurringIntent || signals.hasWaitCondition || signals.hasMultipleStages;
  const base = features.monitorIntent || (signals.hasPersistentState && features.hasGoalOrAction);
  if (base && driver) {
    return true;
  }
  return features.explicitWorkflow && features.hasGoalOrAction && !isIntraTurnOneShot(features);
}

function sideEffectReason(features: TurnFeatures): ReasonCode[] {
  return features.sideEffect === "none" ? [] : [REASON.SIDE_EFFECT_ORTHOGONAL_TO_DURATION];
}

export function qualifyTurn(
  input: ConversationTurnInput,
  features = analyzeTurn(input),
): QualificationResult {
  const { signals } = features;

  // A model self-claim of completion is never a fact; it advances nothing. Past-
  // tense completion words (生成好/发出去了) are part of the claim, not a request,
  // so only a fresh imperative overrides this.
  if (features.completionClaim && !features.imperativeRequest) {
    return { kind: "chat", reasons: [REASON.MODEL_SELF_CLAIM_IGNORED] };
  }

  // A revision targets an existing task; P1 does not resolve the binding (P3).
  if (features.revisionIntent) {
    return {
      kind: "needs_clarification",
      missing: ["target_task"],
      reasons: [REASON.REVISION_WITHOUT_TARGET_TASK],
    };
  }

  // A concept question ("怎么算的？") is chat even if it mentions an action verb.
  // An imperative ask or a monitor/reminder intent is not caught here.
  const isQuestion = /怎么|如何|什么是|为什么|是不是|[?？]\s*$/.test(input.text);
  if (
    isQuestion &&
    !features.imperativeRequest &&
    !features.monitorIntent &&
    !features.reminderIntent
  ) {
    return { kind: "chat", reasons: [REASON.PLAIN_QUESTION_IS_CHAT] };
  }

  // Reminder = nudge a human at a future time; no continuous agent execution.
  if (features.reminderIntent && signals.hasFutureIntent && !isLongRunningCandidate(features)) {
    return { kind: "reminder", reasons: [REASON.REMINDER_HUMAN_NUDGE] };
  }

  // Long-running candidate — the only path that (post-Activation, P2) makes a
  // long-running ledger. Guarded so no single signal can upgrade.
  if (isLongRunningCandidate(features)) {
    assertNoInsufficientUpgrade(signals, "long_running_candidate");
    const reasons: ReasonCode[] = [
      REASON.PERSISTENT_STATE_WITH_CONTINUATION,
      REASON.CANNOT_COMPLETE_IN_ONE_RUN,
    ];
    if (features.monitorIntent && signals.hasRecurringIntent) {
      reasons.push(REASON.MULTI_CYCLE_MONITORING);
    }
    if (features.explicitWorkflow) {
      reasons.push(REASON.EXPLICIT_MULTI_STEP_WORKFLOW);
    }
    return { kind: "long_running_candidate", reasons: [...reasons, ...sideEffectReason(features)] };
  }

  // Scheduled action = a fixed action at a future time (one-shot or recurring),
  // which recurrence/future alone must not escalate to L2.
  if (signals.hasFutureIntent && features.produceSendVerb) {
    const reasons: ReasonCode[] = signals.hasRecurringIntent
      ? [REASON.RECURRING_FIXED_ACTION_NOT_L2, REASON.RECURRING_ALONE_NOT_L2]
      : [REASON.SCHEDULED_ONE_SHOT_ACTION, REASON.FUTURE_INTENT_ALONE_NOT_L2];
    return { kind: "scheduled_action", reasons: [...reasons, ...sideEffectReason(features)] };
  }

  // Short action = reliably completable in the current run.
  if (features.leadImmediateAction || (features.produceSendVerb && !signals.hasFutureIntent)) {
    return {
      kind: "short_action",
      reasons: [
        REASON.COMPLETABLE_IN_CURRENT_RUN,
        REASON.SINGLE_ACTION_NO_PERSISTENT_STATE,
        ...sideEffectReason(features),
      ],
    };
  }

  // Wait with a continuation intent but no goal: cannot activate; ask what to do.
  if (
    signals.hasWaitCondition &&
    features.continuationIntent &&
    input.hasActiveTaskBinding !== true
  ) {
    return {
      kind: "needs_clarification",
      missing: ["goal"],
      reasons: [REASON.WAIT_WITHOUT_GOAL_NEEDS_CLARIFICATION],
    };
  }

  // Wait while an active task exists: this is a Turn Contract blocking gate.
  if (signals.hasWaitCondition && input.hasActiveTaskBinding === true) {
    return { kind: "chat", reasons: [REASON.WAIT_CONDITION_IS_TURN_GATE] };
  }

  return { kind: "chat", reasons: [REASON.PLAIN_QUESTION_IS_CHAT] };
}
