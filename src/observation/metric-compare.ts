/** Deterministic comparison only: no promotion, causal inference or control-plane effects. */
import { OBSERVATION_METRIC_DICT, OBSERVATION_METRIC_DICT_VERSION } from "./metric-dict.js";
import type { Provenance, SampleLinkageQualification } from "./sample-assembler.js";
export type ComparisonSampleRef = {
  readonly sampleId: string;
  readonly taskId: string;
  readonly outcomeVersion: number;
  readonly qualification: SampleLinkageQualification;
  readonly improvementEligible: boolean;
  readonly provenance: Provenance;
};
export type MetricCohort = {
  readonly metricDictVersion: number;
  readonly metricId: string;
  readonly denominatorDefinition: string;
  readonly cohortRef: string;
  readonly window: { readonly from: number; readonly to: number };
  readonly windowDefinition: string;
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly environment: "production" | "test";
  samples: readonly ComparisonSampleRef[];
};
/** Immutable references bind the supplied aggregates; this function does not judge task outcomes. */
export function compareObservationMetrics(input: {
  readonly baseline: MetricCohort;
  readonly candidate: MetricCohort;
}) {
  const { baseline: b, candidate: c } = input;
  const reasons = new Set<string>();
  const definitions = Object.values(OBSERVATION_METRIC_DICT);
  if (
    b.metricDictVersion !== OBSERVATION_METRIC_DICT_VERSION ||
    c.metricDictVersion !== b.metricDictVersion
  ) {
    reasons.add("metric_dict_mismatch");
  }
  if (b.metricId !== c.metricId || !definitions.some((d) => d.metricId === b.metricId)) {
    reasons.add("metric_mismatch");
  }
  if (!b.denominatorDefinition.trim() || b.denominatorDefinition !== c.denominatorDefinition) {
    reasons.add("denominator_definition_mismatch");
  }
  if (!b.cohortRef.trim() || b.cohortRef !== c.cohortRef) {
    reasons.add("cohort_mismatch");
  }
  if (!b.windowDefinition.trim() || b.windowDefinition !== c.windowDefinition) {
    reasons.add("window_definition_mismatch");
  }
  if (b.environment !== c.environment) {
    reasons.add("environment_mismatch");
  }
  for (const side of [b, c]) {
    if (
      ![side.window.from, side.window.to].every(Number.isFinite) ||
      side.window.from >= side.window.to
    ) {
      reasons.add("invalid_window");
    }
    if (
      side.numerator === null ||
      side.denominator === null ||
      !Number.isSafeInteger(side.numerator) ||
      !Number.isSafeInteger(side.denominator) ||
      side.denominator <= 0 ||
      side.numerator < 0 ||
      side.numerator > side.denominator
    ) {
      reasons.add("unknown_or_invalid_counts");
    }
    if (!side.samples.length) {
      reasons.add("missing_sample_refs");
    }
    const refs = new Set<string>();
    const ids = new Set<string>();
    for (const sample of side.samples) {
      const ref = JSON.stringify([sample.taskId, sample.outcomeVersion]);
      if (
        !sample.sampleId ||
        !sample.taskId ||
        !Number.isSafeInteger(sample.outcomeVersion) ||
        sample.outcomeVersion < 1 ||
        refs.has(ref) ||
        ids.has(sample.sampleId)
      ) {
        reasons.add("invalid_or_duplicate_sample_ref");
      }
      refs.add(ref);
      ids.add(sample.sampleId);
      if (sample.qualification !== "fully_linked" || !sample.improvementEligible) {
        reasons.add("ineligible_sample");
      }
      if (
        side.environment === "test"
          ? sample.provenance !== "injected"
          : sample.provenance !== "live"
      ) {
        reasons.add("provenance_gate");
      }
    }
    // This minimum contract uses one unique sample per denominator unit.
    if (side.denominator !== side.samples.length) {
      reasons.add("denominator_evidence_mismatch");
    }
  }
  if (b.window.to - b.window.from !== c.window.to - c.window.from) {
    reasons.add("window_duration_mismatch");
  }
  if (b.window.to > c.window.from) {
    reasons.add("overlapping_windows");
  }
  const blocked = reasons.size > 0;
  const baselineValue = blocked ? null : b.numerator! / b.denominator!;
  const candidateValue = blocked ? null : c.numerator! / c.denominator!;
  return {
    schemaVersion: 1 as const,
    metricDictVersion: b.metricDictVersion,
    metricId: b.metricId,
    status: blocked ? ("blocked" as const) : ("comparable" as const),
    reasons: [...reasons].toSorted(),
    baselineValue,
    candidateValue,
    delta:
      baselineValue === null || candidateValue === null ? null : candidateValue - baselineValue,
    environment: b.environment,
    provenanceLabel:
      b.environment === "test" ? "injected · non-production" : "live evidence · comparison only",
    productionValidated: false as const,
    promotionAllowed: false as const,
    interpretation: "Observed correlation only; no causal or improvement claim.",
    evidence: structuredClone({ baseline: b, candidate: c }),
  };
}
