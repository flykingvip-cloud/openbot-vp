import type { TenantContext } from "./audit.js";
import type { OptimizationReport } from "./optimization-report.js";
import type { StepTrace } from "./orchestrator.js";

/**
 * Billing bridge: maps AOR execution traces onto OpenBot's public
 * `usage-ingest.report` RPC contract (mirrors `UsageRecord` / cost-budget UI).
 *
 * AOR does not import `src/gateway/billing/*`; callers pass these payloads to
 * `usage-ingest.report` via an injectable Gateway transport.
 */

/** Metering keys understood by cost-budget plans (see gateway billing types). */
export const AOR_METERING_KEYS = {
  aiToken: "ai_token",
  aorTask: "aor_task",
  aorOrchestration: "aor_orchestration",
  /** Fractional-cent proxy for optimization cost savings vs baseline. */
  aorOptimizationSavings: "aor_optimization_savings",
  /** Fractional-cent proxy for optimization revenue share (savings × rate). */
  aorOptimizationRevenueShare: "aor_optimization_revenue_share",
} as const;

/** Payload for `usage-ingest.report` (public gateway RPC). */
export interface UsageIngestPayload {
  eventId: string;
  key: string;
  quantity: number;
  userId?: string;
  occurredAt?: string;
  agentId?: string;
  orgSeatId?: string;
}

export interface TraceToUsageIngestParams {
  trace: StepTrace[];
  /** Unique id for this AOR run (dedup prefix). */
  runId: string;
  occurredAt?: string;
  tenant?: TenantContext;
  /** When set, emits savings + revenue-share metering keys. */
  optimization?: OptimizationReport;
}

function stepCostUsd(step: StepTrace): number {
  return step.usage.costUsd ?? step.estimatedCostUsd;
}

/**
 * Expand an AOR trace into one or more usage-ingest payloads:
 * - `ai_token`: token quantity per step
 * - `aor_task`: one unit per completed step
 * - `aor_orchestration`: fractional unit weighted by estimated USD (×100 cents proxy)
 */
export function traceToUsageIngest(params: TraceToUsageIngestParams): UsageIngestPayload[] {
  const ts = params.occurredAt ?? new Date().toISOString();
  const userId = params.tenant?.userId;
  const agentId = params.tenant?.agentId;
  const orgSeatId = params.tenant?.orgSeatId;
  const attributionFields = {
    ...(userId ? { userId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(orgSeatId ? { orgSeatId } : {}),
    occurredAt: ts,
  };
  const out: UsageIngestPayload[] = [];
  for (const step of params.trace) {
    const prefix = `aor:${params.runId}:${step.nodeId}`;
    if (step.usage.totalTokens > 0) {
      out.push({
        eventId: `${prefix}:tokens`,
        key: AOR_METERING_KEYS.aiToken,
        quantity: step.usage.totalTokens,
        ...attributionFields,
      });
    }
    out.push({
      eventId: `${prefix}:task`,
      key: AOR_METERING_KEYS.aorTask,
      quantity: 1,
      ...attributionFields,
    });
    const cost = stepCostUsd(step);
    if (cost > 0) {
      out.push({
        eventId: `${prefix}:orch`,
        key: AOR_METERING_KEYS.aorOrchestration,
        quantity: Math.max(1, Math.round(cost * 100)),
        ...attributionFields,
      });
    }
  }
  if (params.optimization && params.optimization.costSavingsUsd > 0) {
    out.push({
      eventId: `aor:${params.runId}:opt-savings`,
      key: AOR_METERING_KEYS.aorOptimizationSavings,
      quantity: Math.max(1, Math.round(params.optimization.costSavingsUsd * 100)),
      ...attributionFields,
    });
  }
  if (params.optimization && params.optimization.revenueShareUsd > 0) {
    out.push({
      eventId: `aor:${params.runId}:opt-revenue-share`,
      key: AOR_METERING_KEYS.aorOptimizationRevenueShare,
      quantity: Math.max(1, Math.round(params.optimization.revenueShareUsd * 100)),
      ...attributionFields,
    });
  }
  return out;
}
