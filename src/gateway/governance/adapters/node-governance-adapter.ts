/**
 * NodeGovernanceAdapter (plan PR-P2-2).
 *
 * Pure map from an already-decided node-ownership check result onto a
 * GovernanceDecision. Zero authorization inside the adapter: it does not call
 * the node ownership gate, the management audit writer, the security-profile
 * resolver, or the agent-invocation evaluator. `decisionId` is always a fresh
 * `gd-`.
 *
 * Shadow comparison stays fixed: the live node.invoke path is treat-as-allow
 * (`not-enforced`). Deny against that is D1, or D2 when the reason is
 * `node-ownership-unattributed` (missing attribution).
 */

import { resolveGovernanceDecisionIds } from "../decision-id.js";
import {
  classifyDivergence,
  createGovernanceDecision,
  type GovernanceDecision,
} from "../decision.js";

/** Fields the caller already holds from the ownership check + request context. */
export type NodeGovernanceDecisionInput = {
  allowed: boolean;
  reason?: string;
  nodeId: string;
  /** Invoke command; used as reason fallback when the gate did not supply one. */
  command: string;
  requestId?: string;
  tenantId?: string;
  ownerId?: string;
  /** Execution-entry id the caller already knows (`E9` for node.invoke); copied as `entry`. */
  entry?: string;
};

/**
 * Pure map.
 *  - allowed → allow
 *  - !allowed → deny
 * Never authorizes and never turns a deny into allow.
 */
export function adaptNodeGovernanceDecision(params: {
  decision: NodeGovernanceDecisionInput;
  /** ISO timestamp. Callers pass it so the map stays pure. */
  ts: string;
  uuid?: () => string;
}): GovernanceDecision {
  const effect = params.decision.allowed ? "allow" : "deny";
  const ids = resolveGovernanceDecisionIds({
    source: "node",
    uuid: params.uuid,
  });
  const nodeId = params.decision.nodeId.trim();
  const requestId = params.decision.requestId?.trim();
  const tenantId = params.decision.tenantId?.trim();
  const ownerId = params.decision.ownerId?.trim();
  const entry = params.decision.entry?.trim();
  const reason = params.decision.reason?.trim() || params.decision.command;
  const stricterCause =
    params.decision.reason === "node-ownership-unattributed"
      ? "missing-attribution"
      : "known-bypass";

  return createGovernanceDecision({
    effect,
    decisionId: ids.decisionId,
    source: "node",
    ...(entry ? { entry } : {}),
    mode: "shadow",
    reason,
    ...(requestId ? { requestId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(ownerId ? { actorId: `owner:${ownerId}` } : {}),
    subject: { kind: "node", id: nodeId },
    shadow: {
      existing: { effect: "allow", source: "node", reason: "not-enforced" },
      divergence: classifyDivergence({
        existing: "allow",
        shadow: effect,
        stricterCause,
      }),
    },
    ts: params.ts,
  });
}
