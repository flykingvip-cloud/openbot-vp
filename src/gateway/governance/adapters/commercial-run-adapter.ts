/**
 * CommercialRunAdapter (plan PR-P2-1).
 *
 * Pure map from an already-decided commercial gate result onto a GovernanceDecision.
 * Does not authorize, acquire slots, call billing, or change the gate outcome.
 * `decisionId` reuses `authorizationDecisionId` when the gate produced one
 * (`resolveGovernanceDecisionIds` for `commercial-run`).
 */

import { resolveGovernanceDecisionIds } from "../decision-id.js";
import {
  createGovernanceDecision,
  createLegacySkippedDecision,
  type GovernanceDecision,
} from "../decision.js";
import { appendGovernanceShadowDecision } from "../shadow-sink.js";

/** Gate statuses the adapter understands (same as AgentCommandCommercialGateResult). */
export type CommercialRunGateStatus = "skipped" | "acquired" | "denied";

export type CommercialRunGateInput = {
  status: CommercialRunGateStatus;
  /** Billing foreign key; reused as decisionId when present. */
  authorizationDecisionId?: string;
  /** Deny message from the gate; copied into `reason` on deny. */
  message?: string;
  runId?: string;
  requestId?: string;
  tenantId?: string;
  actorId?: string;
  userId?: string;
  executionId?: string;
  /** P0 leaves this empty. Present so traces have a stable field. */
  runtimeLeaseId?: string;
  dataSpaceRef?: string;
  browserNamespaceRef?: string;
  subjectId?: string;
  /** Execution-entry id the caller already knows (`E2` / `E3`); copied as `entry`. */
  entry?: string;
};

/**
 * Pure map.
 *  - skipped → skipped + legacy (no enterprise scope)
 *  - acquired → allow
 *  - denied → deny
 * Never turns skipped into allow.
 */
export function adaptCommercialRunGate(params: {
  gate: CommercialRunGateInput;
  ts: string;
  uuid?: () => string;
}): GovernanceDecision {
  const gate = params.gate;
  const ids = resolveGovernanceDecisionIds({
    source: "commercial-run",
    authorizationDecisionId: gate.authorizationDecisionId,
    uuid: params.uuid,
  });
  const runId = gate.runId?.trim();
  const requestId = gate.requestId?.trim();
  const tenantId = gate.tenantId?.trim();
  const actorId = gate.actorId?.trim();
  const userId = gate.userId?.trim();
  const executionId = gate.executionId?.trim();
  const dataSpaceRef = gate.dataSpaceRef?.trim();
  const browserNamespaceRef = gate.browserNamespaceRef?.trim();
  const subjectId = gate.subjectId?.trim();
  const entry = gate.entry?.trim();
  const base = {
    ...ids,
    source: "commercial-run" as const,
    ...(entry ? { entry } : {}),
    ...(runId ? { runId } : {}),
    ...(requestId ? { requestId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(actorId ? { actorId } : {}),
    ...(userId ? { userId } : {}),
    ...(executionId ? { executionId } : {}),
    ...(gate.runtimeLeaseId !== undefined ? { runtimeLeaseId: gate.runtimeLeaseId } : {}),
    ...(dataSpaceRef ? { dataSpaceRef } : {}),
    ...(browserNamespaceRef ? { browserNamespaceRef } : {}),
    ...(subjectId ? { subject: { kind: "run" as const, id: subjectId } } : {}),
    ts: params.ts,
  };

  if (gate.status === "skipped") {
    return createLegacySkippedDecision(base);
  }

  if (gate.status === "acquired") {
    return createGovernanceDecision({
      ...base,
      effect: "allow",
      // Commercial acquisition is the live gate; the envelope describes that fact.
      mode: "enforced",
    });
  }

  const reason = gate.message?.trim() || "denied";
  return createGovernanceDecision({
    ...base,
    effect: "deny",
    mode: "enforced",
    reason,
  });
}

/**
 * Builds the commercial-run envelope and hands it to the best-effort shadow sink.
 * Never throws; never changes the gate result. Sink respects OPENBOT_GOVERNANCE_SHADOW_LOG.
 */
export function recordCommercialRunDecision(params: {
  gate: CommercialRunGateInput;
  ts?: string;
  env?: NodeJS.ProcessEnv;
  uuid?: () => string;
}): GovernanceDecision | undefined {
  try {
    const decision = adaptCommercialRunGate({
      gate: params.gate,
      ts: params.ts ?? new Date().toISOString(),
      uuid: params.uuid,
    });
    void appendGovernanceShadowDecision(decision, { env: params.env }).catch(() => {});
    return decision;
  } catch {
    return undefined;
  }
}
