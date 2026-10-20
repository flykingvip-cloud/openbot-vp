// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { scanNode } from "../capability/employee-capability/terminology-filter.ts";
import { renderCapabilityUpdateRecapTimeline } from "./capability-update-recap-timeline.ts";

describe("renderCapabilityUpdateRecapTimeline", () => {
  it("renders employee-language update headlines", () => {
    const container = document.createElement("div");
    render(
      renderCapabilityUpdateRecapTimeline({
        loading: false,
        recaps: [
          { id: "r1", at: 1_700_000_000_000, headline: "最近更新 · 优化了使用场景说明" },
          { id: "r2", at: 1_700_100_000_000, headline: "最近更新 · 新增了常见任务示例" },
        ],
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("最近更新");
    expect(text).toContain("优化了使用场景说明");
    expect(text).toContain("新增了常见任务示例");
  });

  it("renders nothing when there are no recaps", () => {
    const container = document.createElement("div");
    render(renderCapabilityUpdateRecapTimeline({ loading: false, recaps: [] }), container);
    expect(container.textContent).toBe("");
  });

  it("passes terminology scan and hides version-like text", () => {
    const container = document.createElement("div");
    render(
      renderCapabilityUpdateRecapTimeline({
        loading: false,
        recaps: [{ id: "r1", at: 1, headline: "最近更新 · 优化了使用场景说明" }],
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/v?\d+\.\d+\.\d+/);
    expect(() => scanNode(container)).not.toThrow();
  });
});
