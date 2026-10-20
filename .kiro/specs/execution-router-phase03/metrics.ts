import type { PercentileSet, PerformanceSample, ScenarioMetrics, ScenarioType } from "./types.ts";
import { SCENARIO_TYPES } from "./types.ts";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export function percentileSet(values: number[]): PercentileSet {
  const sorted = [...values].toSorted((a, b) => a - b);
  const avg =
    sorted.length === 0 ? 0 : sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    avg,
  };
}

export function summarizeSamples(samples: PerformanceSample[]): ScenarioMetrics {
  const ttfts = samples.map((sample) => sample.ttftMs);
  const routePreps = samples.map((sample) => sample.routePrepMs);
  const totals = samples.map((sample) => sample.totalMs);
  const prompts = samples.map((sample) => sample.promptTokens);
  const tokenAvg =
    samples.length === 0
      ? 0
      : samples.reduce((sum, sample) => sum + sample.totalTokens, 0) / samples.length;
  const firstTool = samples.filter((sample) => sample.firstToolSuccess != null);
  const retried = samples.filter(
    (sample) => sample.toolCallCount > 0 && sample.errorClass === "tool_retry",
  );
  const withTools = samples.filter((sample) => sample.toolCallCount > 0);
  return {
    sampleCount: samples.length,
    ttftMs: percentileSet(ttfts),
    routePrepMs: percentileSet(routePreps),
    totalMs: percentileSet(totals),
    promptTokens: percentileSet(prompts),
    totalTokensAvg: tokenAvg,
    firstToolSuccessRate:
      firstTool.length > 0
        ? firstTool.filter((sample) => sample.firstToolSuccess === true).length / firstTool.length
        : null,
    toolRetryRate: withTools.length > 0 ? retried.length / withTools.length : null,
    fallbackRate:
      samples.length > 0
        ? samples.filter((sample) => sample.fallbackCount > 0).length / samples.length
        : 0,
  };
}

export function countScenarios(samples: PerformanceSample[]): Record<ScenarioType, number> {
  const counts = Object.fromEntries(SCENARIO_TYPES.map((type) => [type, 0])) as Record<
    ScenarioType,
    number
  >;
  for (const sample of samples) {
    counts[sample.scenarioType] += 1;
  }
  return counts;
}

export function summarizeByScenario(
  samples: PerformanceSample[],
): Partial<Record<ScenarioType, ScenarioMetrics>> {
  const grouped = new Map<ScenarioType, PerformanceSample[]>();
  for (const sample of samples) {
    const list = grouped.get(sample.scenarioType) ?? [];
    list.push(sample);
    grouped.set(sample.scenarioType, list);
  }
  return Object.fromEntries(
    [...grouped.entries()].map(([type, list]) => [type, summarizeSamples(list)]),
  );
}
