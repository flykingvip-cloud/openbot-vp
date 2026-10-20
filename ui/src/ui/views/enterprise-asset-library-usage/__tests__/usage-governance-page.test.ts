// @vitest-environment jsdom
// 应用治理摘要：指标可扫读，分区跟计数走，空态不渲染巨型插图。

import { render, type TemplateResult } from "lit-html";
import { describe, expect, it, vi } from "vitest";
import type { GovernanceIssue } from "../../../capability/runtime-projection/types.ts";
import type {
  UsageGovernanceController,
  UsageGovernanceState,
} from "../../../controllers/enterprise-asset-library-usage/usage-governance.ts";
import { capabilityCenterTabHref, renderUsageGovernancePage } from "../usage-governance-page.ts";

function issue(
  partial: Partial<GovernanceIssue> & Pick<GovernanceIssue, "issueId" | "type">,
): GovernanceIssue {
  return {
    capabilityId: "c1",
    robotId: "r1",
    description: partial.description ?? `${partial.type}示例`,
    suggestion: partial.type === "未使用能力" ? "卸载" : "重新整理能力",
    evidence: {},
    detectedAt: 0,
    ...partial,
  };
}

function state(partial: Partial<UsageGovernanceState> = {}): UsageGovernanceState {
  return {
    loading: false,
    error: null,
    activeTab: "低效能力",
    config: {
      lowEfficiency: { minExecutions: 50, maxSuccessRate: 0.7 },
      zombie: { minInstallDays: 30 },
      conflict: { minSimilarity: 0.8 },
    },
    lowEfficiency: [],
    zombie: [],
    conflict: [],
    acknowledgedIssues: new Set(),
    pendingAction: null,
    ...partial,
  };
}

function controller(): UsageGovernanceController {
  return {
    getState: () => state(),
    load: vi.fn(async () => {}),
    changeTab: vi.fn(),
    updateConfig: vi.fn(async () => {}),
    acknowledge: vi.fn(),
    getVisibleIssues: vi.fn(() => []),
    executeSuggestion: vi.fn(),
    cancelAction: vi.fn(),
  };
}

function renderPage(
  pageState: UsageGovernanceState,
  pageController: UsageGovernanceController = controller(),
): HTMLDivElement {
  const container = document.createElement("div");
  const template: TemplateResult = renderUsageGovernancePage({
    state: pageState,
    controller: pageController,
    basePath: "/enterprise/acme",
    tenantId: "acme",
  });
  render(template, container);
  return container;
}

describe("capabilityCenterTabHref", () => {
  it("switches only the existing capability-center tab query", () => {
    const location = {
      pathname: "/enterprise/acme/capabilities",
      search: "?tab=governance&view=high-value",
    };
    expect(capabilityCenterTabHref("analytics", location)).toBe(
      "/enterprise/acme/capabilities?tab=analytics",
    );
    expect(capabilityCenterTabHref("install", location)).toBe(
      "/enterprise/acme/capabilities?tab=install",
    );
    expect(capabilityCenterTabHref("skills", location)).toBe("/enterprise/acme/capabilities");
  });
});

describe("renderUsageGovernancePage", () => {
  it("shows a readable unused count and its list while low-efficiency stays an honest empty", () => {
    window.history.replaceState({}, "", "/enterprise/acme/capabilities?tab=governance");
    const zombies = Array.from({ length: 599 }, (_, index) =>
      issue({
        issueId: `z-${index}`,
        type: "未使用能力",
        description: index === 0 ? "已安装 40 天且零调用" : `未使用能力 ${index}`,
        evidence: { executions30d: 0, installDays: 40 },
      }),
    );
    const container = renderPage(
      state({
        activeTab: "低效能力",
        zombie: zombies,
      }),
    );

    const values = [...container.querySelectorAll(".enterprise-kpi-card__value")].map((node) =>
      node.textContent?.trim(),
    );
    expect(values).toEqual(["0", "599", "0"]);
    expect(container.querySelector(".enterprise-usage-subtab")).toBeNull();
    expect(container.querySelector(".enterprise-usage-empty-state")).toBeNull();
    const svgs = [...container.querySelectorAll("svg")];
    expect(svgs.length).toBeGreaterThan(0);
    expect(svgs.every((svg) => svg.closest(".enterprise-kpi-card__arrow"))).toBe(true);

    expect(container.textContent).toContain("暂无低效能力");
    expect(container.textContent).toContain("近 30 天没有调用超过阈值、同时成功率偏低的能力");
    const analytics = container.querySelector<HTMLAnchorElement>(
      "#enterprise-capability-governance-low a",
    );
    expect(analytics?.textContent?.trim()).toBe("查看效果分析");
    expect(analytics?.getAttribute("href")).toBe("/enterprise/acme/capabilities?tab=analytics");

    const unused = container.querySelector("#enterprise-capability-governance-unused");
    expect(unused?.textContent).toContain("已安装 40 天且零调用");
    expect(unused?.querySelectorAll(".enterprise-governance-issue-row")).toHaveLength(599);
    expect(container.textContent).toContain("暂无冲突能力");
    const skills = container.querySelector<HTMLAnchorElement>(
      "#enterprise-capability-governance-conflict a",
    );
    expect(skills?.getAttribute("href")).toBe("/enterprise/acme/capabilities");
  });

  it("keeps acknowledged issues out of both the metric and the section", () => {
    const container = renderPage(
      state({
        lowEfficiency: [
          issue({
            issueId: "low-open",
            type: "低效能力",
            description: "仍待处理的低效能力",
            evidence: { executions30d: 80, successRate: 0.4 },
          }),
          issue({
            issueId: "low-done",
            type: "低效能力",
            description: "已标记暂不处理",
          }),
        ],
        acknowledgedIssues: new Set(["low-done"]),
      }),
    );

    expect(container.querySelector(".enterprise-kpi-card__value")?.textContent?.trim()).toBe("1");
    expect(container.textContent).toContain("仍待处理的低效能力");
    expect(container.textContent).not.toContain("已标记暂不处理");
  });

  it("does not treat a failed load as a clean zero", () => {
    const pageController = controller();
    const container = renderPage(state({ error: "治理检测失败，请重试" }), pageController);

    expect(container.textContent).toContain("治理检测失败，请重试");
    expect(container.textContent).not.toContain("暂无低效能力");
    expect(container.textContent).toContain("不要把 0 当成已治理完成");
    container.querySelector<HTMLButtonElement>(".enterprise-usage-error__retry")?.click();
    expect(pageController.load).toHaveBeenCalledOnce();
  });

  it("renders the low-efficiency row actions from the existing controller", () => {
    const pageController = controller();
    const low = issue({
      issueId: "low1",
      type: "低效能力",
      description: "调用次数高但成功率偏低",
      suggestion: "重新整理能力",
      evidence: { executions30d: 100, successRate: 0.5 },
    });
    const container = renderPage(state({ lowEfficiency: [low] }), pageController);

    expect(container.textContent).toContain("调用次数高但成功率偏低");
    expect(container.textContent).toContain("50.0%");
    const action = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "重新整理能力",
    );
    action?.click();
    expect(pageController.executeSuggestion).toHaveBeenCalledWith(low);
  });

  it("shows a loading skeleton instead of an empty illustration", () => {
    const container = renderPage(state({ loading: true }));
    expect(container.querySelector(".enterprise-capability-governance__skeleton")).not.toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector(".enterprise-kpi-card")).toBeNull();
  });
});
