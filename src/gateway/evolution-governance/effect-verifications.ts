/**
 * Formal Evolution Governance API for effect verification windows.
 * Unique write path over state.json — not a parallel Runtime store.
 */

import { recordDecisionObservationEvent } from "./effect-observations.js";
import {
  readGovernancePersistedState,
  writeGovernancePersistedState,
  type GovernanceEffectBeforeSnapshot,
  type GovernanceEffectBaselineMetrics,
  type GovernanceEffectDecision,
  type GovernanceEffectVerification,
} from "./persistent-store.js";
import { assertTickWriterCapability } from "./tick-writer-capability.js";

const DEFAULT_EFFECT_VERIFY_MS = 60 * 60 * 1000;

export type OpenGovernanceEffectWindowInput = {
  runtimeAgentId: string;
  reason: string;
  action: string;
  now?: number;
  commandId?: string;
  beforeSnapshot?: GovernanceEffectBeforeSnapshot;
  baseline?: GovernanceEffectBaselineMetrics;
  baselineWindow?: { startedAt: string; endedAt: string };
  binding?: {
    proposalId: string;
    experimentId: string;
    applicationId: string;
    tenantId: string;
    domainReceiptRef: string;
  };
  observationUntil?: string;
  observationWindowMs?: number;
  evaluationIntervalMs?: number;
  minimumSampleSize?: number;
  modelRevision?: string;
  configRevision?: string;
  /** Allowed on unbound control windows so probes can stay tenant-scoped. */
  tenantId?: string;
};

export type CloseGovernanceEffectWindowInput = {
  effectVerificationId: string;
  status: "resumed" | "held" | "escalated";
  now?: number;
  outcomeNote?: string;
  treatment?: GovernanceEffectBaselineMetrics;
  treatmentWindow?: { startedAt: string; endedAt: string };
};

export type SubmitGovernanceEffectDecisionInput = {
  decisionId: string;
  effectVerificationId: string;
  decidedBy: "governance_tick" | "authorized_operator" | "runtime_verifier";
  decision: "resume" | "hold" | "escalate";
  evidenceRefs: string[];
  sourceReceiptRef: string;
  decidedAt?: string;
  now?: number;
  principalRef?: string;
  grantId?: string;
  outcomeNote?: string;
  verifierId?: string;
  capabilityToken?: string;
};

export const DEFAULT_MINIMUM_EVALUATION_SAMPLES = 20;

export function registerRuntimeEffectVerifier(): never {
  throw new Error("runtime-verifier-self-registration-forbidden");
}

function hasId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function effectVerifyMs(): number {
  const fromEnv = Number(process.env.OPENBOT_GOV_EFFECT_VERIFY_MS);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) {
    return Math.floor(fromEnv);
  }
  return DEFAULT_EFFECT_VERIFY_MS;
}

export function isBoundEffectVerification(
  row: GovernanceEffectVerification,
): row is GovernanceEffectVerification & {
  experimentId: string;
  applicationId: string;
} {
  return hasId(row.experimentId) && hasId(row.applicationId);
}

export function listGovernanceEffectVerifications(
  configDir?: string,
): GovernanceEffectVerification[] {
  return [...(readGovernancePersistedState(configDir).effectVerifications ?? [])];
}

function persistWindows(
  windows: GovernanceEffectVerification[],
  configDir?: string,
): GovernanceEffectVerification[] {
  const state = readGovernancePersistedState(configDir);
  const next = windows.slice(-200);
  writeGovernancePersistedState({ ...state, effectVerifications: next }, configDir);
  return next;
}

function emptyBaseline(): GovernanceEffectBaselineMetrics {
  return {
    skillSuccessRate: null,
    skillUsageTotal: 0,
    invocationCount7d: 0,
    tokenConsumption7d: 0,
  };
}

/**
 * Open an effect window. Caller-supplied experiment IDs are accepted only
 * through the explicit trusted `binding` object from Evolution Control.
 * Duplicate commandId returns the existing window. A second live bound
 * application on the same runtime agent fails closed.
 */
export function openGovernanceEffectWindow(
  input: OpenGovernanceEffectWindowInput,
  configDir?: string,
): GovernanceEffectVerification {
  const runtimeAgentId = input.runtimeAgentId.trim();
  if (!runtimeAgentId) {
    throw new Error("missing-runtime-agent");
  }
  const existing = listGovernanceEffectVerifications(configDir);
  if (hasId(input.commandId)) {
    const duplicate = existing.find((row) => row.commandId === input.commandId);
    if (duplicate) {
      return duplicate;
    }
  }
  const binding = input.binding;
  if (binding) {
    if (
      !hasId(binding.proposalId) ||
      !hasId(binding.experimentId) ||
      !hasId(binding.applicationId) ||
      !hasId(binding.tenantId)
    ) {
      throw new Error("incomplete-trusted-binding");
    }
    const liveOther = existing.some(
      (row) =>
        row.runtimeAgentId === runtimeAgentId &&
        row.status === "open" &&
        isBoundEffectVerification(row) &&
        row.applicationId !== binding.applicationId,
    );
    if (liveOther) {
      throw new Error("multiple-live-applications");
    }
  }
  const now = input.now ?? Date.now();
  const id = hasId(input.commandId)
    ? `effect:evo:${input.commandId}`
    : `effect:${input.action}:${runtimeAgentId}:${input.reason}:${now}`;
  const already = existing.find((row) => row.id === id);
  if (already) {
    return already;
  }
  const openedAt = new Date(now).toISOString();
  const observeMs =
    input.observationWindowMs ?? Math.max(effectVerifyMs(), DEFAULT_EFFECT_VERIFY_MS);
  const observationUntil = hasId(input.observationUntil)
    ? input.observationUntil
    : new Date(now + observeMs).toISOString();
  const evaluationIntervalMs = input.evaluationIntervalMs ?? effectVerifyMs();
  const minimumSampleSize = input.minimumSampleSize ?? DEFAULT_MINIMUM_EVALUATION_SAMPLES;
  const row: GovernanceEffectVerification = {
    id,
    assetId: `asset:bot:${runtimeAgentId}`,
    runtimeAgentId,
    reason: input.reason,
    pausedAt: openedAt,
    openedAt,
    observationStartedAt: openedAt,
    verifyAfterAt: new Date(now + effectVerifyMs()).toISOString(),
    nextEvaluateAt: new Date(now + evaluationIntervalMs).toISOString(),
    evaluationIntervalMs,
    evaluationCount: 0,
    consumedInvocationIds: [],
    minimumSampleSize,
    observationUntil,
    baseline: input.baseline ?? emptyBaseline(),
    status: "open",
    action: input.action,
    ...(hasId(input.commandId) ? { commandId: input.commandId } : {}),
    ...(input.beforeSnapshot ? { beforeSnapshot: input.beforeSnapshot } : {}),
    ...(input.baselineWindow ? { baselineWindow: input.baselineWindow } : {}),
    ...(hasId(input.modelRevision) ? { modelRevision: input.modelRevision } : {}),
    ...(hasId(input.configRevision) ? { configRevision: input.configRevision } : {}),
    ...(hasId(input.tenantId) && !binding ? { tenantId: input.tenantId } : {}),
    ...(binding
      ? {
          proposalId: binding.proposalId,
          experimentId: binding.experimentId,
          applicationId: binding.applicationId,
          tenantId: binding.tenantId,
          domainReceiptRef: binding.domainReceiptRef,
        }
      : {}),
  };
  persistWindows([...existing, row], configDir);
  return row;
}

/**
 * Untrusted legacy close. Public callers cannot submit a status.
 * Production observation never reads windows closed only through this path.
 */
export function closeGovernanceEffectWindow(
  _input: CloseGovernanceEffectWindowInput,
  _configDir?: string,
): GovernanceEffectVerification {
  throw new Error("untrusted-status-close: use submitGovernanceEffectDecision");
}

export function listGovernanceEffectDecisions(configDir?: string): GovernanceEffectDecision[] {
  return [...(readGovernancePersistedState(configDir).effectDecisions ?? [])];
}

function persistDecisions(
  decisions: GovernanceEffectDecision[],
  configDir?: string,
): GovernanceEffectDecision[] {
  const state = readGovernancePersistedState(configDir);
  const next = decisions.slice(-500);
  writeGovernancePersistedState({ ...state, effectDecisions: next }, configDir);
  return next;
}

function applyTrustedWindowClose(
  input: {
    effectVerificationId: string;
    status: "resumed" | "held" | "escalated";
    now?: number;
    outcomeNote?: string;
    decisionId?: string;
  },
  configDir?: string,
): GovernanceEffectVerification {
  const existing = listGovernanceEffectVerifications(configDir);
  const index = existing.findIndex((row) => row.id === input.effectVerificationId);
  if (index < 0) {
    throw new Error(`effect-window-not-found:${input.effectVerificationId}`);
  }
  const current = existing[index];
  if (!current) {
    throw new Error(`effect-window-not-found:${input.effectVerificationId}`);
  }
  if (current.status !== "open") {
    return current;
  }
  const now = input.now ?? Date.now();
  const closed: GovernanceEffectVerification = {
    ...current,
    status: input.status,
    closedAt: new Date(now).toISOString(),
    ...(input.outcomeNote ? { outcomeNote: input.outcomeNote } : {}),
    ...(hasId(input.decisionId) ? { decisionId: input.decisionId } : {}),
  };
  const next = [...existing];
  next[index] = closed;
  persistWindows(next, configDir);
  return closed;
}

function decisionToStatus(
  decision: SubmitGovernanceEffectDecisionInput["decision"],
): "resumed" | "held" | "escalated" {
  if (decision === "resume") {
    return "resumed";
  }
  if (decision === "hold") {
    return "held";
  }
  return "escalated";
}

function applyEffectDecision(
  input: SubmitGovernanceEffectDecisionInput,
  configDir?: string,
): { decision: GovernanceEffectDecision; window: GovernanceEffectVerification } {
  if (!hasId(input.decisionId)) {
    throw new Error("missing-decision-id");
  }
  if (!hasId(input.sourceReceiptRef)) {
    throw new Error("missing-source-receipt");
  }
  if (!input.evidenceRefs.some((ref) => hasId(ref))) {
    throw new Error("missing-decision-evidence");
  }
  const existing = listGovernanceEffectDecisions(configDir);
  const duplicate = existing.find((row) => row.decisionId === input.decisionId);
  if (duplicate) {
    const window = listGovernanceEffectVerifications(configDir).find(
      (row) => row.id === input.effectVerificationId,
    );
    if (!window) {
      throw new Error(`effect-window-not-found:${input.effectVerificationId}`);
    }
    return { decision: duplicate, window };
  }
  const conflict = existing.find(
    (row) =>
      row.effectVerificationId === input.effectVerificationId && row.decision !== input.decision,
  );
  if (conflict) {
    throw new Error("conflicting-effect-decision");
  }
  const decidedAt = input.decidedAt ?? new Date(input.now ?? Date.now()).toISOString();
  const decision: GovernanceEffectDecision = {
    decisionId: input.decisionId,
    effectVerificationId: input.effectVerificationId,
    decidedBy: input.decidedBy,
    decision: input.decision,
    evidenceRefs: input.evidenceRefs.filter((ref) => hasId(ref)),
    sourceReceiptRef: input.sourceReceiptRef,
    decidedAt,
    ...(hasId(input.principalRef) ? { principalRef: input.principalRef } : {}),
    ...(hasId(input.grantId) ? { grantId: input.grantId } : {}),
  };
  persistDecisions([...existing, decision], configDir);
  const window = applyTrustedWindowClose(
    {
      effectVerificationId: input.effectVerificationId,
      status: decisionToStatus(input.decision),
      now: input.now ?? Date.parse(decidedAt),
      outcomeNote: input.outcomeNote,
      decisionId: decision.decisionId,
    },
    configDir,
  );
  recordDecisionObservationEvent(
    {
      effectVerificationId: input.effectVerificationId,
      decisionId: decision.decisionId,
      decision: input.decision,
      sourceReceiptRef: input.sourceReceiptRef,
      decidedAt,
      window,
    },
    configDir,
  );
  return { decision, window };
}

export function submitGovernanceEffectDecision(
  input: SubmitGovernanceEffectDecisionInput,
  _configDir?: string,
): { decision: GovernanceEffectDecision; window: GovernanceEffectVerification } {
  if (input.decidedBy === "governance_tick") {
    throw new Error("governance_tick-decision-forbidden");
  }
  if (input.decidedBy === "authorized_operator") {
    // Authority inspector lives in evolution-control/authority-gate.ts
    // (checkEvolutionAuthority). Governance SoT cannot import that layer
    // without inverting the composition root. Non-empty principalRef/grantId
    // is not authorization. Operator close stays disabled.
    throw new Error("operator-effect-decision-unavailable");
  }
  if (input.decidedBy === "runtime_verifier") {
    throw new Error("runtime-verifier-unavailable");
  }
  throw new Error("untrusted-effect-decision");
}

/**
 * Tick-pipeline close. Requires the module-private Tick capability.
 * Not re-exported from the public governance barrel.
 */
export function submitTickEffectDecision(
  input: Omit<SubmitGovernanceEffectDecisionInput, "decidedBy"> & { capability: unknown },
  configDir?: string,
): { decision: GovernanceEffectDecision; window: GovernanceEffectVerification } {
  assertTickWriterCapability(input.capability);
  return applyEffectDecision({ ...input, decidedBy: "governance_tick" }, configDir);
}

export function persistOpenWindowEvaluation(
  input: {
    effectVerificationId: string;
    evaluationCount: number;
    lastEvaluationAt: string;
    lastEvaluationReceiptRef?: string;
    nextEvaluateAt: string;
    capability: unknown;
    consumedInvocationIds?: string[];
    lastTelemetryFingerprint?: string;
    lastCostFingerprint?: string;
    lastHealth?: string;
    lastSeenActionId?: string;
  },
  configDir?: string,
): GovernanceEffectVerification {
  assertTickWriterCapability(input.capability);
  const existing = listGovernanceEffectVerifications(configDir);
  const index = existing.findIndex((row) => row.id === input.effectVerificationId);
  if (index < 0) {
    throw new Error(`effect-window-not-found:${input.effectVerificationId}`);
  }
  const current = existing[index];
  if (!current) {
    throw new Error(`effect-window-not-found:${input.effectVerificationId}`);
  }
  const nextRow: GovernanceEffectVerification = {
    ...current,
    evaluationCount: input.evaluationCount,
    lastEvaluationAt: input.lastEvaluationAt,
    nextEvaluateAt: input.nextEvaluateAt,
    ...(input.lastEvaluationReceiptRef
      ? { lastEvaluationReceiptRef: input.lastEvaluationReceiptRef }
      : {}),
    ...(input.consumedInvocationIds
      ? { consumedInvocationIds: input.consumedInvocationIds.slice(-500) }
      : {}),
    ...(input.lastTelemetryFingerprint
      ? { lastTelemetryFingerprint: input.lastTelemetryFingerprint }
      : {}),
    ...(input.lastCostFingerprint ? { lastCostFingerprint: input.lastCostFingerprint } : {}),
    ...(input.lastHealth ? { lastHealth: input.lastHealth } : {}),
    ...(input.lastSeenActionId ? { lastSeenActionId: input.lastSeenActionId } : {}),
  };
  const next = [...existing];
  next[index] = nextRow;
  persistWindows(next, configDir);
  return nextRow;
}

export function revokeGovernanceEffectWindowsForApplication(
  input: { applicationId: string; reason?: string; now?: number },
  configDir?: string,
): GovernanceEffectVerification[] {
  const existing = listGovernanceEffectVerifications(configDir);
  const now = input.now ?? Date.now();
  let changed = false;
  const next = existing.map((row) => {
    if (row.applicationId !== input.applicationId || row.status !== "open") {
      return row;
    }
    changed = true;
    return {
      ...row,
      status: "escalated" as const,
      closedAt: new Date(now).toISOString(),
      outcomeNote: input.reason ?? "application rolled back",
    };
  });
  if (changed) {
    persistWindows(next, configDir);
  }
  return next.filter((row) => row.applicationId === input.applicationId);
}

export function humanInterventionRate(
  windows: readonly GovernanceEffectVerification[],
): number | undefined {
  const closed = windows.filter(
    (row) => row.status === "resumed" || row.status === "held" || row.status === "escalated",
  );
  if (closed.length === 0) {
    return undefined;
  }
  const interventions = closed.filter((row) => row.status === "held" || row.status === "escalated");
  return interventions.length / closed.length;
}

export function selectRuntimeEffectWindows(input: {
  windows: readonly GovernanceEffectVerification[];
  runtimeAgentId: string;
  phase: "baseline" | "treatment";
  startedAt: string;
  endedAt: string;
  experimentId?: string;
  applicationId?: string;
  tenantId?: string;
}): GovernanceEffectVerification[] | "fail-closed" {
  const startedAt = Date.parse(input.startedAt);
  const endedAt = Date.parse(input.endedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return [];
  }
  const inWindow = (row: GovernanceEffectVerification): boolean => {
    const marked = Date.parse(row.closedAt ?? row.pausedAt);
    return Number.isFinite(marked) && marked >= startedAt && marked <= endedAt;
  };
  const forAgent = input.windows.filter(
    (row) => row.runtimeAgentId === input.runtimeAgentId && inWindow(row),
  );
  if (input.phase === "treatment") {
    if (!hasId(input.experimentId) || !hasId(input.applicationId)) {
      return [];
    }
    const liveApps = new Set(
      forAgent
        .filter((row) => row.status === "open" && isBoundEffectVerification(row))
        .map((row) => row.applicationId),
    );
    if (liveApps.size > 1) {
      return "fail-closed";
    }
    return forAgent.filter((row) => {
      if (row.status === "open") {
        return false;
      }
      if (!isBoundEffectVerification(row)) {
        return false;
      }
      if (row.experimentId !== input.experimentId || row.applicationId !== input.applicationId) {
        return false;
      }
      if (hasId(input.tenantId) && hasId(row.tenantId) && row.tenantId !== input.tenantId) {
        return false;
      }
      return true;
    });
  }
  return forAgent.filter((row) => row.status !== "open");
}
