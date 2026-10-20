// @vitest-environment node
// Feature: enterprise-capability-usage-management
// Robot Capability View controller — state transition tests

import { describe, expect, it, vi } from "vitest";
import type { EnterpriseUsageGateway } from "../../../capability/enterprise-asset-library-usage/gateway-client.ts";
import { createRobotCapabilityViewController } from "../robot-capability-view.ts";

function createMockGateway(): EnterpriseUsageGateway & {
  listRobotCapabilityViews: ReturnType<typeof vi.fn>;
  getRobotDetail: ReturnType<typeof vi.fn>;
} {
  return {
    listRobotCapabilityViews: vi.fn(async () => ({
      items: [
        {
          robotId: "r1",
          robotName: "Robot 1",
          capabilityCount: 3,
          monthlyExecutions: 100,
          employeeCoverage: 5,
          successRate: 0.9,
          healthStatus: "效果稳定" as const,
          topCapabilities: ["A", "B"],
        },
      ],
      pagination: { currentPage: 1, pageSize: 10, totalItems: 1 },
      kpis: {
        totalRobots: 1,
        totalMonthlyExecutions: 100,
        totalEmployeeCoverage: 5,
        averageSuccessRate: 0.9,
      },
    })),
    getRobotDetail: vi.fn(async () => ({
      basic: {
        robotId: "r1",
        robotName: "Robot 1",
        healthStatus: "效果稳定" as const,
        lastActiveAt: 1700000000000,
      },
      capabilities: [],
      trend30d: { dates: [], dailyExecutions: [] },
      topCapabilities: [],
    })),
    getAnalytics: vi.fn(),
    detectGovernance: vi.fn(),
    acknowledgeGovernance: vi.fn(),
    updateGovernanceConfig: vi.fn(),
  } as unknown as EnterpriseUsageGateway & {
    listRobotCapabilityViews: ReturnType<typeof vi.fn>;
    getRobotDetail: ReturnType<typeof vi.fn>;
  };
}

describe("RobotCapabilityViewController", () => {
  it("loads items and updates state", async () => {
    const gateway = createMockGateway();
    let captured: unknown;
    const controller = createRobotCapabilityViewController(gateway, (s) => {
      captured = s;
    });
    await controller.load();
    expect(controller.getState().loading).toBe(false);
    expect(controller.getState().items).toHaveLength(1);
    expect(controller.getState().kpis?.totalRobots).toBe(1);
    expect(captured).toBeDefined();
  });

  it("updateFilter resets pagination to page 1 and triggers load", async () => {
    const gateway = createMockGateway();
    const controller = createRobotCapabilityViewController(gateway, () => {});
    controller.changePage(3);
    controller.updateFilter({ nameQuery: "test" });
    await new Promise((r) => setTimeout(r, 10));
    expect(controller.getState().filters.nameQuery).toBe("test");
    expect(controller.getState().pagination.currentPage).toBe(1);
  });

  it("changeSort toggles direction when same field is clicked", async () => {
    const gateway = createMockGateway();
    const controller = createRobotCapabilityViewController(gateway, () => {});
    expect(controller.getState().sorting.direction).toBe("desc");
    controller.changeSort("monthlyExecutions");
    await new Promise((r) => setTimeout(r, 10));
    expect(controller.getState().sorting.direction).toBe("asc");
    controller.changeSort("monthlyExecutions");
    await new Promise((r) => setTimeout(r, 10));
    expect(controller.getState().sorting.direction).toBe("desc");
  });

  it("openDetail loads robot detail data", async () => {
    const gateway = createMockGateway();
    const controller = createRobotCapabilityViewController(gateway, () => {});
    await controller.openDetail("r1");
    expect(controller.getState().detail.open).toBe(true);
    expect(controller.getState().detail.robotId).toBe("r1");
    expect(controller.getState().detail.data?.robotName).toBe("Robot 1");
  });

  it("closeDetail resets detail to default", async () => {
    const gateway = createMockGateway();
    const controller = createRobotCapabilityViewController(gateway, () => {});
    await controller.openDetail("r1");
    controller.closeDetail();
    expect(controller.getState().detail.open).toBe(false);
    expect(controller.getState().detail.robotId).toBeNull();
  });

  it("captures error state when gateway fails", async () => {
    const gateway = createMockGateway();
    (gateway.listRobotCapabilityViews as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network error"),
    );
    const controller = createRobotCapabilityViewController(gateway, () => {});
    await controller.load();
    expect(controller.getState().loading).toBe(false);
    expect(controller.getState().error).toBeTruthy();
  });

  it("retries transient 'gateway not connected' rejections and recovers", async () => {
    // Regression: landing on the page before the WebSocket is OPEN used to leave
    // the view permanently stuck on "加载失败" even though the gateway was fine.
    const gateway = createMockGateway();
    const listFn = gateway.listRobotCapabilityViews as ReturnType<typeof vi.fn>;
    listFn.mockRejectedValueOnce(new Error("gateway not connected"));
    const controller = createRobotCapabilityViewController(gateway, () => {});

    await controller.load();

    expect(listFn.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(controller.getState().error).toBeNull();
    expect(controller.getState().items.length).toBe(1);
    expect(controller.getState().loading).toBe(false);
  });
});
