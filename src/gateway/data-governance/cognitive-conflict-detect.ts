/**
 * Production conflict-detection entry (B5 / B28 live run).
 * Classifies a pair of comparable claims and records an open edge only when
 * the pair is a conflict. The evaluator must not plant expected edges.
 */
import { recordOpenConflictEdge } from "./cognitive-conflict-edges.js";
import { listConflictEdges } from "./cognitive-conflict-graph.js";
import type { CognitiveConflictEdge, CognitiveConflictKind } from "./types.js";

const KINDS = new Set<CognitiveConflictKind>(["policy", "fact", "temporal", "scope"]);

export type CognitiveComparableClaim = {
  claimKind: CognitiveConflictKind;
  subject: string;
  polarity: "assert" | "deny";
  value: string;
  scope: string;
  validFrom?: string;
  validTo?: string;
};

export type ClassifyCognitiveClaimPairResult =
  | { conflict: true; conflictKind: CognitiveConflictKind }
  | { conflict: false };

export type DetectCognitiveConflictParams = {
  tenantId: string | null;
  stateDir: string;
  leftResourceId: string;
  rightResourceId: string;
  leftClaim: CognitiveComparableClaim;
  rightClaim: CognitiveComparableClaim;
  evaluatorId: string;
  now?: Date;
};

export type DetectCognitiveConflictResult =
  | {
      ok: true;
      detected: boolean;
      conflictKind?: CognitiveConflictKind;
      edge?: CognitiveConflictEdge;
    }
  | { ok: false; error: "invalid_claim" | "conflict_edge_write_failed" };

function canon(value: string): string {
  return value.trim().toLowerCase();
}

function isClaim(value: unknown): value is CognitiveComparableClaim {
  if (!value || typeof value !== "object") {
    return false;
  }
  const claim = value as CognitiveComparableClaim;
  return (
    KINDS.has(claim.claimKind) &&
    typeof claim.subject === "string" &&
    claim.subject.trim().length > 0 &&
    (claim.polarity === "assert" || claim.polarity === "deny") &&
    typeof claim.value === "string" &&
    claim.value.trim().length > 0 &&
    typeof claim.scope === "string" &&
    claim.scope.trim().length > 0
  );
}

function parseBound(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : fallback;
}

function intervalsOverlap(
  left: CognitiveComparableClaim,
  right: CognitiveComparableClaim,
): boolean {
  const leftFrom = parseBound(left.validFrom, Number.NEGATIVE_INFINITY);
  const leftTo = parseBound(left.validTo, Number.POSITIVE_INFINITY);
  const rightFrom = parseBound(right.validFrom, Number.NEGATIVE_INFINITY);
  const rightTo = parseBound(right.validTo, Number.POSITIVE_INFINITY);
  return leftFrom <= rightTo && rightFrom <= leftTo;
}

function incompatible(left: CognitiveComparableClaim, right: CognitiveComparableClaim): boolean {
  if (canon(left.subject) !== canon(right.subject)) {
    return false;
  }
  if (left.polarity !== right.polarity) {
    return true;
  }
  return canon(left.value) !== canon(right.value);
}

/**
 * Deterministic pair classifier. Does not read fixture labels.
 * Same subject + incompatible value/polarity conflicts when the kind's
 * scope/time window also overlaps.
 */
export function classifyCognitiveClaimPair(
  left: CognitiveComparableClaim,
  right: CognitiveComparableClaim,
): ClassifyCognitiveClaimPairResult {
  if (!isClaim(left) || !isClaim(right)) {
    return { conflict: false };
  }
  if (left.claimKind !== right.claimKind) {
    return { conflict: false };
  }
  if (canon(left.subject) !== canon(right.subject)) {
    return { conflict: false };
  }
  if (!incompatible(left, right)) {
    return { conflict: false };
  }
  if (left.claimKind === "temporal" && !intervalsOverlap(left, right)) {
    return { conflict: false };
  }
  if (left.claimKind !== "temporal" && canon(left.scope) !== canon(right.scope)) {
    return { conflict: false };
  }
  return { conflict: true, conflictKind: left.claimKind };
}

export async function detectAndRecordCognitiveConflict(
  params: DetectCognitiveConflictParams,
): Promise<DetectCognitiveConflictResult> {
  if (!isClaim(params.leftClaim) || !isClaim(params.rightClaim)) {
    return { ok: false, error: "invalid_claim" };
  }
  const classified = classifyCognitiveClaimPair(params.leftClaim, params.rightClaim);
  if (!classified.conflict) {
    return { ok: true, detected: false };
  }
  const recorded = await recordOpenConflictEdge({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    leftResourceId: params.leftResourceId,
    rightResourceId: params.rightResourceId,
    conflictKind: classified.conflictKind,
    evaluatorId: params.evaluatorId,
    now: params.now,
  });
  if (!recorded.ok) {
    return { ok: false, error: "conflict_edge_write_failed" };
  }
  const open = listConflictEdges({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
  }).filter((edge) => edge.status === "open" && edge.edgeId === recorded.edge.edgeId);
  if (open.length === 0) {
    return { ok: false, error: "conflict_edge_write_failed" };
  }
  return {
    ok: true,
    detected: true,
    conflictKind: classified.conflictKind,
    edge: recorded.edge,
  };
}
