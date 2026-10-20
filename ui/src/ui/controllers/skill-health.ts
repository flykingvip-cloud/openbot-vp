import type { GatewayBrowserClient } from "../gateway.ts";
import type { SkillHealthStatus } from "./skill-models.ts";

export type SkillHealthSample = {
  skillId: string;
  agentId: string;
  timestamp: number;
  outcome: "success" | "failure";
  latencyMs: number;
  failureReason?: string;
};

export type SkillHealthSummary = {
  status: SkillHealthStatus;
  successRate: number | null;
  avgLatencyMs: number | null;
  lastVerifiedAt: number | null;
  friendlyStatusLabel: string;
};

export type SkillHealthThresholds = {
  warningSuccessRate: number;
  brokenConsecutiveFailures: number;
  windowMs: number;
};

export type SkillHealthState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  bufferedSamples: SkillHealthSample[];
};

/**
 * Maps SkillHealthStatus to employee-friendly Chinese labels.
 * - "healthy" → "运行正常"
 * - "warning" → "偶尔出错"
 * - "broken" → "已失效"
 */
export function toFriendlyLabel(status: SkillHealthStatus): string {
  switch (status) {
    case "warning":
      return "偶尔出错";
    case "broken":
      return "已失效";
    default:
      return "运行正常";
  }
}

/**
 * Pure function that computes a SkillHealthSummary from a set of samples
 * within the sliding window defined by thresholds.
 *
 * Logic:
 * 1. Filters samples within windowMs of the most recent sample timestamp (or Date.now())
 * 2. Calculates successRate = successCount / totalCount
 * 3. Calculates avgLatencyMs
 * 4. Determines status:
 *    - If consecutive trailing failures >= brokenConsecutiveFailures → "broken"
 *    - Else if successRate < warningSuccessRate → "warning"
 *    - Else → "healthy"
 * 5. Sets friendlyStatusLabel via toFriendlyLabel
 */
export function computeHealthSummary(
  samples: SkillHealthSample[],
  thresholds: SkillHealthThresholds,
): SkillHealthSummary {
  if (samples.length === 0) {
    return {
      status: "healthy",
      successRate: null,
      avgLatencyMs: null,
      lastVerifiedAt: null,
      friendlyStatusLabel: toFriendlyLabel("healthy"),
    };
  }

  const now = Date.now();
  const windowStart = now - thresholds.windowMs;
  const windowSamples = samples.filter((s) => s.timestamp >= windowStart);

  if (windowSamples.length === 0) {
    return {
      status: "healthy",
      successRate: null,
      avgLatencyMs: null,
      lastVerifiedAt: null,
      friendlyStatusLabel: toFriendlyLabel("healthy"),
    };
  }

  // Sort by timestamp ascending for consecutive failure detection
  const sorted = [...windowSamples].toSorted((a, b) => a.timestamp - b.timestamp);

  const totalCount = sorted.length;
  const successCount = sorted.filter((s) => s.outcome === "success").length;
  const successRate = totalCount > 0 ? successCount / totalCount : null;
  const avgLatencyMs =
    totalCount > 0 ? sorted.reduce((sum, s) => sum + s.latencyMs, 0) / totalCount : null;
  const lastVerifiedAt = sorted[sorted.length - 1].timestamp;

  // Count consecutive trailing failures (from the end)
  let consecutiveFailures = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].outcome === "failure") {
      consecutiveFailures++;
    } else {
      break;
    }
  }

  let status: SkillHealthStatus;
  if (consecutiveFailures >= thresholds.brokenConsecutiveFailures) {
    status = "broken";
  } else if (successRate !== null && successRate < thresholds.warningSuccessRate) {
    status = "warning";
  } else {
    status = "healthy";
  }

  return {
    status,
    successRate,
    avgLatencyMs,
    lastVerifiedAt,
    friendlyStatusLabel: toFriendlyLabel(status),
  };
}

/**
 * Reports a single health sample to the gateway endpoint.
 * Buffers the sample locally and sends it to the backend.
 */
export async function reportHealthSample(
  state: SkillHealthState,
  sample: SkillHealthSample,
): Promise<void> {
  if (!state.client || !state.connected) {
    state.bufferedSamples.push(sample);
    return;
  }
  await state.client.request("skill-health.sample", { sample });
}
