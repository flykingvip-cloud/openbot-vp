import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  assignConflictGroup,
  createGovernanceTask,
  ensureChunkGovernanceRows,
  insertChunkRelation,
  readChunkText,
  readExistingConflictGroupId,
} from "../chunk-governance-store.js";
import type { GovernanceResourceBudget } from "../runtime/job-resource-budget.js";
import { type ChunkConflictLlmClient, recallScoreEligibleForLlm } from "./chunk-conflict-llm.js";
import { recallChunkPeers } from "./chunk-peer-recall.js";
import type { ChunkPeerRecallBudget } from "./chunk-peer-recall.js";

const CONFLICT_MARKERS: Array<[string, string]> = [
  ["增长", "下降"],
  ["上升", "下滑"],
  ["通过", "否决"],
  ["允许", "禁止"],
  ["必须", "禁止"],
  ["可以", "不得"],
];

export type ConflictDetectionResult = {
  conflictPairs: number;
  relationsCreated: number;
  tasksCreated: number;
  similarityQueries: number;
  llmCalls: number;
  llmPairsDeferred: number;
};

function hasConflictSignal(leftText: string, rightText: string): string | null {
  const left = leftText.toLowerCase();
  const right = rightText.toLowerCase();
  for (const [a, b] of CONFLICT_MARKERS) {
    if ((left.includes(a) && right.includes(b)) || (left.includes(b) && right.includes(a))) {
      return `${a}/${b}`;
    }
  }
  return null;
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  find(id: string): string {
    const current = this.parent.get(id) ?? id;
    if (current !== id) {
      const root = this.find(current);
      this.parent.set(id, root);
      return root;
    }
    this.parent.set(id, id);
    return id;
  }

  union(left: string, right: string): void {
    const rootLeft = this.find(left);
    const rootRight = this.find(right);
    if (rootLeft !== rootRight) {
      this.parent.set(rootRight, rootLeft);
    }
  }

  groups(): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      const bucket = grouped.get(root) ?? [];
      bucket.push(id);
      grouped.set(root, bucket);
    }
    return grouped;
  }

  add(id: string): void {
    this.find(id);
  }
}

function resolveConflictGroupId(params: {
  db: DatabaseSync;
  kbId: string;
  chunkIds: string[];
}): string {
  for (const chunkId of params.chunkIds) {
    const existing = readExistingConflictGroupId(params.db, params.kbId, chunkId);
    if (existing) {
      return existing;
    }
  }
  return randomUUID();
}

function hasOpenChunkConflictTask(db: DatabaseSync, kbId: string, chunkIds: string[]): boolean {
  const key = chunkIds.toSorted().join(":");
  const rows = db
    .prepare(
      `SELECT related_chunk_ids FROM governance_tasks
       WHERE kb_id = ? AND task_type = 'conflict' AND status = 'open'`,
    )
    .all(kbId) as Array<{ related_chunk_ids: string }>;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.related_chunk_ids) as unknown;
      const ids = Array.isArray(parsed)
        ? parsed
            .filter((entry): entry is string => typeof entry === "string")
            .toSorted()
            .join(":")
        : "";
      if (ids === key) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

type PeerCandidate = {
  chunkId: string;
  text: string;
  recallScore: number;
  recallSource: "vector" | "fts";
};

export async function runConflictDetection(params: {
  db: DatabaseSync;
  kbId: string;
  chunkIds: string[];
  resourceBudget?: GovernanceResourceBudget;
  llmClient?: ChunkConflictLlmClient | null;
}): Promise<ConflictDetectionResult> {
  ensureChunkGovernanceRows({ db: params.db, kbId: params.kbId, chunkIds: params.chunkIds });
  const peerBudget: ChunkPeerRecallBudget | undefined = params.resourceBudget
    ? {
        maxSimilarityQueries: params.resourceBudget.maxSimilarityQueries,
        similarityQueriesUsed: params.resourceBudget.similarityQueriesUsed,
      }
    : undefined;
  const similarityQueriesBefore = peerBudget?.similarityQueriesUsed ?? 0;
  let llmCalls = 0;
  let llmPairsDeferred = 0;
  let llmCallsRemaining = params.resourceBudget?.llmCallsRemaining ?? 0;

  const texts = new Map<string, string>();
  for (const chunkId of params.chunkIds) {
    const text = readChunkText(params.db, chunkId);
    if (text) {
      texts.set(chunkId, text);
    }
  }

  const union = new UnionFind();
  const pairReasons = new Map<string, string>();
  let conflictPairs = 0;
  const llmCandidates: Array<{
    chunkId: string;
    peer: PeerCandidate;
    pairKey: string;
  }> = [];
  const evaluatedPairs = new Set<string>();

  for (const [chunkId, text] of texts) {
    union.add(chunkId);
    const peers = recallChunkPeers({
      db: params.db,
      kbId: params.kbId,
      chunkId,
      text,
      budget: peerBudget,
    });
    for (const peer of peers) {
      if (peer.chunkId === chunkId) {
        continue;
      }
      const pairKey = [chunkId, peer.chunkId].toSorted().join(":");
      if (evaluatedPairs.has(pairKey)) {
        continue;
      }
      evaluatedPairs.add(pairKey);

      const markerReason = hasConflictSignal(text, peer.text);
      if (markerReason) {
        conflictPairs += 1;
        union.union(chunkId, peer.chunkId);
        pairReasons.set(pairKey, markerReason);
        insertChunkRelation({
          db: params.db,
          kbId: params.kbId,
          fromChunk: chunkId,
          toChunk: peer.chunkId,
          relationType: "conflict",
          weight: Math.max(0.5, peer.recallScore),
        });
        continue;
      }

      if (
        params.llmClient &&
        llmCallsRemaining > 0 &&
        recallScoreEligibleForLlm({
          recallScore: peer.recallScore,
          recallSource: peer.recallSource,
        })
      ) {
        llmCandidates.push({ chunkId, peer, pairKey });
      }
    }
  }

  llmCandidates.sort((left, right) => right.peer.recallScore - left.peer.recallScore);

  for (const candidate of llmCandidates) {
    if (!params.llmClient) {
      continue;
    }
    if (llmCallsRemaining <= 0) {
      llmPairsDeferred += 1;
      continue;
    }

    const leftText = texts.get(candidate.chunkId);
    if (!leftText) {
      continue;
    }

    llmCallsRemaining -= 1;
    llmCalls += 1;
    const verdict = await params.llmClient.judgePair({
      leftText,
      rightText: candidate.peer.text,
    });
    if (!verdict?.contradicts) {
      continue;
    }

    conflictPairs += 1;
    union.union(candidate.chunkId, candidate.peer.chunkId);
    pairReasons.set(candidate.pairKey, `llm:${verdict.reason || "contradiction"}`);
    insertChunkRelation({
      db: params.db,
      kbId: params.kbId,
      fromChunk: candidate.chunkId,
      toChunk: candidate.peer.chunkId,
      relationType: "conflict",
      weight: Math.max(0.5, candidate.peer.recallScore),
    });
  }

  let relationsCreated = conflictPairs;
  let tasksCreated = 0;
  for (const members of union.groups().values()) {
    if (members.length < 2) {
      continue;
    }
    const chunkGroup = [...new Set(members)].toSorted();
    const groupId = resolveConflictGroupId({
      db: params.db,
      kbId: params.kbId,
      chunkIds: chunkGroup,
    });
    assignConflictGroup({
      db: params.db,
      kbId: params.kbId,
      chunkIds: chunkGroup,
      conflictGroupId: groupId,
    });
    if (!hasOpenChunkConflictTask(params.db, params.kbId, chunkGroup)) {
      let reason = "marker_conflict";
      let detectionMethod: "llm" | "marker" = "marker";
      for (const [pairKey, pairReason] of pairReasons) {
        const [left, right] = pairKey.split(":");
        if (left && right && chunkGroup.includes(left) && chunkGroup.includes(right)) {
          if (pairReason.startsWith("llm:")) {
            detectionMethod = "llm";
            reason = pairReason.slice(4);
          } else {
            reason = pairReason;
          }
          break;
        }
      }
      createGovernanceTask({
        db: params.db,
        kbId: params.kbId,
        taskType: "conflict",
        relatedChunkIds: chunkGroup,
        priority: 20,
        proposedResolution: {
          action: "review_conflict",
          reason,
          conflictGroupId: groupId,
          detectionMethod,
        },
      });
      tasksCreated += 1;
    }
  }

  const similarityQueries = (peerBudget?.similarityQueriesUsed ?? 0) - similarityQueriesBefore;

  return {
    conflictPairs,
    relationsCreated,
    tasksCreated,
    similarityQueries,
    llmCalls,
    llmPairsDeferred,
  };
}
