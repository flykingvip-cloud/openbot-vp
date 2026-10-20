// @vitest-environment node
// Feature: enterprise-capability-usage-management
// Format display logic — Requirements 8.3, 8.4

import { describe, expect, it } from "vitest";
import {
  formatExecutions,
  formatHealthStatus,
  formatLastActiveAt,
  formatSuccessRate,
} from "../shared/format.ts";

describe("formatSuccessRate", () => {
  it("formats 0.965 as 96.5%", () => {
    expect(formatSuccessRate(0.965)).toBe("96.5%");
  });

  it("formats 0 as 0.0%", () => {
    expect(formatSuccessRate(0)).toBe("0.0%");
  });

  it("formats 1 as 100.0%", () => {
    expect(formatSuccessRate(1)).toBe("100.0%");
  });

  it("returns 暂无数据 for negative input", () => {
    expect(formatSuccessRate(-0.1)).toBe("暂无数据");
  });

  it("returns 暂无数据 for input > 1", () => {
    expect(formatSuccessRate(1.5)).toBe("暂无数据");
  });

  it("returns 暂无数据 for NaN", () => {
    expect(formatSuccessRate(NaN)).toBe("暂无数据");
  });

  it("returns 暂无数据 for null/undefined", () => {
    expect(formatSuccessRate(null)).toBe("暂无数据");
    expect(formatSuccessRate(undefined)).toBe("暂无数据");
  });
});

describe("formatExecutions", () => {
  it("formats 0 as 0", () => {
    expect(formatExecutions(0)).toBe("0");
  });

  it("formats 1284 as 1,284", () => {
    expect(formatExecutions(1284)).toBe("1,284");
  });

  it("formats 1000000 as 1,000,000", () => {
    expect(formatExecutions(1000000)).toBe("1,000,000");
  });

  it("returns 暂无数据 for non-integer", () => {
    expect(formatExecutions(21.4)).toBe("暂无数据");
  });

  it("returns 暂无数据 for negative", () => {
    expect(formatExecutions(-1)).toBe("暂无数据");
  });

  it("returns 暂无数据 for NaN/null/undefined", () => {
    expect(formatExecutions(NaN)).toBe("暂无数据");
    expect(formatExecutions(null)).toBe("暂无数据");
    expect(formatExecutions(undefined)).toBe("暂无数据");
  });
});

describe("formatHealthStatus", () => {
  it("returns valid status as-is", () => {
    expect(formatHealthStatus("效果稳定")).toBe("效果稳定");
    expect(formatHealthStatus("偶尔不理想")).toBe("偶尔不理想");
    expect(formatHealthStatus("建议优化")).toBe("建议优化");
    expect(formatHealthStatus("已停用")).toBe("已停用");
  });

  it("returns 暂无数据 for raw runtime enum values", () => {
    expect(formatHealthStatus("healthy")).toBe("暂无数据");
    expect(formatHealthStatus("degraded")).toBe("暂无数据");
    expect(formatHealthStatus("unhealthy")).toBe("暂无数据");
  });

  it("returns 暂无数据 for null/undefined/empty", () => {
    expect(formatHealthStatus(null)).toBe("暂无数据");
    expect(formatHealthStatus(undefined)).toBe("暂无数据");
    expect(formatHealthStatus("")).toBe("暂无数据");
  });
});

describe("formatLastActiveAt", () => {
  it("formats valid timestamp as YYYY-MM-DD HH:mm", () => {
    // 2024-05-06 15:30 UTC = 2024-05-06 23:30 Beijing time
    const result = formatLastActiveAt(Date.UTC(2024, 4, 6, 7, 30));
    // Format depends on system timezone, but should match the regex
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("returns 暂无数据 for invalid input", () => {
    expect(formatLastActiveAt(null)).toBe("暂无数据");
    expect(formatLastActiveAt(undefined)).toBe("暂无数据");
    expect(formatLastActiveAt(NaN)).toBe("暂无数据");
    expect(formatLastActiveAt(-1)).toBe("暂无数据");
  });
});
