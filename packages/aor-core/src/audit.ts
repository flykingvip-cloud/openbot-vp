import type { AorRunResult } from "./orchestrator.js";
import type { SelectionResult } from "./selector.js";
import type { Task } from "./types.js";

/** Tenant / user context for multi-tenant audit and billing. */
export interface TenantContext {
  /** Billing / cost-budget user id. */
  userId?: string;
  /** Logical tenant id (prefix for session keys, audit queries). */
  tenantId?: string;
  /** Runtime agent id for usage attribution (岗位汇报机器人明细). */
  agentId?: string;
  /** Org position seat id when known (skips seat lookup on ingest). */
  orgSeatId?: string;
}

/** Immutable audit record for a single AOR run. */
export interface AorAuditRecord {
  runId: string;
  occurredAt: string;
  tenantId?: string;
  userId?: string;
  taskType: string;
  goal: string;
  strategy: string;
  selection: {
    model: string;
    reason: string;
    score: number;
    estimatedCostUsd: number;
  };
  evaluationScore?: number;
  totalTokens: number;
  totalCostUsd?: number;
  latencyMs: number;
  stepCount: number;
}

export function buildAuditRecord(params: {
  runId: string;
  task: Task;
  result: AorRunResult;
  strategy: string;
  tenant?: TenantContext;
  occurredAt?: string;
}): AorAuditRecord {
  const { result } = params;
  const selection = formatSelection(result.selection);
  return {
    runId: params.runId,
    occurredAt: params.occurredAt ?? new Date().toISOString(),
    tenantId: params.tenant?.tenantId,
    userId: params.tenant?.userId,
    taskType: result.taskType,
    goal: params.task.goal,
    strategy: params.strategy,
    selection,
    evaluationScore: result.evaluation?.score,
    totalTokens: result.usage.totalTokens,
    totalCostUsd: result.usage.costUsd,
    latencyMs: result.latencyMs,
    stepCount: result.trace.length,
  };
}

function formatSelection(sel: SelectionResult): AorAuditRecord["selection"] {
  return {
    model: `${sel.model.provider}/${sel.model.id}`,
    reason: sel.reason,
    score: sel.score,
    estimatedCostUsd: sel.estimatedCostUsd,
  };
}

/** Prefix a session key with tenant id for isolation. */
export function tenantSessionKey(tenantId: string | undefined, sessionKey: string): string {
  if (!tenantId?.trim()) {
    return sessionKey;
  }
  const prefix = tenantId.trim();
  if (sessionKey.startsWith(`${prefix}:`)) {
    return sessionKey;
  }
  return `${prefix}:${sessionKey}`;
}

/** Default session key prefix when AOR materializes a key for Gateway runs. */
export const DEFAULT_AOR_SESSION_PREFIX = "aor";

/**
 * Resolve the Gateway session key for a run. When `tenantId` is set, always
 * returns a tenant-prefixed key — materializing `aor:<runId>` when the caller
 * omitted `sessionKey` so RPC clients never auto-generate bare `aor:<uuid>`.
 */
export function resolveRunSessionKey(params: {
  sessionKey?: string;
  tenant?: TenantContext;
  runId: string;
  sessionKeyPrefix?: string;
}): string | undefined {
  if (!params.tenant?.tenantId?.trim()) {
    return params.sessionKey;
  }
  const prefix = params.sessionKeyPrefix ?? DEFAULT_AOR_SESSION_PREFIX;
  const base = params.sessionKey ?? `${prefix}:${params.runId}`;
  return tenantSessionKey(params.tenant.tenantId, base);
}
