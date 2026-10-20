// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderCapabilityUsageBoard } from "./capability-usage-board.ts";
import { renderDataAuthorizationOverview } from "./data-authorization-overview.ts";
import { renderDataSourceHealthPanel } from "./data-source-health-panel.ts";
import { renderMetricsOverviewCards } from "./metrics-overview-cards.ts";
import { renderPendingApprovalPanel } from "./pending-approval-panel.ts";

function mount(template: unknown): HTMLElement {
  const container = document.createElement("div");
  render(template as never, container);
  return container;
}

describe("MetricsOverviewCards", () => {
  it("renders five labeled KPI cards from summary", () => {
    const container = mount(
      renderMetricsOverviewCards({
        summary: {
          totalDataSources: 26,
          totalCapabilities: 43,
          totalDepartments: 14,
          knowledgeObjectCount: 682,
          enabledBindingCount: 9,
          pendingApprovals: 23,
        },
        loading: false,
        error: null,
      }),
    );
    expect(container.textContent).toContain("数据源");
    expect(container.textContent).toContain("26");
    expect(container.textContent).toContain("知识对象");
    expect(container.textContent).toContain("682");
    expect(container.textContent).toContain("待审批");
    expect(container.textContent).toContain("23");
  });

  it("switches sections from KPI cards instead of only changing the hash", () => {
    const onDrilldown = vi.fn();
    const container = mount(
      renderMetricsOverviewCards({
        summary: {
          totalDataSources: 1,
          totalCapabilities: 1,
          totalDepartments: 1,
          knowledgeObjectCount: 1,
          enabledBindingCount: 0,
          pendingApprovals: 0,
        },
        loading: false,
        error: null,
        onDrilldown,
      }),
    );
    const source = container.querySelector('a[href="#sources"]') as HTMLAnchorElement;
    source.click();
    expect(onDrilldown).toHaveBeenCalledWith("sources");
    expect(window.location.hash).not.toBe("#sources");
  });

  it.skip("merges knowledge-supply + audit metrics into one row and dedupes 知识对象数 (removed in IA redesign)", () => {
    const container = mount(
      renderMetricsOverviewCards({
        summary: {
          totalDataSources: 2,
          totalCapabilities: 3,
          totalDepartments: 1,
          knowledgeObjectCount: 7,
          enabledBindingCount: 4,
          pendingApprovals: 0,
        },
        loading: false,
        error: null,
        knowledgeSupply: {
          projectionCount: 5,
          activeProjectionCount: 2,
          enabledBindingCount: 4,
          visibilityPolicyCount: 1,
          feedItemCount: 7,
          freshness: { fresh: 3, stale: 1, expired: 0 },
          lineageRecordCount: 9,
        },
        knowledgeSupplyLoading: false,
        lineageOverview: { lineageCount: 9, supplyAuditCount: 6, materializationFailureCount: 0 },
        lineageOverviewLoading: false,
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("投影总数");
    expect(text).toContain("活跃投影");
    expect(text).toContain("血缘记录");
    expect(text).toContain("供给审计事件");
    // Dedup: 知识对象数 appears exactly once (sourced from summary, not knowledge-supply).
    const labels = Array.from(container.querySelectorAll(".enterprise-kpi-card__label")).map(
      (el) => el.textContent,
    );
    expect(labels.filter((label) => label === "知识对象").length).toBe(1);
  });

  it("shows placeholder when summary failed", () => {
    const container = mount(
      renderMetricsOverviewCards({ summary: null, loading: false, error: "加载失败，请重试。" }),
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("—");
  });

  it("shows placeholder while loading without data", () => {
    const container = mount(
      renderMetricsOverviewCards({ summary: null, loading: true, error: null }),
    );
    expect(container.textContent).toContain("…");
  });
});

describe("PendingApprovalPanel", () => {
  it("renders inline approve/reject when handler provided", () => {
    const container = mount(
      renderPendingApprovalPanel({
        items: [
          {
            approvalId: "a1",
            category: "source_onboarding",
            displayName: "Wind数据源接入申请",
            requestedAt: "2026-06-08T00:00:00.000Z",
            status: "pending",
          },
        ],
        loading: false,
        error: null,
        approvalCenterHref: "/x/access",
        onDecideApproval: async () => {},
      }),
    );
    expect(container.querySelector('[data-testid="pending-approval-approve-a1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pending-approval-reject-a1"]')).not.toBeNull();
  });

  it("renders the three governance categories", () => {
    const container = mount(
      renderPendingApprovalPanel({
        items: [
          {
            approvalId: "a1",
            category: "source_onboarding",
            displayName: "Wind数据源接入申请",
            requestedAt: "2026-06-08T00:00:00.000Z",
            status: "pending",
          },
        ],
        loading: false,
        error: null,
        approvalCenterHref: "/x/access",
      }),
    );
    expect(container.textContent).toContain("待审批中心");
    expect(container.textContent).toContain("Wind数据源接入申请");
    expect(
      container.querySelector('[data-testid="approval-lane-source_onboarding"]')?.textContent,
    ).toContain("Wind数据源接入申请");
    expect(
      container.querySelector('[data-testid="approval-lane-data_access"]')?.textContent,
    ).toContain("暂无");
    expect(
      container.querySelector('[data-testid="approval-lane-capability_exposure"]')?.textContent,
    ).toContain("暂无");
    expect(container.textContent).toContain("数据源接入");
    expect(container.textContent).toContain("进入审批中心");
  });

  it("renders empty state", () => {
    const container = mount(
      renderPendingApprovalPanel({
        items: [],
        loading: false,
        error: null,
        approvalCenterHref: "/x/access",
      }),
    );
    expect(container.textContent).toContain("暂无待审批事项");
  });
});

describe("DataSourceHealthPanel", () => {
  it("maps the three health states to badges", () => {
    const container = mount(
      renderDataSourceHealthPanel({
        rows: [
          { sourceId: "s1", displayName: "CRM", category: "crm", status: "normal" },
          { sourceId: "s2", displayName: "Wind", category: "external", status: "disconnected" },
          { sourceId: "s3", displayName: "MES", category: "mes", status: "error" },
        ],
        loading: false,
        error: null,
        detailHref: "/x/identities",
      }),
    );
    expect(container.textContent).toContain("数据源健康状态");
    expect(container.textContent).toContain("正常");
    expect(container.textContent).toContain("已断开");
    expect(container.textContent).toContain("异常");
    expect(container.textContent).toContain("查看详情");
  });
});

describe("CapabilityUsageBoard", () => {
  it("renders capability rows with sources, targets, feed count and status", () => {
    const container = mount(
      renderCapabilityUsageBoard({
        rows: [
          {
            capabilityId: "cap-1",
            displayName: "销售分析能力",
            sourceNames: ["CRM", "ERP"],
            targetLabels: ["销售部门客户摘要访问"],
            knowledgeObjectCount: 128,
            enabled: true,
            lastRunAt: "2026-06-08T10:23:00.000Z",
          },
          {
            capabilityId: "cap-2",
            displayName: "库存优化能力",
            sourceNames: ["ERP"],
            targetLabels: [],
            knowledgeObjectCount: 0,
            enabled: false,
            lastRunAt: null,
          },
        ],
        loading: false,
        error: null,
        onViewAll: () => {},
      }),
    );
    expect(container.textContent).toContain("数据产品运行榜");
    expect(container.textContent).toContain("销售分析能力");
    expect(container.textContent).toContain("CRM + ERP");
    expect(container.textContent).toContain("知识供给 128");
    expect(container.textContent).toContain("最近运行 2026-06-08 10:23");
    expect(container.textContent).toContain("正常");
    expect(container.textContent).toContain("已停用");
    expect(container.textContent).toContain("查看全部产品");
  });

  it("renders empty state when there are no capabilities", () => {
    const container = mount(renderCapabilityUsageBoard({ rows: [], loading: false, error: null }));
    expect(container.textContent).toContain("暂无数据产品");
  });

  it("renders error alert when load failed", () => {
    const container = mount(
      renderCapabilityUsageBoard({ rows: null, loading: false, error: "加载失败，请重试。" }),
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe("DataAuthorizationOverview", () => {
  it("renders per-source department/seat/role targets", () => {
    const container = mount(
      renderDataAuthorizationOverview({
        cards: [
          {
            sourceId: "src-crm",
            displayName: "CRM",
            targets: [
              { kind: "department", label: "华东销售", count: 1, precise: true },
              { kind: "seat", label: "华东销售经理", count: 1, precise: true },
              { kind: "role", label: "sales-mgr", count: 2, precise: false },
            ],
          },
        ],
        loading: false,
        error: null,
      }),
    );
    expect(container.textContent).toContain("数据授权关系总览");
    expect(container.textContent).toContain("CRM");
    expect(container.textContent).toContain("华东销售");
    expect(container.textContent).toContain("部门 1");
    expect(container.textContent).toContain("华东销售经理");
    expect(container.textContent).toContain("岗位 1");
    expect(container.textContent).toContain("sales-mgr");
    expect(container.textContent).toContain("角色 2");
    // role grouping marked non-precise
    expect(container.textContent).toContain("非精确");
  });

  it("renders empty state when no authorized sources", () => {
    const container = mount(
      renderDataAuthorizationOverview({ cards: [], loading: false, error: null }),
    );
    expect(container.textContent).toContain("暂无授权数据源");
  });

  it("renders error alert when load failed", () => {
    const container = mount(
      renderDataAuthorizationOverview({ cards: null, loading: false, error: "加载失败，请重试。" }),
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
