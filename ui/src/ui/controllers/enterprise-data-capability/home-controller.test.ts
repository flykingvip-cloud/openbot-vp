import { describe, expect, it, vi } from "vitest";
import type { EnterpriseDataCapabilityGateway } from "./gateway-client.ts";
import { createInitialDataCapabilityHomeState, loadDataCapabilityHome } from "./home-controller.ts";

function createGateway(
  overrides: Partial<EnterpriseDataCapabilityGateway> = {},
): EnterpriseDataCapabilityGateway {
  return {
    loadDashboardSummary: vi.fn(async () => ({
      ok: true as const,
      data: {
        totalDataSources: 3,
        totalCapabilities: 5,
        totalDepartments: 2,
        knowledgeObjectCount: 12,
        enabledBindingCount: 4,
        pendingApprovals: 1,
      },
    })),
    loadPendingApprovals: vi.fn(async () => ({
      ok: true as const,
      data: [
        {
          approvalId: "ap-1",
          category: "data_access" as const,
          displayName: "财务数据访问申请",
          requestedAt: "2026-06-08T00:00:00.000Z",
          status: "pending",
        },
      ],
    })),
    loadSourceHealth: vi.fn(async () => ({
      ok: true as const,
      data: [{ sourceId: "s-1", displayName: "CRM", category: "crm", status: "normal" as const }],
    })),
    loadCapabilityRows: vi.fn(async () => ({
      ok: true as const,
      data: [
        {
          capabilityId: "cap-1",
          displayName: "销售分析能力",
          sourceNames: ["CRM", "ERP"],
          targetLabels: ["销售部门客户摘要访问"],
          knowledgeObjectCount: 128,
          enabled: true,
          lastRunAt: "2026-06-08T10:23:00.000Z",
        },
      ],
    })),
    loadAuthorizationCards: vi.fn(async () => ({
      ok: true as const,
      data: [
        {
          sourceId: "src-crm",
          displayName: "CRM",
          targets: [
            { kind: "department" as const, label: "华东销售", count: 1, precise: true },
            { kind: "seat" as const, label: "华东销售经理", count: 1, precise: true },
          ],
        },
      ],
    })),
    loadAssetLandscape: vi.fn(async () => ({
      ok: true as const,
      data: {
        nodes: [
          { id: "source:s1", kind: "source" as const, label: "CRM" },
          { id: "capability:c1", kind: "capability" as const, label: "销售分析能力" },
        ],
        edges: [{ from: "source:s1", to: "capability:c1", relation: "source" as const }],
        truncated: false,
      },
    })),
    loadKnowledgeSupply: vi.fn(async () => ({
      ok: true as const,
      data: {
        projectionCount: 4,
        activeProjectionCount: 3,
        enabledBindingCount: 2,
        visibilityPolicyCount: 1,
        feedItemCount: 12,
        freshness: { fresh: 10, stale: 1, expired: 1 },
        lineageRecordCount: 5,
      },
    })),
    loadLineageOverview: vi.fn(async () => ({
      ok: true as const,
      data: { lineageCount: 5, supplyAuditCount: 7 },
    })),
    ...overrides,
    // Focused mock: home-controller only exercises the dashboard load methods above.
    // Assert to the full gateway type (the unused management methods are never called).
  } as EnterpriseDataCapabilityGateway;
}

const FAIL = { ok: false as const, error: "加载失败，请重试。" };

describe("home-controller", () => {
  it("loads all three panels in parallel and clears loading flags", async () => {
    const state = createInitialDataCapabilityHomeState();
    const gateway = createGateway();
    const requestRender = vi.fn();

    await loadDataCapabilityHome({ state, gateway, tenantId: "tenant-acme", requestRender });

    expect(state.summary?.totalDataSources).toBe(3);
    expect(state.approvals).toHaveLength(1);
    expect(state.sourceHealth).toHaveLength(1);
    expect(state.capabilityRows).toHaveLength(1);
    expect(state.authorizationCards).toHaveLength(1);
    expect(state.assetLandscape?.nodes).toHaveLength(2);
    expect(state.knowledgeSupply?.feedItemCount).toBe(12);
    expect(state.lineageOverview?.lineageCount).toBe(5);
    expect(state.summaryLoading).toBe(false);
    expect(state.approvalsLoading).toBe(false);
    expect(state.sourceHealthLoading).toBe(false);
    expect(state.capabilityRowsLoading).toBe(false);
    expect(state.authorizationCardsLoading).toBe(false);
    expect(state.assetLandscapeLoading).toBe(false);
    expect(state.knowledgeSupplyLoading).toBe(false);
    expect(state.lineageOverviewLoading).toBe(false);
    expect(state.summaryError).toBeNull();
    // 至少触发一次初始 render + 八个面板各一次。
    expect(requestRender.mock.calls.length).toBeGreaterThanOrEqual(9);
  });

  it("isolates a single panel failure without blocking the others", async () => {
    const state = createInitialDataCapabilityHomeState();
    const gateway = createGateway({
      loadDashboardSummary: vi.fn(async () => FAIL),
    });

    await loadDataCapabilityHome({
      state,
      gateway,
      tenantId: "tenant-acme",
      requestRender: vi.fn(),
    });

    expect(state.summary).toBeNull();
    expect(state.summaryError).not.toBeNull();
    // 其余面板仍正常加载。
    expect(state.approvals).toHaveLength(1);
    expect(state.sourceHealth).toHaveLength(1);
  });

  it("records error when a panel throws", async () => {
    const state = createInitialDataCapabilityHomeState();
    const gateway = createGateway({
      loadSourceHealth: vi.fn(async () => {
        throw new Error("boom");
      }),
    });

    await loadDataCapabilityHome({
      state,
      gateway,
      tenantId: "tenant-acme",
      requestRender: vi.fn(),
    });

    expect(state.sourceHealthError).not.toBeNull();
    expect(state.sourceHealthLoading).toBe(false);
    expect(state.summary?.totalCapabilities).toBe(5);
  });

  it("treats empty success arrays as data, not failure", async () => {
    const state = createInitialDataCapabilityHomeState();
    const gateway = createGateway({
      loadPendingApprovals: vi.fn(async () => ({ ok: true as const, data: [] })),
      loadSourceHealth: vi.fn(async () => ({ ok: true as const, data: [] })),
    });

    await loadDataCapabilityHome({
      state,
      gateway,
      tenantId: "tenant-acme",
      requestRender: vi.fn(),
    });

    // 空态：data 为 []，error 必须为 null（不能被当成加载失败）。
    expect(state.approvals).toEqual([]);
    expect(state.approvalsError).toBeNull();
    expect(state.sourceHealth).toEqual([]);
    expect(state.sourceHealthError).toBeNull();
  });

  it("marks loadStarted so the surface load-once switch fires only once", async () => {
    const state = createInitialDataCapabilityHomeState();
    expect(state.loadStarted).toBe(false);
    await loadDataCapabilityHome({
      state,
      gateway: createGateway(),
      tenantId: "tenant-acme",
      requestRender: vi.fn(),
    });
    expect(state.loadStarted).toBe(true);
  });

  it("keeps stale data on failed refresh by default (stale-while-revalidate)", async () => {
    const state = createInitialDataCapabilityHomeState();
    await loadDataCapabilityHome({
      state,
      gateway: createGateway(),
      tenantId: "tenant-acme",
      requestRender: vi.fn(),
    });
    expect(state.summary?.totalDataSources).toBe(3);

    // Refresh where summary now fails: default keeps the prior data + sets error.
    await loadDataCapabilityHome({
      state,
      gateway: createGateway({ loadDashboardSummary: vi.fn(async () => FAIL) }),
      tenantId: "tenant-acme",
      requestRender: vi.fn(),
    });
    expect(state.summary?.totalDataSources).toBe(3);
    expect(state.summaryError).not.toBeNull();
  });

  it("clears stale data when resetData is true", async () => {
    const state = createInitialDataCapabilityHomeState();
    await loadDataCapabilityHome({
      state,
      gateway: createGateway(),
      tenantId: "tenant-acme",
      requestRender: vi.fn(),
    });
    expect(state.summary).not.toBeNull();

    await loadDataCapabilityHome({
      state,
      gateway: createGateway({ loadDashboardSummary: vi.fn(async () => FAIL) }),
      tenantId: "tenant-acme",
      requestRender: vi.fn(),
      resetData: true,
    });
    expect(state.summary).toBeNull();
    expect(state.summaryError).not.toBeNull();
  });
});
