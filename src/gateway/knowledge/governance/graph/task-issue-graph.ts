import type { DatabaseSync } from "node:sqlite";
import type { RelationshipEdgeType } from "../../types.js";
import { readChunkText } from "../chunk-governance-store.js";
import { listClaimsForChunks } from "../claims/claim-store.js";
import type { GovernanceTaskRecord, KnowledgeClaimRecord } from "../types.js";

export type GovernanceTaskIssueGraph = {
  graph: {
    nodes: Array<{
      id: string;
      kind: "knowledge-object";
      title: string;
      summary?: string;
      objectId?: string;
    }>;
    edges: Array<{
      sourceId: string;
      targetId: string;
      relationType: RelationshipEdgeType;
      score: number;
    }>;
  };
  claims: KnowledgeClaimRecord[];
  focusNodeId: string | null;
};

const CHUNK_NODE_PREFIX = "gov:chunk:";
const CLAIM_NODE_PREFIX = "gov:claim:";

function chunkNodeId(chunkId: string): string {
  return `${CHUNK_NODE_PREFIX}${chunkId}`;
}

function claimNodeId(claimId: string): string {
  return `${CLAIM_NODE_PREFIX}${claimId}`;
}

function mapChunkRelationType(relationType: string): RelationshipEdgeType {
  if (relationType === "conflict") {
    return "conflicts";
  }
  if (relationType === "reference") {
    return "supports";
  }
  return "related";
}

function mapClaimRelationType(relationType: string): RelationshipEdgeType {
  if (relationType === "conflict") {
    return "conflicts";
  }
  if (relationType === "supports") {
    return "supports";
  }
  return "related";
}

function summarizeChunkText(text: string): string {
  const line =
    text
      .split(/\n+/)
      .find((entry) => entry.trim().length > 0)
      ?.trim() ?? text.trim();
  return line.length > 72 ? `${line.slice(0, 69)}…` : line;
}

function extractClaimIds(task: GovernanceTaskRecord): string[] {
  const resolution = task.proposedResolution;
  if (!resolution || typeof resolution !== "object") {
    return [];
  }
  const claimIds = (resolution as { claimIds?: unknown }).claimIds;
  return Array.isArray(claimIds)
    ? claimIds.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function buildGovernanceTaskIssueGraph(params: {
  db: DatabaseSync;
  task: GovernanceTaskRecord;
}): GovernanceTaskIssueGraph {
  const chunkIds = [...new Set(params.task.relatedChunkIds)];
  const claims = listClaimsForChunks(params.db, chunkIds);
  const taskClaimIds = new Set(extractClaimIds(params.task));
  const scopedClaims =
    taskClaimIds.size > 0 ? claims.filter((claim) => taskClaimIds.has(claim.id)) : claims;

  const nodes = new Map<string, GovernanceTaskIssueGraph["graph"]["nodes"][number]>();
  const edges: GovernanceTaskIssueGraph["graph"]["edges"] = [];
  const edgeKeys = new Set<string>();

  const addEdge = (edge: GovernanceTaskIssueGraph["graph"]["edges"][number]) => {
    const key = `${edge.sourceId}:${edge.targetId}:${edge.relationType}`;
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);
    edges.push(edge);
  };

  for (const chunkId of chunkIds) {
    const text = readChunkText(params.db, chunkId) ?? chunkId;
    nodes.set(chunkNodeId(chunkId), {
      id: chunkNodeId(chunkId),
      kind: "knowledge-object",
      title: `Chunk ${chunkId.slice(-6)}`,
      summary: summarizeChunkText(text),
      objectId: chunkId,
    });
  }

  for (const claim of scopedClaims) {
    nodes.set(claimNodeId(claim.id), {
      id: claimNodeId(claim.id),
      kind: "knowledge-object",
      title: claim.subject,
      summary: claim.objectValue,
      objectId: claim.id,
    });
    addEdge({
      sourceId: chunkNodeId(claim.chunkId),
      targetId: claimNodeId(claim.id),
      relationType: "derived-from",
      score: 1,
    });
  }

  if (chunkIds.length > 0) {
    const placeholders = chunkIds.map(() => "?").join(", ");
    const chunkRelations = params.db
      .prepare(
        `SELECT from_chunk, to_chunk, relation_type, weight
         FROM chunk_relations
         WHERE kb_id = ? AND from_chunk IN (${placeholders}) AND to_chunk IN (${placeholders})`,
      )
      .all(params.task.kbId, ...chunkIds, ...chunkIds) as Array<{
      from_chunk: string;
      to_chunk: string;
      relation_type: string;
      weight: number | null;
    }>;
    for (const relation of chunkRelations) {
      if (
        !nodes.has(chunkNodeId(relation.from_chunk)) ||
        !nodes.has(chunkNodeId(relation.to_chunk))
      ) {
        continue;
      }
      addEdge({
        sourceId: chunkNodeId(relation.from_chunk),
        targetId: chunkNodeId(relation.to_chunk),
        relationType: mapChunkRelationType(relation.relation_type),
        score: relation.weight ?? 1,
      });
    }
  }

  const claimIds = scopedClaims.map((claim) => claim.id);
  if (claimIds.length > 0) {
    const placeholders = claimIds.map(() => "?").join(", ");
    const claimRelations = params.db
      .prepare(
        `SELECT from_claim, to_claim, relation_type, weight
         FROM claim_relations
         WHERE kb_id = ? AND from_claim IN (${placeholders}) AND to_claim IN (${placeholders})`,
      )
      .all(params.task.kbId, ...claimIds, ...claimIds) as Array<{
      from_claim: string;
      to_claim: string;
      relation_type: string;
      weight: number | null;
    }>;
    for (const relation of claimRelations) {
      if (
        !nodes.has(claimNodeId(relation.from_claim)) ||
        !nodes.has(claimNodeId(relation.to_claim))
      ) {
        continue;
      }
      addEdge({
        sourceId: claimNodeId(relation.from_claim),
        targetId: claimNodeId(relation.to_claim),
        relationType: mapClaimRelationType(relation.relation_type),
        score: relation.weight ?? 1,
      });
    }
  }

  let focusNodeId: string | null = null;
  if (scopedClaims.length > 0) {
    focusNodeId = claimNodeId(scopedClaims[0].id);
  } else if (chunkIds.length > 0) {
    focusNodeId = chunkNodeId(chunkIds[0]);
  }

  return {
    graph: {
      nodes: [...nodes.values()],
      edges,
    },
    claims: scopedClaims,
    focusNodeId,
  };
}
