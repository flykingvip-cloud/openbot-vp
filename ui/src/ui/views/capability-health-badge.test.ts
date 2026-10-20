// @vitest-environment jsdom
import { render } from "lit";
import { html } from "lit";
import { describe, expect, it } from "vitest";
import { scanNode } from "../capability/employee-capability/terminology-filter.ts";
import { healthRepairSuggestion, renderCapabilityHealthBadge } from "./capability-health-badge.ts";

describe("renderCapabilityHealthBadge", () => {
  it("renders the three employee-language labels", () => {
    const container = document.createElement("div");
    render(
      html`
        ${renderCapabilityHealthBadge({ label: "运行稳定", variant: "inline" })}
        ${renderCapabilityHealthBadge({ label: "偶尔异常", variant: "inline" })}
        ${renderCapabilityHealthBadge({ label: "需要重新整理", variant: "inline" })}
      `,
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("运行稳定");
    expect(text).toContain("偶尔异常");
    expect(text).toContain("需要重新整理");
  });

  it("shows repair suggestions only in detail variant", () => {
    const inline = document.createElement("div");
    render(renderCapabilityHealthBadge({ label: "需要重新整理", variant: "inline" }), inline);
    expect(inline.textContent).not.toContain("建议稍后重新整理");

    const detail = document.createElement("div");
    render(renderCapabilityHealthBadge({ label: "需要重新整理", variant: "detail" }), detail);
    expect(detail.textContent).toContain("建议稍后重新整理");
  });

  it("does not leak raw telemetry details", () => {
    const container = document.createElement("div");
    render(renderCapabilityHealthBadge({ label: "偶尔异常", variant: "detail" }), container);

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\d+ms|successRate|failureReasons|stack trace/i);
    expect(() => scanNode(container)).not.toThrow();
  });

  it("keeps suggestions employee-language only", () => {
    expect(healthRepairSuggestion("运行稳定")).toBeNull();
    expect(healthRepairSuggestion("偶尔异常")).toContain("建议稍后整理");
    expect(healthRepairSuggestion("需要重新整理")).toContain("建议稍后重新整理");
  });
});
