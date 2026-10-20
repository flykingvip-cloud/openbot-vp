// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { CapabilityMaturity } from "../../capability/enterprise-capability/types.ts";
import { maturityToDotCount, renderMaturityIndicator } from "./maturity-indicator.ts";

describe("maturityToDotCount", () => {
  it.each<[CapabilityMaturity, number]>([
    ["初步形成", 1],
    ["稳定使用", 2],
    ["多人复用", 3],
    ["企业认证", 4],
    ["企业标准", 5],
    ["核心资产", 6],
  ])("maps %s to %d filled dots", (maturity, expected) => {
    expect(maturityToDotCount(maturity)).toBe(expected);
  });
});

describe("renderMaturityIndicator", () => {
  it("always renders exactly 6 dots regardless of level", () => {
    const container = document.createElement("div");
    render(renderMaturityIndicator({ maturity: "初步形成" }), container);

    const dots = container.querySelectorAll(".maturity-indicator__dot");
    expect(dots.length).toBe(6);
  });

  it("fills the first N dots where N equals the level (核心资产 → 6 filled)", () => {
    const container = document.createElement("div");
    render(renderMaturityIndicator({ maturity: "核心资产" }), container);

    const filled = container.querySelectorAll(".maturity-indicator__dot--filled");
    const empty = container.querySelectorAll(".maturity-indicator__dot--empty");
    expect(filled.length).toBe(6);
    expect(empty.length).toBe(0);
  });

  it("fills 3 of 6 dots for 多人复用", () => {
    const container = document.createElement("div");
    render(renderMaturityIndicator({ maturity: "多人复用" }), container);

    const filled = container.querySelectorAll(".maturity-indicator__dot--filled");
    const empty = container.querySelectorAll(".maturity-indicator__dot--empty");
    expect(filled.length).toBe(3);
    expect(empty.length).toBe(3);
  });

  it("uses high-tier (gold) styling for 企业认证 / 企业标准 / 核心资产", () => {
    for (const maturity of ["企业认证", "企业标准", "核心资产"] as const) {
      const container = document.createElement("div");
      render(renderMaturityIndicator({ maturity }), container);

      const root = container.querySelector(".maturity-indicator");
      // .--high-tier modifier applies the gold (#F59E0B) fill via CSS in
      // enterprise-components.css.
      expect(root?.classList.contains("maturity-indicator--high-tier")).toBe(true);

      const firstFilled = container.querySelector(".maturity-indicator__dot--filled");
      expect(firstFilled).not.toBeNull();
    }
  });

  it("uses default-tier (blue) styling for 初步形成 / 稳定使用 / 多人复用", () => {
    for (const maturity of ["初步形成", "稳定使用", "多人复用"] as const) {
      const container = document.createElement("div");
      render(renderMaturityIndicator({ maturity }), container);

      const root = container.querySelector(".maturity-indicator");
      // .--default-tier modifier applies the blue (#3B82F6) fill via CSS.
      expect(root?.classList.contains("maturity-indicator--default-tier")).toBe(true);

      const firstFilled = container.querySelector(".maturity-indicator__dot--filled");
      expect(firstFilled).not.toBeNull();
    }
  });

  it("renders the maturity text label for variant='with-label' (default)", () => {
    const container = document.createElement("div");
    render(renderMaturityIndicator({ maturity: "企业标准" }), container);

    const label = container.querySelector(".maturity-indicator__label");
    expect(label).not.toBeNull();
    expect(label?.textContent).toContain("企业标准");
  });

  it("omits the text label for variant='compact'", () => {
    const container = document.createElement("div");
    render(renderMaturityIndicator({ maturity: "企业标准", variant: "compact" }), container);

    const label = container.querySelector(".maturity-indicator__label");
    expect(label).toBeNull();

    // dots still rendered
    const dots = container.querySelectorAll(".maturity-indicator__dot");
    expect(dots.length).toBe(6);
  });

  it("exposes business-language aria-label for accessibility", () => {
    const container = document.createElement("div");
    render(renderMaturityIndicator({ maturity: "多人复用" }), container);

    const root = container.querySelector(".maturity-indicator");
    expect(root?.getAttribute("role")).toBe("img");
    expect(root?.getAttribute("aria-label")).toBe("能力成熟度：多人复用");
  });
});
