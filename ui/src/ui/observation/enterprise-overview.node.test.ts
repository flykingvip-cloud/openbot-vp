import { describe, expect, it } from "vitest";
import {
  attentionCounts,
  classifyAttention,
  computeOverviewMetrics,
  defaultCapacityCards,
  filterAttention,
  formatLifecycleRate,
  formatRatioOrUnknown,
  percentile,
} from "./enterprise-overview.ts";
import type { ObservationRun } from "./model.ts";

const run = (overrides: Partial<ObservationRun> & Pick<ObservationRun, "id">): ObservationRun => ({
  label: "example",
  scope: "personal",
  tenantId: "demo",
  tenantLabel: "Demo",
  clientRunId: null,
  sourceRunId: null,
  admittedWorkId: null,
  scenarioTaskRef: null,
  outcomeRevision: null,
  toolState: "completed",
  outcomeState: "unavailable",
  latencyMs: null,
  attributedCost: null,
  stages: [],
  reasons: [],
  eventCount: 0,
  sample: false,
  ...overrides,
});

describe("formatLifecycleRate", () => {
  it("stays unknown when the denominator is zero and never prints 0%", () => {
    const metric = formatLifecycleRate(0, 0);
    expect(metric.value).toBe("未知");
    expect(metric.value).not.toContain("0%");
    expect(formatLifecycleRate(1, 2).value).toBe("1/2");
  });
});

describe("computeOverviewMetrics", () => {
  it("computes active, events and latency, and keeps P95 unknown with a single sample", () => {
    const metrics = computeOverviewMetrics([
      run({
        id: "a",
        toolState: "running",
        eventCount: 4,
        latencyMs: 3200,
        stages: [{ key: "tool", label: "工具", state: "observed", detail: "" }],
      }),
      run({ id: "b", toolState: "completed", eventCount: 9, latencyMs: null }),
    ]);
    const byKey = Object.fromEntries(metrics.map((row) => [row.key, row]));
    expect(byKey.active_runs.value).toBe("1");
    expect(byKey.event_receive_rate.value).toBe("13");
    expect(byKey.run_completion_rate.value).toBe("1/2");
    expect(byKey.latency_p50.value).toBe("3.2");
    expect(byKey.latency_p95.value).toBe("未知");
    expect(byKey.tool_calls.value).toBe("1");
  });

  it("keeps lifecycle and tool counts unknown when nothing is supplied", () => {
    const metrics = computeOverviewMetrics([]);
    const byKey = Object.fromEntries(metrics.map((row) => [row.key, row]));
    expect(byKey.run_completion_rate.value).toBe("未知");
    expect(byKey.latency_p50.value).toBe("未知");
    expect(byKey.latency_p95.value).toBe("未知");
    expect(byKey.tool_calls.value).toBe("未知");
    expect(byKey.tool_calls.value).not.toBe("0");
  });
});

describe("attention classification", () => {
  it("classifies link breaks and does not invent rule findings", () => {
    const link = classifyAttention(
      run({ id: "l", reasons: ["scenario_task_ref", "outcome_revision"] }),
    );
    const review = classifyAttention(run({ id: "r", reasons: ["sequence_gap_or_reorder"] }));
    const rows = [link, review];
    expect(link.status).toBe("关联断链");
    expect(link.qualification).toBe("资格未供给");
    expect(attentionCounts(rows)).toEqual({ all: 2, link: 1, review: 2, rule: 0 });
    expect(filterAttention(rows, "rule")).toEqual([]);
    expect(filterAttention(rows, "link")).toHaveLength(1);
  });
});

describe("formatRatioOrUnknown", () => {
  it("does not invent a ratio when the denominator is missing or zero", () => {
    expect(formatRatioOrUnknown(0, 0, { numerator: "n", denominator: "d" }).value).toBe("未知");
    expect(formatRatioOrUnknown(1, null, { numerator: "n", denominator: "d" }).value).toBe("未知");
    expect(formatRatioOrUnknown(3, 4, { numerator: "n", denominator: "d" }).value).toBe("3/4");
  });
});

describe("defaultCapacityCards", () => {
  it("keeps coverage, heartbeat, concurrency and quota unknown without a denominator", () => {
    for (const card of defaultCapacityCards()) {
      expect(card.value).toBe("未知");
      expect(card.value).not.toContain("0%");
    }
  });
});

describe("percentile", () => {
  it("requires two samples for P95", () => {
    expect(percentile([100], 0.5)).toBe(100);
    expect(percentile([100], 0.95)).toBeNull();
    expect(percentile([100, 200], 0.95)).toBe(200);
  });
});
