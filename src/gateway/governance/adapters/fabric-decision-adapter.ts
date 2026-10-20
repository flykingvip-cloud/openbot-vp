/**
 * FabricDecisionAdapter (plan PR-P2-4).
 *
 * Pure map from an already-held Fabric policy decision object onto a
 * GovernanceDecision. Input is supplied by the caller or by tests; this PR
 * does not call the adapter from any production path.
 *
 * Zero authorization and zero Fabric runtime coupling:
 *  - does not read the Fabric enablement env/config flags
 *  - does not import Fabric contract types or any `src/fabric` module
 *  - `stage` is a plain string (GovernanceTraceEntry), never the Fabric closed enum
 *
 * Mapping:
 *  - ALLOW  → allow
 *  - DENY   → deny
 *  - MODIFY → allow (envelope effect) with trace effect `modify`
 *
 * `decisionId` is always a fresh `gd-`.
 */

import { resolveGovernanceDecisionIds } from "../decision-id.js";
import {
  createGovernanceDecision,
  type GovernanceDecision,
  type GovernanceEffect,
  type GovernanceTraceEntry,
} from "../decision.js";

/** Fabric decision literals the adapter understands (caller already holds them). */
export type FabricDecisionKind = "ALLOW" | "DENY" | "MODIFY";

/**
 * Trace row shaped like Fabric's explainability entry, but with `stage: string`
 * so this module never depends on the Fabric closed enum.
 */
export type FabricDecisionTraceInput = {
  stage: string;
  hit: boolean;
  /** Must not contain credentials, emails, or tokens. */
  detail?: string;
  effect?: GovernanceTraceEntry["effect"];
};

/** Fields the caller already holds from a Fabric decision-shaped object. */
export type FabricDecisionInput = {
  decision: FabricDecisionKind;
  /** Deny (or optional) reason from the source decision. */
  reason?: string;
  matchedRules?: string[];
  decisionTrace?: FabricDecisionTraceInput[];
  runId?: string;
  requestId?: string;
  tenantId?: string;
  actorId?: string;
  /** Optional subject id; kind is always `run` (Fabric judges a run-scoped decision). */
  subjectId?: string;
};

function copyTraceEntries(entries: FabricDecisionTraceInput[] | undefined): GovernanceTraceEntry[] {
  if (!entries || entries.length === 0) {
    return [];
  }
  return entries.map((entry) => {
    const stage = String(entry.stage);
    const out: GovernanceTraceEntry = {
      stage,
      hit: entry.hit,
      effect: entry.effect ?? "neutral",
    };
    const detail = entry.detail?.trim();
    if (detail) {
      out.detail = detail;
    }
    return out;
  });
}

/**
 * Builds the governance decisionTrace.
 * For MODIFY, the envelope is allow and at least one trace row must carry
 * effect `modify` (plan §1 / §2 PR-P2-4).
 */
function buildDecisionTrace(input: FabricDecisionInput): GovernanceTraceEntry[] | undefined {
  const copied = copyTraceEntries(input.decisionTrace);
  if (input.decision === "MODIFY") {
    if (!copied.some((entry) => entry.effect === "modify")) {
      copied.push({
        stage: "fabric.modify",
        hit: true,
        effect: "modify",
      });
    }
    return copied;
  }
  return copied.length > 0 ? copied : undefined;
}

function envelopeEffect(kind: FabricDecisionKind): GovernanceEffect {
  // MODIFY tightens constraints but still admits the run → envelope allow.
  if (kind === "DENY") {
    return "deny";
  }
  return "allow";
}

/**
 * Pure map.
 *  - ALLOW  → allow
 *  - DENY   → deny
 *  - MODIFY → allow + decisionTrace effect modify
 * Never authorizes, never reads Fabric flags, never turns deny into allow.
 */
export function adaptFabricDecision(params: {
  decision: FabricDecisionInput;
  /** ISO timestamp. Callers pass it so the map stays pure. */
  ts: string;
  uuid?: () => string;
}): GovernanceDecision {
  const input = params.decision;
  const effect = envelopeEffect(input.decision);
  const ids = resolveGovernanceDecisionIds({
    source: "fabric",
    uuid: params.uuid,
  });
  const reason =
    input.decision === "DENY"
      ? input.reason?.trim() || "denied"
      : input.reason?.trim() || undefined;
  const matchedRules = input.matchedRules
    ?.map((rule) => rule.trim())
    .filter((rule) => rule.length > 0);
  const runId = input.runId?.trim();
  const requestId = input.requestId?.trim();
  const tenantId = input.tenantId?.trim();
  const actorId = input.actorId?.trim();
  const subjectId = input.subjectId?.trim();
  const decisionTrace = buildDecisionTrace(input);

  return createGovernanceDecision({
    effect,
    decisionId: ids.decisionId,
    source: "fabric",
    // Future shadow wiring may compare against a live path; this PR has no caller.
    mode: "shadow",
    ...(reason ? { reason } : {}),
    ...(matchedRules && matchedRules.length > 0 ? { matchedRules } : {}),
    ...(decisionTrace && decisionTrace.length > 0 ? { decisionTrace } : {}),
    ...(runId ? { runId } : {}),
    ...(requestId ? { requestId } : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(actorId ? { actorId } : {}),
    ...(subjectId ? { subject: { kind: "run" as const, id: subjectId } } : {}),
    ts: params.ts,
  });
}
