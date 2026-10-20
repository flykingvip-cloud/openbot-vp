/**
 * Agent command (agent RPC / CLI / inter-agent bus) model governance
 * (governance closure plan v1.0 §7.3 PR-1a, E2/E3/E7 model column).
 *
 * Maps the commercial gate result to the `runWithModelFallback` governance params:
 *  - gate not run (subagent lane): no params, so no model row here; the child's row
 *    comes from `recordSubagentModelShadow` (E6).
 *  - gate `skipped` (no enterprise scope): `legacy`, no allowlist.
 *  - gate `acquired`: configured mode (default `shadow`) + the gate's allowlist.
 *
 * The caller's entry (`E2` ingress / `E3` CLI) rides on the context as `entry`.
 *
 * `preferredModelOrder` is deliberately not forwarded: in shadow the candidate list must
 * stay identical to the pre-PR behavior. The mode never comes from the security profile.
 */

import type { ModelGovernanceContext } from "../../agents/model-fallback-governance.js";
import type { ExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import type { GovernanceMode } from "../../gateway/governance/decision.js";
import {
  resolveGovernanceModeForCommercialGate,
  resolveGovernanceModeFromEnv,
} from "../../gateway/governance/mode.js";
import type { AgentCommandCommercialGateResult } from "./commercial-run-gate.js";
import type { AgentCommandGovernanceEntry } from "./types.js";

export const AGENT_COMMAND_MODEL_MODE_ENV = "OPENBOT_GOVERNANCE_AGENT_COMMAND_MODEL_MODE";

export function resolveAgentCommandConfiguredModelMode(
  env: NodeJS.ProcessEnv = process.env,
): GovernanceMode {
  return resolveGovernanceModeFromEnv({
    envName: AGENT_COMMAND_MODEL_MODE_ENV,
    defaultMode: "shadow",
    env,
  });
}

export type AgentCommandModelGovernanceParams = {
  governanceMode?: GovernanceMode;
  entitlementAllowlist?: string[];
  governanceContext?: ModelGovernanceContext;
};

/**
 * Envelope actor id (plan v1.0 goal 4) from the frozen, server-side execution identity
 * only — never from agent RPC params. Prefers opaque ids over the login email:
 * platform user id → membership id → seat id, prefixed with its kind so ids from
 * different namespaces cannot collide. Returns `undefined` rather than guessing.
 *
 * Note (E7): inter-agent bus runs carry the loopback operator's identity, not the
 * originating end user; that stays a Bypass until the bus identity handoff lands.
 */
export function resolveAgentCommandActorId(
  identity: ExecutionIdentityContext | undefined,
): string | undefined {
  if (!identity) {
    return undefined;
  }
  if (identity.platformUserId) {
    return `platform-user:${identity.platformUserId}`;
  }
  if (identity.membershipId) {
    return `membership:${identity.membershipId}`;
  }
  if (identity.seatId) {
    return `seat:${identity.seatId}`;
  }
  return undefined;
}

export function resolveAgentCommandModelGovernance(
  gate: AgentCommandCommercialGateResult | undefined,
  env: NodeJS.ProcessEnv = process.env,
  identity?: ExecutionIdentityContext,
  entry?: AgentCommandGovernanceEntry,
): AgentCommandModelGovernanceParams {
  if (!gate || gate.status === "denied") {
    return {};
  }
  const governanceMode = resolveGovernanceModeForCommercialGate({
    gateStatus: gate.status,
    configuredMode: resolveAgentCommandConfiguredModelMode(env),
  });
  const actorId = resolveAgentCommandActorId(identity);
  if (gate.status === "skipped") {
    const skippedContext: ModelGovernanceContext = {
      ...(actorId ? { actorId } : {}),
      ...(entry ? { entry } : {}),
    };
    return Object.keys(skippedContext).length > 0
      ? { governanceMode, governanceContext: skippedContext }
      : { governanceMode };
  }
  const allowlist = gate.modelGate?.allowlist;
  // Tenant comes from the commercial gate (server-side resolution), never from the client.
  const tenantId = gate.modelGate?.tenantId ?? gate.enterpriseId;
  const context: ModelGovernanceContext = {
    ...(tenantId ? { tenantId } : {}),
    ...(actorId ? { actorId } : {}),
    ...(gate.authorizationDecisionId
      ? { commercialAuthorizationId: gate.authorizationDecisionId }
      : {}),
    ...(entry ? { entry } : {}),
  };
  return {
    governanceMode,
    ...(allowlist !== undefined ? { entitlementAllowlist: [...allowlist] } : {}),
    governanceContext: context,
  };
}
