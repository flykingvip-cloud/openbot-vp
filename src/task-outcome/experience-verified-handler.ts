import fs from "node:fs";
import path from "node:path";
import type { PendingLearningInjectionScope } from "../auto-reply/reply/learning-experience-pending.js";
/**
 * W4 wrap-up + reverify P1:
 * tip closed + eligible success may verify **adopted** exposure only.
 *
 * 口径（Option A）：
 * - tip success + exposure alone = 「成功任务中的曝光」(reason exposure_on_success_not_verified)
 *   — 不计 outcome_verified，不触发有效性策展。
 * - 仅当 tip.experienceExposure.adoptedAssetIds 非空时，对 adopted∩injected 记
 *   outcome_verified 并策展。禁止共现=有效；禁止按 agentId 猜测 pending。
 *
 * 落盘：可等待、失败传播；消费确认必须在落盘成功之后（drain await）。
 * 幂等：稳定 contributionKey 驱动计数（key 注册表为源，asset 计数 reconcile）；
 * 任务级贡献元数据写入 contributions/experience-verified，**不**回写 TaskOutcome tip。
 */
import { curateLearningSkillDraftsSafely } from "../auto-reply/reply/learning-skill-curation.js";
import type { ConsumerHandler } from "./consumers.js";
import { computeEvaluationEligibility } from "./eligibility.js";
import {
  applyOutcomeVerifiedContributionKey,
  revokeOutcomeVerifiedContributionKey,
  type OutcomeVerifiedCollaborationStores,
} from "./experience-verified-counts.js";
import type { DurableTaskOutcomeStore } from "./store.js";
import { scopeIdOf } from "./transitions.js";
import type { OutcomeOutboxEvent, TaskOutcomeRecord } from "./types.js";

export const EXPERIENCE_VERIFIED_CONSUMER_ID = "experience-verified";

export type ExperienceVerificationPlan = {
  shouldVerify: boolean;
  reason: string;
  scopes: PendingLearningInjectionScope[];
};

/** Durable consumer contribution — lives outside TaskOutcome tip. */
export type ExperienceVerifiedContribution = {
  contributionKey: string;
  eventId: string;
  outcomeVersion: number;
  taskId: string;
  status: "applied" | "revoked";
  scopes: PendingLearningInjectionScope[];
  assetIds: string[];
  updatedAt: string;
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

export function buildExperienceVerifiedContributionKey(params: {
  taskId: string;
  eventId: string;
}): string {
  return `experience-verified:${params.taskId.trim()}:${params.eventId.trim()}`;
}

function experienceContributionDir(store: DurableTaskOutcomeStore): string {
  return path.join(
    store.rootDir,
    "contributions",
    encodeURIComponent(EXPERIENCE_VERIFIED_CONSUMER_ID),
  );
}

function experienceContributionPath(
  store: DurableTaskOutcomeStore,
  scopeId: string,
  taskId: string,
): string {
  return path.join(
    experienceContributionDir(store),
    `${encodeURIComponent(scopeId)}__${encodeURIComponent(taskId)}.json`,
  );
}

export function loadExperienceVerifiedContribution(
  store: DurableTaskOutcomeStore,
  scopeId: string,
  taskId: string,
): ExperienceVerifiedContribution | undefined {
  const filePath = experienceContributionPath(store, scopeId, taskId);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as ExperienceVerifiedContribution;
  } catch {
    return undefined;
  }
}

export function saveExperienceVerifiedContribution(
  store: DurableTaskOutcomeStore,
  scopeId: string,
  value: ExperienceVerifiedContribution,
): void {
  const filePath = experienceContributionPath(store, scopeId, value.taskId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

export function clearExperienceVerifiedContribution(
  store: DurableTaskOutcomeStore,
  scopeId: string,
  taskId: string,
): void {
  const filePath = experienceContributionPath(store, scopeId, taskId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Awaitable apply: durable keyed stage write then curation. Propagates failures.
 * Prefer createExperienceVerifiedHandler for production (contribution store + keys).
 */
export async function applyExperienceVerification(
  plan: ExperienceVerificationPlan,
  opts?: { contributionKey?: string },
): Promise<{
  verifiedAssetIds: string[];
  reason: string;
}> {
  if (!plan.shouldVerify) {
    return { verifiedAssetIds: [], reason: plan.reason };
  }
  const contributionKey =
    opts?.contributionKey?.trim() ||
    `experience-verified:ad-hoc:${plan.reason}:${plan.scopes
      .flatMap((s) => s.assetIds)
      .toSorted()
      .join(",")}`;
  const verifiedAssetIds: string[] = [];
  for (const scope of plan.scopes) {
    const applied = await applyOutcomeVerifiedContributionKey({
      contributionKey: `${contributionKey}:${scope.scopeId}`,
      scopeId: scope.scopeId,
      assetIds: scope.assetIds,
    });
    curateLearningSkillDraftsSafely({
      scopeId: scope.scopeId,
      botId: scope.botId,
    });
    verifiedAssetIds.push(...applied.verifiedAssetIds);
  }
  return { verifiedAssetIds: [...new Set(verifiedAssetIds)], reason: plan.reason };
}

/**
 * experience-verified consumer: adopted ∩ tip exposure → outcome_verified + curation.
 * Contribution metadata stays in contributions/experience-verified — never store.saveTask.
 */
export function createExperienceVerifiedHandler(
  store: DurableTaskOutcomeStore,
  opts?: { stores?: OutcomeVerifiedCollaborationStores },
): ConsumerHandler {
  const stores = opts?.stores;
  return {
    consumerId: EXPERIENCE_VERIFIED_CONSUMER_ID,
    onEvent: async (event: OutcomeOutboxEvent, record: TaskOutcomeRecord) => {
      if (event.eventType !== "task.closed" && event.eventType !== "task.corrected") {
        return;
      }
      const plan = resolveExperienceVerificationPlan(record);
      const sid = scopeIdOf(record.scope);
      const prev = loadExperienceVerifiedContribution(store, sid, record.taskId);
      const contributionKey = buildExperienceVerifiedContributionKey({
        taskId: record.taskId,
        eventId: event.eventId,
      });

      // Same event already fully recorded in contribution store — reconcile counts, no tip write.
      if (prev && prev.eventId === event.eventId && prev.status === "applied") {
        for (const scope of prev.scopes) {
          await applyOutcomeVerifiedContributionKey({
            contributionKey: `${prev.contributionKey}:${scope.scopeId}`,
            scopeId: scope.scopeId,
            assetIds: scope.assetIds,
            stores,
          });
        }
        return;
      }

      // Correction / non-verify: revoke prior contribution for this tip.
      if (prev && prev.status === "applied" && !plan.shouldVerify) {
        for (const scope of prev.scopes) {
          await revokeOutcomeVerifiedContributionKey({
            contributionKey: `${prev.contributionKey}:${scope.scopeId}`,
            scopeId: scope.scopeId,
            assetIds: scope.assetIds,
            stores,
          });
        }
        saveExperienceVerifiedContribution(store, sid, {
          ...prev,
          status: "revoked",
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      if (!plan.shouldVerify) {
        return;
      }

      // Newer version replacing older verified contribution on same tip.
      if (prev && prev.status === "applied" && prev.eventId !== event.eventId) {
        for (const scope of prev.scopes) {
          await revokeOutcomeVerifiedContributionKey({
            contributionKey: `${prev.contributionKey}:${scope.scopeId}`,
            scopeId: scope.scopeId,
            assetIds: scope.assetIds,
            stores,
          });
        }
      }

      const verifiedAssetIds: string[] = [];
      for (const scope of plan.scopes) {
        const applied = await applyOutcomeVerifiedContributionKey({
          contributionKey: `${contributionKey}:${scope.scopeId}`,
          scopeId: scope.scopeId,
          assetIds: scope.assetIds,
          stores,
        });
        curateLearningSkillDraftsSafely({
          scopeId: scope.scopeId,
          botId: scope.botId,
          ...(stores ? { stores } : {}),
        });
        verifiedAssetIds.push(...applied.verifiedAssetIds);
      }
      const uniqueAssets = [...new Set(verifiedAssetIds)];
      if (uniqueAssets.length === 0) {
        return;
      }

      // Persist contribution metadata AFTER keyed count reconcile (key is source of truth).
      // Crash before this write: replay re-reconciles via key (no double count) then rewrites file.
      saveExperienceVerifiedContribution(store, sid, {
        contributionKey,
        eventId: event.eventId,
        outcomeVersion: event.outcomeVersion,
        taskId: record.taskId,
        status: "applied",
        scopes: plan.scopes,
        assetIds: uniqueAssets,
        updatedAt: new Date().toISOString(),
      });
    },
  };
}
