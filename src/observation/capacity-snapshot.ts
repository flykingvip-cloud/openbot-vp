/** Pure metadata projection. Source adapters must authenticate scope; no collection or writes. */
export type CapacitySource = {
  scopeRef: string;
  sampledAt: number;
  provenance: "live" | "seed" | "injected" | "unknown";
  sourceRef: string;
};
export type CapacityInput = {
  scopeRef: string;
  projectedAt: number;
  maxAgeMs: number;
  registry?: CapacitySource & {
    state: "readable" | "missing" | "corrupt";
    complete: boolean;
    activeRuns: number | null;
    staleRunCount: number | null;
  };
  entitlement?: CapacitySource & {
    version: string | null;
    maxConcurrentRuns: number | null;
    mode: "block" | "queue" | "pay_as_you_go" | "unknown";
  };
  health?: CapacitySource & {
    kind: "registration_snapshot" | "continuous_probe";
    continuous: boolean;
    expectedSamples: number | null;
    observedSamples: number | null;
  };
  heartbeat?: CapacitySource & {
    kind: "activity" | "liveness_probe";
    continuous: boolean;
    expectedSamples: number | null;
    observedSamples: number | null;
  };
  quota?: CapacitySource & {
    state: "authoritative" | "fallback" | "missing";
    periodRef: string | null;
    unit: string | null;
    remaining: number | null;
    allowance: number | null;
  };
};
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export function buildCapacitySnapshot(input: CapacityInput) {
  if (
    !input.scopeRef.trim() ||
    !Number.isFinite(input.projectedAt) ||
    !Number.isFinite(input.maxAgeMs) ||
    input.maxAgeMs <= 0
  ) {
    throw new Error("invalid_capacity_context");
  }
  const reasons = (s: CapacitySource | undefined) =>
    !s
      ? ["source_missing"]
      : [
          ...(s.scopeRef !== input.scopeRef ? ["scope_mismatch"] : []),
          ...(!Number.isFinite(s.sampledAt) ||
          s.sampledAt > input.projectedAt ||
          input.projectedAt - s.sampledAt > input.maxAgeMs
            ? ["source_stale_or_invalid_time"]
            : []),
          ...(!s.sourceRef || s.provenance === "unknown" || s.provenance === "seed"
            ? ["source_not_qualified"]
            : []),
        ];
  const r = input.registry,
    e = input.entitlement;
  const concurrentReasons = [...reasons(r), ...reasons(e)];
  if (
    r &&
    (r.state !== "readable" ||
      !r.complete ||
      !count(r.activeRuns) ||
      !count(r.staleRunCount) ||
      r.staleRunCount !== 0)
  ) {
    concurrentReasons.push("registry_incomplete_or_stale");
  }
  if (e && (!e.version || !count(e.maxConcurrentRuns) || e.maxConcurrentRuns <= 0)) {
    concurrentReasons.push("finite_positive_limit_required");
  }
  if (e && !["block", "queue"].includes(e.mode)) {
    concurrentReasons.push("overage_or_unknown_mode");
  }
  if (r && e && (r.provenance !== e.provenance || r.sampledAt !== e.sampledAt)) {
    concurrentReasons.push("source_cohort_or_time_mismatch");
  }
  const ready = concurrentReasons.length === 0;
  const series = (source: CapacityInput["health"] | CapacityInput["heartbeat"], kind: string) => {
    const why = reasons(source);
    if (
      source &&
      (!source.continuous ||
        source.kind !== kind ||
        !count(source.expectedSamples) ||
        source.expectedSamples < 2 ||
        !count(source.observedSamples) ||
        source.observedSamples !== source.expectedSamples)
    ) {
      why.push("continuous_probe_denominator_unavailable");
    }
    return {
      state: why.length ? ("unknown" as const) : ("observed" as const),
      coverage: why.length ? null : 1,
      normal: null,
      reasons: why,
    };
  };
  const q = input.quota;
  const quotaReasons = reasons(q);
  if (
    q &&
    (q.state !== "authoritative" ||
      !q.periodRef ||
      !q.unit ||
      typeof q.remaining !== "number" ||
      !Number.isFinite(q.remaining) ||
      typeof q.allowance !== "number" ||
      !Number.isFinite(q.allowance) ||
      q.allowance <= 0 ||
      q.remaining < 0 ||
      q.remaining > q.allowance)
  ) {
    quotaReasons.push("authoritative_balance_denominator_unavailable");
  }
  return {
    schemaVersion: 1,
    projectedAt: input.projectedAt,
    health: series(input.health, "continuous_probe"),
    heartbeat: series(input.heartbeat, "liveness_probe"),
    concurrency: {
      state: ready ? ("observed" as const) : ("unknown" as const),
      kind: "registered_run_snapshot" as const,
      activeRuns: ready ? r!.activeRuns : null,
      limit: ready ? e!.maxConcurrentRuns : null,
      remaining: ready ? Math.max(0, e!.maxConcurrentRuns! - r!.activeRuns!) : null,
      entitlementVersion: ready ? e!.version : null,
      reasons: concurrentReasons,
    },
    quota: {
      state: quotaReasons.length ? ("unknown" as const) : ("observed" as const),
      remaining: quotaReasons.length ? null : q!.remaining,
      allowance: quotaReasons.length ? null : q!.allowance,
      unit: quotaReasons.length ? null : q!.unit,
      periodRef: quotaReasons.length ? null : q!.periodRef,
      reasons: quotaReasons,
    },
    businessOutcome: {
      state: "unknown" as const,
      reasons: ["capacity_does_not_establish_task_outcome"],
    },
  };
}
