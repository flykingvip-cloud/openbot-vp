// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { StatisticsDashboardData } from "../../capability/enterprise-capability/types.ts";
import { renderCapabilityOverview, type CapabilityOverviewProps } from "./capability-overview.ts";

function createMockStats(overrides?: Partial<StatisticsDashboardData>): StatisticsDashboardData {
  return {
    totalCapabilities: 128,
    publishedCapabilities: 96,
    coveredEmployees: 1520,
    coveredRobots: 45,
    monthlyUsageCount: 23456,
    changes: {
      totalCapabilities: { value: 12, type: "absolute" },
      publishedCapabilities: { value: 5, type: "absolute" },
      coveredEmployees: { value: 15, type: "percentage" },
      coveredRobots: { value: -3, type: "absolute" },
      monthlyUsageCount: { value: 27, type: "percentage" },
    },
    updatedAt: Date.now(),
    ...overrides,
  };
}

function createDefaultProps(overrides?: Partial<CapabilityOverviewProps>): CapabilityOverviewProps {
  return {
    stats: createMockStats(),
    statsLoading: false,
    statsError: null,
    lastSuccessfulLoadAt: null,
    onRefreshStats: vi.fn(),
    onNavigateContributionRecords: vi.fn(),
    onNavigateInstallManagement: vi.fn(),
    ...overrides,
  };
}

function renderToContainer(props: CapabilityOverviewProps): HTMLElement {
  const container = document.createElement("div");
  render(renderCapabilityOverview(props), container);
  return container;
}

describe("renderCapabilityOverview — header", () => {
  it("renders the page title '企业能力中心'", () => {
    const container = renderToContainer(createDefaultProps());
    const title = container.querySelector(".capability-overview__title");
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe("企业能力中心");
  });

  it("renders the info icon next to the title", () => {
    const container = renderToContainer(createDefaultProps());
    const icon = container.querySelector(".capability-overview__info-icon");
    expect(icon).not.toBeNull();
    expect(icon!.querySelector("svg")).not.toBeNull();
  });

  it("renders the subtitle with correct text", () => {
    const container = renderToContainer(createDefaultProps());
    const subtitle = container.querySelector(".capability-overview__subtitle");
    expect(subtitle).not.toBeNull();
    expect(subtitle!.textContent).toContain("查看当前能力资产规模、覆盖范围与使用活跃度");
    expect(subtitle!.textContent).toContain("适合先做全局判断，再进入安装与贡献管理");
  });
});

describe("renderCapabilityOverview — action buttons", () => {
  it("renders '能力贡献记录' secondary button", () => {
    const container = renderToContainer(createDefaultProps());
    const btn = container.querySelector(".capability-overview__btn--secondary");
    expect(btn).not.toBeNull();
    expect(btn!.textContent?.trim()).toBe("能力贡献记录");
  });

  it("renders '能力安装管理' primary button", () => {
    const container = renderToContainer(createDefaultProps());
    const btn = container.querySelector(".capability-overview__btn--primary");
    expect(btn).not.toBeNull();
    expect(btn!.textContent?.trim()).toBe("能力安装管理");
  });

  it("calls onNavigateContributionRecords when secondary button is clicked", () => {
    const onNavigate = vi.fn();
    const container = renderToContainer(
      createDefaultProps({ onNavigateContributionRecords: onNavigate }),
    );
    const btn = container.querySelector(
      ".capability-overview__btn--secondary",
    ) as HTMLButtonElement;
    btn.click();
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("calls onNavigateInstallManagement when primary button is clicked", () => {
    const onNavigate = vi.fn();
    const container = renderToContainer(
      createDefaultProps({ onNavigateInstallManagement: onNavigate }),
    );
    const btn = container.querySelector(".capability-overview__btn--primary") as HTMLButtonElement;
    btn.click();
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("buttons meet minimum 32×32px click target", () => {
    const container = renderToContainer(createDefaultProps());
    const btns = container.querySelectorAll(".capability-overview__btn");
    expect(btns.length).toBeGreaterThan(0);
    // 32×32 minimum is enforced via the .enterprise-btn class in
    // enterprise-components.css. We assert class presence which guarantees
    // the constraint per the stylesheet.
    for (const btn of btns) {
      expect((btn as HTMLElement).classList.contains("enterprise-btn")).toBe(true);
    }
  });
});

describe("renderCapabilityOverview — statistics dashboard (success)", () => {
  it("renders 5 stat cards", () => {
    const container = renderToContainer(createDefaultProps());
    const cards = container.querySelectorAll(".capability-overview__card");
    expect(cards.length).toBe(5);
  });

  it("renders correct labels for all 5 cards", () => {
    const container = renderToContainer(createDefaultProps());
    const labels = container.querySelectorAll(".capability-overview__card-label");
    const texts = Array.from(labels).map((el) => el.textContent);
    expect(texts).toEqual(["能力总数", "已发布能力", "覆盖员工数", "覆盖机器人数", "本月使用次数"]);
  });

  it("renders values with thousand separators", () => {
    const container = renderToContainer(createDefaultProps());
    const values = container.querySelectorAll(".capability-overview__card-value");
    const texts = Array.from(values).map((el) => el.textContent);
    // 128, 96, 1,520, 45, 23,456
    expect(texts).toContain("1,520");
    expect(texts).toContain("23,456");
  });

  it("renders positive change with green color and ↑ arrow", () => {
    const container = renderToContainer(createDefaultProps());
    const changes = container.querySelectorAll(".capability-overview__card-change");
    // First card: totalCapabilities change = +12 absolute
    const firstChange = changes[0] as HTMLElement;
    expect(firstChange.textContent).toContain("+12");
    expect(firstChange.textContent).toContain("↑");
    // Color is applied via .--positive class modifier (green via CSS).
    expect(firstChange.classList.contains("capability-overview__card-change--positive")).toBe(true);
  });

  it("renders negative change with red color and ↓ arrow", () => {
    const container = renderToContainer(createDefaultProps());
    const changes = container.querySelectorAll(".capability-overview__card-change");
    // Fourth card: coveredRobots change = -3 absolute
    const fourthChange = changes[3] as HTMLElement;
    expect(fourthChange.textContent).toContain("-3");
    expect(fourthChange.textContent).toContain("↓");
    // Color is applied via .--negative class modifier (red via CSS).
    expect(fourthChange.classList.contains("capability-overview__card-change--negative")).toBe(
      true,
    );
  });

  it("renders percentage change with % suffix", () => {
    const container = renderToContainer(createDefaultProps());
    const changes = container.querySelectorAll(".capability-overview__card-change");
    // Third card: coveredEmployees change = +15%
    const thirdChange = changes[2] as HTMLElement;
    expect(thirdChange.textContent).toContain("+15%");
  });

  it("renders zero change as '持平' in gray", () => {
    const stats = createMockStats({
      changes: {
        totalCapabilities: { value: 0, type: "absolute" },
        publishedCapabilities: { value: 5, type: "absolute" },
        coveredEmployees: { value: 15, type: "percentage" },
        coveredRobots: { value: -3, type: "absolute" },
        monthlyUsageCount: { value: 27, type: "percentage" },
      },
    });
    const container = renderToContainer(createDefaultProps({ stats }));
    const changes = container.querySelectorAll(".capability-overview__card-change");
    const firstChange = changes[0] as HTMLElement;
    expect(firstChange.textContent).toContain("持平");
    // Neutral tone applied via .--neutral class modifier (gray via CSS).
    expect(firstChange.classList.contains("capability-overview__card-change--neutral")).toBe(true);
  });

  it("renders an SVG icon for each stat card", () => {
    const container = renderToContainer(createDefaultProps());
    const icons = container.querySelectorAll(".capability-overview__card-icon");
    expect(icons.length).toBe(5);
    // Icons now use the shared SVG icon system (renderIcon) instead of emoji,
    // so each icon wrapper must contain an <svg> element.
    for (const el of Array.from(icons)) {
      expect(el.querySelector("svg")).not.toBeNull();
    }
  });
});

describe("renderCapabilityOverview — loading state", () => {
  it("renders skeleton placeholders when loading with no data", () => {
    const container = renderToContainer(createDefaultProps({ stats: null, statsLoading: true }));
    const skeletons = container.querySelectorAll(".capability-overview__card--skeleton");
    expect(skeletons.length).toBe(5);
  });

  it("does not render stat cards when loading with no data", () => {
    const container = renderToContainer(createDefaultProps({ stats: null, statsLoading: true }));
    const cards = container.querySelectorAll(
      ".capability-overview__card:not(.capability-overview__card--skeleton)",
    );
    expect(cards.length).toBe(0);
  });
});

describe("renderCapabilityOverview — error state", () => {
  it("renders error message when error with no cached data", () => {
    const container = renderToContainer(
      createDefaultProps({ stats: null, statsError: "网络连接失败" }),
    );
    const errorText = container.querySelector(".capability-overview__error-text");
    expect(errorText).not.toBeNull();
    expect(errorText!.textContent).toContain("网络连接失败");
  });

  it("renders retry button in error state", () => {
    const onRefresh = vi.fn();
    const container = renderToContainer(
      createDefaultProps({ stats: null, statsError: "超时", onRefreshStats: onRefresh }),
    );
    const retryBtn = container.querySelector(
      ".capability-overview__retry-btn",
    ) as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    retryBtn.click();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("shows cached data with update time when error but cache available", () => {
    const cachedTime = new Date("2024-06-15T10:30:00").getTime();
    const container = renderToContainer(
      createDefaultProps({
        stats: createMockStats(),
        statsError: "刷新失败",
        lastSuccessfulLoadAt: cachedTime,
      }),
    );
    // Should still show stat cards
    const cards = container.querySelectorAll(".capability-overview__card");
    expect(cards.length).toBe(5);
    // Should show cache hint
    const text = container.textContent ?? "";
    expect(text).toContain("数据更新时间：2024-06-15 10:30");
  });

  it("shows cache hint with lastSuccessfulLoadAt timestamp", () => {
    const ts = new Date("2024-01-20T14:05:00").getTime();
    const container = renderToContainer(
      createDefaultProps({
        stats: null,
        statsError: "失败",
        lastSuccessfulLoadAt: ts,
      }),
    );
    const hint = container.querySelector(".capability-overview__cache-hint");
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain("2024-01-20 14:05");
  });
});

describe("renderCapabilityOverview — accessibility", () => {
  it("wraps in a section with aria-label", () => {
    const container = renderToContainer(createDefaultProps());
    const section = container.querySelector("section.capability-overview");
    expect(section).not.toBeNull();
    expect(section!.getAttribute("aria-label")).toBe("企业能力概览");
  });

  it("uses h1 for the page title", () => {
    const container = renderToContainer(createDefaultProps());
    const h1 = container.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1!.textContent).toBe("企业能力中心");
  });

  it("card icons are marked aria-hidden", () => {
    const container = renderToContainer(createDefaultProps());
    const icons = container.querySelectorAll(".capability-overview__card-icon");
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
