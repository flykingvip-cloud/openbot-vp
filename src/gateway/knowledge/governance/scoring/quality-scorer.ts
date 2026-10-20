import type { GovernanceStatus } from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ChunkQualityInput = {
  publishedAt: number | null;
  referenceCount: number;
  lastHitAt: number | null;
  governanceStatus: GovernanceStatus | null;
  conflictGroupId: string | null;
  trustScore: number | null;
  expertWeight?: number;
};

export function computeFreshnessScore(publishedAt: number | null, now = Date.now()): number | null {
  if (publishedAt == null || !Number.isFinite(publishedAt)) {
    return null;
  }
  const ageDays = Math.max(0, (now - publishedAt) / DAY_MS);
  if (ageDays <= 30) {
    return 1;
  }
  if (ageDays <= 180) {
    return 1 - ((ageDays - 30) / 150) * 0.2;
  }
  if (ageDays <= 365) {
    return 0.8 - ((ageDays - 180) / 185) * 0.2;
  }
  return 0.5;
}

export function computeUsageBoost(
  referenceCount: number,
  lastHitAt: number | null,
  now = Date.now(),
): number {
  let boost = 0;
  if (referenceCount > 0) {
    boost += Math.min(0.08, referenceCount * 0.01);
  }
  if (lastHitAt != null && now - lastHitAt <= 7 * DAY_MS) {
    boost += 0.04;
  }
  return boost;
}

export function computeTrustScore(input: ChunkQualityInput): number | null {
  if (input.governanceStatus === "confirmed") {
    const expertWeight = input.expertWeight ?? 1;
    const base = input.trustScore ?? 1;
    return Math.min(1.2, Math.max(0.5, base * expertWeight));
  }
  if (input.governanceStatus === "suppressed") {
    return 0.5;
  }
  return input.trustScore;
}

export function computeQualityScore(input: ChunkQualityInput, now = Date.now()): number | null {
  const freshness = computeFreshnessScore(input.publishedAt, now) ?? 1;
  const usage = computeUsageBoost(input.referenceCount, input.lastHitAt, now);
  let quality = freshness + usage;
  if (input.conflictGroupId && input.governanceStatus !== "confirmed") {
    quality *= 0.85;
  }
  return Math.min(1.2, Math.max(0.5, quality));
}
