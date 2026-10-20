// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { DomainDistribution } from "../../capability/enterprise-capability/types.ts";
import { renderDomainDistribution, type DomainDistributionProps } from "./domain-distribution.ts";

function makeDomain(overrides: Partial<DomainDistribution> = {}): DomainDistribution {
  return {
    domain: "销售",
    capabilityCount: 12,
    representativeCapabilities: ["客户跟进", "商机分析", "报价生成"],
    coverageRate: 85,
    ...overrides,
  };
}

function makeProps(overrides: Partial<DomainDistributionProps> = {}): DomainDistributionProps {
  return {
    domains: [
      makeDomain({ domain: "销售", capabilityCount: 12 }),
      makeDomain({ domain: "HR", capabilityCount: 8 }),
      makeDomain({ domain: "客服", capabilityCount: 6 }),
      makeDomain({ domain: "财务", capabilityCount: 5 }),
      makeDomain({ domain: "法务", capabilityCount: 3 }),
      makeDomain({ domain: "数据分析", capabilityCount: 2 }),
    ],
    loading: false,
    error: null,
    onSelectDomain: vi.fn(),
    ...overrides,
  };
}

describe("renderDomainDistribution — normal state", () => {
  it("renders section title and subtitle", () => {
    const container = document.createElement("div");
    render(renderDomainDistribution(makeProps()), container);

    const text = container.textContent ?? "";
    expect(text).toContain("能力领域分布");
    expect(text).toContain("按业务领域聚合的企业 AI 能力版图");
  });

  it("renders 6 domain cards", () => {
    const container = document.createElement("div");
    render(renderDomainDistribution(makeProps()), container);

    const cards = container.querySelectorAll(".domain-distribution__card");
    expect(cards.length).toBe(6);
  });

  it("renders fallback cards for all enterprise domains when response is empty", () => {
    const container = document.createElement("div");
    render(renderDomainDistribution(makeProps({ domains: [] })), container);

    const cards = container.querySelectorAll(".domain-distribution__card");
    const text = container.textContent ?? "";
    expect(cards.length).toBe(6);
    expect(text).toContain("销售");
    expect(text).toContain("HR");
    expect(text).toContain("客服");
    expect(text).toContain("财务");
    expect(text).toContain("法务");
    expect(text).toContain("数据分析");
    expect(text.match(/暂无能力/g)?.length).toBe(6);
  });

  it("renders domain name and capability count", () => {
    const container = document.createElement("div");
    render(renderDomainDistribution(makeProps()), container);

    const text = container.textContent ?? "";
    expect(text).toContain("销售");
    expect(text).toContain("12 项能力");
    expect(text).toContain("HR");
    expect(text).toContain("8 项能力");
  });

  it("renders domain emoji icons", () => {
    const container = document.createElement("div");
    render(renderDomainDistribution(makeProps()), container);

    const text = container.textContent ?? "";
    expect(text).toContain("💼"); // 销售
    expect(text).toContain("👥"); // HR
    expect(text).toContain("🎧"); // 客服
    expect(text).toContain("💰"); // 财务
    expect(text).toContain("⚖️"); // 法务
    expect(text).toContain("📊"); // 数据分析
  });

  it("renders representative capabilities (up to 3)", () => {
    const container = document.createElement("div");
    render(
      renderDomainDistribution(
        makeProps({
          domains: [
            makeDomain({
              representativeCapabilities: ["能力A", "能力B", "能力C", "能力D"],
            }),
          ],
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("能力A");
    expect(text).toContain("能力B");
    expect(text).toContain("能力C");
    expect(text).not.toContain("能力D");
  });

  it("renders coverage rate", () => {
    const container = document.createElement("div");
    render(
      renderDomainDistribution(
        makeProps({
          domains: [makeDomain({ coverageRate: 72 })],
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("覆盖率 72%");
  });

  it("calls onSelectDomain when card is clicked", () => {
    const onSelectDomain = vi.fn();
    const container = document.createElement("div");
    render(renderDomainDistribution(makeProps({ onSelectDomain })), container);

    const firstCard = container.querySelector(".domain-distribution__card") as HTMLElement;
    firstCard.click();

    expect(onSelectDomain).toHaveBeenCalledWith("销售");
  });

  it("calls onSelectDomain on Enter key press", () => {
    const onSelectDomain = vi.fn();
    const container = document.createElement("div");
    render(renderDomainDistribution(makeProps({ onSelectDomain })), container);

    const firstCard = container.querySelector(".domain-distribution__card") as HTMLElement;
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    firstCard.dispatchEvent(event);

    expect(onSelectDomain).toHaveBeenCalledWith("销售");
  });
});

describe("renderDomainDistribution — empty domain (0 capabilities)", () => {
  it("shows '暂无能力' for domains with 0 capabilities", () => {
    const container = document.createElement("div");
    render(
      renderDomainDistribution(
        makeProps({
          domains: [
            makeDomain({ domain: "法务", capabilityCount: 0, representativeCapabilities: [] }),
          ],
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("暂无能力");
    expect(text).not.toContain("0 项能力");
  });

  it("does not render coverage rate for empty domains", () => {
    const container = document.createElement("div");
    render(
      renderDomainDistribution(
        makeProps({
          domains: [
            makeDomain({ domain: "法务", capabilityCount: 0, representativeCapabilities: [] }),
          ],
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).not.toContain("覆盖率");
  });

  it("applies muted opacity for empty domain cards", () => {
    const container = document.createElement("div");
    render(
      renderDomainDistribution(
        makeProps({
          domains: [
            makeDomain({ domain: "法务", capabilityCount: 0, representativeCapabilities: [] }),
          ],
        }),
      ),
      container,
    );

    const card = container.querySelector(".domain-distribution__card") as HTMLElement;
    expect(card.style.cssText).toContain("opacity");
  });
});

describe("renderDomainDistribution — loading state", () => {
  it("renders 6 skeleton cards when loading", () => {
    const container = document.createElement("div");
    render(renderDomainDistribution(makeProps({ loading: true })), container);

    const skeletons = container.querySelectorAll(".domain-distribution__skeleton");
    expect(skeletons.length).toBe(6);
  });

  it("does not render domain cards when loading", () => {
    const container = document.createElement("div");
    render(renderDomainDistribution(makeProps({ loading: true })), container);

    const cards = container.querySelectorAll(".domain-distribution__card");
    expect(cards.length).toBe(0);
  });
});

describe("renderDomainDistribution — error state", () => {
  it("renders error message", () => {
    const container = document.createElement("div");
    render(
      renderDomainDistribution(
        makeProps({
          loading: false,
          error: "网络连接失败，请稍后重试",
        }),
      ),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("网络连接失败，请稍后重试");
  });

  it("renders retry button", () => {
    const container = document.createElement("div");
    render(
      renderDomainDistribution(
        makeProps({
          loading: false,
          error: "加载失败",
        }),
      ),
      container,
    );

    const retryBtn = container.querySelector(".domain-distribution__retry-btn");
    expect(retryBtn).not.toBeNull();
    expect(retryBtn!.textContent).toContain("重试");
  });

  it("does not render domain cards when error", () => {
    const container = document.createElement("div");
    render(
      renderDomainDistribution(
        makeProps({
          loading: false,
          error: "加载失败",
        }),
      ),
      container,
    );

    const cards = container.querySelectorAll(".domain-distribution__card");
    expect(cards.length).toBe(0);
  });
});

describe("renderDomainDistribution — accessibility", () => {
  it("has aria-labelledby on the section", () => {
    const container = document.createElement("div");
    render(renderDomainDistribution(makeProps()), container);

    const section = container.querySelector(".domain-distribution");
    expect(section?.getAttribute("aria-labelledby")).toBe("domain-distribution-title");
  });

  it("cards have role=button and tabindex=0", () => {
    const container = document.createElement("div");
    render(renderDomainDistribution(makeProps()), container);

    const card = container.querySelector(".domain-distribution__card");
    expect(card?.getAttribute("role")).toBe("button");
    expect(card?.getAttribute("tabindex")).toBe("0");
  });

  it("cards have descriptive aria-label", () => {
    const container = document.createElement("div");
    render(
      renderDomainDistribution(
        makeProps({
          domains: [makeDomain({ domain: "客服", capabilityCount: 6 })],
        }),
      ),
      container,
    );

    const card = container.querySelector(".domain-distribution__card");
    expect(card?.getAttribute("aria-label")).toContain("客服");
    expect(card?.getAttribute("aria-label")).toContain("6 项能力");
  });

  it("error state has role=alert", () => {
    const container = document.createElement("div");
    render(renderDomainDistribution(makeProps({ loading: false, error: "失败" })), container);

    const errorEl = container.querySelector("[role='alert']");
    expect(errorEl).not.toBeNull();
  });
});
