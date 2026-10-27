import {
  peekPendingLearningInjection,
  takePendingLearningInjection,
  type PendingLearningInjectionScope,
} from "../auto-reply/reply/learning-experience-pending.js";
import { recordLearningExperienceStageSafely } from "../auto-reply/reply/learning-recall.js";
/**
 * W4: after tip closed + eligible success, promote pending/tip-attached injected
 * learning assets to outcome_verified and run existing skill-draft curation.
 *
 * Reuses: computeEvaluationEligibility, learning-recall stage accounting,
 * curateLearningSkillDraftsSafely. Does not invent a second success judgement.
 */
import { curateLearningSkillDraftsSafely } from "../auto-reply/reply/learning-skill-curation.js";
import type { ConsumerHandler } from "./consumers.js";
import { computeEvaluationEligibility } from "./eligibility.js";
import type { DurableTaskOutcomeStore } from "./store.js";
import type { OutcomeOutboxEvent, TaskOutcomeRecord } from "./types.js";

export const EXPERIENCE_VERIFIED_CONSUMER_ID = "experience-verified";

export type ExperienceVerifiedHandlerOptions = {
  agentId?: string;
};

export type ExperienceVerificationPlan = {
  shouldVerify: boolean;
  reason: string;
  scopes: PendingLearningInjectionScope[];
};

function normalizeScopes(
  scopes: ReadonlyArray<PendingLearningInjectionScope> | undefined,
): PendingLearningInjectionScope[] {
  return (scopes ?? [])
    .map((scope) => ({
      scopeId: scope.scopeId.trim(),
      botId: scope.botId.trim(),
      assetIds: [...new Set(scope.assetIds.map((id) => id.trim()).filter(Boolean))],
    }))
    .filter((scope) => scope.scopeId && scope.assetIds.length > 0);
}

/**
 * Pure decision: only closed success + skill-eligible may verify exposure → outcome_verified.
 * cancelled / failure / incomplete never verify. Does not consume pending ledger.
 */
export function resolveExperienceVerificationPlan(
  record: TaskOutcomeRecord,
  opts?: { agentId?: string; pendingScopes?: PendingLearningInjectionScope[] },
): ExperienceVerificationPlan {
  if (record.lifecycle !== "closed") {
    return { shouldVerify: false, reason: "not_closed", scopes: [] };
  }
  if (record.taskJudgement === "cancelled") {
    return { shouldVerify: false, reason: "cancelled_excluded", scopes: [] };
  }
  if (record.taskJudgement !== "success") {
    return { shouldVerify: false, reason: "not_success", scopes: [] };
  }
  const eligibility = computeEvaluationEligibility(record);
  if (!eligibility.countsSkillSuccessRate) {
    return { shouldVerify: false, reason: "not_eligible", scopes: [] };
  }

  const fromTip = normalizeScopes(record.experienceExposure?.scopes);
  const pending =
    opts?.pendingScopes !== undefined
      ? normalizeScopes(opts.pendingScopes)
      : normalizeScopes(
          opts?.agentId ? peekPendingLearningInjection(opts.agentId)?.scopes : undefined,
        );
  // Prefer tip-durable attachment; fall back to in-process pending for this agent.
  const scopes = fromTip.length > 0 ? fromTip : pending;

  if (scopes.length === 0) {
    return { shouldVerify: false, reason: "no_injected_assets", scopes: [] };
  }
  return { shouldVerify: true, reason: "tip_success_eligible", scopes };
}

export function applyExperienceVerification(plan: ExperienceVerificationPlan): {
  verifiedAssetIds: string[];
  reason: string;
} {
  if (!plan.shouldVerify) {
    return { verifiedAssetIds: [], reason: plan.reason };
  }
  const verifiedAssetIds: string[] = [];
  for (const scope of plan.scopes) {
    recordLearningExperienceStageSafely({
      scopeId: scope.scopeId,
      assetIds: scope.assetIds,
      stage: "outcome_verified",
      onRecorded: () => {
        // Curation only after verified accounting lands.
        curateLearningSkillDraftsSafely({
          scopeId: scope.scopeId,
          botId: scope.botId,
        });
      },
    });
    verifiedAssetIds.push(...scope.assetIds);
  }
  return { verifiedAssetIds: [...new Set(verifiedAssetIds)], reason: plan.reason };
}

/**
 * experience-verified consumer: tip success+eligible → outcome_verified + curation.
 * Does not count skill success/failure itself (skill-quality remains separate).
 */
export function createExperienceVerifiedHandler(
  _store: DurableTaskOutcomeStore,
  opts?: ExperienceVerifiedHandlerOptions,
): ConsumerHandler {
  return {
    consumerId: EXPERIENCE_VERIFIED_CONSUMER_ID,
    onEvent: (event: OutcomeOutboxEvent, record: TaskOutcomeRecord) => {
      if (event.eventType !== "task.closed" && event.eventType !== "task.corrected") {
        return;
      }
      const plan = resolveExperienceVerificationPlan(record, { agentId: opts?.agentId });
      if (plan.shouldVerify && opts?.agentId && !record.experienceExposure?.scopes?.length) {
        // Consume pending only when we actually verify from the in-process ledger.
        takePendingLearningInjection(opts.agentId);
      } else if (!plan.shouldVerify && opts?.agentId && plan.reason !== "no_injected_assets") {
        // Closed but not verifiable (cancel/fail): drop stale pending so it cannot
        // leak onto a later unrelated success.
        if (peekPendingLearningInjection(opts.agentId)) {
          takePendingLearningInjection(opts.agentId);
        }
      }
      applyExperienceVerification(plan);
    },
  };
}
