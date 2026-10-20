/**
 * CapabilityInvokeAdapter (plan PR-P5-1).
 *
 * Maps an E11/E12-style invoke outcome onto a GovernanceDecision. The effect
 * table is the frozen `CAPABILITY_INVOKE_ADAPTER_MAPPING` from P5-0. This
 * module does not authorize, grant, or quota-check, and it does not write the
 * management audit stream. It does not read governance mode or shadow-log
 * defaults.
 *
 * Opt-in shadow: `OPENBOT_GOVERNANCE_CAPABILITY_INVOKE_SHADOW` defaults off.
 * When the flag is off, `recordCapabilityInvokeShadow` returns before building
 * a decision or calling the sink. When it is on, the mapped envelope is
 * appended through `appendGovernanceShadowDecision`. Callers must return the
 * original invoke outcome unchanged.
 */

import { isTruthyEnvValue } from "../../../infra/env.js";
import { resolveGovernanceDecisionIds } from "../decision-id.js";
import {
  classifyDivergence,
  createGovernanceDecision,
  type GovernanceDecision,
  type GovernanceEffect,
} from "../decision.js";
import {
  CAPABILITY_INVOKE_ADAPTER_MAPPING,
  type CapabilityInvokeAdapterMappingRow,
  type CapabilityInvokeSourceResult,
} from "../execution-entry-registry.js";
import { appendGovernanceShadowDecision } from "../shadow-sink.js";

export const CAPABILITY_INVOKE_SHADOW_ENV = "OPENBOT_GOVERNANCE_CAPABILITY_INVOKE_SHADOW";

/** Entries this adapter serves: E11 enterprise data capability, E12 knowledge capability. */
export type CapabilityInvokeEntry = "E11" | "E12";

/** E11/E12-style outcome plus the ids already known to the caller. */
export type CapabilityInvokeOutcomeInput = {
  /**
   * The caller's execution entry, copied as `entry`. Without it the offline reports
   * fall back to the `capability` → E8 source mapping.
   */
  entry?: CapabilityInvokeEntry;
  ok: boolean;
  reason?: string;
  capabilityId?: string;
  /** Capability ledger id. Never reused as `decisionId`. */
  auditId?: string;
  tenantId?: string;
  seatId?: string;
  actorId?: string;
  requestId?: string;
  runId?: string;
};

const MAPPING_BY_SOURCE = new Map<CapabilityInvokeSourceResult, CapabilityInvokeAdapterMappingRow>(
  CAPABILITY_INVOKE_ADAPTER_MAPPING.map((row) => [row.source, row]),
);

export function isCapabilityInvokeShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnvValue(env[CAPABILITY_INVOKE_SHADOW_ENV]);
}

function mappingRowForOutcome(
  outcome: CapabilityInvokeOutcomeInput,
): CapabilityInvokeAdapterMappingRow | undefined {
  if (outcome.ok) {
    return MAPPING_BY_SOURCE.get("ok");
  }
  const reason = outcome.reason?.trim();
  if (!reason || reason === "ok") {
    return undefined;
  }
  return MAPPING_BY_SOURCE.get(reason as CapabilityInvokeSourceResult);
}

function actorIdForOutcome(outcome: CapabilityInvokeOutcomeInput): string | undefined {
  const actorId = outcome.actorId?.trim();
  if (actorId) {
    return actorId;
  }
  const seatId = outcome.seatId?.trim();
  if (seatId) {
    return `seat:${seatId}`;
  }
  return undefined;
}

/**
 * Pure map. `ok === true` is the only allow. `handler-error` stays `skipped`.
 * A reason that is not in the frozen table stays `skipped` and is not an allow.
 */
export function adaptCapabilityInvokeOutcome(params: {
  outcome: CapabilityInvokeOutcomeInput;
  /** ISO timestamp. Callers pass it so the map stays pure. */
  ts: string;
  uuid?: () => string;
}): GovernanceDecision {
  const row = mappingRowForOutcome(params.outcome);
  const effect: GovernanceEffect = row?.effect ?? "skipped";
  const trimmedReason = params.outcome.reason?.trim();
  const unmappedReason =
    trimmedReason && trimmedReason !== "ok" ? trimmedReason : "unmapped-capability-outcome";
  const reason =
    row?.reason === "empty" ? undefined : row?.reason === "original" ? row.source : unmappedReason;
  const ids = resolveGovernanceDecisionIds({ source: "capability", uuid: params.uuid });
  const capabilityId = params.outcome.capabilityId?.trim();
  const tenantId = params.outcome.tenantId?.trim();
  const actorId = actorIdForOutcome(params.outcome);
  const requestId = params.outcome.requestId?.trim();
  const runId = params.outcome.runId?.trim();

  return createGovernanceDecision({
    effect,
    decisionId: ids.decisionId,
    source: "capability",
    ...(params.outcome.entry ? { entry: params.outcome.entry } : {}),
    mode: "shadow",
    ...(reason ? { reason } : {}),
    ...(requestId ? { requestId } : {}),
    ...(runId ? { runId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(actorId ? { actorId } : {}),
    ...(capabilityId ? { subject: { kind: "capability", id: capabilityId } } : {}),
    ts: params.ts,
  });
}

function withExistingComparison(decision: GovernanceDecision): GovernanceDecision {
  return createGovernanceDecision({
    ...decision,
    shadow: {
      existing: {
        effect: decision.effect,
        source: "capability",
        ...(decision.reason ? { reason: decision.reason } : {}),
      },
      divergence: classifyDivergence({
        existing: decision.effect,
        shadow: decision.effect,
      }),
    },
  });
}

async function writeCapabilityInvokeShadow(
  params: { outcome: CapabilityInvokeOutcomeInput; env?: NodeJS.ProcessEnv },
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    const decision = adaptCapabilityInvokeOutcome({
      outcome: params.outcome,
      ts: new Date().toISOString(),
    });
    await appendGovernanceShadowDecision(withExistingComparison(decision), { env });
  } catch (error) {
    console.warn(`[governance] capability invoke shadow failed: ${String(error)}`);
  }
}

/**
 * Records one shadow envelope when the opt-in flag is on.
 * Flag off: returns immediately, with no decision build and no sink call.
 */
export function recordCapabilityInvokeShadow(params: {
  outcome: CapabilityInvokeOutcomeInput;
  env?: NodeJS.ProcessEnv;
}): Promise<void> | void {
  const env = params.env ?? process.env;
  if (!isCapabilityInvokeShadowEnabled(env)) {
    return;
  }
  return writeCapabilityInvokeShadow(params, env);
}
