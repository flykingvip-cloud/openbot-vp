import { render } from "lit";
import { describe, expect, it } from "vitest";
import { buildCapacitySnapshot } from "../../../../src/observation/capacity-snapshot.js";
import {
  compareObservationMetrics,
  type MetricCohort,
} from "../../../../src/observation/metric-compare.js";
import {
  renderComparisonCapacity,
  type CapacityView,
  type ComparisonView,
} from "./comparison-capacity-panel.ts";
describe("readonly comparison capacity", () => {
  it("preserves unknown and blocked reasons without promotion controls", () => {
    const capacity: CapacityView = {
      ok: true,
      snapshot: buildCapacitySnapshot({ scopeRef: "scope", projectedAt: 10, maxAgeMs: 10 }),
      sources: {
        registry: { state: "missing", provenance: "unknown" },
        entitlement: { state: "unknown", provenance: "unknown" },
        quota: { state: "unknown", reason: "authoritative_balance_not_collected" },
      },
      reasons: ["raw_sources_have_no_provenance_proof"],
    };
    const side: MetricCohort = {
      metricDictVersion: 1,
      metricId: "eval.link_coverage",
      denominatorDefinition: "samples",
      cohortRef: "cohort",
      window: { from: 0, to: 10 },
      windowDefinition: "explicit",
      numerator: null,
      denominator: null,
      environment: "production",
      samples: [],
    };
    const comparison: ComparisonView = {
      ok: true as const,
      comparison: {
        ...compareObservationMetrics({
          baseline: side,
          candidate: { ...side, window: { from: 10, to: 20 } },
        }),
        status: "blocked",
        baselineValue: null,
        candidateValue: null,
        delta: null,
      },
      evidence: { baseline: [], candidate: [] },
      selectionScope: "explicit_references_only" as const,
    };
    const container = document.createElement("div");
    render(renderComparisonCapacity(capacity, comparison), container);
    for (const label of [
      "资源健康",
      "心跳",
      "登记并发",
      "额度",
      "source_missing",
      "blocked",
      "unknown_or_invalid_counts",
      "raw_sources_have_no_provenance_proof",
    ]) {
      expect(container.textContent).toContain(label);
    }
    expect(container.querySelectorAll("button,input,form,a")).toHaveLength(0);
    render(renderComparisonCapacity(null, null), container);
    expect(container.textContent).toContain("缺少显式baseline/candidate");
    expect(container.textContent).not.toContain("raw_sources_have_no_provenance_proof");
  });
});
