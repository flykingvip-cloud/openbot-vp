// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type {
  ContributionPerformanceItem,
  EnterpriseAssetListItem,
} from "../../capability/enterprise-capability/types.ts";
import {
  renderHighValueCapabilityCards,
  type HighValueCapabilityCardsProps,
} from "./high-value-capability-cards.ts";

function makeCapability(overrides: Partial<EnterpriseAssetListItem> = {}): EnterpriseAssetListItem {
  return {
    id: "cap-001",
    name: "智能合同审核",
    description: "自动审核合同条款",
    usageScenarios: ["合同审核", "风险评估"],
    applicableScope: { kind: "enterprise" },
    domain: "法务",
    maturity: "企业认证",
    healthStatus: "效果稳定",
    lifecycle: "published",
    valueSummary: {
      monthlyExecutions: 1284,
      departmentCoverageCount: 7,
      reuseGrowthRate30d: 23,
    },
    reuseData: {
      robotCount: 12,
      employeeCount: 45,
      departmentCount: 7,
      trend30Days: Array.from({ length: 30 }, () => 40),
      growthPercentage: 23,
    },
    sourceEmployeeName: "张三",
    avatar: null,
    ...overrides,
  };
}

function makeContributor(
  overrides: Partial<ContributionPerformanceItem> = {},
): ContributionPerformanceItem {
  return {
    employeeId: "emp-001",
    employeeName: "李四",
    department: "法务部",
    totalContributions: 15,
    approvedCount: 12,
    approvalRate: 80,
    averageMaturityLevel: 4,
    totalReuseRobots: 8,
    totalReuseEmployees: 30,
    averageSuccessRate: 92,
    ...overrides,
  };
}

function makeProps(
  overrides: Partial<HighValueCapabilityCardsProps> = {},
): HighValueCapabilityCardsProps {
  return {
    capabilities: [makeCapability()],
    loading: false,
    error: null,
    monthlyTopContributors: [makeContributor()],
    onViewAllCapabilities: vi.fn(),
    onViewCapabilityDetail: vi.fn(),
    onViewContributionPerformance: vi.fn(),
    ...overrides,
  };
}

describe("renderHighValueCapabilityCards", () => {
  it("renders section title and subtitle", () => {
    const container = document.createElement("div");
    render(renderHighValueCapabilityCards(makeProps()), container);

    const text = container.textContent ?? "";
    expect(text).toContain("高价值能力");
    expect(text).toContain("按成熟度、复用范围与近 30 天增长排序的重点能力资产");
  });

  it("renders capability card with name and domain chip", () => {
    const container = document.createElement("div");
    render(renderHighValueCapabilityCards(makeProps()), container);

    const text = container.textContent ?? "";
    expect(text).toContain("智能合同审核");
    expect(text).toContain("法务");
  });

  it("renders maturity indicator in compact variant", () => {
    const container = document.createElement("div");
    render(renderHighValueCapabilityCards(makeProps()), container);

    const indicator = container.querySelector(".maturity-indicator--compact");
    expect(indicator).not.toBeNull();
  });

  it("renders value summary in inline variant", () => {
    const container = document.createElement("div");
    render(renderHighValueCapabilityCards(makeProps()), container);

    const inline = container.querySelector(".value-summary-card--inline");
    expect(inline).not.toBeNull();

    const text = container.textContent ?? "";
    expect(text).toContain("本月已被调用 1,284 次");
  });

  it("renders '查看详情' button that calls onViewCapabilityDetail", () => {
    const onViewDetail = vi.fn();
    const container = document.createElement("div");
    render(
      renderHighValueCapabilityCards(makeProps({ onViewCapabilityDetail: onViewDetail })),
      container,
    );

    const btn = container.querySelector(".high-value-card__detail-btn") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent?.trim()).toBe("查看详情");

    btn.click();
    expect(onViewDetail).toHaveBeenCalledWith("cap-001");
  });

  it("renders '查看全部能力' footer button", () => {
    const onViewAll = vi.fn();
    const container = document.createElement("div");
    render(
      renderHighValueCapabilityCards(makeProps({ onViewAllCapabilities: onViewAll })),
      container,
    );

    const btn = container.querySelector(
      ".high-value-capability-cards__view-all-btn",
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent?.trim()).toBe("查看全部能力");

    btn.click();
    expect(onViewAll).toHaveBeenCalled();
  });

  it("renders domain chip with correct color for 法务", () => {
    const container = document.createElement("div");
    render(renderHighValueCapabilityCards(makeProps()), container);

    const chip = container.querySelector(".high-value-card__domain-chip") as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.style.color).toContain("rgb(99, 102, 241)"); // #6366F1
  });

  it("renders multiple cards for multiple capabilities", () => {
    const caps = [
      makeCapability({ id: "cap-001", name: "能力A", domain: "销售" }),
      makeCapability({ id: "cap-002", name: "能力B", domain: "HR" }),
      makeCapability({ id: "cap-003", name: "能力C", domain: "客服" }),
    ];
    const container = document.createElement("div");
    render(renderHighValueCapabilityCards(makeProps({ capabilities: caps })), container);

    const cards = container.querySelectorAll(".high-value-card");
    expect(cards.length).toBe(3);

    const text = container.textContent ?? "";
    expect(text).toContain("能力A");
    expect(text).toContain("能力B");
    expect(text).toContain("能力C");
  });
});

describe("renderHighValueCapabilityCards — loading state", () => {
  it("renders 3 skeleton cards when loading", () => {
    const container = document.createElement("div");
    render(renderHighValueCapabilityCards(makeProps({ loading: true })), container);

    const skeletons = container.querySelectorAll(".high-value-card--skeleton");
    expect(skeletons.length).toBe(3);
  });

  it("does not render real capability cards when loading", () => {
    const container = document.createElement("div");
    render(renderHighValueCapabilityCards(makeProps({ loading: true })), container);

    const text = container.textContent ?? "";
    expect(text).not.toContain("智能合同审核");
  });
});

describe("renderHighValueCapabilityCards — error state", () => {
  it("renders error message", () => {
    const container = document.createElement("div");
    render(renderHighValueCapabilityCards(makeProps({ error: "数据加载超时，请重试" })), container);

    const text = container.textContent ?? "";
    expect(text).toContain("数据加载超时，请重试");
  });

  it("renders retry button on error", () => {
    const container = document.createElement("div");
    render(renderHighValueCapabilityCards(makeProps({ error: "网络错误" })), container);

    const errorDiv = container.querySelector(".high-value-cards__error");
    expect(errorDiv).not.toBeNull();
    const retryBtn = errorDiv!.querySelector("button");
    expect(retryBtn).not.toBeNull();
  });
});

describe("renderHighValueCapabilityCards — empty state", () => {
  it("renders empty state message when no capabilities", () => {
    const container = document.createElement("div");
    render(renderHighValueCapabilityCards(makeProps({ capabilities: [] })), container);

    const text = container.textContent ?? "";
    expect(text).toContain("暂无可展示的企业能力资产");
    expect(text).toContain("员工提交并通过审核后");
  });
});

describe("renderHighValueCapabilityCards — contributors sidebar", () => {
  it("renders top contributors section title", () => {
    const container = document.createElement("div");
    render(renderHighValueCapabilityCards(makeProps()), container);

    const text = container.textContent ?? "";
    expect(text).toContain("本月活跃贡献者 Top 5");
  });

  it("renders contributor name, department, and count", () => {
    const contributors = [
      makeContributor({ employeeName: "王五", department: "销售部", totalContributions: 20 }),
    ];
    const container = document.createElement("div");
    render(
      renderHighValueCapabilityCards(makeProps({ monthlyTopContributors: contributors })),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("王五");
    expect(text).toContain("销售部");
    expect(text).toContain("20 次贡献");
  });

  it("renders '查看贡献绩效' link that calls onViewContributionPerformance", () => {
    const onViewPerf = vi.fn();
    const container = document.createElement("div");
    render(
      renderHighValueCapabilityCards(makeProps({ onViewContributionPerformance: onViewPerf })),
      container,
    );

    const link = container.querySelector(".high-value-contributors__link") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.textContent?.trim()).toContain("查看贡献绩效");

    link.click();
    expect(onViewPerf).toHaveBeenCalled();
  });

  it("shows empty message when no contributors", () => {
    const container = document.createElement("div");
    render(renderHighValueCapabilityCards(makeProps({ monthlyTopContributors: [] })), container);

    const text = container.textContent ?? "";
    expect(text).toContain("暂无贡献数据");
  });

  it("limits contributors to top 5", () => {
    const contributors = Array.from({ length: 8 }, (_, i) =>
      makeContributor({ employeeId: `emp-${i}`, employeeName: `员工${i}` }),
    );
    const container = document.createElement("div");
    render(
      renderHighValueCapabilityCards(makeProps({ monthlyTopContributors: contributors })),
      container,
    );

    const items = container.querySelectorAll(".high-value-contributors__name");
    expect(items.length).toBe(5);
  });
});
