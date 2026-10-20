import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  assignDuplicateGroup,
  createGovernanceTask,
  ensureChunkGovernanceRows,
  findChunkIdsBySemanticHash,
  insertChunkRelation,
  readChunkText,
  readExistingDuplicateGroupId,
  upsertChunkSemanticHash,
} from "../chunk-governance-store.js";
import type { GovernanceResourceBudget } from "../runtime/job-resource-budget.js";
import { computeChunkSemanticHash } from "../semantic-hash.js";
import { recallApproximateDuplicatePeers } from "./chunk-peer-recall.js";

export type DuplicateDetectionResult = {
  duplicateGroups: number;
  relationsCreated: number;
  tasksCreated: number;
  similarityQueries: number;
};

function duplicateGroupKey(members: string[]): string {
  return members.toSorted().join(":");
}

function hasOpenDuplicateTask(db: DatabaseSync, kbId: string, members: string[]): boolean {
  const key = duplicateGroupKey(members);
  const rows = db
    .prepare(
      `SELECT related_chunk_ids FROM governance_tasks
       WHERE kb_id = ? AND task_type = 'duplicate' AND status = 'open'`,
    )
    .all(kbId) as Array<{ related_chunk_ids: string }>;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.related_chunk_ids) as unknown;
      const ids = Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string")
        : [];
      if (duplicateGroupKey(ids) === key) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

export function runDuplicateDetection(params: {
  db: DatabaseSync;
  kbId: string;
  chunkIds: string[];
  resourceBudget?: GovernanceResourceBudget;
}): DuplicateDetectionResult {
  ensureChunkGovernanceRows({ db: params.db, kbId: params.kbId, chunkIds: params.chunkIds });
  let duplicateGroups = 0;
  let relationsCreated = 0;
  let tasksCreated = 0;
  const reportedGroups = new Set<string>();
  const similarityQueriesBefore = params.resourceBudget?.similarityQueriesUsed ?? 0;

  for (const chunkId of params.chunkIds) {
    const text = readChunkText(params.db, chunkId);
    if (!text) {
      continue;
    }
    const semanticHash = computeChunkSemanticHash(text);
    upsertChunkSemanticHash({
      db: params.db,
      kbId: params.kbId,
      chunkId,
      semanticHash,
    });
    const matches = new Set(
      findChunkIdsBySemanticHash({
        db: params.db,
        kbId: params.kbId,
        semanticHash,
        excludeChunkId: chunkId,
      }),
    );
    for (const peer of recallApproximateDuplicatePeers({
      db: params.db,
      kbId: params.kbId,
      chunkId,
      text,
      budget: params.resourceBudget
        ? {
            maxSimilarityQueries: params.resourceBudget.maxSimilarityQueries,
            similarityQueriesUsed: params.resourceBudget.similarityQueriesUsed,
          }
        : undefined,
    })) {
      matches.add(peer.chunkId);
    }
    if (matches.size === 0) {
      continue;
    }
    const groupMembers = [chunkId, ...matches];
    const reportKey = duplicateGroupKey(groupMembers);
    if (reportedGroups.has(reportKey)) {
      continue;
    }
    reportedGroups.add(reportKey);

    const existingGroupId = groupMembers
      .map((memberId) => readExistingDuplicateGroupId(params.db, params.kbId, memberId))
      .find((groupId): groupId is string => Boolean(groupId));
    const groupId = existingGroupId ?? randomUUID();
    assignDuplicateGroup({
      db: params.db,
      kbId: params.kbId,
      chunkIds: groupMembers,
      duplicateGroupId: groupId,
    });
    duplicateGroups += 1;
    if (!hasOpenDuplicateTask(params.db, params.kbId, groupMembers)) {
      createGovernanceTask({
        db: params.db,
        kbId: params.kbId,
        taskType: "duplicate",
        relatedChunkIds: groupMembers,
        priority: 10,
        proposedResolution: { action: "review_duplicate", duplicateGroupId: groupId },
      });
      tasksCreated += 1;
    }
    for (const matchId of matches) {
      insertChunkRelation({
        db: params.db,
        kbId: params.kbId,
        fromChunk: chunkId,
        toChunk: matchId,
        relationType: "duplicate",
        weight: 1,
      });
      relationsCreated += 1;
    }
  }

  const similarityQueries =
    (params.resourceBudget?.similarityQueriesUsed ?? 0) - similarityQueriesBefore;
  return { duplicateGroups, relationsCreated, tasksCreated, similarityQueries };
}
