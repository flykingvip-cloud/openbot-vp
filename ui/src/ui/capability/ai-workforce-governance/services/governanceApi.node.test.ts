import { describe, expect, it } from "vitest";
import type { DashboardStats, MeshGrowthAggregateView } from "../types/index.ts";
import { blendPerformanceGrowth } from "./governanceApi.ts";

describe("blendPerformanceGrowth", () => {
  it("returns null when both inputs are missing", () => {
    expect(blendPerformanceGrowth(null, null)).toBeNull();
  });

  it("merges dashboard cost metrics with growth velocity", () => {
    const dashboard: DashboardStats = {
      summary: { totalAssets: 3, activeAssets: 3, pausedAssets: 0, errorAssets: 0 },
      metrics: {
        totalTasksToday: 120,
        totalCostToday: 45.5,
        avgSuccessRate: 0.92,
        totalAnomalies: 0,
        pendingAnomalies: 0,
      },
      riskDistribution: { low: 3, medium: 0, high: 0 },
      recentAnomalies: [],
    };
    const growth = {
      generatedAt: "2026-08-04T00:00:00.000Z",
      summary: {
        botCount: 2,
        trackedCount: 2,
        withOperationalScore: 1,
        falseReadyCount: 0,
        activatedCount: 0,
        missionReadyCount: 1,
        avgActivationScore: 70,
        avgOperationalScore: 55,
        avgGrowthVelocity: 5,
      },
      lifecycleDistribution: {},
      workingStyle: {
        botsWithProfile: 0,
        botsWithRecentChange: 0,
        effectiveness: {
          overall: {
            total: 0,
            improved: 0,
            regressed: 0,
            inconclusive: 0,
            rolledBack: 0,
            improvedRate: null,
            avgDeltaScore: null,
          },
        },
      },
      ranking: [],
    } satisfies MeshGrowthAggregateView;

    const blend = blendPerformanceGrowth(dashboard, growth);
    expect(blend).toEqual({
      totalCostToday: 45.5,
      totalTasksToday: 120,
      avgSuccessRate: 0.92,
      avgCostPerBot: 22.75,
      avgGrowthVelocity: 5,
      costPerGrowthPoint: 4.55,
    });
  });
});
