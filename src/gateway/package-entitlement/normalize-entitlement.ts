/**
 * EntitlementSnapshot 默认值与向后兼容归一化。
 */

import type { EntitlementOveragePolicy, EntitlementSnapshot } from "./types.js";

export const DEFAULT_OVERAGE_POLICY: EntitlementOveragePolicy = {
  type: "block",
  allowBurstConcurrency: false,
};

/** 由 Bot 配额推导默认并发上限（0 = 不限 bots 时仍给合理默认）。 */
export function defaultMaxConcurrentRuns(maxBots: number): number {
  if (maxBots <= 0) {
    return 8;
  }
  return Math.max(2, Math.min(32, Math.ceil(maxBots * 0.4) + 2));
}

function normalizeAiProfileQuota(
  raw: EntitlementSnapshot["aiProfileQuota"] | undefined,
): EntitlementSnapshot["aiProfileQuota"] | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const out: NonNullable<EntitlementSnapshot["aiProfileQuota"]> = {};
  for (const key of ["basic", "pro", "elite"] as const) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      out[key] = Math.floor(value);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function normalizeEntitlementSnapshot(raw: EntitlementSnapshot): EntitlementSnapshot {
  const maxBots = Math.max(0, Math.floor(raw.maxBots));
  const maxConcurrentRuns =
    raw.maxConcurrentRuns !== undefined && raw.maxConcurrentRuns >= 0
      ? Math.floor(raw.maxConcurrentRuns)
      : defaultMaxConcurrentRuns(maxBots);
  const aiProfileQuota = normalizeAiProfileQuota(raw.aiProfileQuota);
  return {
    ...raw,
    maxBots,
    maxConcurrentRuns,
    ...(aiProfileQuota ? { aiProfileQuota } : {}),
    overagePolicy: raw.overagePolicy ?? DEFAULT_OVERAGE_POLICY,
  };
}
