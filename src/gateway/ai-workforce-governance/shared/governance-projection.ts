export type GovernanceProjectionAsset = {
  id: string;
  name: string;
  type: "bot" | "group";
  status: "active" | "paused" | "error";
  metrics: {
    taskCount: number;
    successRate: number;
    avgLatencyMs: number;
    totalCost: number;
  };
  riskLevel: "low" | "medium" | "high";
  activeAnomalyCount: number;
};

export type GovernanceProjectionActionHistoryRecord = {
  id: string;
  assetId: string;
  assetName: string;
  action: string;
  trigger: "manual" | "auto_governance" | "anomaly";
  reason: string;
  status: "pending" | "executed" | "failed" | "cancelled";
  executedAt?: string;
  createdAt: string;
};

export function deriveGovernanceScore(
  asset: Pick<GovernanceProjectionAsset, "metrics" | "activeAnomalyCount" | "status">,
) {
  const activityScore = Math.min(asset.metrics.taskCount * 2, 35);
  const successScore = asset.metrics.successRate * 45;
  const costPenalty = Math.min(asset.metrics.totalCost, 20);
  const anomalyPenalty = asset.activeAnomalyCount * 10;
  const statusPenalty = asset.status === "error" ? 20 : asset.status === "paused" ? 10 : 0;
  return Math.max(
    0,
    Math.round(activityScore + successScore - costPenalty - anomalyPenalty - statusPenalty),
  );
}

export function withDerivedScores<T extends GovernanceProjectionAsset>(assets: T[]) {
  return assets.map((asset) => ({
    ...asset,
    score: deriveGovernanceScore(asset),
  }));
}

export function buildGovernanceAnomalies(assets: GovernanceProjectionAsset[], nowIso: string) {
  return assets
    .filter((asset) => asset.activeAnomalyCount > 0)
    .flatMap((asset) =>
      Array.from({ length: asset.activeAnomalyCount }).map((_, index) => ({
        id: `${asset.id}:anomaly:${index + 1}`,
        assetId: asset.id,
        assetName: asset.name,
        assetType: asset.type,
        type: asset.riskLevel === "high" ? "high_failure" : "cost_spike",
        severity: asset.riskLevel === "high" ? "high" : "medium",
        description:
          asset.riskLevel === "high" ? "运行成功率偏低或健康状态异常" : "运行成本高于治理预期",
        detectedAt: nowIso,
        status: "pending",
      })),
    );
}

export function buildGovernanceSuggestedActions(
  assets: GovernanceProjectionAsset[],
  history: GovernanceProjectionActionHistoryRecord[],
  nowIso: string,
) {
  const derivedPending = assets
    .filter((asset) => asset.activeAnomalyCount > 0)
    .map((asset) => ({
      id: `${asset.id}:governance-action`,
      assetId: asset.id,
      assetName: asset.name,
      action: asset.riskLevel === "high" ? "pause" : "notify_admin",
      trigger: "anomaly" as const,
      reason: asset.riskLevel === "high" ? "运行成功率偏低或健康状态异常" : "运行成本高于治理预期",
      status: "pending" as const,
      createdAt: nowIso,
    }));

  const historyById = new Map(history.map((entry) => [entry.id, entry] as const));
  const merged = derivedPending.map((entry) => historyById.get(entry.id) ?? entry);
  const knownIds = new Set(merged.map((entry) => entry.id));

  for (const entry of history) {
    if (!knownIds.has(entry.id)) {
      merged.push(entry);
    }
  }

  return merged.toSorted((left, right) => {
    if (left.status !== right.status) {
      return left.status === "pending" ? -1 : 1;
    }
    return right.createdAt.localeCompare(left.createdAt);
  });
}

export function buildGovernanceRanking(
  assets: GovernanceProjectionAsset[],
  type: "bot" | "group" | "position",
) {
  const scored = withDerivedScores(assets)
    .filter((asset) => (type === "position" ? true : asset.type === type))
    .toSorted((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .map((asset, index) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      score: asset.score,
      rank: index + 1,
      metrics: {
        taskCount: asset.metrics.taskCount,
        successRate: asset.metrics.successRate,
        avgCost:
          asset.metrics.taskCount > 0
            ? asset.metrics.totalCost / asset.metrics.taskCount
            : asset.metrics.totalCost,
      },
    }));

  return {
    type,
    items: scored,
    total: scored.length,
    generatedAt: new Date().toISOString(),
  };
}

export function buildGovernanceDashboard(assets: GovernanceProjectionAsset[], nowIso: string) {
  const anomalies = buildGovernanceAnomalies(assets, nowIso);
  return {
    summary: {
      totalAssets: assets.length,
      activeAssets: assets.filter((asset) => asset.status === "active").length,
      pausedAssets: assets.filter((asset) => asset.status === "paused").length,
      errorAssets: assets.filter((asset) => asset.status === "error").length,
    },
    metrics: {
      totalTasksToday: assets.reduce((sum, asset) => sum + asset.metrics.taskCount, 0),
      totalCostToday: assets.reduce((sum, asset) => sum + asset.metrics.totalCost, 0),
      avgSuccessRate:
        assets.length > 0
          ? assets.reduce((sum, asset) => sum + asset.metrics.successRate, 0) / assets.length
          : 0,
      totalAnomalies: anomalies.length,
      pendingAnomalies: anomalies.length,
    },
    riskDistribution: {
      low: assets.filter((asset) => asset.riskLevel === "low").length,
      medium: assets.filter((asset) => asset.riskLevel === "medium").length,
      high: assets.filter((asset) => asset.riskLevel === "high").length,
    },
    recentAnomalies: anomalies.slice(0, 5),
  };
}
