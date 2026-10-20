// @vitest-environment jsdom
// Feature: enterprise-data-capability-ia-redesign
// Visual regression smoke — overview workbench panels (no default landscape).

import { html, render, type TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import { renderCapabilityUsageBoard } from "./capability-usage-board.ts";
import { renderDataSourceHealthPanel } from "./data-source-health-panel.ts";
import { renderMetricsOverviewCards } from "./metrics-overview-cards.ts";
import { renderPendingApprovalPanel } from "./pending-approval-panel.ts";

function renderToFixture(template: TemplateResult): HTMLDivElement {
  const container = document.createElement("div");
  container.id = "edc-vrt-fixture";
  container.style.width = "1280px";
  container.style.minHeight = "720px";
  document.body.appendChild(container);
  render(template, container);
  return container;
}

function renderHome(empty: boolean): TemplateResult {
  return html`
    <div class="enterprise-data-capability-home">
      ${renderMetricsOverviewCards({
        summary: empty
          ? null
          : {
              totalDataSources: 26,
              totalCapabilities: 43,
              totalDepartments: 14,
              knowledgeObjectCount: 682,
              enabledBindingCount: 9,
              pendingApprovals: 23,
            },
        loading: false,
        error: null,
      })}
      ${renderCapabilityUsageBoard({
        rows: empty
          ? []
          : [
              {
                capabilityId: "c1",
                displayName: "销售分析能力",
                sourceNames: ["CRM"],
                targetLabels: ["销售部门客户摘要访问"],
                knowledgeObjectCount: 128,
                enabled: true,
                lastRunAt: "2026-06-08T10:23:00.000Z",
              },
            ],
        loading: false,
        error: null,
      })}
      ${renderDataSourceHealthPanel({
        rows: empty
          ? []
          : [{ sourceId: "s1", displayName: "CRM", category: "crm", status: "normal" }],
        loading: false,
        error: null,
        detailHref: "/x/identities",
      })}
      ${renderPendingApprovalPanel({
        items: empty
          ? []
          : [
              {
                approvalId: "a1",
                category: "data_access",
                displayName: "财务数据访问申请",
                requestedAt: "2026-06-08T00:00:00.000Z",
                status: "pending",
              },
            ],
        loading: false,
        error: null,
        approvalCenterHref: "/x/access",
      })}
    </div>
  `;
}

describe("VRT smoke — enterprise data capability home", () => {
  it("renders all panels with full data without errors", () => {
    const container = renderToFixture(renderHome(false));
    expect(container.textContent).toContain("可用数据产品");
    expect(container.textContent).toContain("数据产品运行榜");
    expect(container.textContent).toContain("数据源健康状态");
    expect(container.textContent).toContain("待审批中心");
    container.remove();
  });

  it("renders all panels in empty state without errors", () => {
    const container = renderToFixture(renderHome(true));
    expect(container.textContent).toContain("暂无数据产品");
    expect(container.textContent).toContain("暂无数据源");
    expect(container.textContent).toContain("暂无待审批事项");
    container.remove();
  });
});
