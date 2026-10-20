// @vitest-environment node
// Feature: platform-agent-runtime-center, Task 20: Telemetry mini-chart rendering
import { describe, expect, it } from "vitest";
import type { RuntimeTelemetry } from "../../../../../capability/runtime-canonical/index.ts";
import { renderTelemetryMiniChart } from "../TelemetryMiniChart.ts";

function sample(overrides: Partial<RuntimeTelemetry> = {}): RuntimeTelemetry {
  return {
    runtimeAgentId: "agent-1",
    capabilityId: null,
    calls7d: 100,
    successRate7d: 1,
    avgLatencyMs: 200,
    p95LatencyMs: 400,
    tokenConsumption7d: 1_000,
    errorCount7d: 0,
    queueDepth: 0,
    memoryPressure: 0,
    lastSampleAt: 0,
    ...overrides,
  };
}

/**
 * 把 lit Template 转为字符串 — 仅用于 unit test 抽样断言。
 * Lit template result 在 node 下没有 toString，但每个 `strings` 数组与 values 数组
 * 可被合并出一个原始片段。
 */
function templateToString(tpl: unknown): string {
  // Lit TemplateResult shape: { strings: TemplateStringsArray, values: unknown[] }
  const t = tpl as { strings?: TemplateStringsArray; values?: unknown[] };
  if (!t.strings) {
    return JSON.stringify(tpl);
  }
  let out = "";
  for (let i = 0; i < t.strings.length; i += 1) {
    out += t.strings[i] ?? "";
    if (i < (t.values?.length ?? 0)) {
      const v = t.values?.[i];
      out +=
        typeof v === "object" && v !== null
          ? templateToString(v)
          : String(v as string | number | boolean | bigint | null | undefined);
    }
  }
  return out;
}

describe("renderTelemetryMiniChart — empty data", () => {
  it("renders 暂无数据 placeholder when no samples are provided", () => {
    const tpl = renderTelemetryMiniChart({ samples: [], metric: "avg-latency" });
    const s = templateToString(tpl);
    expect(s).toContain("暂无数据");
    expect(s).toContain("平均延迟");
    expect(s).not.toContain("<svg"); // empty state does not emit svg
  });
});

describe("renderTelemetryMiniChart — non-empty data", () => {
  it("emits an SVG path with values for avg-latency", () => {
    const samples = [
      sample({ avgLatencyMs: 100, lastSampleAt: 1 }),
      sample({ avgLatencyMs: 250, lastSampleAt: 2 }),
      sample({ avgLatencyMs: 80, lastSampleAt: 3 }),
    ];
    const tpl = renderTelemetryMiniChart({ samples, metric: "avg-latency" });
    const s = templateToString(tpl);
    expect(s).toContain("<svg");
    expect(s).toContain("path d=");
    // 最大值与最小值脚注
    expect(s).toContain("最大");
    expect(s).toContain("最小");
  });

  it("classifies tone based on latest sample", () => {
    // tone for avg-latency: <=1000 ok, <=5000 warn, else danger
    const okSamples = [sample({ avgLatencyMs: 200 })];
    const warnSamples = [sample({ avgLatencyMs: 3000 })];
    const dangerSamples = [sample({ avgLatencyMs: 8000 })];

    const ok = templateToString(
      renderTelemetryMiniChart({ samples: okSamples, metric: "avg-latency" }),
    );
    const warn = templateToString(
      renderTelemetryMiniChart({ samples: warnSamples, metric: "avg-latency" }),
    );
    const danger = templateToString(
      renderTelemetryMiniChart({ samples: dangerSamples, metric: "avg-latency" }),
    );

    expect(ok).toContain("agent-runtime__mini-chart--is-ok");
    expect(warn).toContain("agent-runtime__mini-chart--is-warn");
    expect(danger).toContain("agent-runtime__mini-chart--is-danger");
  });

  it("error-rate metric handles zero-call samples without NaN", () => {
    const samples = [sample({ calls7d: 0, successRate7d: 0 })];
    const tpl = renderTelemetryMiniChart({ samples, metric: "error-rate" });
    const s = templateToString(tpl);
    expect(s).toContain("错误率");
    expect(s).not.toContain("NaN");
  });
});
