import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { updateClaimGovernanceStatus } from "../claims/claim-store.js";
import { seedExpertAuthorityForResolver, resolveExpertWeight } from "../expert-authority-store.js";
import { runQualityRefresh } from "../scoring/run-quality-refresh.js";
import type { GovernanceTaskStatus, GovernanceTaskType } from "../types.js";

export type GovernanceAnnotationAction = "confirm" | "reject" | "merge" | "edit" | "dismiss";

export type ResolveGovernanceTaskParams = {
  db: DatabaseSync;
  taskId: string;
  status: GovernanceTaskStatus;
  expertId: string;
  action?: GovernanceAnnotationAction;
  comment?: string | null;
  domainScope?: string | null;
  /**
   * For claim_conflict tasks: the claim the expert designated as the canonical
   * truth. When provided and valid, that claim is confirmed and the rest are
   * suppressed. When absent, the resolver falls back to the first sorted claim
   * (legacy behaviour) so existing callers stay compatible.
   */
  canonicalClaimId?: string | null;
  now?: number;
};

function getTask(
  db: DatabaseSync,
  taskId: string,
): {
  id: string;
  kbId: string;
  taskType: GovernanceTaskType;
  relatedChunkIds: string[];
  proposedResolution: unknown;
} | null {
  const row = db
    .prepare(
      `SELECT id, kb_id, task_type, related_chunk_ids, proposed_resolution FROM governance_tasks WHERE id = ?`,
    )
    .get(taskId) as
    | {
        id: string;
        kb_id: string;
        task_type: GovernanceTaskType;
        related_chunk_ids: string;
        proposed_resolution: string | null;
      }
    | undefined;
  if (!row) {
    return null;
  }
  let relatedChunkIds: string[] = [];
  try {
    const parsed = JSON.parse(row.related_chunk_ids) as unknown;
    relatedChunkIds = Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    relatedChunkIds = [];
  }
  return {
    id: row.id,
    kbId: row.kb_id,
    taskType: row.task_type,
    relatedChunkIds,
    proposedResolution: parseProposedResolution(row.proposed_resolution),
  };
}

function parseProposedResolution(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractClaimIds(proposedResolution: unknown): string[] {
  if (!proposedResolution || typeof proposedResolution !== "object") {
    return [];
  }
  const claimIds = (proposedResolution as { claimIds?: unknown }).claimIds;
  return Array.isArray(claimIds)
    ? claimIds.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function insertAnnotation(params: {
  db: DatabaseSync;
  taskId: string;
  expertId: string;
  action: GovernanceAnnotationAction;
  comment?: string | null;
  expertWeight: number;
  verificationLevel?: string | null;
  now: number;
}): void {
  params.db
    .prepare(
      `INSERT INTO governance_annotations (
         id, task_id, expert_id, action, comment, expert_weight, verification_level, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      params.taskId,
      params.expertId,
      params.action,
      params.comment ?? null,
      params.expertWeight,
      params.verificationLevel ?? null,
      params.now,
    );
}

function applyChunkStatuses(params: {
  db: DatabaseSync;
  kbId: string;
  chunkIds: string[];
  governanceStatus: "confirmed" | "suppressed" | "pending";
  trustScore?: number | null;
}): void {
  const stmt = params.db.prepare(
    `UPDATE chunk_governance
     SET governance_status = ?, trust_score = COALESCE(?, trust_score)
     WHERE kb_id = ? AND chunk_id = ?`,
  );
  for (const chunkId of params.chunkIds) {
    stmt.run(params.governanceStatus, params.trustScore ?? null, params.kbId, chunkId);
  }
}

function resolveDuplicateTask(params: {
  db: DatabaseSync;
  kbId: string;
  chunkIds: string[];
  status: GovernanceTaskStatus;
  expertWeight: number;
}): void {
  if (params.chunkIds.length === 0) {
    return;
  }
  if (params.status === "dismissed") {
    return;
  }
  const [canonical, ...duplicates] = params.chunkIds;
  applyChunkStatuses({
    db: params.db,
    kbId: params.kbId,
    chunkIds: [canonical],
    governanceStatus: "confirmed",
    trustScore: Math.min(1.2, params.expertWeight),
  });
  if (duplicates.length > 0) {
    applyChunkStatuses({
      db: params.db,
      kbId: params.kbId,
      chunkIds: duplicates,
      governanceStatus: "suppressed",
      trustScore: 0.5,
    });
  }
}

function resolveConflictTask(params: {
  db: DatabaseSync;
  kbId: string;
  chunkIds: string[];
  status: GovernanceTaskStatus;
  expertWeight: number;
}): void {
  if (params.status === "dismissed" || params.chunkIds.length === 0) {
    return;
  }
  applyChunkStatuses({
    db: params.db,
    kbId: params.kbId,
    chunkIds: params.chunkIds,
    governanceStatus: "confirmed",
    trustScore: Math.min(1.2, params.expertWeight),
  });
  params.db
    .prepare(
      `UPDATE chunk_governance SET conflict_group_id = NULL WHERE kb_id = ? AND chunk_id IN (${params.chunkIds.map(() => "?").join(", ")})`,
    )
    .run(params.kbId, ...params.chunkIds);
}

function resolveClaimConflictTask(params: {
  db: DatabaseSync;
  kbId: string;
  chunkIds: string[];
  status: GovernanceTaskStatus;
  proposedResolution: unknown;
  canonicalClaimId?: string | null;
}): void {
  if (params.status === "dismissed") {
    return;
  }
  const claimIds = extractClaimIds(params.proposedResolution);
  if (claimIds.length === 0) {
    return;
  }
  // Expert-selected truth wins; otherwise fall back to the first sorted claim so
  // legacy callers (no explicit choice) keep their existing behaviour.
  const chosen =
    params.canonicalClaimId && claimIds.includes(params.canonicalClaimId)
      ? params.canonicalClaimId
      : claimIds[0];
  const canonical = chosen;
  const suppressed = claimIds.filter((id) => id !== chosen);
  updateClaimGovernanceStatus({
    db: params.db,
    claimIds: [canonical],
    governanceStatus: "confirmed",
  });
  if (suppressed.length > 0) {
    updateClaimGovernanceStatus({
      db: params.db,
      claimIds: suppressed,
      governanceStatus: "suppressed",
    });
  }
  applyChunkStatuses({
    db: params.db,
    kbId: params.kbId,
    chunkIds: params.chunkIds,
    governanceStatus: "confirmed",
  });
}

export function resolveGovernanceTask(params: ResolveGovernanceTaskParams): boolean {
  const now = params.now ?? Date.now();
  const task = getTask(params.db, params.taskId);
  if (!task) {
    return false;
  }
  const authority = seedExpertAuthorityForResolver({
    db: params.db,
    expertId: params.expertId,
    grantedBy: params.expertId,
    domainScope: params.domainScope ?? task.kbId,
  });
  const expertWeight = resolveExpertWeight({
    db: params.db,
    expertId: params.expertId,
    domainScope: params.domainScope ?? task.kbId,
  });
  const action: GovernanceAnnotationAction =
    params.action ??
    (params.status === "dismissed" ? "dismiss" : params.status === "resolved" ? "confirm" : "edit");

  insertAnnotation({
    db: params.db,
    taskId: params.taskId,
    expertId: params.expertId,
    action,
    comment: params.comment,
    expertWeight,
    verificationLevel: authority.verificationLevel,
    now,
  });

  if (task.taskType === "duplicate") {
    resolveDuplicateTask({
      db: params.db,
      kbId: task.kbId,
      chunkIds: task.relatedChunkIds,
      status: params.status,
      expertWeight,
    });
  } else if (task.taskType === "conflict") {
    resolveConflictTask({
      db: params.db,
      kbId: task.kbId,
      chunkIds: task.relatedChunkIds,
      status: params.status,
      expertWeight,
    });
  } else if (task.taskType === "claim_conflict") {
    resolveClaimConflictTask({
      db: params.db,
      kbId: task.kbId,
      chunkIds: task.relatedChunkIds,
      status: params.status,
      proposedResolution: task.proposedResolution,
      canonicalClaimId: params.canonicalClaimId,
    });
  }

  const result = params.db
    .prepare(`UPDATE governance_tasks SET status = ?, updated_at = ? WHERE id = ?`)
    .run(params.status, now, params.taskId);
  if (result.changes === 0) {
    return false;
  }

  runQualityRefresh({
    db: params.db,
    kbId: task.kbId,
    chunkIds: task.relatedChunkIds,
    now,
  });
  return true;
}
