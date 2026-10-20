/**
 * AI Workforce Governance - Shared Utilities
 * Common utility functions for the governance system.
 */

import { randomUUID } from "node:crypto";
import type {
  AiAnomaly,
  AiAssetStatus,
  AiMetricsDaily,
  AnomalySeverity,
  AnomalyType,
  RiskLevel,
} from "./types.ts";

// ============================================================================
// ID Generation
// ============================================================================

export function generateAssetId(type: "bot" | "group"): string {
  return `${type}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function generateRunId(): string {
  return `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function generateMetricsId(): string {
  return `metric_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function generateAnomalyId(): string {
  return `anomaly_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function generateScoreId(): string {
  return `score_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function generateActionId(): string {
  return `action_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

// ============================================================================
// Date Utilities
// ============================================================================

export function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

export function getYesterdayDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().split("T")[0];
}

export function getDateNDaysAgo(n: number): string {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date.toISOString().split("T")[0];
}

export function getStartOfDay(dateStr: string): string {
  return `${dateStr}T00:00:00.000Z`;
}

export function getEndOfDay(dateStr: string): string {
  return `${dateStr}T23:59:59.999Z`;
}

// ============================================================================
// Metrics Calculation
// ============================================================================

export interface RawMetrics {
  taskCount: number;
  successCount: number;
  failCount: number;
  totalDurationMs: number;
  totalCost: number;
  totalTokens: number;
  errorCount: number;
}

export function calculateMetrics(
  runs: {
    durationMs: number | null;
    cost: number;
    tokensInput: number;
    tokensOutput: number;
    status: string;
    errorCode: string | null;
  }[],
): RawMetrics {
  let taskCount = 0;
  let successCount = 0;
  let failCount = 0;
  let totalDurationMs = 0;
  let totalCost = 0;
  let totalTokens = 0;
  let errorCount = 0;

  for (const run of runs) {
    taskCount++;
    totalCost += run.cost;
    totalTokens += run.tokensInput + run.tokensOutput;

    if (run.durationMs !== null) {
      totalDurationMs += run.durationMs;
    }

    if (run.status === "success") {
      successCount++;
    } else if (run.status === "failed") {
      failCount++;
      errorCount++;
    } else if (run.status === "timeout") {
      failCount++;
      errorCount++;
    }

    if (run.errorCode) {
      errorCount++;
    }
  }

  return {
    taskCount,
    successCount,
    failCount,
    totalDurationMs,
    totalCost,
    totalTokens,
    errorCount,
  };
}

export function calculateDerivedMetrics(
  raw: RawMetrics,
  yesterdayMetrics?: AiMetricsDaily | null,
): Omit<AiMetricsDaily, "id" | "assetId" | "date" | "createdAt" | "updatedAt"> {
  const taskCount = raw.taskCount;
  const successCount = raw.successCount;
  const failCount = raw.failCount;

  const avgLatencyMs = taskCount > 0 ? Math.round(raw.totalDurationMs / taskCount) : 0;
  const avgCostPerTask = taskCount > 0 ? raw.totalCost / taskCount : 0;
  const successRate = taskCount > 0 ? successCount / taskCount : 0;

  // Calculate cost growth rate
  let costGrowthRate = 0;
  if (yesterdayMetrics && yesterdayMetrics.totalCost > 0) {
    costGrowthRate = (raw.totalCost - yesterdayMetrics.totalCost) / yesterdayMetrics.totalCost;
  }

  return {
    taskCount,
    successCount,
    failCount,
    avgLatencyMs,
    totalDurationMs: raw.totalDurationMs,
    totalTokens: raw.totalTokens,
    totalCost: raw.totalCost,
    avgCostPerTask,
    errorCount: raw.errorCount,
    successRate,
    costGrowthRate,
  };
}

// ============================================================================
// Risk Assessment
// ============================================================================

export function assessRisk(
  metrics: AiMetricsDaily,
  activeAnomalies: Pick<AiAnomaly, "type" | "severity">[],
): { level: RiskLevel; factors: string[] } {
  const factors: string[] = [];
  let severityScore = 0;

  for (const anomaly of activeAnomalies) {
    if (anomaly.severity === "high") {
      severityScore += 3;
      factors.push(`high severity: ${anomaly.type}`);
    } else if (anomaly.severity === "medium") {
      severityScore += 2;
      factors.push(`medium severity: ${anomaly.type}`);
    } else {
      severityScore += 1;
    }
  }

  if (metrics.successRate < 0.7) {
    severityScore += 2;
    factors.push(`low success rate: ${(metrics.successRate * 100).toFixed(1)}%`);
  }

  if (metrics.costGrowthRate > 0.5) {
    severityScore += 2;
    factors.push(`cost spike: +${(metrics.costGrowthRate * 100).toFixed(1)}%`);
  }

  if (metrics.avgLatencyMs > 5000) {
    severityScore += 1;
    factors.push(`high latency: ${metrics.avgLatencyMs}ms`);
  }

  let level: RiskLevel;
  if (severityScore >= 5) {
    level = "high";
  } else if (severityScore >= 2) {
    level = "medium";
  } else {
    level = "low";
  }

  return { level, factors };
}

// ============================================================================
// Anomaly Helpers
// ============================================================================

export function createAnomaly(
  assetId: string,
  type: AnomalyType,
  severity: AnomalySeverity,
  description: string,
  metadata?: Record<string, unknown>,
): Omit<AiAnomaly, "id" | "createdAt"> {
  return {
    assetId,
    type,
    severity,
    description,
    detectedAt: new Date().toISOString(),
    resolvedAt: null,
    status: "pending",
    metadata: metadata ?? null,
  };
}

export function formatAnomalyDescription(type: AnomalyType, metrics: AiMetricsDaily): string {
  switch (type) {
    case "no_task":
      return `Asset has incurred $${metrics.totalCost.toFixed(2)} cost but has 0 completed tasks`;
    case "cost_spike":
      return `Cost increased by ${(metrics.costGrowthRate * 100).toFixed(1)}% compared to yesterday`;
    case "high_failure":
      return `Failure rate is ${((metrics.failCount / metrics.taskCount) * 100).toFixed(1)}% (${metrics.failCount}/${metrics.taskCount} tasks)`;
    case "runtime_error":
      return `Runtime encountered ${metrics.errorCount} errors`;
    case "low_success_rate":
      return `Success rate dropped to ${(metrics.successRate * 100).toFixed(1)}%`;
    case "high_latency":
      return `Average latency is ${metrics.avgLatencyMs}ms, exceeding threshold`;
    default:
      return "Anomaly detected: unknown";
  }
}

// ============================================================================
// Status Helpers
// ============================================================================

export function isValidAssetStatus(status: string): status is AiAssetStatus {
  return ["active", "paused", "error"].includes(status);
}

export function normalizeAssetStatus(status: string): AiAssetStatus {
  if (isValidAssetStatus(status)) {
    return status;
  }
  return "active";
}

// ============================================================================
// Pagination Helpers
// ============================================================================

export function calculatePagination(
  total: number,
  page: number,
  pageSize: number,
): {
  totalPages: number;
  offset: number;
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
} {
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;
  const limit = pageSize;
  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  return { totalPages, offset, limit, hasNext, hasPrev };
}

// ============================================================================
// Search Helpers
// ============================================================================

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function matchesSearch(text: string, query: string): boolean {
  if (!query) {
    return true;
  }
  return text.toLowerCase().includes(normalizeSearchQuery(query));
}
