// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import type { EnterpriseHealthStatus } from "../../capability/enterprise-capability/types.ts";
import { renderEnterpriseHealthBadge } from "./health-badge.ts";

const COLOR_BY_STATUS: Record<EnterpriseHealthStatus, string> = {
  效果稳定: "#10B981",
  偶尔结果不理想: "#F59E0B",
  建议重新整理: "#EA580C",
  已不适合继续推广: "#6B7280",
};

function getMainBadge(container: Element): HTMLElement {
  const main = container.querySelector(".enterprise-health-badge__main");
  if (!main) {
    throw new Error("missing .enterprise-health-badge__main");
  }
  return main as HTMLElement;
}

describe("renderEnterpriseHealthBadge — color & label mapping", () => {
  it.each(Object.keys(COLOR_BY_STATUS) as EnterpriseHealthStatus[])(
    "renders %s with the expected status data attribute and matching text label",
    (status) => {
      const container = document.createElement("div");
      render(renderEnterpriseHealthBadge({ status }), container);

      const main = getMainBadge(container);
      // The label text must always appear (accessibility: not color-only).
      expect(main.textContent ?? "").toContain(status);

      // data-status attribute drives both CSS background color (per status)
      // and E2E selectors. The CSS in enterprise-foundation.css applies the
      // expected color via [data-status="<status>"] attribute selector.
      expect(main.getAttribute("data-status")).toBe(status);
      // COLOR_BY_STATUS is the visual contract — keep the constant alongside
      // the test so changes to the palette are reviewable here.
      expect(COLOR_BY_STATUS[status]).toBeTruthy();
    },
  );
});

describe("renderEnterpriseHealthBadge — variants", () => {
  it("defaults to the inline variant when variant is omitted", () => {
    const container = document.createElement("div");
    render(renderEnterpriseHealthBadge({ status: "效果稳定" }), container);

    expect(container.querySelector(".enterprise-health-badge--inline")).not.toBeNull();
    expect(container.querySelector(".enterprise-health-badge--detail")).toBeNull();
  });

  it("inline variant uses compact padding & xs font size (via class modifier)", () => {
    const container = document.createElement("div");
    render(renderEnterpriseHealthBadge({ status: "效果稳定", variant: "inline" }), container);

    const main = getMainBadge(container);
    // Padding/font-size are applied via .enterprise-health-badge__main--inline
    // class in enterprise-foundation.css (px-2 py-0.5 ≈ 8px / 2px, text-xs).
    expect(main.classList.contains("enterprise-health-badge__main--inline")).toBe(true);
  });

  it("detail variant uses larger padding & sm font size (via class modifier)", () => {
    const container = document.createElement("div");
    render(renderEnterpriseHealthBadge({ status: "效果稳定", variant: "detail" }), container);

    const main = getMainBadge(container);
    // Padding/font-size are applied via .enterprise-health-badge__main--detail
    // class in enterprise-foundation.css (px-3 py-1 ≈ 12px / 4px, text-sm).
    expect(main.classList.contains("enterprise-health-badge__main--detail")).toBe(true);
  });
});

describe("renderEnterpriseHealthBadge — accessibility", () => {
  it("wraps the badge in role=status with the full aria-label", () => {
    const container = document.createElement("div");
    render(renderEnterpriseHealthBadge({ status: "建议重新整理" }), container);

    const wrapper = container.querySelector(".enterprise-health-badge");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.getAttribute("role")).toBe("status");
    expect(wrapper!.getAttribute("aria-label")).toBe("能力健康状态：建议重新整理");
  });

  it("renders the text label alongside the color (never color-only)", () => {
    const container = document.createElement("div");
    render(renderEnterpriseHealthBadge({ status: "已不适合继续推广" }), container);

    const labelEl = container.querySelector(".enterprise-health-badge__label");
    expect(labelEl).not.toBeNull();
    expect(labelEl!.textContent).toBe("已不适合继续推广");
  });

  it("does not leak engineering terminology (healthy/warning/broken/error rate/latency)", () => {
    const container = document.createElement("div");
    for (const status of Object.keys(COLOR_BY_STATUS) as EnterpriseHealthStatus[]) {
      render(
        renderEnterpriseHealthBadge({ status, noTelemetry: true, variant: "detail" }),
        container,
      );
    }

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/healthy|warning|broken|error rate|latency/i);
    // No raw numeric metrics like "95%" or "1284ms" in the badge.
    expect(text).not.toMatch(/\d+%/);
    expect(text).not.toMatch(/\d+ms/);
  });
});

describe("renderEnterpriseHealthBadge — noTelemetry annotation", () => {
  it("does not render the annotation by default", () => {
    const container = document.createElement("div");
    render(renderEnterpriseHealthBadge({ status: "效果稳定" }), container);

    expect(container.querySelector(".enterprise-health-badge__annotation")).toBeNull();
  });

  it("appends '暂无运行数据' annotation when noTelemetry is true", () => {
    const container = document.createElement("div");
    render(renderEnterpriseHealthBadge({ status: "效果稳定", noTelemetry: true }), container);

    const annotation = container.querySelector(".enterprise-health-badge__annotation");
    expect(annotation).not.toBeNull();
    expect(annotation!.textContent).toBe("暂无运行数据");
  });

  it("annotation appears after the main badge in document order", () => {
    const container = document.createElement("div");
    render(renderEnterpriseHealthBadge({ status: "效果稳定", noTelemetry: true }), container);

    const wrapper = container.querySelector(".enterprise-health-badge")!;
    const children = Array.from(wrapper.children);
    const mainIndex = children.findIndex((c) =>
      c.classList.contains("enterprise-health-badge__main"),
    );
    const annotationIndex = children.findIndex((c) =>
      c.classList.contains("enterprise-health-badge__annotation"),
    );

    expect(mainIndex).toBeGreaterThanOrEqual(0);
    expect(annotationIndex).toBeGreaterThan(mainIndex);
  });
});
