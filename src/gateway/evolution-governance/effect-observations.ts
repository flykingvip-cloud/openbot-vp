/**
 * Effect Observation Events — the statistical sample unit.
 *
 * Effect Window = one application observation period.
 * Metric Observation = aggregation of independent events in a window.
 * Statistical Sample for primary = independent governance evaluation events.
 * Skill invocations are guardrail sensors only — they never enter the
 * intervention denominator.
 * Window status is a governance conclusion, not a sample.
 */

import {
  readGovernancePersistedState,
  writeGovernancePersistedState,
  type GovernanceEffectObservationEvent,
  type GovernanceEffectObservationKind,
  type GovernanceEffectVerification,
} from "./persistent-store.js";
import { assertTickWriterCapability } from "./tick-writer-capability.js";

const SECURITY_FAILURE_CATEGORIES = new Set([
  "security",
  "security_violation",
  "security_violations",
  "authz",
  "authorization",
]);

function listWindows(configDir?: string): GovernanceEffectVerification[] {
  return [...(readGovernancePersistedState(configDir).effectVerifications ?? [])];
}

function windowIsBound(row: GovernanceEffectVerification): boolean {
  return hasId(row.experimentId) && hasId(row.applicationId);
}

function hasId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function derivedSecurity(category: string | null | undefined): boolean | undefined {
  if (category == null || category.trim() === "") {
    return undefined;
  }
  return SECURITY_FAILURE_CATEGORIES.has(category);
}

export function isGovernanceEvaluationEvent(
  row: Pick<GovernanceEffectObservationEvent, "kind" | "intervention" | "evaluationCycleId">,
): boolean {
  return (
    row.kind === "runtime_probe" &&
    row.intervention != null &&
    typeof row.evaluationCycleId === "string" &&
    row.evaluationCycleId.trim() !== ""
  );
}

function persistEvents(
  events: GovernanceEffectObservationEvent[],
  configDir?: string,
): GovernanceEffectObservationEvent[] {
  const state = readGovernancePersistedState(configDir);
  const next = events.slice(-2000);
  writeGovernancePersistedState({ ...state, effectObservationEvents: next }, configDir);
  return next;
}

export function listGovernanceEffectObservationEvents(
  configDir?: string,
): GovernanceEffectObservationEvent[] {
  return [...(readGovernancePersistedState(configDir).effectObservationEvents ?? [])];
}

export type RecordSkillInvocationObservationInput = {
  effectVerificationId: string;
  invocation: {
    invocationId: string;
    agentId: string;
    tenantId?: string | null;
    completedAt: number;
    outcome: string;
    latencyMs: number;
    failureCategory?: string | null;
    experimentId?: string | null;
    applicationId?: string | null;
  };
  modelRevision?: string;
  configRevision?: string;
};

function eventInFrozenWindow(window: GovernanceEffectVerification, occurredAtMs: number): boolean {
  const openedAt = Date.parse(window.openedAt ?? window.pausedAt);
  if (!Number.isFinite(openedAt) || occurredAtMs < openedAt) {
    return false;
  }
  if (hasId(window.observationUntil)) {
    const until = Date.parse(window.observationUntil);
    if (Number.isFinite(until) && occurredAtMs > until) {
      return false;
    }
  }
  return true;
}

function assertInvocationBinding(
  window: GovernanceEffectVerification,
  invocation: RecordSkillInvocationObservationInput["invocation"],
): {
  experimentId?: string;
  applicationId?: string;
  tenantId: string;
} {
  if (!hasId(invocation.tenantId)) {
    throw new Error("unbound-invocation-excluded");
  }
  if (windowIsBound(window)) {
    if (
      !hasId(invocation.experimentId) ||
      !hasId(invocation.applicationId) ||
      invocation.experimentId !== window.experimentId ||
      invocation.applicationId !== window.applicationId ||
      invocation.tenantId !== window.tenantId
    ) {
      throw new Error("unbound-invocation-excluded");
    }
    return {
      experimentId: invocation.experimentId,
      applicationId: invocation.applicationId,
      tenantId: invocation.tenantId,
    };
  }
  if (hasId(invocation.experimentId) || hasId(invocation.applicationId)) {
    throw new Error("unbound-invocation-excluded");
  }
  if (hasId(window.tenantId) && invocation.tenantId !== window.tenantId) {
    throw new Error("unbound-invocation-excluded");
  }
  return { tenantId: invocation.tenantId };
}

/**
 * Production skill-invocation writer. Binding IDs come from the raw event.
 * Missing or mismatched experiment/application/tenant excludes the row.
 * Does not write intervention — invocations are guardrail sensors only.
 */
export function recordSkillInvocationEffectObservation(
  input: RecordSkillInvocationObservationInput,
  configDir?: string,
): GovernanceEffectObservationEvent {
  if (!hasId(input.invocation.invocationId)) {
    throw new Error("missing-source-receipt");
  }
  const window = listWindows(configDir).find((row) => row.id === input.effectVerificationId);
  if (!window) {
    throw new Error(`effect-window-not-found:${input.effectVerificationId}`);
  }
  if (!eventInFrozenWindow(window, input.invocation.completedAt)) {
    throw new Error("observation-window-closed");
  }
  const binding = assertInvocationBinding(window, input.invocation);
  if (
    hasId(window.modelRevision) &&
    hasId(input.modelRevision) &&
    input.modelRevision !== window.modelRevision
  ) {
    throw new Error("model-revision-mismatch");
  }
  if (
    hasId(window.configRevision) &&
    hasId(input.configRevision) &&
    input.configRevision !== window.configRevision
  ) {
    throw new Error("config-revision-mismatch");
  }
  const existing = listGovernanceEffectObservationEvents(configDir);
  const eventId = `obs:invoke:${input.invocation.invocationId}`;
  const duplicate = existing.find((row) => row.eventId === eventId);
  if (duplicate) {
    return duplicate;
  }
  const security = derivedSecurity(input.invocation.failureCategory);
  const crossTenant =
    hasId(window.tenantId) && hasId(input.invocation.tenantId)
      ? input.invocation.tenantId !== window.tenantId
      : undefined;
  const row: GovernanceEffectObservationEvent = {
    eventId,
    effectVerificationId: window.id,
    runtimeAgentId: window.runtimeAgentId,
    occurredAt: new Date(input.invocation.completedAt).toISOString(),
    kind: "skill_invocation",
    skillSuccess: input.invocation.outcome === "success",
    latencyMs: input.invocation.latencyMs,
    deliveryFailed: input.invocation.outcome === "failure",
    sourceReceiptRef: input.invocation.invocationId,
    cohortRef: windowIsBound(window) ? "treatment" : "control",
    tenantId: binding.tenantId,
    ...(hasId(window.proposalId) ? { proposalId: window.proposalId } : {}),
    ...(hasId(binding.experimentId) ? { experimentId: binding.experimentId } : {}),
    ...(hasId(binding.applicationId) ? { applicationId: binding.applicationId } : {}),
    ...(security !== undefined ? { securityViolation: security } : {}),
    ...(crossTenant !== undefined ? { crossTenantContamination: crossTenant } : {}),
    ...(input.modelRevision ? { modelRevision: input.modelRevision } : {}),
    ...(input.configRevision ? { configRevision: input.configRevision } : {}),
  };
  persistEvents([...existing, row], configDir);
  return row;
}

export type RecordRuntimeProbeInput = {
  effectVerificationId: string;
  eventId: string;
  sourceReceiptRef: string;
  occurredAt: number;
  tenantId: string;
  evaluation: "resume" | "hold" | "escalate";
  evaluationCycleId: string;
  metricsSnapshotRef: string;
  capability: unknown;
  experimentId?: string;
  applicationId?: string;
  skillSuccess?: boolean;
  latencyMs?: number;
  deliveryFailed?: boolean;
  securityViolation?: boolean;
  crossTenantContamination?: boolean;
  tokenCost?: number;
  modelRevision?: string;
  configRevision?: string;
};

/**
 * Tick-only governance evaluation writer. Requires the module-private
 * Tick capability. Binding IDs must already be on the probe.
 */
export function recordRuntimeProbeEffectObservation(
  input: RecordRuntimeProbeInput,
  configDir?: string,
): GovernanceEffectObservationEvent {
  assertTickWriterCapability(input.capability);
  if (!hasId(input.sourceReceiptRef)) {
    throw new Error("missing-source-receipt");
  }
  if (!hasId(input.eventId)) {
    throw new Error("missing-event-id");
  }
  if (!hasId(input.tenantId)) {
    throw new Error("missing-tenant");
  }
  if (!hasId(input.evaluationCycleId) || !hasId(input.metricsSnapshotRef)) {
    throw new Error("missing-evaluation-cycle");
  }
  const window = listWindows(configDir).find((row) => row.id === input.effectVerificationId);
  if (!window) {
    throw new Error(`effect-window-not-found:${input.effectVerificationId}`);
  }
  if (!eventInFrozenWindow(window, input.occurredAt)) {
    throw new Error("observation-window-closed");
  }
  if (windowIsBound(window)) {
    if (
      !hasId(input.experimentId) ||
      !hasId(input.applicationId) ||
      input.experimentId !== window.experimentId ||
      input.applicationId !== window.applicationId ||
      input.tenantId !== window.tenantId
    ) {
      throw new Error("unbound-invocation-excluded");
    }
  } else if (hasId(input.experimentId) || hasId(input.applicationId)) {
    throw new Error("unbound-invocation-excluded");
  } else if (hasId(window.tenantId) && input.tenantId !== window.tenantId) {
    throw new Error("unbound-invocation-excluded");
  }
  const existing = listGovernanceEffectObservationEvents(configDir);
  const duplicate = existing.find((row) => row.eventId === input.eventId);
  if (duplicate) {
    return duplicate;
  }
  const row: GovernanceEffectObservationEvent = {
    eventId: input.eventId,
    effectVerificationId: window.id,
    runtimeAgentId: window.runtimeAgentId,
    occurredAt: new Date(input.occurredAt).toISOString(),
    kind: "runtime_probe",
    intervention: input.evaluation !== "resume",
    sourceReceiptRef: input.sourceReceiptRef,
    evaluationCycleId: input.evaluationCycleId,
    metricsSnapshotRef: input.metricsSnapshotRef,
    cohortRef: windowIsBound(window) ? "treatment" : "baseline",
    tenantId: input.tenantId,
    ...(hasId(window.proposalId) ? { proposalId: window.proposalId } : {}),
    ...(hasId(input.experimentId) ? { experimentId: input.experimentId } : {}),
    ...(hasId(input.applicationId) ? { applicationId: input.applicationId } : {}),
    ...(input.skillSuccess != null ? { skillSuccess: input.skillSuccess } : {}),
    ...(input.latencyMs != null ? { latencyMs: input.latencyMs } : {}),
    ...(input.deliveryFailed != null ? { deliveryFailed: input.deliveryFailed } : {}),
    ...(input.securityViolation != null ? { securityViolation: input.securityViolation } : {}),
    ...(input.crossTenantContamination != null
      ? { crossTenantContamination: input.crossTenantContamination }
      : {}),
    ...(input.tokenCost != null ? { tokenCost: input.tokenCost } : {}),
    ...(input.modelRevision ? { modelRevision: input.modelRevision } : {}),
    ...(input.configRevision ? { configRevision: input.configRevision } : {}),
  };
  persistEvents([...existing, row], configDir);
  return row;
}

export function recordDecisionObservationEvent(
  input: {
    effectVerificationId: string;
    decisionId: string;
    decision: "resume" | "hold" | "escalate";
    sourceReceiptRef: string;
    decidedAt: string;
    window: GovernanceEffectVerification;
  },
  configDir?: string,
): GovernanceEffectObservationEvent {
  const existing = listGovernanceEffectObservationEvents(configDir);
  const eventId = `obs:decision:${input.decisionId}`;
  const duplicate = existing.find((row) => row.eventId === eventId);
  if (duplicate) {
    return duplicate;
  }
  const kind: GovernanceEffectObservationKind =
    input.decision === "resume"
      ? "auto_resume_decision"
      : input.decision === "hold"
        ? "human_hold_decision"
        : "escalation_decision";
  const row: GovernanceEffectObservationEvent = {
    eventId,
    effectVerificationId: input.effectVerificationId,
    runtimeAgentId: input.window.runtimeAgentId,
    occurredAt: input.decidedAt,
    kind,
    intervention: input.decision !== "resume",
    sourceReceiptRef: input.sourceReceiptRef,
    cohortRef: windowIsBound(input.window) ? "treatment" : "control",
    ...(hasId(input.window.proposalId) ? { proposalId: input.window.proposalId } : {}),
    ...(hasId(input.window.experimentId) ? { experimentId: input.window.experimentId } : {}),
    ...(hasId(input.window.applicationId) ? { applicationId: input.window.applicationId } : {}),
    ...(hasId(input.window.tenantId) ? { tenantId: input.window.tenantId } : {}),
  };
  persistEvents([...existing, row], configDir);
  return row;
}

export function selectRuntimeEffectObservationEvents(input: {
  events: readonly GovernanceEffectObservationEvent[];
  windows?: readonly GovernanceEffectVerification[];
  phase: "baseline" | "treatment";
  runtimeAgentId: string;
  startedAt: string;
  endedAt: string;
  experimentId?: string;
  applicationId?: string;
  tenantId?: string;
  modelRevision?: string;
  configRevision?: string;
}): GovernanceEffectObservationEvent[] {
  const startedAt = Date.parse(input.startedAt);
  const endedAt = Date.parse(input.endedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return [];
  }
  const windows = input.windows ?? [];
  const windowById = new Map(windows.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const selected: GovernanceEffectObservationEvent[] = [];
  for (const row of input.events) {
    if (seen.has(row.eventId)) {
      continue;
    }
    if (row.runtimeAgentId !== input.runtimeAgentId) {
      continue;
    }
    if (!hasId(row.sourceReceiptRef)) {
      continue;
    }
    const occurredAt = Date.parse(row.occurredAt);
    if (!Number.isFinite(occurredAt) || occurredAt < startedAt || occurredAt > endedAt) {
      continue;
    }
    const isEvaluation = isGovernanceEvaluationEvent(row);
    const isGuardrail = row.kind === "skill_invocation";
    if (!isEvaluation && !isGuardrail) {
      continue;
    }
    if (
      hasId(input.modelRevision) &&
      hasId(row.modelRevision) &&
      row.modelRevision !== input.modelRevision
    ) {
      continue;
    }
    if (
      hasId(input.configRevision) &&
      hasId(row.configRevision) &&
      row.configRevision !== input.configRevision
    ) {
      continue;
    }
    if (input.phase === "treatment") {
      if (!hasId(input.experimentId) || !hasId(input.applicationId) || !hasId(input.tenantId)) {
        return [];
      }
      if (!hasId(row.experimentId) || !hasId(row.applicationId) || !hasId(row.tenantId)) {
        continue;
      }
      if (row.experimentId !== input.experimentId || row.applicationId !== input.applicationId) {
        continue;
      }
      if (row.tenantId !== input.tenantId) {
        continue;
      }
      if (row.cohortRef === "baseline" || row.cohortRef === "control") {
        continue;
      }
      const parent = windowById.get(row.effectVerificationId);
      if (parent && parent.status === "open") {
        continue;
      }
    } else {
      if (row.cohortRef === "treatment" || hasId(row.applicationId) || hasId(row.experimentId)) {
        continue;
      }
      if (hasId(input.tenantId) && hasId(row.tenantId) && row.tenantId !== input.tenantId) {
        continue;
      }
    }
    seen.add(row.eventId);
    selected.push(row);
  }
  return selected;
}

export type AggregatedRuntimeEffectObservations = {
  humanInterventionRate?: number;
  sampleSize: number;
  skillSuccessRate?: number;
  skillSuccessSampleSize?: number;
  p95LatencyMs?: number;
  latencySampleSize?: number;
  securityViolations?: number;
  securitySampleSize?: number;
  crossTenantContamination?: number;
  tenantSampleSize?: number;
  tokenCost?: number;
  tokenSampleSize?: number;
  deliveryFailureRate?: number;
  deliverySampleSize?: number;
};

function percentileNearestRank(values: number[], percentile: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const bounded = Math.min(100, Math.max(0, percentile));
  const index = Math.max(0, Math.ceil((bounded / 100) * sorted.length) - 1);
  return sorted[index] ?? null;
}

export function aggregateRuntimeEffectObservations(
  events: readonly GovernanceEffectObservationEvent[],
): AggregatedRuntimeEffectObservations | undefined {
  if (events.length === 0) {
    return undefined;
  }
  const evaluations = events.filter(isGovernanceEvaluationEvent);
  const skillRows = events.filter((row) => row.skillSuccess != null);
  const latencyRows = events.filter((row) => row.latencyMs != null);
  const securityRows = events.filter((row) => row.securityViolation != null);
  const tenantRows = events.filter((row) => row.crossTenantContamination != null);
  const costRows = events.filter((row) => row.tokenCost != null);
  const deliveryRows = events.filter((row) => row.deliveryFailed != null);
  const interventions = evaluations.filter((row) => row.intervention === true).length;
  return {
    sampleSize: evaluations.length,
    ...(evaluations.length > 0
      ? { humanInterventionRate: interventions / evaluations.length }
      : {}),
    ...(skillRows.length > 0
      ? {
          skillSuccessRate:
            skillRows.filter((row) => row.skillSuccess === true).length / skillRows.length,
          skillSuccessSampleSize: skillRows.length,
        }
      : {}),
    ...(latencyRows.length > 0
      ? {
          p95LatencyMs:
            percentileNearestRank(
              latencyRows.map((row) => row.latencyMs!),
              95,
            ) ?? undefined,
          latencySampleSize: latencyRows.length,
        }
      : {}),
    ...(securityRows.length > 0
      ? {
          securityViolations:
            securityRows.filter((row) => row.securityViolation === true).length /
            securityRows.length,
          securitySampleSize: securityRows.length,
        }
      : {}),
    ...(tenantRows.length > 0
      ? {
          crossTenantContamination:
            tenantRows.filter((row) => row.crossTenantContamination === true).length /
            tenantRows.length,
          tenantSampleSize: tenantRows.length,
        }
      : {}),
    ...(costRows.length > 0
      ? {
          tokenCost: costRows.reduce((sum, row) => sum + (row.tokenCost ?? 0), 0) / costRows.length,
          tokenSampleSize: costRows.length,
        }
      : {}),
    ...(deliveryRows.length > 0
      ? {
          deliveryFailureRate:
            deliveryRows.filter((row) => row.deliveryFailed === true).length / deliveryRows.length,
          deliverySampleSize: deliveryRows.length,
        }
      : {}),
  };
}
