import type { PendingLearningInjectionScope } from "../auto-reply/reply/learning-experience-pending.js";
import {
  adjustLearningExperienceStage,
  recordLearningExperienceStage,
} from "../auto-reply/reply/learning-recall.js";
/**
 * W4 wrap-up: tip closed + eligible success may verify **adopted** exposure only.
 *
 * 口径（Option A）：
 * - tip success + exposure alone = 「成功任务中的曝光」(reason exposure_on_success_not_verified)
 *   — 不计 outcome_verified，不触发有效性策展。
 * - 仅当 tip.experienceExposure.adoptedAssetIds 非空时，对 adopted∩injected 记
 *   outcome_verified 并策展。禁止共现=有效；禁止按 agentId 猜测 pending。
 *
 * 落盘：可等待、失败传播；消费确认必须在落盘成功之后（drain await）。
 * 幂等：同一 eventId 不重复加数；correction 撤销旧贡献。
 */
import { curateLearningSkillDraftsSafely } from "../auto-reply/reply/learning-skill-curation.js";
import type { ConsumerHandler } from "./consumers.js";
import { computeEvaluationEligibility } from "./eligibility.js";
import type { DurableTaskOutcomeStore } from "./store.js";
import type { ExperienceExposureState, OutcomeOutboxEvent, TaskOutcomeRecord } from "./types.js";

export const EXPERIENCE_VERIFIED_CONSUMER_ID = "experience-verified";

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
 * Pure decision. Tip-durable exposure only — never peeks agentId pending.
 * Adoption evidence required for outcome_verified.
 */
export function resolveExperienceVerificationPlan(
  record: TaskOutcomeRecord,
  _opts?: { pendingScopes?: PendingLearningInjectionScope[] },
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
  // Intentionally ignore opts.pendingScopes / agentId — no reliable association ⇒ skip.
  if (fromTip.length === 0) {
    return { shouldVerify: false, reason: "no_injected_assets", scopes: [] };
  }

  const adoptedIds = [
    ...new Set(
      (record.experienceExposure?.adoptedAssetIds ?? []).map((id) => id.trim()).filter(Boolean),
    ),
  ];
  if (adoptedIds.length === 0) {
    // 成功任务中的曝光 — observable via tip exposure + success; not validity.
    return {
      shouldVerify: false,
      reason: "exposure_on_success_not_verified",
      scopes: fromTip,
    };
  }

  const adoptedSet = new Set(adoptedIds);
  const scopes = fromTip
    .map((scope) => ({
      ...scope,
      assetIds: scope.assetIds.filter((id) => adoptedSet.has(id)),
    }))
    .filter((scope) => scope.assetIds.length > 0);
  if (scopes.length === 0) {
    return { shouldVerify: false, reason: "adopted_not_in_exposure", scopes: [] };
  }
  return { shouldVerify: true, reason: "tip_success_eligible_adopted", scopes };
}

function groupAssetIdsByScope(
  scopes: PendingLearningInjectionScope[],
  assetIds: string[],
): PendingLearningInjectionScope[] {
  const wanted = new Set(assetIds);
  return scopes
    .map((scope) => ({
      ...scope,
      assetIds: scope.assetIds.filter((id) => wanted.has(id)),
    }))
    .filter((scope) => scope.assetIds.length > 0);
}

async function revokeVerifiedContribution(
  record: TaskOutcomeRecord,
  assetIds: string[],
): Promise<void> {
  if (assetIds.length === 0) {
    return;
  }
  const tipScopes = normalizeScopes(record.experienceExposure?.scopes);
  const grouped =
    tipScopes.length > 0
      ? groupAssetIdsByScope(tipScopes, assetIds)
      : [{ scopeId: "", botId: "", assetIds }];
  for (const scope of grouped) {
    if (!scope.scopeId || scope.assetIds.length === 0) {
      continue;
    }
    await adjustLearningExperienceStage({
      scopeId: scope.scopeId,
      assetIds: scope.assetIds,
      stage: "outcome_verified",
      delta: -1,
    });
  }
}

/**
 * Awaitable apply: durable stage write then curation. Propagates failures.
 */
export async function applyExperienceVerification(plan: ExperienceVerificationPlan): Promise<{
  verifiedAssetIds: string[];
  reason: string;
}> {
  if (!plan.shouldVerify) {
    return { verifiedAssetIds: [], reason: plan.reason };
  }
  const verifiedAssetIds: string[] = [];
  for (const scope of plan.scopes) {
    await recordLearningExperienceStage({
      scopeId: scope.scopeId,
      assetIds: scope.assetIds,
      stage: "outcome_verified",
    });
    // Curation after durable verified accounting (still fail-soft for draft write).
    curateLearningSkillDraftsSafely({
      scopeId: scope.scopeId,
      botId: scope.botId,
    });
    verifiedAssetIds.push(...scope.assetIds);
  }
  return { verifiedAssetIds: [...new Set(verifiedAssetIds)], reason: plan.reason };
}

function persistVerifiedContribution(
  store: DurableTaskOutcomeStore,
  record: TaskOutcomeRecord,
  next: ExperienceExposureState["verifiedContribution"] | undefined,
): TaskOutcomeRecord {
  if (!record.experienceExposure) {
    return record;
  }
  const experienceExposure: ExperienceExposureState = {
    ...record.experienceExposure,
    ...(next ? { verifiedContribution: next } : {}),
  };
  if (!next) {
    delete experienceExposure.verifiedContribution;
  }
  const patched: TaskOutcomeRecord = {
    ...record,
    experienceExposure,
    updatedAt: new Date().toISOString(),
  };
  store.saveTask(patched);
  return patched;
}

/**
 * experience-verified consumer: adopted ∩ tip exposure → outcome_verified + curation.
 * Awaitable onEvent so drain marks consumed only after durable write succeeds.
 */
export function createExperienceVerifiedHandler(store: DurableTaskOutcomeStore): ConsumerHandler {
  return {
    consumerId: EXPERIENCE_VERIFIED_CONSUMER_ID,
    onEvent: async (event: OutcomeOutboxEvent, record: TaskOutcomeRecord) => {
      if (event.eventType !== "task.closed" && event.eventType !== "task.corrected") {
        return;
      }
      const plan = resolveExperienceVerificationPlan(record);
      const prev = record.experienceExposure?.verifiedContribution;

      // Idempotent: same event already contributed.
      if (prev && prev.eventId === event.eventId) {
        return;
      }

      // Correction / non-verify: revoke prior contribution for this tip.
      if (prev && !plan.shouldVerify) {
        await revokeVerifiedContribution(record, prev.assetIds);
        persistVerifiedContribution(store, record, undefined);
        return;
      }

      if (!plan.shouldVerify) {
        return;
      }

      // Newer version replacing older verified contribution on same tip.
      if (prev && prev.eventId !== event.eventId) {
        await revokeVerifiedContribution(record, prev.assetIds);
      }

      const applied = await applyExperienceVerification(plan);
      if (applied.verifiedAssetIds.length === 0) {
        return;
      }
      persistVerifiedContribution(store, record, {
        eventId: event.eventId,
        outcomeVersion: event.outcomeVersion,
        assetIds: applied.verifiedAssetIds,
      });
    },
  };
}
