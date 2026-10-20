/**
 * 套餐权益约束检查（纯函数，framework-free）。
 *
 * 统一 Bot / Concurrency / Credits 配额判定，供 resources handler 与 agent-run 治理复用。
 */

import type {
  EntitlementOveragePolicy,
  EntitlementSnapshot,
} from "../package-entitlement/types.js";
import { wouldExceedCredits } from "./credit-meter.js";

export type ConstraintReason =
  | "BOT_LIMIT_EXCEEDED"
  | "CONCURRENCY_LIMIT_EXCEEDED"
  | "CREDITS_EXHAUSTED";

export type ConstraintCheckInput = {
  snapshot: Pick<
    EntitlementSnapshot,
    "maxBots" | "maxConcurrentRuns" | "monthlyCredits" | "overagePolicy"
  >;
  activeBotCount: number;
  activeRunCount: number;
  creditsRemaining: number;
  creditsRequired?: number;
  /** 仅检查 bot 创建时设为 true。 */
  botCreateAttempt?: boolean;
  /** 仅检查 run 启动时设为 true。 */
  runStartAttempt?: boolean;
  /** 仅检查 credits 扣减时设为 true。 */
  creditsChargeAttempt?: boolean;
};

export type ConstraintCheckResult =
  | {
      allowed: true;
      /**
       * pay_as_you_go：Credits 不足仍放行，后续按货币超额计量。
       * block / credits_only 不会出现此标志。
       */
      creditsOverage?: boolean;
    }
  | { allowed: false; reason: ConstraintReason; message: string };

function overageAllowsConcurrencyBurst(policy: EntitlementOveragePolicy): boolean {
  return policy.allowBurstConcurrency;
}

/** Credits 不足时是否仍允许启动（仅 pay_as_you_go）。 */
export function overagePolicyAllowsCreditsShortfall(
  policy: EntitlementOveragePolicy | null | undefined,
): boolean {
  return (policy?.type ?? "block") === "pay_as_you_go";
}

export function checkEntitlementConstraints(input: ConstraintCheckInput): ConstraintCheckResult {
  const { snapshot } = input;

  if (input.botCreateAttempt !== false) {
    const maxBots = snapshot.maxBots;
    if (maxBots > 0 && input.activeBotCount >= maxBots) {
      return {
        allowed: false,
        reason: "BOT_LIMIT_EXCEEDED",
        message: `企业 AI 员工（Bot）配额已满（上限 ${maxBots}）。`,
      };
    }
  }

  if (input.runStartAttempt) {
    const limit = snapshot.maxConcurrentRuns;
    if (
      limit > 0 &&
      input.activeRunCount >= limit &&
      !overageAllowsConcurrencyBurst(snapshot.overagePolicy)
    ) {
      return {
        allowed: false,
        reason: "CONCURRENCY_LIMIT_EXCEEDED",
        message: `并发 AI 任务已达上限（同时 ${limit} 个）。请稍后再试或升级套餐。`,
      };
    }
  }

  if (input.creditsChargeAttempt) {
    const required = Math.max(0, Math.floor(input.creditsRequired ?? 0));
    if (
      required > 0 &&
      snapshot.monthlyCredits > 0 &&
      wouldExceedCredits({
        monthlyCredits: snapshot.monthlyCredits,
        creditsConsumed: snapshot.monthlyCredits - Math.max(0, input.creditsRemaining),
        creditsToCharge: required,
      })
    ) {
      // block / credits_only：额度不足拒绝；pay_as_you_go：放行并由货币超额结算
      if (overagePolicyAllowsCreditsShortfall(snapshot.overagePolicy)) {
        return { allowed: true, creditsOverage: true };
      }
      const policyType = snapshot.overagePolicy?.type ?? "block";
      return {
        allowed: false,
        reason: "CREDITS_EXHAUSTED",
        message:
          policyType === "credits_only"
            ? "本月任务额度（Credits）不足，且套餐策略为仅 Credits（禁止货币超额）。"
            : "本月任务额度（Credits）不足，无法继续执行。",
      };
    }
  }

  return { allowed: true };
}

/** @deprecated 专家方案别名；Prefer checkEntitlementConstraints */
export function checkPackageConstraints(input: {
  snapshot: Pick<
    EntitlementSnapshot,
    "maxBots" | "maxConcurrentRuns" | "monthlyCredits" | "overagePolicy"
  >;
  activeBotCount: number;
  activeRunCount: number;
  creditsRemaining?: number;
  creditsRequired?: number;
}): ConstraintCheckResult {
  return checkEntitlementConstraints({
    snapshot: input.snapshot,
    activeBotCount: input.activeBotCount,
    activeRunCount: input.activeRunCount,
    creditsRemaining: input.creditsRemaining ?? input.snapshot.monthlyCredits,
    creditsRequired: input.creditsRequired,
    botCreateAttempt: true,
    runStartAttempt: true,
    creditsChargeAttempt: Boolean(input.creditsRequired),
  });
}

export function computeBotQuotaUsage(activeBotCount: number): number {
  return Math.max(0, Math.floor(activeBotCount));
}

export function computeConcurrencyUsage(activeRunCount: number): number {
  return Math.max(0, Math.floor(activeRunCount));
}
