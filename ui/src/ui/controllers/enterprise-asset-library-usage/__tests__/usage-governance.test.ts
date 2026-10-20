// @vitest-environment node
// Feature: enterprise-capability-usage-management
// Usage Governance controller — state transition tests

import { describe, expect, it, vi } from "vitest";
import type { EnterpriseUsageGateway } from "../../../capability/enterprise-asset-library-usage/gateway-client.ts";
import { createUsageGovernanceController } from "../usage-governance.ts";

function createMockGateway() {
  return {
    listRobotCapabilityViews: vi.fn(),
    getRobotDetail: vi.fn(),
    getAnalytics: vi.fn(),
    detectGovernance: vi.fn(async () => ({
      lowEfficiency: [
        {
          issueId: "低效能力|c1|r1",
          type: "低效能力" as const,
          capabilityId: "c1",
          robotId: "r1",
          description: "低效",
          suggestion: "重新整理能力" as const,
          evidence: { executions30d: 100, successRate: 0.5 },
          detectedAt: 0,
        },
        {
          issueId: "低效能力|c2|r1",
          type: "低效能力" as const,
          capabilityId: "c2",
          robotId: "r1",
          description: "低效",
          suggestion: "重新整理能力" as const,
          evidence: { executions30d: 80, successRate: 0.55 },
          detectedAt: 0,
        },
      ],
      zombie: [
        {
          issueId: "未使用能力|c3|r2",
          type: "未使用能力" as const,
          capabilityId: "c3",
          robotId: "r2",
          description: "僵尸",
          suggestion: "卸载" as const,
          evidence: { executions30d: 0, installDays: 60 },
          detectedAt: 0,
        },
      ],
      conflict: [],
    })),
    acknowledgeGovernance: vi.fn(async () => ({ acknowledged: true as const })),
    updateGovernanceConfig: vi.fn(async () => ({
      config: {
        lowEfficiency: { minExecutions: 50, maxSuccessRate: 0.7 },
        zombie: { minInstallDays: 30 },
        conflict: { minSimilarity: 0.8 },
      },
    })),
  } as unknown as EnterpriseUsageGateway;
}

describe("UsageGovernanceController", () => {
  it("loads governance issues on initial call", async () => {
    const gateway = createMockGateway();
    const controller = createUsageGovernanceController(gateway, () => {});
    await controller.load();
    expect(controller.getState().lowEfficiency).toHaveLength(2);
    expect(controller.getState().zombie).toHaveLength(1);
    expect(controller.getState().conflict).toHaveLength(0);
  });

  it("changeTab updates activeTab", async () => {
    const gateway = createMockGateway();
    const controller = createUsageGovernanceController(gateway, () => {});
    expect(controller.getState().activeTab).toBe("低效能力");
    controller.changeTab("未使用能力");
    expect(controller.getState().activeTab).toBe("未使用能力");
  });

  it("acknowledge filters out the issue from getVisibleIssues", async () => {
    const gateway = createMockGateway();
    const controller = createUsageGovernanceController(gateway, () => {});
    await controller.load();
    expect(controller.getVisibleIssues("低效能力")).toHaveLength(2);
    controller.acknowledge("低效能力|c1|r1");
    expect(controller.getVisibleIssues("低效能力")).toHaveLength(1);
  });

  it("acknowledge is in-memory only (no gateway call)", async () => {
    const gateway = createMockGateway();
    const controller = createUsageGovernanceController(gateway, () => {});
    await controller.load();
    controller.acknowledge("low-eff-c1-r1");
    expect((gateway.acknowledgeGovernance as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("updateConfig calls gateway and reloads", async () => {
    const gateway = createMockGateway();
    const controller = createUsageGovernanceController(gateway, () => {});
    await controller.updateConfig({ lowEfficiency: { minExecutions: 100, maxSuccessRate: 0.6 } });
    await new Promise((r) => setTimeout(r, 10));
    expect((gateway.updateGovernanceConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(
      (gateway.detectGovernance as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("executeSuggestion sets pendingAction for uninstall suggestions", async () => {
    const gateway = createMockGateway();
    const controller = createUsageGovernanceController(gateway, () => {});
    await controller.load();
    const zombieIssue = controller.getState().zombie[0];
    expect(zombieIssue).toBeDefined();
    if (!zombieIssue) {
      return;
    }
    controller.executeSuggestion(zombieIssue);
    expect(controller.getState().pendingAction?.type).toBe("uninstall");
    expect(controller.getState().pendingAction?.issue.issueId).toBe(zombieIssue.issueId);
  });

  it("cancelAction clears pendingAction", async () => {
    const gateway = createMockGateway();
    const controller = createUsageGovernanceController(gateway, () => {});
    await controller.load();
    const zombieIssue = controller.getState().zombie[0];
    expect(zombieIssue).toBeDefined();
    if (!zombieIssue) {
      return;
    }
    controller.executeSuggestion(zombieIssue);
    controller.cancelAction();
    expect(controller.getState().pendingAction).toBeNull();
  });
});
