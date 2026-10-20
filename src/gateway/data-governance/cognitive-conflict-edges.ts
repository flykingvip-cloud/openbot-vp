import { approvalAuditFrom, isGovernanceApprovalAuth } from "./cognitive-approval-auth.js";
import type { GovernanceApprovalAuth } from "./cognitive-approval-auth.js";
import {
  canonicalConflictPair,
  compareAndPutConflictGraphHead,
  conflictEdgeId,
  readConflictEdge,
  readConflictGraphHead,
} from "./cognitive-conflict-graph.js";
import type { CognitiveConflictEdge, CognitiveConflictKind } from "./types.js";

export type RecordConflictEdgeResult =
  | { ok: true; edge: CognitiveConflictEdge }
  | { ok: false; conflict: "conflict_graph_reserved" | "graph_version_mismatch" };

/**
 * Edge writer (B40): fails closed whenever a reservation exists — live, expired, or fencing.
 * Never clears a reservation.
 */
export async function recordOpenConflictEdge(params: {
  tenantId: string | null;
  stateDir: string;
  leftResourceId: string;
  rightResourceId: string;
  conflictKind: CognitiveConflictKind;
  evaluatorId: string;
  now?: Date;
}): Promise<RecordConflictEdgeResult> {
  const now = params.now ?? new Date();
  const [leftResourceId, rightResourceId] = canonicalConflictPair(
    params.leftResourceId,
    params.rightResourceId,
  );
  const edgeId = conflictEdgeId({
    leftResourceId,
    rightResourceId,
    conflictKind: params.conflictKind,
  });
  const head = readConflictGraphHead({ tenantId: params.tenantId, stateDir: params.stateDir });
  if (head.reservation) {
    return { ok: false, conflict: "conflict_graph_reserved" };
  }
  const existing = readConflictEdge({
    edgeId,
    tenantId: params.tenantId,
    stateDir: params.stateDir,
  });
  if (existing?.status === "open") {
    return { ok: true, edge: existing };
  }
  const edge: CognitiveConflictEdge = {
    edgeId,
    kind: "cognitive_conflict_edge",
    tenantId: params.tenantId,
    leftResourceId,
    rightResourceId,
    conflictKind: params.conflictKind,
    status: "open",
    effectiveAt: now.toISOString(),
    detectedByAudit: { evaluatorId: params.evaluatorId, detectedAt: now.toISOString() },
  };
  const cas = await compareAndPutConflictGraphHead({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    expectedGraphVersion: head.graphVersion,
    mutate: (current) => {
      if (current.reservation) {
        return null;
      }
      return {
        head: { ...current, graphVersion: current.graphVersion + 1 },
        edge,
      };
    },
  });
  if (!cas.ok) {
    const latest = readConflictGraphHead({ tenantId: params.tenantId, stateDir: params.stateDir });
    return {
      ok: false,
      conflict: latest.reservation ? "conflict_graph_reserved" : "graph_version_mismatch",
    };
  }
  return { ok: true, edge };
}

export type ResolveConflictEdgeResult =
  | { ok: true; edge: CognitiveConflictEdge }
  | {
      ok: false;
      conflict:
        | "governance_approval_auth_required"
        | "conflict_graph_reserved"
        | "not_found"
        | "graph_version_mismatch";
    };

/** Authorized resolve. Pair-scope grant is verified by the minted auth, not here. */
export async function resolveConflictEdge(params: {
  tenantId: string | null;
  stateDir: string;
  leftResourceId: string;
  rightResourceId: string;
  conflictKind: CognitiveConflictKind;
  auth: GovernanceApprovalAuth;
  now?: Date;
  resolutionNote?: string;
}): Promise<ResolveConflictEdgeResult> {
  if (!isGovernanceApprovalAuth(params.auth)) {
    return { ok: false, conflict: "governance_approval_auth_required" };
  }
  if (params.auth.approvalGrant.grantKind !== "conflict_precedence_resolve") {
    return { ok: false, conflict: "governance_approval_auth_required" };
  }
  const now = params.now ?? new Date();
  const [leftResourceId, rightResourceId] = canonicalConflictPair(
    params.leftResourceId,
    params.rightResourceId,
  );
  const edgeId = conflictEdgeId({
    leftResourceId,
    rightResourceId,
    conflictKind: params.conflictKind,
  });
  const existing = readConflictEdge({
    edgeId,
    tenantId: params.tenantId,
    stateDir: params.stateDir,
  });
  if (!existing) {
    return { ok: false, conflict: "not_found" };
  }
  if (existing.status === "resolved") {
    return { ok: true, edge: existing };
  }
  const head = readConflictGraphHead({ tenantId: params.tenantId, stateDir: params.stateDir });
  if (head.reservation) {
    return { ok: false, conflict: "conflict_graph_reserved" };
  }
  const scope = params.auth.approvalGrant.scope;
  const precedencePolicyId =
    scope.kind === "conflict_edge_pair" ? scope.precedencePolicyId : undefined;
  const audit = approvalAuditFrom(params.auth, now);
  const edge: CognitiveConflictEdge = {
    ...existing,
    status: "resolved",
    resolvedAt: now.toISOString(),
    resolutionGrantId: audit.grantId,
    ...(precedencePolicyId ? { precedencePolicyId } : {}),
    ...(params.resolutionNote ? { resolutionNote: params.resolutionNote } : {}),
  };
  const cas = await compareAndPutConflictGraphHead({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    expectedGraphVersion: head.graphVersion,
    mutate: (current) => {
      if (current.reservation) {
        return null;
      }
      return {
        head: { ...current, graphVersion: current.graphVersion + 1 },
        edge,
      };
    },
  });
  if (!cas.ok) {
    const latest = readConflictGraphHead({ tenantId: params.tenantId, stateDir: params.stateDir });
    return {
      ok: false,
      conflict: latest.reservation ? "conflict_graph_reserved" : "graph_version_mismatch",
    };
  }
  return { ok: true, edge };
}
