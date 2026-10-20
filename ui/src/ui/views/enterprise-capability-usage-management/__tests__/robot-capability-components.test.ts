// @vitest-environment jsdom
// Feature: enterprise-capability-usage-management
// Robot capability table + detail panel component tests

import { render, type TemplateResult } from "lit-html";
import { describe, expect, it } from "vitest";
import type {
  RobotCapabilityUsageView,
  RobotDetail,
} from "../../../capability/runtime-projection/types.ts";
import { renderRobotCapabilityTable } from "../robot-capability-table.ts";
import { renderRobotDetailPanel } from "../robot-detail-panel.ts";

function renderToContainer(template: TemplateResult): HTMLDivElement {
  const container = document.createElement("div");
  render(template, container);
  return container;
}

const sampleItem: RobotCapabilityUsageView = {
  robotId: "r1",
  robotName: "CRM 助手",
  capabilityCount: 5,
  monthlyExecutions: 1284,
  employeeCoverage: 12,
  successRate: 0.965,
  healthStatus: "效果稳定",
  topCapabilities: ["客户跟进", "邮件草稿", "会议纪要"],
};

describe("renderRobotCapabilityTable", () => {
  it("renders robot name and stats correctly", () => {
    const container = renderToContainer(
      renderRobotCapabilityTable({
        items: [sampleItem],
        sorting: { field: "monthlyExecutions", direction: "desc" },
        onSort: () => {},
        onViewDetail: () => {},
      }),
    );
    expect(container.textContent).toContain("CRM 助手");
    expect(container.textContent).toContain("1,284");
    expect(container.textContent).toContain("96.5%");
    expect(container.textContent).toContain("效果稳定");
  });

  it("displays Top 3 capabilities with overflow indicator", () => {
    const itemWith5 = { ...sampleItem, topCapabilities: ["A", "B", "C", "D", "E"] };
    const container = renderToContainer(
      renderRobotCapabilityTable({
        items: [itemWith5],
        sorting: { field: "monthlyExecutions", direction: "desc" },
        onSort: () => {},
        onViewDetail: () => {},
      }),
    );
    // Only first 3 displayed; remaining shown as +N
    expect(container.textContent).toContain("A");
    expect(container.textContent).toContain("B");
    expect(container.textContent).toContain("C");
    expect(container.textContent).toContain("+2");
  });

  it("renders 暂无数据 health badge for downgraded status", () => {
    const itemNoData = { ...sampleItem, healthStatus: "暂无数据" as const };
    const container = renderToContainer(
      renderRobotCapabilityTable({
        items: [itemNoData],
        sorting: { field: "monthlyExecutions", direction: "desc" },
        onSort: () => {},
        onViewDetail: () => {},
      }),
    );
    expect(container.textContent).toContain("暂无数据");
  });

  it("does NOT contain runtime/agent terminology in rendered output", () => {
    const container = renderToContainer(
      renderRobotCapabilityTable({
        items: [sampleItem],
        sorting: { field: "monthlyExecutions", direction: "desc" },
        onSort: () => {},
        onViewDetail: () => {},
      }),
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\bruntime\b/i);
    expect(text).not.toMatch(/\bagent\b/i);
    expect(text).not.toMatch(/\btemplate\b/i);
    expect(text).not.toMatch(/\bcpu\b/i);
    expect(text).not.toMatch(/\bmemory\b/i);
  });
});

describe("renderRobotDetailPanel", () => {
  const sampleDetail: RobotDetail = {
    robotId: "r1",
    robotName: "CRM 助手",
    healthStatus: "效果稳定",
    lastActiveAt: Date.UTC(2024, 4, 6, 7, 30),
    capabilities: [
      {
        capabilityId: "c1",
        capabilityName: "客户跟进提醒",
        monthlyExecutions: 100,
        successRate: 0.95,
      },
    ],
    trend30d: { dates: ["2024-05-01"], dailyExecutions: [50] },
    employeeCoverage: 8,
    topCapabilities: ["客户跟进", "邮件草稿"],
  };

  it("renders all three sections: basic info, capability list, usage stats", () => {
    const container = renderToContainer(
      renderRobotDetailPanel({
        data: sampleDetail,
        loading: false,
        onClose: () => {},
      }),
    );
    expect(container.textContent).toContain("CRM 助手");
    expect(container.textContent).toContain("效果稳定");
    expect(container.textContent).toContain("客户跟进提醒");
    expect(container.textContent).toContain("近 30 天调用趋势");
  });

  it("does NOT show CPU / memory / Agent ID / template ID fields", () => {
    const container = renderToContainer(
      renderRobotDetailPanel({
        data: sampleDetail,
        loading: false,
        onClose: () => {},
      }),
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\bcpu\b/i);
    expect(text).not.toMatch(/\bmemory\b/i);
    expect(text).not.toMatch(/\bagent\b/i);
    expect(text).not.toMatch(/\btemplate\b/i);
    expect(text).not.toMatch(/\bnode id\b/i);
  });

  it("renders loading skeleton when loading=true", () => {
    const container = renderToContainer(
      renderRobotDetailPanel({
        data: null,
        loading: true,
        onClose: () => {},
      }),
    );
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("renders error state when no data and not loading", () => {
    const container = renderToContainer(
      renderRobotDetailPanel({
        data: null,
        loading: false,
        onClose: () => {},
      }),
    );
    expect(container.textContent).toContain("加载失败");
  });
});
