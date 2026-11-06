import { describe, it, expect } from "vitest";
import { compareObservationMetrics, type MetricCohort } from "./metric-compare.js";
const cohort = (candidate = false): MetricCohort => ({
  metricDictVersion: 1,
  metricId: "eval.link_coverage",
  denominatorDefinition: "unique attempted candidates including invalid",
  cohortRef: "test-cohort",
  window: { from: candidate ? 10 : 0, to: candidate ? 20 : 10 },
  windowDefinition: "half_open_source_window",
  numerator: candidate ? 8 : 5,
  denominator: 10,
  environment: "test",
  samples: Array.from({ length: 10 }, (_, i) => ({
    sampleId: (candidate ? "c" : "b") + i,
    taskId: "task" + i,
    outcomeVersion: 1,
    qualification: "fully_linked",
    improvementEligible: true,
    provenance: "injected",
  })),
});
describe("read-only metric comparison", () => {
  it("returns a labelled injected comparison without authorizing promotion", () => {
    const r = compareObservationMetrics({ baseline: cohort(), candidate: cohort(true) });
    expect(r.status).toBe("comparable");
    expect(r.delta).toBeCloseTo(0.3);
    expect(r.productionValidated).toBe(false);
    expect(r.promotionAllowed).toBe(false);
    expect(r.interpretation).toContain("correlation");
  });
  it("blocks zero or unknown denominators", () => {
    for (const denominator of [0, null]) {
      expect(
        compareObservationMetrics({
          baseline: { ...cohort(), denominator },
          candidate: cohort(true),
        }).status,
      ).toBe("blocked");
    }
  });
  it("blocks mismatched metric, dictionary, cohort and window semantics", () => {
    for (const patch of [
      { metricDictVersion: 2 },
      { metricId: "business.task_closed_success_rate" },
      { cohortRef: "other" },
      { denominatorDefinition: "calls" },
      { windowDefinition: "closed_window" },
      { window: { from: 10, to: 21 } },
    ]) {
      expect(
        compareObservationMetrics({ baseline: cohort(), candidate: { ...cohort(true), ...patch } })
          .status,
      ).toBe("blocked");
    }
  });
  it("blocks seed contamination, insufficient linkage and ineligible production", () => {
    for (const patch of [
      { provenance: "seed" as const },
      { qualification: "execution_only" as const },
      { improvementEligible: false },
    ]) {
      const candidate = cohort(true);
      candidate.samples = [{ ...candidate.samples[0], ...patch }, ...candidate.samples.slice(1)];
      expect(compareObservationMetrics({ baseline: cohort(), candidate }).status).toBe("blocked");
    }
    expect(
      compareObservationMetrics({
        baseline: { ...cohort(), environment: "production" },
        candidate: { ...cohort(true), environment: "production" },
      }).status,
    ).toBe("blocked");
  });
  it("blocks duplicate immutable references and invalid counts", () => {
    const candidate = cohort(true);
    candidate.samples = [candidate.samples[0], ...candidate.samples.slice(0, 9)];
    expect(compareObservationMetrics({ baseline: cohort(), candidate }).status).toBe("blocked");
    expect(
      compareObservationMetrics({
        baseline: cohort(),
        candidate: { ...cohort(true), numerator: 11 },
      }).status,
    ).toBe("blocked");
  });
});
