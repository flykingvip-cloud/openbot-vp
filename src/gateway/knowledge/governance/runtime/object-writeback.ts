import type { DatabaseSync } from "node:sqlite";
import type { KnowledgeObject } from "../../types.js";
import { listGovernanceTasks } from "../chunk-governance-store.js";

export type DocumentGovernanceOverlay = {
  openConflictCount: number;
  openDuplicateCount: number;
  openOrphanCount: number;
  suppressedChunkCount: number;
  confirmedChunkCount: number;
};

function emptyOverlay(): DocumentGovernanceOverlay {
  return {
    openConflictCount: 0,
    openDuplicateCount: 0,
    openOrphanCount: 0,
    suppressedChunkCount: 0,
    confirmedChunkCount: 0,
  };
}

function mergeOverlay(
  target: DocumentGovernanceOverlay,
  source: DocumentGovernanceOverlay,
): DocumentGovernanceOverlay {
  return {
    openConflictCount: target.openConflictCount + source.openConflictCount,
    openDuplicateCount: target.openDuplicateCount + source.openDuplicateCount,
    openOrphanCount: target.openOrphanCount + source.openOrphanCount,
    suppressedChunkCount: target.suppressedChunkCount + source.suppressedChunkCount,
    confirmedChunkCount: target.confirmedChunkCount + source.confirmedChunkCount,
  };
}

export function loadDocumentGovernanceOverlay(
  db: DatabaseSync,
): Map<string, DocumentGovernanceOverlay> {
  const chunkToKnowledgeBase = new Map<string, string>();
  const docRows = db.prepare(`SELECT chunk_id, kb_id FROM chunk_meta`).all() as Array<{
    chunk_id: string;
    kb_id: string;
  }>;
  for (const row of docRows) {
    chunkToKnowledgeBase.set(row.chunk_id, row.kb_id);
  }

  const map = new Map<string, DocumentGovernanceOverlay>();
  const applyForKnowledgeBase = (
    knowledgeBaseId: string,
    patch: Partial<DocumentGovernanceOverlay>,
  ) => {
    const key = `obj:kb:${knowledgeBaseId.trim()}`;
    if (key === "obj:kb:") {
      return;
    }
    const merged = emptyOverlay();
    Object.assign(merged, patch);
    map.set(key, mergeOverlay(map.get(key) ?? emptyOverlay(), merged));
  };

  const openTasks = listGovernanceTasks({ db, status: "open", limit: 200 });
  for (const task of openTasks) {
    const knowledgeBaseIds = new Set<string>();
    for (const chunkId of task.relatedChunkIds) {
      const knowledgeBaseId = chunkToKnowledgeBase.get(chunkId);
      if (knowledgeBaseId) {
        knowledgeBaseIds.add(knowledgeBaseId);
      }
    }
    for (const knowledgeBaseId of knowledgeBaseIds) {
      if (task.taskType === "conflict") {
        applyForKnowledgeBase(knowledgeBaseId, { openConflictCount: 1 });
      } else if (task.taskType === "duplicate") {
        applyForKnowledgeBase(knowledgeBaseId, { openDuplicateCount: 1 });
      } else if (task.taskType === "orphan") {
        applyForKnowledgeBase(knowledgeBaseId, { openOrphanCount: 1 });
      }
    }
  }

  const statusRows = db
    .prepare(
      `SELECT m.kb_id, cg.governance_status, COUNT(*) AS count
       FROM chunk_governance cg
       JOIN chunk_meta m ON m.chunk_id = cg.chunk_id
       WHERE cg.governance_status IN ('suppressed', 'confirmed')
       GROUP BY m.kb_id, cg.governance_status`,
    )
    .all() as Array<{ kb_id: string; governance_status: string; count: number }>;
  for (const row of statusRows) {
    if (row.governance_status === "suppressed") {
      applyForKnowledgeBase(row.kb_id, { suppressedChunkCount: row.count });
    } else if (row.governance_status === "confirmed") {
      applyForKnowledgeBase(row.kb_id, { confirmedChunkCount: row.count });
    }
  }

  return map;
}

export function applyDocumentGovernanceOverlay(
  objects: KnowledgeObject[],
  overlay: Map<string, DocumentGovernanceOverlay>,
): KnowledgeObject[] {
  if (overlay.size === 0) {
    return objects;
  }
  return objects.map((object) => {
    const stats = overlay.get(object.id);
    if (!stats) {
      return object;
    }
    const existing = object.relationshipSummary ?? {
      relatedCount: 0,
      conflictCount: 0,
      supportingCount: 0,
    };
    return {
      ...object,
      relationshipSummary: {
        ...existing,
        conflictCount: stats.openConflictCount,
        supportingCount: Math.max(existing.supportingCount, stats.confirmedChunkCount),
      },
    };
  });
}

export function suppressResolvedConflictEdges<
  T extends { relationType: string; sourceId: string; targetId: string },
>(edges: T[], objects: KnowledgeObject[]): T[] {
  const conflictFree = new Set(
    objects
      .filter((object) => (object.relationshipSummary?.conflictCount ?? 0) === 0)
      .map((object) => object.id),
  );
  if (conflictFree.size === 0) {
    return edges;
  }
  return edges.filter((edge) => {
    if (edge.relationType !== "conflicts") {
      return true;
    }
    const sourceObjectId = edge.sourceId.replace(/^node:/, "");
    const targetObjectId = edge.targetId.replace(/^node:/, "");
    if (conflictFree.has(sourceObjectId) && conflictFree.has(targetObjectId)) {
      return false;
    }
    return true;
  });
}
