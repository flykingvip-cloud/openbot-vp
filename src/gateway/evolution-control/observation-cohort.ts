import type { MetricObservation, ObservationWindow } from "@openbot/evolution-core";

export type CohortOutcome = {
  occurredAt: number;
  succeeded: boolean;
  latencyMs?: number;
  securityViolation?: boolean;
  /**
   * Suspected bypass is never a confirmed security observation.
   * `observationsFromCohort` ignores this field on purpose.
   */
  suspectedAuthorizationBypass?: boolean;
  crossTenantContamination?: boolean;
  humanTakeover?: boolean;
  experimentId?: string;
  applicationId?: string;
  agentId?: string;
  tenantId?: string;
  cohortRef?: string;
  runId?: string;
};

export type CohortBind = {
  experimentId?: string;
  applicationId?: string;
  agentId?: string;
  tenantId?: string;
  cohortRef?: string;
  runId?: string;
  requireRunId?: boolean;
  requireCohort?: boolean;
};

const SECURITY_FAILURE_CATEGORIES = new Set([
  "security",
  "security_violation",
  "security_violations",
  "authz",
  "authorization",
]);

export function percentileNearestRank(values: number[], percentile: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const bounded = Math.min(100, Math.max(0, percentile));
  const index = Math.max(0, Math.ceil((bounded / 100) * sorted.length) - 1);
  return sorted[index] ?? null;
}

export function securityViolationFromFailureCategory(
  category: string | null | undefined,
): boolean | undefined {
  if (category === undefined) {
    return undefined;
  }
  if (category == null || category.trim() === "") {
    return false;
  }
  return SECURITY_FAILURE_CATEGORIES.has(category);
}

export function crossTenantFromIds(
  eventTenantId: string | null | undefined,
  windowTenantScope: string | null | undefined,
): boolean | undefined {
  if (eventTenantId == null || eventTenantId.trim() === "") {
    return undefined;
  }
  if (windowTenantScope == null || windowTenantScope.trim() === "") {
    return undefined;
  }
  return eventTenantId !== windowTenantScope;
}

function hasBoundId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function idsEqual(left: string | null | undefined, right: string | null | undefined): boolean {
  return hasBoundId(left) && hasBoundId(right) && left === right;
}

export function filterCohort(
  events: readonly CohortOutcome[],
  window: ObservationWindow,
  bind?: CohortBind,
): CohortOutcome[] {
  const startedAt = Date.parse(window.startedAt);
  const endedAt = Date.parse(window.endedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return [];
  }
  const treatment = window.phase === "treatment";
  const experimentId = bind?.experimentId ?? window.experimentId;
  const applicationId = bind?.applicationId;
  const agentId = bind?.agentId;
  const tenantId = bind?.tenantId ?? window.tenantScope ?? undefined;
  const cohortRef = bind?.cohortRef ?? window.cohortRef;
  return events.filter((event) => {
    if (event.occurredAt < startedAt || event.occurredAt > endedAt) {
      return false;
    }
    if (hasBoundId(agentId) && !idsEqual(event.agentId, agentId)) {
      return false;
    }
    if (hasBoundId(tenantId) && !idsEqual(event.tenantId, tenantId)) {
      return false;
    }
    if (bind?.requireCohort && hasBoundId(cohortRef) && !idsEqual(event.cohortRef, cohortRef)) {
      return false;
    }
    if (treatment) {
      if (bind?.requireRunId && !hasBoundId(event.runId)) {
        return false;
      }
      if (hasBoundId(bind?.runId) && !idsEqual(event.runId, bind?.runId)) {
        return false;
      }
      if (hasBoundId(experimentId) && !idsEqual(event.experimentId, experimentId)) {
        return false;
      }
      if (hasBoundId(applicationId) && !idsEqual(event.applicationId, applicationId)) {
        return false;
      }
      return true;
    }
    if (
      hasBoundId(event.experimentId) &&
      hasBoundId(experimentId) &&
      event.experimentId !== experimentId
    ) {
      return false;
    }
    if (
      hasBoundId(event.applicationId) &&
      hasBoundId(applicationId) &&
      event.applicationId !== applicationId
    ) {
      return false;
    }
    if (hasBoundId(event.cohortRef) && hasBoundId(cohortRef) && event.cohortRef !== cohortRef) {
      return false;
    }
    if (
      hasBoundId(event.applicationId) &&
      !hasBoundId(applicationId) &&
      !idsEqual(event.experimentId, experimentId)
    ) {
      return false;
    }
    return true;
  });
}

function measuredRate(
  events: readonly CohortOutcome[],
  pick: (event: CohortOutcome) => boolean | undefined,
): { value: number; sampleSize: number } | null {
  if (events.length === 0 || !events.every((event) => typeof pick(event) === "boolean")) {
    return null;
  }
  return {
    value: events.filter((event) => pick(event) === true).length / events.length,
    sampleSize: events.length,
  };
}

export function observationsFromCohort(input: {
  events: readonly CohortOutcome[];
  windowRef: string;
  primary: { metricId: string; value: (events: readonly CohortOutcome[]) => number };
  includeLatencyP95?: boolean;
  includeHumanTakeover?: boolean;
  includeDeliveryFailure?: boolean;
}): MetricObservation[] {
  if (input.events.length === 0) {
    return [];
  }
  const sampleSize = input.events.length;
  const observations: MetricObservation[] = [
    {
      metricId: input.primary.metricId,
      value: input.primary.value(input.events),
      sampleSize,
      windowRef: input.windowRef,
    },
  ];
  if (
    input.includeHumanTakeover &&
    input.events.every((event) => typeof event.humanTakeover === "boolean")
  ) {
    observations.push({
      metricId: "human_takeover_rate",
      value: input.events.filter((event) => event.humanTakeover).length / sampleSize,
      sampleSize,
      windowRef: input.windowRef,
    });
  }
  // Critical guardrail consumes confirmed securityViolation only.
  // suspectedAuthorizationBypass must not invent security_violations.
  const security = measuredRate(input.events, (event) => event.securityViolation);
  if (security) {
    observations.push({
      metricId: "security_violations",
      value: security.value,
      sampleSize: security.sampleSize,
      windowRef: input.windowRef,
    });
  }
  const crossTenant = measuredRate(input.events, (event) => event.crossTenantContamination);
  if (crossTenant) {
    observations.push({
      metricId: "cross_tenant_contamination",
      value: crossTenant.value,
      sampleSize: crossTenant.sampleSize,
      windowRef: input.windowRef,
    });
  }
  if (input.includeDeliveryFailure) {
    observations.push({
      metricId: "delivery_failure_rate",
      value: input.events.filter((event) => !event.succeeded).length / sampleSize,
      sampleSize,
      windowRef: input.windowRef,
    });
  }
  if (input.includeLatencyP95) {
    const latencies = input.events
      .map((event) => event.latencyMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (latencies.length === input.events.length) {
      const p95 = percentileNearestRank(latencies, 95);
      if (p95 != null) {
        observations.push({
          metricId: "p95_latency",
          value: p95,
          sampleSize: latencies.length,
          windowRef: input.windowRef,
        });
      }
    }
  }
  return observations;
}
