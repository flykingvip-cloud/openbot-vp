import { describe, expect, it } from "vitest";
import {
  OBSERVATION_METRIC_DICT,
  OBSERVATION_METRIC_DICT_VERSION,
  OBSERVATION_STREAM_METRIC_MAPPING,
} from "./metric-dict.js";

describe("observation metric dictionary contract", () => {
  it("versions all three definitions and specifies unknown for zero denominators", () => {
    expect(OBSERVATION_METRIC_DICT_VERSION).toBe(1);
    const definitions = Object.values(OBSERVATION_METRIC_DICT);
    expect(new Set(definitions.map((metric) => metric.metricId)).size).toBe(3);
    for (const metric of definitions) {
      expect(metric.version).toBe(1);
      expect(metric.zeroDenominator).toBeNull();
      for (const field of [
        "formula",
        "denominator",
        "window",
        "timeAttribution",
        "coverageGate",
        "showGate",
      ] as const) {
        expect(metric[field].length).toBeGreaterThan(0);
      }
      expect(metric.sources.length).toBeGreaterThan(0);
    }
  });

  it("records the actual finite-latency completion predicate and tool-only denominator", () => {
    const metric = OBSERVATION_METRIC_DICT.lifecycleCompletion;
    expect(metric.formula).toBe("runs_with_finite_latencyMs / projected_runs");
    expect(metric.denominator).toContain("tool-only");
    expect(metric.showGate).toContain("runs_with_finite_latencyMs > 0");
    expect(metric.coverageGate).toContain("execution_only");
    expect(metric.constraints.join(" ")).toContain("Number.isFinite(latencyMs)");
  });

  it("keeps cancellations in overall business denominator and preserves judgement authority", () => {
    const metric = OBSERVATION_METRIC_DICT.businessClosedSuccess;
    expect(metric.denominator).toContain("cancelled");
    expect(metric.timeAttribution).toBe("TaskOutcomeRecord.decidedAt");
    expect(metric.window).toContain("[from, to)");
    expect(metric.constraints.join(" ")).toContain("not_required is not delivered");
    expect(metric.constraints.join(" ")).toContain("never recompute or write");
    expect(metric.showGate).toContain("provenance");
  });

  it("does not drop invalid candidates to inflate link coverage", () => {
    const metric = OBSERVATION_METRIC_DICT.linkCoverage;
    expect(metric.denominator).toContain("including invalid");
    expect(metric.coverageGate).toContain("invalidCount");
    expect(metric.formula).toBe("fully_linked_count / attemptedCount");
    expect(metric.constraints.join(" ")).toContain("not positive outcome");
  });

  it("maps technical completion only and does not equate acceptance with closure", () => {
    expect(OBSERVATION_STREAM_METRIC_MAPPING.run_completion_rate).toBe(
      "runtime.lifecycle_completion_rate",
    );
    expect(OBSERVATION_STREAM_METRIC_MAPPING.business_acceptance).toBeNull();
    expect(OBSERVATION_STREAM_METRIC_MAPPING.attributed_cost).toBeNull();
  });
});
