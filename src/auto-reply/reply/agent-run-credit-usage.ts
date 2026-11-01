/**
 * Agent run 成功路径 → `recordCreditUsage` 入参（P4 可测试边界）。
 */

import type { RecordCreditUsageInput } from "../../gateway/billing/record-credit-usage.js";

export type RuntimeFallbackAttempt = {
  provider: string;
  model: string;
  error: string;
  reason?: string;
  status?: number;
  code?: string;
};

function readAttemptString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

function readOptionalAttemptString(value: unknown): string | undefined {
  const text = readAttemptString(value);
  return text.length > 0 ? text : undefined;
}

export function normalizeRuntimeFallbackAttempts(raw: unknown): RuntimeFallbackAttempt[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((attempt) => ({
    provider: readAttemptString((attempt as { provider?: unknown }).provider),
    model: readAttemptString((attempt as { model?: unknown }).model),
    error: readAttemptString((attempt as { error?: unknown }).error),
    reason: readOptionalAttemptString((attempt as { reason?: unknown }).reason),
    status:
      typeof (attempt as { status?: unknown }).status === "number"
        ? (attempt as { status: number }).status
        : undefined,
    code: readOptionalAttemptString((attempt as { code?: unknown }).code),
  }));
}

/** 模型 fallback 尝试次数：首次成功前的额外尝试数。 */
export function resolveCommercialRunRetryCount(
  attempts: readonly RuntimeFallbackAttempt[],
): number {
  return Math.max(0, attempts.length - 1);
}

export type BuildCommercialRunCreditUsageInput = {
  enterpriseId: string;
  policyId: string;
  runId: string;
  provider: string;
  model: string;
  creditUserId?: string;
  agentId?: string;
  authorizationDecisionId?: string;
  subscriptionId?: string;
  planId?: string;
  planVersionId?: string;
  subscriptionSnapshotId?: string;
  durationMs?: number;
  toolCallCount: number;
  toolClasses: readonly string[];
  fallbackAttemptsRaw: unknown;
  tokenUsage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
};

export function buildCommercialRunCreditUsageInput(
  input: BuildCommercialRunCreditUsageInput,
): RecordCreditUsageInput {
  const fallbackAttempts = normalizeRuntimeFallbackAttempts(input.fallbackAttemptsRaw);
  return {
    enterpriseId: input.enterpriseId,
    taskId: input.runId,
    modelId: `${input.provider}/${input.model}`,
    policyId: input.policyId,
    userId: input.creditUserId,
    agentId: input.agentId,
    runId: input.runId,
    authorizationDecisionId: input.authorizationDecisionId,
    subscriptionId: input.subscriptionId,
    planId: input.planId,
    planVersionId: input.planVersionId,
    subscriptionSnapshotId: input.subscriptionSnapshotId,
    durationMs: input.durationMs,
    retryCount: resolveCommercialRunRetryCount(fallbackAttempts),
    toolCallCount: input.toolCallCount,
    toolClasses: [...input.toolClasses],
    tokenUsage:
      input.tokenUsage?.input !== undefined ||
      input.tokenUsage?.output !== undefined ||
      input.tokenUsage?.cacheRead !== undefined ||
      input.tokenUsage?.cacheWrite !== undefined
        ? {
            ...(input.tokenUsage.input !== undefined
              ? { inputTokens: input.tokenUsage.input }
              : {}),
            ...(input.tokenUsage.output !== undefined
              ? { outputTokens: input.tokenUsage.output }
              : {}),
            ...(input.tokenUsage.cacheRead !== undefined
              ? { cacheReadTokens: input.tokenUsage.cacheRead }
              : {}),
            ...(input.tokenUsage.cacheWrite !== undefined
              ? { cacheWriteTokens: input.tokenUsage.cacheWrite }
              : {}),
          }
        : undefined,
  };
}
