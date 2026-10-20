// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { CredibilityIndicators } from "../../capability/enterprise-capability/types.ts";
import { renderCredibilityBadge } from "./credibility-badge.ts";

function makeCredibility(overrides: Partial<CredibilityIndicators> = {}): CredibilityIndicators {
  return {
    verifiedDepartments: ["法务部", "采购部", "销售部"],
    productionUsageDays: 305,
    ...overrides,
  };
}

describe("renderCredibilityBadge — inline variant", () => {
  it("defaults to inline variant when variant is omitted", () => {
    const container = document.createElement("div");
    render(renderCredibilityBadge({ credibility: makeCredibility() }), container);

    expect(container.querySelector(".credibility-badge--inline")).not.toBeNull();
    expect(container.querySelector(".credibility-badge--detail")).toBeNull();
  });

  it("renders the production usage days line", () => {
    const container = document.createElement("div");
    render(
      renderCredibilityBadge({ credibility: makeCredibility({ productionUsageDays: 305 }) }),
      container,
    );

    expect(container.textContent ?? "").toContain("已在生产环境运行 305 天");
  });

  it("renders verified department chips with label prefix", () => {
    const container = document.createElement("div");
    render(
      renderCredibilityBadge({
        credibility: makeCredibility({ verifiedDepartments: ["法务部", "采购部"] }),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("已验证部门：");
    expect(text).toContain("法务部");
    expect(text).toContain("采购部");
  });

  it("shows up to 3 chips and uses +N overflow when more departments exist", () => {
    const container = document.createElement("div");
    render(
      renderCredibilityBadge({
        credibility: makeCredibility({
          verifiedDepartments: [
            "法务部",
            "采购部",
            "销售部",
            "客服部",
            "HR",
            "财务部",
            "数据分析",
            "市场部",
          ],
        }),
      }),
      container,
    );

    const chips = container.querySelectorAll(".credibility-badge__chip--inline");
    expect(chips.length).toBe(3);

    const overflow = container.querySelector(".credibility-badge__overflow");
    expect(overflow).not.toBeNull();
    expect(overflow!.textContent).toBe("+5");
  });

  it("does not render overflow when departments count is <= 3", () => {
    const container = document.createElement("div");
    render(
      renderCredibilityBadge({
        credibility: makeCredibility({ verifiedDepartments: ["法务部", "采购部", "销售部"] }),
      }),
      container,
    );

    expect(container.querySelector(".credibility-badge__overflow")).toBeNull();
    expect(container.querySelectorAll(".credibility-badge__chip--inline").length).toBe(3);
  });

  it("shows empty placeholder when verifiedDepartments is empty", () => {
    const container = document.createElement("div");
    render(
      renderCredibilityBadge({
        credibility: makeCredibility({ verifiedDepartments: [] }),
      }),
      container,
    );

    const empty = container.querySelector(".credibility-badge__empty");
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain("暂无已验证部门");
  });

  it("shows new-on-shelf message when productionUsageDays is 0", () => {
    const container = document.createElement("div");
    render(
      renderCredibilityBadge({
        credibility: makeCredibility({ productionUsageDays: 0 }),
      }),
      container,
    );

    expect(container.textContent ?? "").toContain("新上架，尚未在生产环境长期运行");
  });

  it("collapses to '稳定运行超过 1 年' when productionUsageDays >= 365", () => {
    const container = document.createElement("div");
    render(
      renderCredibilityBadge({
        credibility: makeCredibility({ productionUsageDays: 400 }),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("已稳定运行超过 1 年");
    expect(text).not.toContain("400 天");
  });

  it("renders the shield icon as a prefix", () => {
    const container = document.createElement("div");
    render(renderCredibilityBadge({ credibility: makeCredibility() }), container);

    expect(container.querySelector(".credibility-badge__shield")).not.toBeNull();
  });
});

describe("renderCredibilityBadge — detail variant", () => {
  it("renders the section heading '可信度'", () => {
    const container = document.createElement("div");
    render(
      renderCredibilityBadge({ credibility: makeCredibility(), variant: "detail" }),
      container,
    );

    const heading = container.querySelector(".credibility-badge__heading");
    expect(heading).not.toBeNull();
    expect(heading!.textContent).toBe("可信度");
  });

  it("renders the production usage with stable wording", () => {
    const container = document.createElement("div");
    render(
      renderCredibilityBadge({
        credibility: makeCredibility({ productionUsageDays: 305 }),
        variant: "detail",
      }),
      container,
    );

    expect(container.textContent ?? "").toContain("已在生产环境稳定运行 305 天");
  });

  it("renders all verified departments without overflow truncation", () => {
    const departments = [
      "法务部",
      "采购部",
      "销售部",
      "客服部",
      "HR",
      "财务部",
      "数据分析",
      "市场部",
    ];
    const container = document.createElement("div");
    render(
      renderCredibilityBadge({
        credibility: makeCredibility({ verifiedDepartments: departments }),
        variant: "detail",
      }),
      container,
    );

    const chips = container.querySelectorAll(".credibility-badge__chip--detail");
    expect(chips.length).toBe(departments.length);
    expect(container.querySelector(".credibility-badge__overflow")).toBeNull();

    const text = container.textContent ?? "";
    for (const dept of departments) {
      expect(text).toContain(dept);
    }
  });

  it("shows empty placeholder in detail variant when departments are empty", () => {
    const container = document.createElement("div");
    render(
      renderCredibilityBadge({
        credibility: makeCredibility({ verifiedDepartments: [] }),
        variant: "detail",
      }),
      container,
    );

    const empty = container.querySelector(".credibility-badge__empty");
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain("暂无已验证部门");
  });

  it("shows new-on-shelf message in detail when productionUsageDays is 0", () => {
    const container = document.createElement("div");
    render(
      renderCredibilityBadge({
        credibility: makeCredibility({ productionUsageDays: 0 }),
        variant: "detail",
      }),
      container,
    );

    expect(container.textContent ?? "").toContain("新上架，尚未在生产环境长期运行");
  });

  it("collapses to over-1-year wording in detail when days >= 365", () => {
    const container = document.createElement("div");
    render(
      renderCredibilityBadge({
        credibility: makeCredibility({ productionUsageDays: 365 }),
        variant: "detail",
      }),
      container,
    );

    expect(container.textContent ?? "").toContain("已稳定运行超过 1 年");
  });
});
