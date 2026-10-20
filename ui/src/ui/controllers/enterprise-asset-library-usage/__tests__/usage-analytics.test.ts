// @vitest-environment node
// Feature: enterprise-capability-usage-management
// Usage Analytics controller — state transition tests

import { describe, expect, it, vi } from "vitest";
import type { EnterpriseUsageGateway } from "../../../capability/enterprise-asset-library-usage/gateway-client.ts";
import { createUsageAnalyticsController } from "../usage-analytics.ts";

function createMockGateway() {
  return {
    listRobotCapabilityViews: vi.fn(),
    getRobotDetail: vi.fn(),
    getAnalytics: vi.fn(async () => ({
      kpis: {
        totalMonthlyExecutions: {
          current: 1000,
          previousMonthChange: 100,
          previousMonthPercentage: 0.11,
        },
        coveredRobots: { current: 5, previousMonthChange: 1, previousMonthPercentage: 0.25 },
        coveredEmployees: { current: 50, previousMonthChange: 5, previousMonthPercentage: 0.11 },
        averageSuccessRate: {
          current: 0.92,
          previousMonthChange: 0.02,
          previousMonthPercentage: 0.022,
        },
      },
      trendExecutions: { dates: ["2024-05-01", "2024-05-02"], values: [100, 200] },
      trendCapabilityReuse: { dates: ["2024-05-01", "2024-05-02"], values: [10, 12] },
      topCapabilities: [
        {
          capabilityId: "c1",
          capabilityName: "Cap A",
          monthlyExecutions: 500,
          successRate: 0.95,
          coveredRobots: 3,
        },
      ],
    })),
    detectGovernance: vi.fn(),
    acknowledgeGovernance: vi.fn(),
    updateGovernanceConfig: vi.fn(),
  } as unknown as EnterpriseUsageGateway;
}

describe("UsageAnalyticsController", () => {
  it("loads analytics data on initial call", async () => {
    const gateway = createMockGateway();
    const controller = createUsageAnalyticsController(gateway, () => {});
    await controller.load();
    const state = controller.getState();
    expect(state.kpis?.totalMonthlyExecutions.current).toBe(1000);
    expect(state.trendExecutions?.values).toHaveLength(2);
    expect(state.topCapabilities).toHaveLength(1);
  });

  it("changeWindow updates window and reloads", async () => {
    const gateway = createMockGateway();
    const controller = createUsageAnalyticsController(gateway, () => {});
    expect(controller.getState().window).toBe(30);
    controller.changeWindow(7);
    await new Promise((r) => setTimeout(r, 10));
    expect(controller.getState().window).toBe(7);
    expect(
      (gateway.getAnalytics as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("captures error state on gateway failure", async () => {
    const gateway = createMockGateway();
    (gateway.getAnalytics as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network error"),
    );
    const controller = createUsageAnalyticsController(gateway, () => {});
    await controller.load();
    expect(controller.getState().error).toBeTruthy();
    expect(controller.getState().loading).toBe(false);
  });
});
