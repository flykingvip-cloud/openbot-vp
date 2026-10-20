import type { DatabaseSync } from "node:sqlite";
import { listGovernanceTasks } from "../governance/chunk-governance-store.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "../kb-index.js";
import { resolveDeliverableDocumentId } from "./attach.js";
import type { WorkspaceArtifactGovernanceStatus, WorkspaceDeliverable } from "./types.js";

export type DeliverableGovernanceClassification = {
  status: WorkspaceArtifactGovernanceStatus;
  /** True when a KB `stale` governance task overlaps the deliverable's chunks (过时信号). */
  stale: boolean;
};

/**
 * Pure governance classifier for an archived deliverable, given the governance tasks that
 * already overlap its chunks. Kept DB-free so it is unit-testable:
 *   - conflict / claim_conflict  → status "conflict"
 *   - any other open task OR a pending governance chunk → status "pending"
 *   - none → "verified"
 * `stale` is orthogonal: a matured deliverable can be verified-but-stale or conflict-and-stale,
 * so it is surfaced independently of `status` when a `stale` task touches the chunks.
 */
export function classifyDeliverableGovernance(params: {
  hasChunks: boolean;
  overlappingTaskTypes: string[];
  hasPendingGovernanceChunk: boolean;
}): DeliverableGovernanceClassification {
  if (!params.hasChunks) {
    return { status: "pending", stale: false };
  }
  let hasConflict = false;
  let hasOpenGovernance = false;
  let hasStale = false;
  for (const taskType of params.overlappingTaskTypes) {
    if (taskType === "conflict" || taskType === "claim_conflict") {
      hasConflict = true;
    } else {
      hasOpenGovernance = true;
    }
    if (taskType === "stale") {
      hasStale = true;
    }
  }
  const status: WorkspaceArtifactGovernanceStatus = hasConflict
    ? "conflict"
    : hasOpenGovernance || params.hasPendingGovernanceChunk
      ? "pending"
      : "verified";
  return { status, stale: hasStale };
}

export function resolveIndexedDeliverableGovernance(
  db: DatabaseSync,
  params: { kbId: string; docId: string },
): DeliverableGovernanceClassification {
  const chunkRows = db
    .prepare(`SELECT chunk_id FROM chunk_meta WHERE kb_id = ? AND doc_id = ?`)
    .all(params.kbId, params.docId) as Array<{ chunk_id: string }>;
  if (chunkRows.length === 0) {
    return classifyDeliverableGovernance({
      hasChunks: false,
      overlappingTaskTypes: [],
      hasPendingGovernanceChunk: false,
    });
  }
  const chunkIds = new Set(chunkRows.map((row) => row.chunk_id));
  const openTasks = listGovernanceTasks({ db, status: "open", limit: 200, kbId: params.kbId });
  const overlappingTaskTypes = openTasks
    .filter((task) => task.relatedChunkIds.some((chunkId) => chunkIds.has(chunkId)))
    .map((task) => task.taskType);
  const pendingRow = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM chunk_governance cg
       JOIN chunk_meta m ON m.chunk_id = cg.chunk_id
       WHERE m.kb_id = ? AND m.doc_id = ? AND cg.governance_status = 'pending'`,
    )
    .get(params.kbId, params.docId) as { count: number };
  return classifyDeliverableGovernance({
    hasChunks: true,
    overlappingTaskTypes,
    hasPendingGovernanceChunk: pendingRow.count > 0,
  });
}

/** @deprecated Prefer {@link resolveIndexedDeliverableGovernance}; kept for back-compat. */
export function resolveIndexedDeliverableGovernanceStatus(
  db: DatabaseSync,
  params: { kbId: string; docId: string },
): WorkspaceArtifactGovernanceStatus {
  return resolveIndexedDeliverableGovernance(db, params).status;
}

export async function applyRuntimeGovernanceToDeliverables(params: {
  deliverables: WorkspaceDeliverable[];
  ownerId: string;
  tenantId: string | null;
  indexRoot?: string;
}): Promise<WorkspaceDeliverable[]> {
  const archived = params.deliverables.filter((item) => item.relatedKnowledgeBaseId?.trim());
  if (archived.length === 0) {
    return params.deliverables;
  }
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.ownerId,
    tenantId: params.tenantId,
    indexRoot: params.indexRoot,
  });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    const classificationByDeliverableId = new Map<string, DeliverableGovernanceClassification>();
    for (const item of archived) {
      const kbId = item.relatedKnowledgeBaseId?.trim();
      if (!kbId) {
        continue;
      }
      const docId = resolveDeliverableDocumentId(item.deliverableId);
      if (!docId) {
        continue;
      }
      classificationByDeliverableId.set(
        item.deliverableId,
        resolveIndexedDeliverableGovernance(index.db, { kbId, docId }),
      );
    }
    return params.deliverables.map((item) => {
      const runtime = classificationByDeliverableId.get(item.deliverableId);
      if (!runtime) {
        return item;
      }
      return {
        ...item,
        governanceStatus: runtime.status,
        stale: runtime.stale,
      };
    });
  } finally {
    index.close();
  }
}
