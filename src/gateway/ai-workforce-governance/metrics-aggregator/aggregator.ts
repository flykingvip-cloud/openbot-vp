/**
 * Metrics Aggregator
 * Scheduled job to calculate daily metrics from run logs.
 */

import * as runsStore from "../ai-runs/store.js";
import type { AiMetricsDaily, AggregationResult } from "../shared/types.js";
import {
  generateMetricsId,
  getTodayDate,
  getYesterdayDate,
  getStartOfDay,
  getEndOfDay,
  calculateMetrics,
  calculateDerivedMetrics,
} from "../shared/utils.js";

// ============================================================================
// In-Memory Store for Metrics
// ============================================================================

const metricsStore = new Map<string, AiMetricsDaily>();

// ============================================================================
// Aggregation Core
// ============================================================================

export async function aggregateMetricsForAsset(
  assetId: string,
  date: string,
): Promise<AggregationResult> {
  const startTime = getStartOfDay(date);
  const endTime = getEndOfDay(date);

  // Get all runs for the asset on the specified date
  const runs = await runsStore.getRunsForAggregation(assetId, startTime, endTime);

  // Get yesterday's metrics for growth rate calculation
  const yesterdayMetrics = await getMetricsForAssetAndDate(assetId, getYesterdayDate());

  // Calculate raw metrics
  const raw = calculateMetrics(
    runs.map((r) => ({
      durationMs: r.durationMs,
      cost: r.cost,
      tokensInput: r.tokensInput,
      tokensOutput: r.tokensOutput,
      status: r.status,
      errorCode: r.errorCode,
    })),
  );

  // Calculate derived metrics
  const derived = calculateDerivedMetrics(raw, yesterdayMetrics);

  const result: AggregationResult = {
    assetId,
    date,
    metrics: derived,
    inserted: false,
  };

  // Store the metrics
  const id = generateMetricsId();
  const now = new Date().toISOString();
  const dailyMetrics: AiMetricsDaily = {
    id,
    assetId,
    date,
    ...derived,
    createdAt: now,
    updatedAt: now,
  };

  // Use composite key for lookup
  const key = `${assetId}:${date}`;
  metricsStore.set(key, dailyMetrics);
  result.inserted = true;

  return result;
}

export async function aggregateMetricsForAllAssets(
  assetIds: string[],
  date: string = getTodayDate(),
): Promise<AggregationResult[]> {
  const results: AggregationResult[] = [];

  for (const assetId of assetIds) {
    try {
      const result = await aggregateMetricsForAsset(assetId, date);
      results.push(result);
    } catch (error) {
      console.error(`[MetricsAggregator] Failed to aggregate metrics for asset ${assetId}:`, error);
    }
  }

  return results;
}

// ============================================================================
// Scheduled Job
// ============================================================================

export interface AggregationJob {
  intervalMinutes: number;
  lastRunAt: string | null;
  isRunning: boolean;
}

let currentJob: AggregationJob = {
  intervalMinutes: 5,
  lastRunAt: null,
  isRunning: false,
};

export async function runAggregationJob(assetIds: string[]): Promise<{
  startedAt: string;
  completedAt: string;
  processed: number;
  errors: number;
}> {
  if (currentJob.isRunning) {
    throw new Error("Aggregation job is already running");
  }

  currentJob.isRunning = true;
  const startedAt = new Date().toISOString();
  let processed = 0;
  let errors = 0;

  try {
    const results = await aggregateMetricsForAllAssets(assetIds);
    processed = results.length;
    errors = results.filter((r) => !r.inserted).length;
  } finally {
    currentJob.isRunning = false;
    currentJob.lastRunAt = new Date().toISOString();
  }

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    processed,
    errors,
  };
}

export function getAggregationJobStatus(): AggregationJob {
  return { ...currentJob };
}

export function configureAggregationJob(config: { intervalMinutes: number }): void {
  currentJob.intervalMinutes = config.intervalMinutes;
}

// ============================================================================
// Metrics Retrieval
// ============================================================================

export async function getMetricsForAssetAndDate(
  assetId: string,
  date: string,
): Promise<AiMetricsDaily | null> {
  const key = `${assetId}:${date}`;
  return metricsStore.get(key) ?? null;
}

export async function getLatestMetricsForAsset(assetId: string): Promise<AiMetricsDaily | null> {
  // Find the most recent metrics for this asset
  const allMetrics = Array.from(metricsStore.values()).filter((m) => m.assetId === assetId);

  if (allMetrics.length === 0) {
    return null;
  }

  return allMetrics.toSorted((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
}

export async function getMetricsForAssetRange(
  assetId: string,
  startDate: string,
  endDate: string,
): Promise<AiMetricsDaily[]> {
  const metrics = Array.from(metricsStore.values()).filter((m) => {
    if (m.assetId !== assetId) {
      return false;
    }
    return m.date >= startDate && m.date <= endDate;
  });

  return [...metrics].toSorted((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export async function getAllLatestMetrics(): Promise<Map<string, AiMetricsDaily>> {
  const latestMetrics = new Map<string, AiMetricsDaily>();

  for (const metric of metricsStore.values()) {
    const existing = latestMetrics.get(metric.assetId);
    if (!existing || new Date(metric.date).getTime() > new Date(existing.date).getTime()) {
      latestMetrics.set(metric.assetId, metric);
    }
  }

  return latestMetrics;
}

// ============================================================================
// Metrics Update (for corrections)
// ============================================================================

export async function updateMetrics(
  assetId: string,
  date: string,
  updates: Partial<Omit<AiMetricsDaily, "id" | "assetId" | "createdAt">>,
): Promise<AiMetricsDaily | null> {
  const key = `${assetId}:${date}`;
  const existing = metricsStore.get(key);

  if (!existing) {
    return null;
  }

  const updated: AiMetricsDaily = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  metricsStore.set(key, updated);
  return updated;
}

// ============================================================================
// Store Management
// ============================================================================

export function clearMetricsStore(): void {
  metricsStore.clear();
}

export function seedMetricsForTesting(metrics: AiMetricsDaily[]): void {
  for (const metric of metrics) {
    const key = `${metric.assetId}:${metric.date}`;
    metricsStore.set(key, metric);
  }
}

export function getMetricsStoreSize(): number {
  return metricsStore.size;
}

// ============================================================================
// Cleanup
// ============================================================================

export async function cleanupOldMetrics(retentionDays: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  let count = 0;
  for (const [key, metric] of metricsStore) {
    if (metric.date < cutoffStr) {
      metricsStore.delete(key);
      count++;
    }
  }

  return count;
}
