/**
 * AgentInvocationAdapter (plan PR-P2-2).
 *
 * Pure map from an already-decided agent-invocation evaluation result onto a
 * GovernanceDecision. Zero authorization inside the adapter: it does not call
 * the commercial gate, the management audit writer, the security-profile
 * resolver, or the agent-invocation evaluator. `decisionId` is always a fresh
 * `gd-`.
 *
 * Shadow comparison stays fixed: the live session path is treat-as-allow
 * (`not-enforced`). Deny against that is D1; equal effects are D0.
 */

import { resolveGovernanceDecisionIds } from "../decision-id.js";
import {
  classifyDivergence,
  createGovernanceDecision,
  type GovernanceDecision,
} from "../decision.js";

/** Fields the caller already holds from the pure evaluator + request context. */
export type AgentInvocationDecisionInput = {
  allowed: boolean;
  /** Deny reason from the pure evaluator; omitted on allow. */
  reason?: string;
  agentId: string;
  runId?: string;
  /**
   * Tenant that owns the calling session. Resolved from membership by the caller,
   * never from a client-supplied hint. Without it the row cannot be grouped by
   * tenant in the offline reports, so an E2 decision is unattributable.
   */
  tenantId?: string;
  /** Opaque governance actor id (`platform-user:<id>`); never an email. */
  actorId?: string;
};

/**
 * Pure map.
 *  - allowed → allow
 *  - !allowed → deny
 * Never authorizes and never turns a deny into allow.
 */
export function adaptAgentInvocationDecision(params: {
  decision: AgentInvocationDecisionInput;
  /** ISO timestamp. Callers pass it so the map stays pure. */
  ts: string;
  uuid?: () => string;
}): GovernanceDecision {
  const effect = params.decision.allowed ? "allow" : "deny";
  const ids = resolveGovernanceDecisionIds({
    source: "agent-invocation",
    uuid: params.uuid,
  });
  const agentId = params.decision.agentId.trim();
  const runId = params.decision.runId?.trim();
  const tenantId = params.decision.tenantId?.trim();
  const actorId = params.decision.actorId?.trim();
  const reason = params.decision.allowed ? undefined : params.decision.reason?.trim() || undefined;

  return createGovernanceDecision({
    effect,
    decisionId: ids.decisionId,
    ...(ids.commercialAuthorizationId
      ? { commercialAuthorizationId: ids.commercialAuthorizationId }
      : {}),
    source: "agent-invocation",
    mode: "shadow",
    ...(reason ? { reason } : {}),
    ...(runId ? { runId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(actorId ? { actorId } : {}),
    subject: { kind: "agent", id: agentId },
    shadow: {
      existing: { effect: "allow", source: "session", reason: "not-enforced" },
      divergence: classifyDivergence({
        existing: "allow",
        shadow: effect,
        stricterCause: "known-bypass",
      }),
    },
    ts: params.ts,
  });
}
