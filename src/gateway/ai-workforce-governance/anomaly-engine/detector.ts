/**
 * Anomaly Detection Engine
 * Automatically detects anomalies based on rules and metrics.
 */

import type {
  AiAnomaly,
  AiMetricsDaily,
  AnomalySeverity,
  AnomalyType,
  DetectionResult,
  DetectionRule,
} from "../shared/types.ts";
import { generateAnomalyId, createAnomaly } from "../shared/utils.ts";

// ============================================================================
// In-Memory Store
// ============================================================================

const anomaliesStore = new Map<string, AiAnomaly>();

// ============================================================================
// Detection Rules
// ============================================================================

const DEFAULT_RULES: DetectionRule[] = [
  // Rule 1: No task anomaly - Cost incurred but no tasks
  {
    type: "no_task",
    severity: "high",
    condition: (metrics) => metrics.taskCount === 0 && metrics.totalCost > 0,
    description: (metrics) =>
      `Asset incurred $${metrics.totalCost.toFixed(2)} cost with 0 completed tasks`,
  },

  // Rule 2: Cost spike - Cost growth > 30%
  {
    type: "cost_spike",
    severity: "medium",
    condition: (metrics) => metrics.costGrowthRate > 0.3,
    description: (metrics) =>
      `Cost increased by ${(metrics.costGrowthRate * 100).toFixed(1)}% compared to yesterday`,
  },

  // Rule 3: High failure rate - > 30% failure
  {
    type: "high_failure",
    severity: "high",
    condition: (metrics) => metrics.taskCount > 0 && metrics.failCount / metrics.taskCount > 0.3,
    description: (metrics) =>
      `Failure rate is ${((metrics.failCount / metrics.taskCount) * 100).toFixed(1)}% (${metrics.failCount}/${metrics.taskCount} tasks)`,
  },

  // Rule 4: Runtime errors - Error count threshold
  {
    type: "runtime_error",
    severity: "high",
    condition: (metrics) => metrics.errorCount >= 5,
    description: (metrics) => `Runtime encountered ${metrics.errorCount} errors`,
  },

  // Rule 5: Low success rate - < 70% success
  {
    type: "low_success_rate",
    severity: "medium",
    condition: (metrics) => metrics.taskCount > 5 && metrics.successRate < 0.7,
    description: (metrics) => `Success rate dropped to ${(metrics.successRate * 100).toFixed(1)}%`,
  },

  // Rule 6: High latency - Average latency > 5 seconds
  {
    type: "high_latency",
    severity: "low",
    condition: (metrics) => metrics.taskCount > 0 && metrics.avgLatencyMs > 5000,
    description: (metrics) =>
      `Average latency is ${metrics.avgLatencyMs}ms, exceeding 5000ms threshold`,
  },
];

let activeRules: DetectionRule[] = [...DEFAULT_RULES];

// ============================================================================
// Core Detection
// ============================================================================

export async function detectAnomalies(
  assetId: string,
  metrics: AiMetricsDaily,
  history: AiMetricsDaily[] = [],
): Promise<DetectionResult[]> {
  const results: DetectionResult[] = [];

  for (const rule of activeRules) {
    try {
      const triggered = rule.condition(metrics, history);

      if (triggered) {
        const anomalyData = createAnomaly(
          assetId,
          rule.type,
          rule.severity,
          rule.description(metrics),
          {
            metricId: metrics.id,
            taskCount: metrics.taskCount,
            failCount: metrics.failCount,
            successRate: metrics.successRate,
            costGrowthRate: metrics.costGrowthRate,
            detectedBy: rule.type,
          },
        );

        results.push({
          triggered: true,
          anomaly: anomalyData,
        });
      }
    } catch (error) {
      console.error(`[AnomalyDetector] Rule ${rule.type} failed for asset ${assetId}:`, error);
    }
  }

  return results;
}

export async function runDetectionForAsset(
  assetId: string,
  metrics: AiMetricsDaily,
  history: AiMetricsDaily[] = [],
): Promise<AiAnomaly[]> {
  const results = await detectAnomalies(assetId, metrics, history);
  const detectedAnomalies: AiAnomaly[] = [];

  for (const result of results) {
    if (result.triggered && result.anomaly) {
      // Check if similar anomaly already exists for this asset
      const existing = await findPendingAnomalyOfType(assetId, result.anomaly.type);

      if (!existing) {
        // Create new anomaly
        const anomaly = await createAnomalyRecord(result.anomaly);
        detectedAnomalies.push(anomaly);
      }
    }
  }

  return detectedAnomalies;
}

// ============================================================================
// Anomaly CRUD
// ============================================================================

export async function createAnomalyRecord(
  data: Omit<AiAnomaly, "id" | "createdAt">,
): Promise<AiAnomaly> {
  const anomaly: AiAnomaly = {
    ...data,
    id: generateAnomalyId(),
    createdAt: new Date().toISOString(),
  };

  anomaliesStore.set(anomaly.id, anomaly);
  return anomaly;
}

export async function getAnomalyById(id: string): Promise<AiAnomaly | null> {
  return anomaliesStore.get(id) ?? null;
}

export async function resolveAnomaly(
  id: string,
  _resolutionNote?: string,
): Promise<AiAnomaly | null> {
  const anomaly = anomaliesStore.get(id);
  if (!anomaly) {
    return null;
  }

  const resolved: AiAnomaly = {
    ...anomaly,
    status: "resolved",
    resolvedAt: new Date().toISOString(),
  };

  anomaliesStore.set(id, resolved);
  return resolved;
}

// ============================================================================
// Query Operations
// ============================================================================

export async function listAnomalies(
  filters: {
    assetId?: string;
    severity?: AnomalySeverity;
    status?: "pending" | "resolved";
    type?: AnomalyType;
    limit?: number;
  } = {},
): Promise<AiAnomaly[]> {
  let anomalies = Array.from(anomaliesStore.values());

  if (filters.assetId) {
    anomalies = anomalies.filter((a) => a.assetId === filters.assetId);
  }

  if (filters.severity) {
    anomalies = anomalies.filter((a) => a.severity === filters.severity);
  }

  if (filters.status) {
    anomalies = anomalies.filter((a) => a.status === filters.status);
  }

  if (filters.type) {
    anomalies = anomalies.filter((a) => a.type === filters.type);
  }

  // Sort by detected_at descending
  anomalies = anomalies.toSorted(
    (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
  );

  if (filters.limit) {
    anomalies = anomalies.slice(0, filters.limit);
  }

  return anomalies;
}

export async function findPendingAnomalyOfType(
  assetId: string,
  type: AnomalyType,
): Promise<AiAnomaly | null> {
  const anomalies = await listAnomalies({ assetId, status: "pending", type });
  return anomalies[0] ?? null;
}

export async function getPendingAnomaliesForAsset(assetId: string): Promise<AiAnomaly[]> {
  return listAnomalies({ assetId, status: "pending" });
}

export async function countActiveAnomaliesByAsset(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  for (const anomaly of anomaliesStore.values()) {
    if (anomaly.status === "pending") {
      const current = counts.get(anomaly.assetId) ?? 0;
      counts.set(anomaly.assetId, current + 1);
    }
  }

  return counts;
}

// ============================================================================
// Batch Detection
// ============================================================================

export async function runBatchDetection(
  metricsByAsset: Map<string, AiMetricsDaily>,
  historyByAsset: Map<string, AiMetricsDaily[]>,
): Promise<{
  totalProcessed: number;
  newAnomalies: number;
  errors: number;
}> {
  let totalProcessed = 0;
  let newAnomalies = 0;
  let errors = 0;

  for (const [assetId, metrics] of metricsByAsset) {
    try {
      totalProcessed++;
      const history = historyByAsset.get(assetId) ?? [];
      const detected = await runDetectionForAsset(assetId, metrics, history);
      newAnomalies += detected.length;
    } catch (error) {
      errors++;
      console.error(`[AnomalyDetector] Batch detection failed for asset ${assetId}:`, error);
    }
  }

  return { totalProcessed, newAnomalies, errors };
}

// ============================================================================
// Rule Management
// ============================================================================

export function getActiveRules(): DetectionRule[] {
  return [...activeRules];
}

export function addRule(rule: DetectionRule): void {
  activeRules.push(rule);
}

export function removeRule(type: AnomalyType): void {
  activeRules = activeRules.filter((r) => r.type !== type);
}

export function resetRules(): void {
  activeRules = [...DEFAULT_RULES];
}

// ============================================================================
// Store Management
// ============================================================================

export function clearAnomaliesStore(): void {
  anomaliesStore.clear();
}

export function seedAnomaliesForTesting(anomalies: AiAnomaly[]): void {
  for (const anomaly of anomalies) {
    anomaliesStore.set(anomaly.id, anomaly);
  }
}

export function getAnomaliesStoreSize(): number {
  return anomaliesStore.size;
}

// ============================================================================
// Cleanup
// ============================================================================

export async function cleanupOldAnomalies(retentionDays: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  let count = 0;
  for (const [id, anomaly] of anomaliesStore) {
    if (new Date(anomaly.createdAt).getTime() < cutoff.getTime()) {
      anomaliesStore.delete(id);
      count++;
    }
  }

  return count;
}

export async function cleanupResolvedAnomalies(retentionDays: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  let count = 0;
  for (const [id, anomaly] of anomaliesStore) {
    if (
      anomaly.status === "resolved" &&
      anomaly.resolvedAt &&
      new Date(anomaly.resolvedAt).getTime() < cutoff.getTime()
    ) {
      anomaliesStore.delete(id);
      count++;
    }
  }

  return count;
}
