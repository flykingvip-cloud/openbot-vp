// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderMiniTrendChart } from "./mini-trend-chart.ts";

describe("renderMiniTrendChart — empty / no-data placeholder", () => {
  it("renders '暂无使用数据' when trend is an empty array", () => {
    const container = document.createElement("div");
    render(renderMiniTrendChart({ trend: [], growthPercentage: 0 }), container);

    expect(container.querySelector(".mini-trend-chart--empty")).not.toBeNull();
    expect(container.textContent ?? "").toContain("暂无使用数据");
    // No SVG should be rendered when there is no data
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders '暂无使用数据' when trend contains all zeros", () => {
    const container = document.createElement("div");
    render(
      renderMiniTrendChart({ trend: Array.from({ length: 30 }, () => 0), growthPercentage: 0 }),
      container,
    );

    expect(container.querySelector(".mini-trend-chart--empty")).not.toBeNull();
    expect(container.textContent ?? "").toContain("暂无使用数据");
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("renderMiniTrendChart — SVG rendering", () => {
  function makeTrend(): number[] {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  }

  it("renders an SVG with role='img' and the accessibility label", () => {
    const container = document.createElement("div");
    render(renderMiniTrendChart({ trend: makeTrend(), growthPercentage: 12 }), container);

    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("role")).toBe("img");
    expect(svg!.getAttribute("aria-label")).toBe("近30天使用趋势");
  });

  it("uses default width=80 and height=24 when not provided", () => {
    const container = document.createElement("div");
    render(renderMiniTrendChart({ trend: makeTrend(), growthPercentage: 5 }), container);

    const svg = container.querySelector("svg");
    expect(svg!.getAttribute("width")).toBe("80");
    expect(svg!.getAttribute("height")).toBe("24");
    expect(svg!.getAttribute("viewBox")).toBe("0 0 80 24");
  });

  it("respects custom width and height", () => {
    const container = document.createElement("div");
    render(
      renderMiniTrendChart({ trend: makeTrend(), growthPercentage: 5, width: 120, height: 32 }),
      container,
    );

    const svg = container.querySelector("svg");
    expect(svg!.getAttribute("width")).toBe("120");
    expect(svg!.getAttribute("height")).toBe("32");
    expect(svg!.getAttribute("viewBox")).toBe("0 0 120 32");
  });

  it("renders a polyline whose points span the full width", () => {
    const container = document.createElement("div");
    render(
      renderMiniTrendChart({ trend: makeTrend(), growthPercentage: 12, width: 80, height: 24 }),
      container,
    );

    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    const points = polyline!.getAttribute("points") ?? "";
    const coords = points.split(/\s+/).filter(Boolean);
    expect(coords.length).toBe(makeTrend().length);

    const firstX = Number.parseFloat(coords[0].split(",")[0]);
    const lastX = Number.parseFloat(coords.at(-1)!.split(",")[0]);
    expect(firstX).toBeCloseTo(0, 2);
    expect(lastX).toBeCloseTo(80, 2);
  });
});

describe("renderMiniTrendChart — color mapping by growthPercentage", () => {
  const trend = [1, 2, 3, 4, 5];

  it("uses green (#10B981) for positive growth", () => {
    const container = document.createElement("div");
    render(renderMiniTrendChart({ trend, growthPercentage: 12 }), container);

    const polyline = container.querySelector("polyline");
    expect(polyline!.getAttribute("stroke")).toBe("#10B981");
  });

  it("uses red (#EF4444) for negative growth", () => {
    const container = document.createElement("div");
    render(renderMiniTrendChart({ trend, growthPercentage: -5 }), container);

    const polyline = container.querySelector("polyline");
    expect(polyline!.getAttribute("stroke")).toBe("#EF4444");
  });

  it("uses gray (#9CA3AF) for zero growth", () => {
    const container = document.createElement("div");
    render(renderMiniTrendChart({ trend, growthPercentage: 0 }), container);

    const polyline = container.querySelector("polyline");
    expect(polyline!.getAttribute("stroke")).toBe("#9CA3AF");
  });
});

describe("renderMiniTrendChart — growth label", () => {
  const trend = [1, 2, 3];

  it("renders '+12%' with up arrow ↑ for positive growth", () => {
    const container = document.createElement("div");
    render(renderMiniTrendChart({ trend, growthPercentage: 12 }), container);

    const growth = container.querySelector(".mini-trend-chart__growth--positive");
    expect(growth).not.toBeNull();
    const text = growth!.textContent ?? "";
    expect(text).toContain("↑");
    expect(text).toContain("+12%");
  });

  it("renders '-5%' with down arrow ↓ for negative growth", () => {
    const container = document.createElement("div");
    render(renderMiniTrendChart({ trend, growthPercentage: -5 }), container);

    const growth = container.querySelector(".mini-trend-chart__growth--negative");
    expect(growth).not.toBeNull();
    const text = growth!.textContent ?? "";
    expect(text).toContain("↓");
    expect(text).toContain("-5%");
  });

  it("renders '持平' without arrow for zero growth", () => {
    const container = document.createElement("div");
    render(renderMiniTrendChart({ trend, growthPercentage: 0 }), container);

    const growth = container.querySelector(".mini-trend-chart__growth--neutral");
    expect(growth).not.toBeNull();
    expect(growth!.textContent).toBe("持平");
    expect(growth!.textContent).not.toContain("↑");
    expect(growth!.textContent).not.toContain("↓");
  });

  it("rounds non-integer percentages to integer for display", () => {
    const container = document.createElement("div");
    render(renderMiniTrendChart({ trend, growthPercentage: 12.7 }), container);

    expect(container.textContent ?? "").toContain("+13%");
  });
});

describe("renderMiniTrendChart — degenerate trend shapes", () => {
  it("centers the polyline vertically when all non-zero values are identical", () => {
    const container = document.createElement("div");
    render(
      renderMiniTrendChart({
        trend: [5, 5, 5, 5, 5],
        growthPercentage: 0,
        width: 80,
        height: 24,
      }),
      container,
    );

    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    const points = (polyline!.getAttribute("points") ?? "").split(/\s+/).filter(Boolean);
    // All Y coordinates should be the same when range is zero
    const ys = points.map((p) => Number.parseFloat(p.split(",")[1]));
    const uniqueYs = new Set(ys.map((y) => y.toFixed(2)));
    expect(uniqueYs.size).toBe(1);
  });

  it("renders a single-point trend as a horizontal line spanning the width", () => {
    const container = document.createElement("div");
    render(
      renderMiniTrendChart({ trend: [42], growthPercentage: 0, width: 80, height: 24 }),
      container,
    );

    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    const points = (polyline!.getAttribute("points") ?? "").split(/\s+/).filter(Boolean);
    expect(points.length).toBe(2);
    const xs = points.map((p) => Number.parseFloat(p.split(",")[0]));
    expect(xs[0]).toBeCloseTo(0, 2);
    expect(xs[1]).toBeCloseTo(80, 2);
  });
});
