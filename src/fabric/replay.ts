/**
 * replay.ts — decision replay + policy simulation (R17).
 *
 * - `replayDecision(record)`: re-run the Policy Runtime over a record's stored
 *   snapshot + policy inputs and assert the SAME decision (R17.1). The decision
 *   depends only on hard-signal `PolicyInputs`, so redacted args don't affect it.
 * - `dryRunDiff(records, candidate)`: re-evaluate a candidate policy over a set
 *   of historical records and diff decisions (R17.2). NO side effects — purely
 *   re-decides (R17.3). Any RELAXATION of an existing denial/constraint is
 *   flagged for human confirmation (R17.4).
 *
 * Execution-side replay (re-running side-effecting tools) is explicitly out of
 * scope for v1.
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.7.
 */

import type { FabricExecutionRecord, RequestSnapshot } from "./audit.js";
import type { ExecutionConstraints, PolicyDecision, ToolRequest } from "./contract.js";
import { constraintsFromDecision } from "./mappers.js";
import { decide, type PolicyInputs } from "./policy-runtime.js";

/** Reconstruct a ToolRequest from a (redacted) snapshot for re-decision. */
export function requestFromSnapshot(snap: RequestSnapshot): ToolRequest {
  return {
    id: snap.id,
    source: snap.source,
    tool: snap.tool,
    input: snap.input,
    context: snap.context,
    trace: snap.trace,
  };
}

/** Stable structural equality of two decisions (decision + reason + constraints). */
export function decisionsEqual(a: PolicyDecision, b: PolicyDecision): boolean {
  if (a.decision !== b.decision) {
    return false;
  }
  if (a.decision === "DENY" && b.decision === "DENY") {
    return a.reason === b.reason;
  }
  const ca = constraintsFromDecision(a);
  const cb = constraintsFromDecision(b);
  return JSON.stringify(ca ?? null) === JSON.stringify(cb ?? null);
}

export interface ReplayResult {
  matches: boolean;
  original: PolicyDecision;
  replayed: PolicyDecision;
}

/**
 * Re-run the decision for a record using its stored policy inputs. Returns the
 * replayed decision and whether it matches the original. Records without stored
 * inputs cannot be replayed deterministically.
 */
export function replayDecision(record: FabricExecutionRecord): ReplayResult {
  if (!record.policyInputs) {
    throw new Error(
      `record "${record.correlationId}" has no stored policyInputs; cannot replay decision`,
    );
  }
  const replayed = decide(requestFromSnapshot(record.what), record.policyInputs);
  return {
    matches: decisionsEqual(record.decision, replayed),
    original: record.decision,
    replayed,
  };
}

/** A candidate policy = a transform of the compile-time inputs, then decide. */
export type CandidatePolicy = (inputs: PolicyInputs, request: ToolRequest) => PolicyInputs;

/** Does `candidate` relax `original` (weaken a denial or loosen constraints)? */
export function isRelaxation(original: PolicyDecision, candidate: PolicyDecision): boolean {
  // DENY → anything non-DENY is a relaxation.
  if (original.decision === "DENY" && candidate.decision !== "DENY") {
    return true;
  }
  const orig = constraintsFromDecision(original);
  const cand = constraintsFromDecision(candidate);
  if (!orig) {
    return false; // nothing was constrained to loosen
  }
  return loosens(orig, cand);
}

/** True when `cand` weakens a tightening present in `orig`. */
function loosens(orig: ExecutionConstraints, cand: ExecutionConstraints | undefined): boolean {
  const rank = { strict: 3, restricted: 2, none: 1, undefined: 0 } as const;
  const o = rank[orig.sandboxMode ?? "undefined"];
  const c = rank[cand?.sandboxMode ?? "undefined"];
  if (c < o) {
    return true; // sandbox weakened
  }
  if (orig.allowNetwork === false && cand?.allowNetwork !== false) {
    return true; // network re-enabled
  }
  return false;
}

export interface DiffEntry {
  correlationId: string;
  original: PolicyDecision;
  candidate: PolicyDecision;
  changed: boolean;
  /** Flagged: candidate relaxes an existing denial/constraint (needs human ok). */
  relaxation: boolean;
}

export interface DryRunDiff {
  entries: DiffEntry[];
  /** Count of relaxations — non-zero requires explicit human confirmation. */
  relaxationCount: number;
}

/**
 * Simulate a candidate policy over historical records, diffing decisions. Pure:
 * never executes tools. Relaxations are flagged (R17.2/R17.3/R17.4).
 */
export function dryRunDiff(
  records: readonly FabricExecutionRecord[],
  candidate: CandidatePolicy,
): DryRunDiff {
  const entries: DiffEntry[] = [];
  for (const record of records) {
    if (!record.policyInputs) {
      continue;
    }
    const request = requestFromSnapshot(record.what);
    const candidateDecision = decide(request, candidate(record.policyInputs, request));
    const changed = !decisionsEqual(record.decision, candidateDecision);
    const relaxation = isRelaxation(record.decision, candidateDecision);
    entries.push({
      correlationId: record.correlationId,
      original: record.decision,
      candidate: candidateDecision,
      changed,
      relaxation,
    });
  }
  return { entries, relaxationCount: entries.filter((e) => e.relaxation).length };
}
