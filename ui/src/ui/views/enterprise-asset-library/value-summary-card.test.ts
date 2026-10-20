// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { EnterpriseCapabilityValueSummary } from "../../capability/enterprise-capability/types.ts";
import {
  formatDepartmentCoverage,
  formatMonthlyExecutions,
  formatReuseGrowthRate,
  renderValueSummaryCard,
} from "./value-summary-card.ts";

function makeSummary(
  overrides: Partial<EnterpriseCapabilityValueSummary> = {},
): EnterpriseCapabilityValueSummary {
  return {
    monthlyExecutions: 1284,
    departmentCoverageCount: 7,
    reuseGrowthRate30d: 23,
    ...overrides,
  };
}

describe("formatMonthlyExecutions", () => {
  it("formats counts with zh-CN thousand separators", () => {
    expect(formatMonthlyExecutions(1284)).toBe("本月已被调用 1,284 次");
  });

  it("formats large counts with thousand separators", () => {
    expect(formatMonthlyExecutions(1_234_567)).toBe("本月已被调用 1,234,567 次");
  });

  it("formats single-digit counts without separators", () => {
    expect(formatMonthlyExecutions(7)).toBe("本月已被调用 7 次");
  });

  it("returns the empty-state phrase for zero", () => {
    expect(formatMonthlyExecutions(0)).toBe("本月暂未被调用");
  });
});

describe("formatDepartmentCoverage", () => {
  it("formats positive counts", () => {
    expect(formatDepartmentCoverage(7)).toBe("已覆盖 7 个部门");
  });

  it("formats single-department count", () => {
    expect(formatDepartmentCoverage(1)).toBe("已覆盖 1 个部门");
  });

  it("returns the empty-state phrase for zero", () => {
    expect(formatDepartmentCoverage(0)).toBe("暂未覆盖任何部门");
  });
});

describe("formatReuseGrowthRate", () => {
  it("formats positive growth with leading +", () => {
    expect(formatReuseGrowthRate(23)).toBe("近 30 天复用增长 +23%");
  });

  it("formats negative growth with leading -", () => {
    expect(formatReuseGrowthRate(-5)).toBe("近 30 天复用下降 -5%");
  });

  it("formats zero growth as 持平", () => {
    expect(formatReuseGrowthRate(0)).toBe("近 30 天复用持平");
  });
});

describe("renderValueSummaryCard — card variant (default)", () => {
  it("defaults to card variant when variant is omitted", () => {
    const container = document.createElement("div");
    render(renderValueSummaryCard({ summary: makeSummary() }), container);

    expect(container.querySelector(".value-summary-card--card")).not.toBeNull();
    expect(container.querySelector(".value-summary-card--inline")).toBeNull();
  });

  it("renders all three business-language lines", () => {
    const container = document.createElement("div");
    render(renderValueSummaryCard({ summary: makeSummary() }), container);

    const text = container.textContent ?? "";
    expect(text).toContain("本月已被调用 1,284 次");
    expect(text).toContain("已覆盖 7 个部门");
    expect(text).toContain("近 30 天复用增长 +23%");
  });

  it("never renders raw field names like 'monthlyExecutions:'", () => {
    const container = document.createElement("div");
    render(renderValueSummaryCard({ summary: makeSummary() }), container);

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/monthlyExecutions/);
    expect(text).not.toMatch(/departmentCoverageCount/);
    expect(text).not.toMatch(/reuseGrowthRate30d/);
  });

  it("includes the trend icons (📊 / 🏢 / 📈 for positive growth)", () => {
    const container = document.createElement("div");
    render(renderValueSummaryCard({ summary: makeSummary({ reuseGrowthRate30d: 23 }) }), container);

    const text = container.textContent ?? "";
    expect(text).toContain("📊");
    expect(text).toContain("🏢");
    expect(text).toContain("📈");
  });

  it("uses 📉 icon and red color for negative growth", () => {
    const container = document.createElement("div");
    render(renderValueSummaryCard({ summary: makeSummary({ reuseGrowthRate30d: -5 }) }), container);

    const text = container.textContent ?? "";
    expect(text).toContain("📉");
    expect(text).toContain("近 30 天复用下降 -5%");

    const negativeLine = container.querySelector(".value-summary-card__line--growth-negative");
    expect(negativeLine).not.toBeNull();
    // Color comes from .--growth-negative class via CSS in
    // enterprise-components.css.
    const styledText = negativeLine!.querySelector(".value-summary-card__text");
    expect(styledText).not.toBeNull();
  });

  it("uses ➡️ icon and gray color for zero growth", () => {
    const container = document.createElement("div");
    render(renderValueSummaryCard({ summary: makeSummary({ reuseGrowthRate30d: 0 }) }), container);

    const text = container.textContent ?? "";
    expect(text).toContain("➡️");
    expect(text).toContain("近 30 天复用持平");

    const neutralLine = container.querySelector(".value-summary-card__line--growth-neutral");
    expect(neutralLine).not.toBeNull();
    // Gray color via .--growth-neutral class.
    const styledText = neutralLine!.querySelector(".value-summary-card__text");
    expect(styledText).not.toBeNull();
  });

  it("uses green color for positive growth", () => {
    const container = document.createElement("div");
    render(renderValueSummaryCard({ summary: makeSummary({ reuseGrowthRate30d: 23 }) }), container);

    const positiveLine = container.querySelector(".value-summary-card__line--growth-positive");
    expect(positiveLine).not.toBeNull();
    // Green color via .--growth-positive class.
    const styledText = positiveLine!.querySelector(".value-summary-card__text");
    expect(styledText).not.toBeNull();
  });

  it("renders empty-state phrasing when all metrics are zero", () => {
    const container = document.createElement("div");
    render(
      renderValueSummaryCard({
        summary: makeSummary({
          monthlyExecutions: 0,
          departmentCoverageCount: 0,
          reuseGrowthRate30d: 0,
        }),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("本月暂未被调用");
    expect(text).toContain("暂未覆盖任何部门");
    expect(text).toContain("近 30 天复用持平");
  });
});

describe("renderValueSummaryCard — inline variant", () => {
  it("renders inline variant with separators between sentences", () => {
    const container = document.createElement("div");
    render(renderValueSummaryCard({ summary: makeSummary(), variant: "inline" }), container);

    expect(container.querySelector(".value-summary-card--inline")).not.toBeNull();
    expect(container.querySelector(".value-summary-card--card")).toBeNull();

    const separators = container.querySelectorAll(".value-summary-card__separator");
    expect(separators.length).toBe(2);
  });

  it("includes all three sentences in inline variant", () => {
    const container = document.createElement("div");
    render(renderValueSummaryCard({ summary: makeSummary(), variant: "inline" }), container);

    const text = container.textContent ?? "";
    expect(text).toContain("本月已被调用 1,284 次");
    expect(text).toContain("已覆盖 7 个部门");
    expect(text).toContain("近 30 天复用增长 +23%");
  });

  it("preserves growth color in inline variant for negative growth", () => {
    const container = document.createElement("div");
    render(
      renderValueSummaryCard({
        summary: makeSummary({ reuseGrowthRate30d: -12 }),
        variant: "inline",
      }),
      container,
    );

    const negativeLine = container.querySelector(".value-summary-card__line--growth-negative");
    expect(negativeLine).not.toBeNull();
    // Color via .--growth-negative class in inline variant.
    const styledText = negativeLine!.querySelector(".value-summary-card__text");
    expect(styledText).not.toBeNull();
  });
});
