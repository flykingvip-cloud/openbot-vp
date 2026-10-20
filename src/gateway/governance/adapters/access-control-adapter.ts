/**
 * AccessControlAdapter (plan PR-P2-3).
 *
 * Pure map from an already-decided access-control `allowed` result onto a
 * GovernanceDecision. Zero authorization inside the adapter: it does not read
 * policy files, call the asset-access evaluator, or resolve the access-control
 * plane mode. `decisionId` is always a fresh `gd-`.
 *
 * Envelope `mode` is the caller's already-resolved access-control mode
 * (`shadow` → governance `shadow`, `enforce` → governance `enforced`). The
 * adapter invents no default.
 *
 * Opt-in shadow: `OPENBOT_GOVERNANCE_ACCESS_CONTROL_SHADOW` defaults off and
 * does not read the access-control plane mode flag. When the flag is off,
 * `recordAccessControlShadow` returns before building a decision or calling
 * the sink. Access results stay unchanged.
 */

import { isTruthyEnvValue } from "../../../infra/env.js";
import { resolveGovernanceDecisionIds } from "../decision-id.js";
import {
  classifyDivergence,
  createGovernanceDecision,
  type GovernanceDecision,
  type GovernanceEffect,
  type GovernanceMode,
  type GovernanceSubject,
} from "../decision.js";
import { appendGovernanceShadowDecision } from "../shadow-sink.js";

export const ACCESS_CONTROL_SHADOW_ENV = "OPENBOT_GOVERNANCE_ACCESS_CONTROL_SHADOW";

/** Access-control plane modes the adapter understands (already resolved by the caller). */
export type AccessControlSourceMode = "shadow" | "enforce";

/** Fields the caller already holds from authorize / evaluate + request context. */
export type AccessControlDecisionInput = {
  /** Source `allowed` (evaluator verdict when coming from authorize). */
  allowed: boolean;
  /** Deny reason from the evaluator; omitted on allow. */
  reason?: string;
  /**
   * Already-resolved access-control mode. Required so the adapter never
   * resolves the plane mode itself or invents a default.
   */
  mode: AccessControlSourceMode;
  /**
   * What the live caller experienced. Defaults: access-control `shadow` → true
   * (not enforced); `enforce` → same as `allowed`.
   */
  callerAllowed?: boolean;
  resourceType?: string;
  resourceId?: string;
  permission?: string;
  enterpriseId?: string;
  subjectType?: string;
  subjectId?: string;
  requestId?: string;
  matchedPolicyId?: string;
};

export function isAccessControlShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnvValue(env[ACCESS_CONTROL_SHADOW_ENV]);
}

/** Maps access-control plane mode onto the governance envelope mode. */
export function toGovernanceModeFromAccessControl(mode: AccessControlSourceMode): GovernanceMode {
  return mode === "enforce" ? "enforced" : "shadow";
}

function subjectForResource(params: {
  resourceType?: string;
  resourceId?: string;
}): GovernanceSubject | undefined {
  const resourceId = params.resourceId?.trim();
  if (!resourceId) {
    return undefined;
  }
  const resourceType = params.resourceType?.trim();
  if (resourceType === "agent_asset" || !resourceType) {
    return { kind: "agent", id: resourceId };
  }
  if (resourceType === "capability") {
    return { kind: "capability", id: resourceId };
  }
  return { kind: "run", id: `${resourceType}:${resourceId}` };
}

/**
 * Pure map.
 *  - allowed → allow
 *  - !allowed → deny
 * Never authorizes and never turns a deny into allow.
 */
export function adaptAccessControlDecision(params: {
  decision: AccessControlDecisionInput;
  /** ISO timestamp. Callers pass it so the map stays pure. */
  ts: string;
  uuid?: () => string;
}): GovernanceDecision {
  const effect: GovernanceEffect = params.decision.allowed ? "allow" : "deny";
  const ids = resolveGovernanceDecisionIds({
    source: "access-control",
    uuid: params.uuid,
  });
  const mode = toGovernanceModeFromAccessControl(params.decision.mode);
  const reason = params.decision.allowed ? undefined : params.decision.reason?.trim() || undefined;
  const requestId = params.decision.requestId?.trim();
  const tenantId = params.decision.enterpriseId?.trim();
  const subjectType = params.decision.subjectType?.trim();
  const subjectId = params.decision.subjectId?.trim();
  const actorId = subjectId ? `${subjectType || "subject"}:${subjectId}` : undefined;
  const matchedPolicyId = params.decision.matchedPolicyId?.trim();
  const subject = subjectForResource({
    resourceType: params.decision.resourceType,
    resourceId: params.decision.resourceId,
  });

  // Live path: access-control shadow always lets the caller through; enforce
  // honours the evaluator. Compare governance effect against that experience.
  const callerAllowed =
    params.decision.callerAllowed ??
    (params.decision.mode === "shadow" ? true : params.decision.allowed);
  const existingEffect: GovernanceEffect = callerAllowed ? "allow" : "deny";
  const existing =
    params.decision.mode === "shadow"
      ? { effect: existingEffect, source: "access-control" as const, reason: "not-enforced" }
      : { effect: existingEffect, source: "access-control" as const };

  return createGovernanceDecision({
    effect,
    decisionId: ids.decisionId,
    source: "access-control",
    mode,
    ...(reason ? { reason } : {}),
    ...(matchedPolicyId ? { matchedRules: [matchedPolicyId] } : {}),
    ...(requestId ? { requestId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(actorId ? { actorId } : {}),
    ...(subject ? { subject } : {}),
    shadow: {
      existing,
      divergence: classifyDivergence({
        existing: existingEffect,
        shadow: effect,
        stricterCause: "known-bypass",
      }),
    },
    ts: params.ts,
  });
}

async function writeAccessControlShadow(
  params: { decision: AccessControlDecisionInput; env?: NodeJS.ProcessEnv },
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    const envelope = adaptAccessControlDecision({
      decision: params.decision,
      ts: new Date().toISOString(),
    });
    await appendGovernanceShadowDecision(envelope, { env });
  } catch (error) {
    console.warn(`[governance] access-control shadow failed: ${String(error)}`);
  }
}

/**
 * Records one shadow envelope when the opt-in flag is on.
 * Flag off: returns immediately, with no decision build and no sink call.
 * Never throws and never changes the access result.
 */
export function recordAccessControlShadow(params: {
  decision: AccessControlDecisionInput;
  env?: NodeJS.ProcessEnv;
}): Promise<void> | void {
  const env = params.env ?? process.env;
  if (!isAccessControlShadowEnabled(env)) {
    return;
  }
  return writeAccessControlShadow(params, env);
}
