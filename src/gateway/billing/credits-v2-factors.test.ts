import { describe, expect, it } from "vitest";
import {
  DEFAULT_BENCHMARK_DURATION_MS,
  DEFAULT_BENCHMARK_TOOL_CALLS,
  resolveToolClassWeight,
  resolveV2RuntimeFactor,
  resolveV2ToolFactor,
} from "./credits-v2-factors.js";

describe("credits-v2-factors", () => {
  it("resolveToolClassWeight flags heavy tools", () => {
    expect(resolveToolClassWeight("read")).toBe(0);
    expect(resolveToolClassWeight("browser_navigate")).toBe(0.5);
    expect(resolveToolClassWeight("exec")).toBe(0.5);
  });

  it("resolveV2ToolFactor defaults to 1 without signals", () => {
    expect(resolveV2ToolFactor()).toBe(1);
    expect(resolveV2ToolFactor({ toolCallCount: 0 })).toBe(1);
  });

  it("resolveV2ToolFactor scales with tool calls relative to benchmark", () => {
    const atBenchmark = resolveV2ToolFactor({
      toolCallCount: DEFAULT_BENCHMARK_TOOL_CALLS,
    });
    expect(atBenchmark).toBeCloseTo(1, 5);
    const above = resolveV2ToolFactor({ toolCallCount: 6 });
    expect(above).toBeGreaterThan(1);
    expect(above).toBeLessThanOrEqual(4);
  });

  it("resolveV2ToolFactor adds class bonus", () => {
    const withClass = resolveV2ToolFactor({
      toolCallCount: 1,
      toolClasses: ["browser_click"],
    });
    const plain = resolveV2ToolFactor({ toolCallCount: 1 });
    expect(withClass).toBeGreaterThan(plain);
  });

  it("resolveV2RuntimeFactor defaults to 1 without signals", () => {
    expect(resolveV2RuntimeFactor()).toBe(1);
  });

  it("resolveV2RuntimeFactor scales with duration and retries", () => {
    const longRun = resolveV2RuntimeFactor({
      durationMs: DEFAULT_BENCHMARK_DURATION_MS * 2,
    });
    expect(longRun).toBeCloseTo(2, 5);
    const retried = resolveV2RuntimeFactor({ retryCount: 2 });
    expect(retried).toBe(3);
    const combined = resolveV2RuntimeFactor({
      durationMs: DEFAULT_BENCHMARK_DURATION_MS * 2,
      retryCount: 1,
    });
    expect(combined).toBeCloseTo(4, 5);
  });

  it("clamps extreme runtime inputs", () => {
    expect(resolveV2RuntimeFactor({ durationMs: DEFAULT_BENCHMARK_DURATION_MS * 100 })).toBe(4);
  });
});
