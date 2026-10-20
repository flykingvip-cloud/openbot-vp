// @vitest-environment jsdom
// Feature: enterprise-capability-usage-management
// Visual regression smoke tests — verify the four sub-pages render without errors.
//
// Note: This file uses jsdom + structural assertions instead of pixel-level
// `toMatchScreenshot` because the latter requires browser-mode test infrastructure
// not yet wired for this module. Pixel-level VRT can be added later by following
// `enterprise-asset-library/__tests__/visual-regression.browser.test.ts` once the
// page shells are stabilized.

import { render, type TemplateResult } from "lit-html";
import { describe, expect, it } from "vitest";
import { renderRobotCapabilityViewPage } from "../robot-capability-view-page.ts";
import { renderUsageAnalyticsPage } from "../usage-analytics-page.ts";
import { renderUsageGovernancePage } from "../usage-governance-page.ts";

function renderToFixture(template: TemplateResult): HTMLDivElement {
  const container = document.createElement("div");
  container.id = "vrt-fixture";
  container.style.width = "1280px";
  container.style.minHeight = "720px";
  document.body.appendChild(container);
  render(template, container);
  return container;
}

function cleanup(container: HTMLElement): void {
  container.remove();
}

describe("Visual regression smoke tests — 3 capability-center usage sub-pages", () => {
  it("robot-capability-view-page renders without errors", () => {
    const dummyController = {
      getState: () => ({}) as never,
      load: async () => {},
      updateFilter: () => {},
      changeSort: () => {},
      changePage: () => {},
      changePageSize: () => {},
      openDetail: async () => {},
      closeDetail: () => {},
    };
    const container = renderToFixture(
      renderRobotCapabilityViewPage({
        state: {
          loading: false,
          error: null,
          items: [
            {
              robotId: "r1",
              robotName: "CRM 助手",
              capabilityCount: 5,
              monthlyExecutions: 1284,
              employeeCoverage: 12,
              successRate: 0.965,
              healthStatus: "效果稳定",
              topCapabilities: ["客户跟进"],
            },
          ],
          pagination: { currentPage: 1, pageSize: 10, totalItems: 1 },
          filters: { nameQuery: "", healthStatus: null, monthlyExecutionsRange: "全部" },
          sorting: { field: "monthlyExecutions", direction: "desc" },
          kpis: {
            totalRobots: 1,
            totalMonthlyExecutions: 1284,
            totalEmployeeCoverage: 12,
            averageSuccessRate: 0.965,
          },
          detail: { open: false, robotId: null, data: null, loading: false },
        },
        controller: dummyController as never,
      }),
    );
    expect(container.querySelector(".enterprise-robot-table")).not.toBeNull();
    expect(container.textContent).toContain("CRM 助手");
    cleanup(container);
  });

  it("usage-analytics-page renders without errors", () => {
    const dummyController = {
      getState: () => ({}) as never,
      load: async () => {},
      changeWindow: () => {},
    };
    const container = renderToFixture(
      renderUsageAnalyticsPage({
        state: {
          loading: false,
          error: null,
          window: 30,
          kpis: {
            totalMonthlyExecutions: {
              current: 1000,
              previousMonthChange: 100,
              previousMonthPercentage: 0.11,
            },
            coveredRobots: { current: 5, previousMonthChange: 1, previousMonthPercentage: 0.25 },
            coveredEmployees: {
              current: 50,
              previousMonthChange: 5,
              previousMonthPercentage: 0.11,
            },
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
              capabilityName: "客户跟进",
              monthlyExecutions: 500,
              successRate: 0.95,
              coveredRobots: 3,
            },
          ],
        },
        controller: dummyController as never,
        basePath: "",
        tenantId: "acme",
      }),
    );
    expect(container.textContent).toContain("调用量趋势");
    expect(container.textContent).toContain("能力复用增长");
    cleanup(container);
  });

  it("usage-governance-page renders without errors", () => {
    const dummyController = {
      getState: () => ({}) as never,
      load: async () => {},
      changeTab: () => {},
      updateConfig: async () => {},
      acknowledge: () => {},
      getVisibleIssues: () => [
        {
          issueId: "low1",
          type: "低效能力" as const,
          capabilityId: "c1",
          robotId: "r1",
          description: "调用次数高但成功率偏低",
          suggestion: "重新整理能力" as const,
          evidence: { executions30d: 100, successRate: 0.5 },
          detectedAt: 0,
        },
      ],
      executeSuggestion: () => {},
      cancelAction: () => {},
    };
    const container = renderToFixture(
      renderUsageGovernancePage({
        state: {
          loading: false,
          error: null,
          activeTab: "低效能力",
          config: {
            lowEfficiency: { minExecutions: 50, maxSuccessRate: 0.7 },
            zombie: { minInstallDays: 30 },
            conflict: { minSimilarity: 0.8 },
          },
          lowEfficiency: [
            {
              issueId: "low1",
              type: "低效能力" as const,
              capabilityId: "c1",
              robotId: "r1",
              description: "调用次数高但成功率偏低",
              suggestion: "重新整理能力" as const,
              evidence: { executions30d: 100, successRate: 0.5 },
              detectedAt: 0,
            },
          ],
          zombie: [],
          conflict: [],
          acknowledgedIssues: new Set(),
          pendingAction: null,
        },
        controller: dummyController as never,
        basePath: "",
        tenantId: "acme",
      }),
    );
    expect(container.textContent).toContain("低效能力");
    expect(container.textContent).toContain("调用次数高但成功率偏低");
    cleanup(container);
  });
});
