/** Read-only metric definitions; no aggregation or business judgement lives here. */
export type ObservationMetricDefinition = {
  readonly metricId: string;
  readonly version: 1;
  readonly layer: "technical" | "business" | "coverage";
  readonly unit: "ratio";
  readonly formula: string;
  readonly denominator: string;
  readonly window: string;
  readonly timeAttribution: string;
  readonly sources: readonly string[];
  readonly coverageGate: string;
  readonly showGate: string;
  readonly zeroDenominator: null;
  readonly constraints: readonly string[];
};

export const OBSERVATION_METRIC_DICT_VERSION = 1 as const;

export const OBSERVATION_METRIC_DICT = {
  lifecycleCompletion: {
    metricId: "runtime.lifecycle_completion_rate",
    version: 1,
    layer: "technical",
    unit: "ratio",
    formula: "runs_with_finite_latencyMs / projected_runs",
    denominator:
      "All unique runs returned by the connection-window projection, including tool-only runs.",
    window: "Current connection snapshot; bounded event retention, not durable history.",
    timeAttribution: "receivedAt in RuntimeObservationSnapshot; not run end time.",
    sources: ["RuntimeObservationSnapshot", "ui/src/ui/observation/stream.ts"],
    coverageGate: "execution_only is sufficient; no business outcome association is implied.",
    showGate: "projected_runs > 0 AND runs_with_finite_latencyMs > 0; otherwise null.",
    zeroDenominator: null,
    constraints: [
      "Completion means typeof latencyMs === number AND Number.isFinite(latencyMs).",
      "Never label this task success or business acceptance.",
      "Preserves the existing stream algorithm; does not upgrade sample eligibility.",
    ],
  },
  businessClosedSuccess: {
    metricId: "business.task_closed_success_rate",
    version: 1,
    layer: "business",
    unit: "ratio",
    formula:
      "count(current_tips WHERE lifecycle == closed AND taskJudgement == success) / count(eligible_current_tips)",
    denominator:
      "One current tip per scoped task in the window, including cancelled and incomplete tasks.",
    window: "[from, to) on decidedAt; explicit trusted scope and separate provenance cohorts.",
    timeAttribution: "TaskOutcomeRecord.decidedAt",
    sources: ["TaskOutcomeRecord written by TaskOutcomeResultService"],
    coverageGate:
      "Readable authoritative outcome (outcome_only or fully_linked); exclude invalid/mismatch.",
    showGate: "eligible_current_tips > 0 AND scope/window/provenance are known; otherwise null.",
    zeroDenominator: null,
    constraints: [
      "Read taskJudgement; never recompute or write it.",
      "Display acceptance and delivery separately; not_required is not delivered.",
      "Technical completion and enqueue_only do not imply success.",
      "Not the skill success rate governed by computeEvaluationEligibility.",
      "Unknown provenance must not be labelled live; do not mix seed/injected/live cohorts.",
    ],
  },
  linkCoverage: {
    metricId: "eval.link_coverage",
    version: 1,
    layer: "coverage",
    unit: "ratio",
    formula: "fully_linked_count / attemptedCount",
    denominator:
      "Unique attempted sample candidates, including invalid candidates; duplicate events do not add candidates.",
    window:
      "Explicit source window [from, to); projectedAt is the projection timestamp, not an event timestamp.",
    timeAttribution: "Source window plus projectedAt and sourceWatermark.",
    sources: ["SampleAssembler"],
    coverageGate: "Report attemptedCount, fully_linked_count and invalidCount separately.",
    showGate: "attemptedCount > 0; otherwise null.",
    zeroDenominator: null,
    constraints: [
      "Include deduplicated invalid candidates in attemptedCount.",
      "Do not infer version associations from the latest tip.",
      "fully_linked describes evidence linkage, not positive outcome or promotion eligibility.",
      "Report missing links and unknown provenance explicitly.",
    ],
  },
} as const satisfies Readonly<Record<string, ObservationMetricDefinition>>;

/** Only exact semantic equivalents map; acceptance alone is not business closure. */
export const OBSERVATION_STREAM_METRIC_MAPPING = {
  active_runs: null,
  event_receive_rate: null,
  run_completion_rate: OBSERVATION_METRIC_DICT.lifecycleCompletion.metricId,
  latency_p50: null,
  latency_p95: null,
  tool_calls: null,
  sequence_or_link_gaps: null,
  business_acceptance: null,
  attributed_cost: null,
} as const;
