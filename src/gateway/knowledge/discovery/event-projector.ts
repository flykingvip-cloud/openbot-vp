import type { DatabaseSync } from "node:sqlite";
import { resolveEmployeeWorkbenchActor } from "../../employee-workbench-scope.js";
import type { GatewayClient } from "../../server-methods/types.js";
import { resolveKnowledgeSourceContext } from "../context.js";
import { listDeliverableArchiveKnowledgeBaseIds } from "../deliverables/archive-store.js";
import { listWorkspaceDeliverables } from "../deliverables/read-model.js";
import {
  listGovernanceTasks,
  listFrequentlyCitedChunks,
  listRecentChunkRelations,
} from "../governance/chunk-governance-store.js";
import type { GovernanceTaskType } from "../governance/types.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "../kb-index.js";
import { listRecentKnowledgeLineageCommits } from "../knowledge-lineage-store.js";
import type { KnowledgeDiscoveryEvent, KnowledgeDiscoveryEventType } from "./types.js";

const DISCOVERY_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const FREQUENTLY_CITED_MIN_REFERENCES = 5;

function mapGovernanceTaskType(taskType: GovernanceTaskType): KnowledgeDiscoveryEventType {
  if (taskType === "duplicate") {
    return "new_duplicate";
  }
  if (taskType === "claim_conflict") {
    return "new_claim_conflict";
  }
  if (taskType === "stale") {
    return "stale_detected";
  }
  if (taskType === "orphan") {
    return "orphan_detected";
  }
  return "new_conflict";
}

function governanceEventTitle(taskType: GovernanceTaskType): string {
  if (taskType === "duplicate") {
    return "检测到重复知识片段";
  }
  if (taskType === "claim_conflict") {
    return "Claim 层事实冲突";
  }
  if (taskType === "stale") {
    return "知识片段可能过期";
  }
  if (taskType === "orphan") {
    return "发现孤儿知识片段";
  }
  return "发现知识冲突";
}

function governanceEventSummary(taskType: GovernanceTaskType, chunkCount: number): string {
  const suffix = chunkCount > 1 ? `，涉及 ${chunkCount} 个片段` : "";
  if (taskType === "duplicate") {
    return `治理引擎标记了可能重复的内容${suffix}`;
  }
  if (taskType === "claim_conflict") {
    return `同一主题下出现不一致的事实断言${suffix}`;
  }
  if (taskType === "stale") {
    return `长期未更新且新鲜度偏低的片段需要复核${suffix}`;
  }
  if (taskType === "orphan") {
    return `长期未被引用且缺少上下文关联的片段${suffix}`;
  }
  return `同一主题下出现不一致结论${suffix}`;
}

export function projectGovernanceDiscoveryEvents(
  db: DatabaseSync,
  sinceMs: number,
): KnowledgeDiscoveryEvent[] {
  const tasks = listGovernanceTasks({ db, status: "open", limit: 40 });
  return tasks
    .filter((task) => task.createdAt >= sinceMs || task.updatedAt >= sinceMs)
    .map((task) => ({
      eventId: `gov:${task.id}`,
      eventType: mapGovernanceTaskType(task.taskType),
      eventSource: "governance" as const,
      title: governanceEventTitle(task.taskType),
      summary: governanceEventSummary(task.taskType, task.relatedChunkIds.length),
      timestamp: task.updatedAt || task.createdAt,
      relatedKnowledge: {
        kbId: task.kbId,
        governanceTaskId: task.id,
        chunkIds: task.relatedChunkIds,
      },
    }));
}

export function projectLineageDiscoveryEvents(
  db: DatabaseSync,
  sinceMs: number,
): KnowledgeDiscoveryEvent[] {
  return listRecentKnowledgeLineageCommits(db, { limit: 20, sinceMs }).map((record) => ({
    eventId: `lineage:${record.lineageId}:commit`,
    eventType: "knowledge_committed" as const,
    eventSource: "lineage" as const,
    title: "成果已沉淀到知识库",
    summary: record.deliverableId
      ? `成果 ${record.deliverableId} 已进入 chunk 索引与检索 runtime`
      : "新知识已写入索引并可供 Agent 消费",
    timestamp: record.updatedAt || record.createdAt,
    relatedKnowledge: {
      kbId: record.sourceKnowledgeBaseIds[0],
      deliverableId: record.deliverableId ?? undefined,
      chunkIds: record.sourceChunkIds,
    },
  }));
}

function projectRelationDiscoveryEvents(
  db: DatabaseSync,
  sinceMs: number,
): KnowledgeDiscoveryEvent[] {
  return listRecentChunkRelations(db, { limit: 20, sinceMs })
    .filter((relation) => relation.relationType !== "duplicate")
    .map((relation) => ({
      eventId: `relation:${relation.id}`,
      eventType: "new_relation" as const,
      eventSource: "relation" as const,
      title:
        relation.relationType === "conflict" ? "chunk 之间形成冲突关联" : "chunk 之间建立新关联",
      summary:
        relation.relationType === "conflict"
          ? "关系图谱新增冲突边，建议进入治理中心确认"
          : "关系图谱新增引用/关联边，可进一步建立知识连接",
      timestamp: relation.createdAt,
      relatedKnowledge: {
        kbId: relation.kbId,
        relationId: relation.id,
        relationType: relation.relationType,
        chunkIds: [relation.fromChunk, relation.toChunk],
      },
    }));
}

export function projectUsageDiscoveryEvents(
  db: DatabaseSync,
  sinceMs: number,
): KnowledgeDiscoveryEvent[] {
  return listFrequentlyCitedChunks(db, {
    minReferenceCount: FREQUENTLY_CITED_MIN_REFERENCES,
    sinceMs,
    limit: 20,
  }).map((chunk) => ({
    eventId: `usage:${chunk.chunkId}`,
    eventType: "frequently_cited" as const,
    eventSource: "usage" as const,
    title: "知识被高频引用",
    summary: `该片段近期被检索引用 ${chunk.referenceCount} 次，已成为热点知识，可考虑确认或建立更多关联`,
    timestamp: chunk.lastHitAt ?? Date.now(),
    relatedKnowledge: {
      kbId: chunk.kbId,
      chunkIds: [chunk.chunkId],
      referenceCount: chunk.referenceCount,
    },
  }));
}

async function projectDeliverableDiscoveryEvents(params: {
  userId: string;
  groupIds?: string[];
  sinceMs: number;
}): Promise<KnowledgeDiscoveryEvent[]> {
  const archives = listDeliverableArchiveKnowledgeBaseIds();
  const { deliverables } = await listWorkspaceDeliverables({
    userId: params.userId,
    groupIds: params.groupIds,
    limit: 40,
  });
  return deliverables
    .filter((item) => {
      if (archives[item.deliverableId]) {
        return false;
      }
      return item.status === "approved" || item.status === "published";
    })
    .filter((item) => item.updatedAtMs >= params.sinceMs)
    .map((item) => ({
      eventId: `deliverable:${item.deliverableId}`,
      eventType: "deliverable_completed" as const,
      eventSource: "deliverable" as const,
      title: "工作成果待沉淀",
      summary: `「${item.title}」已完成，可归档进知识库供 Agent 长期消费`,
      timestamp: item.updatedAtMs,
      relatedKnowledge: {
        deliverableId: item.deliverableId,
        taskId: item.taskId,
      },
    }));
}

async function withUserKnowledgeIndex<T>(
  client: GatewayClient | null,
  fn: (db: DatabaseSync) => T | Promise<T>,
): Promise<T | null> {
  const context = await resolveKnowledgeSourceContext(client);
  if (!context.userId) {
    return null;
  }
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: context.userId,
    tenantId: context.tenantId,
  });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    return await fn(index.db);
  } finally {
    index.close();
  }
}

export async function listKnowledgeDiscoveryEvents(params: {
  client: GatewayClient | null;
  limit?: number;
  lookbackMs?: number;
}): Promise<KnowledgeDiscoveryEvent[]> {
  const limit = Math.min(Math.max(params.limit ?? 8, 1), 40);
  const sinceMs = Date.now() - (params.lookbackMs ?? DISCOVERY_LOOKBACK_MS);
  const context = await resolveKnowledgeSourceContext(params.client);
  if (!context.userId) {
    return [];
  }

  const indexEvents =
    (await withUserKnowledgeIndex(params.client, async (db) => [
      ...projectGovernanceDiscoveryEvents(db, sinceMs),
      ...projectLineageDiscoveryEvents(db, sinceMs),
      ...projectRelationDiscoveryEvents(db, sinceMs),
      ...projectUsageDiscoveryEvents(db, sinceMs),
    ])) ?? [];

  const actor = await resolveEmployeeWorkbenchActor(params.client);
  const deliverableEvents = await projectDeliverableDiscoveryEvents({
    userId: context.userId,
    groupIds: actor?.seatSpaceIds,
    sinceMs,
  });

  return [...indexEvents, ...deliverableEvents]
    .toSorted((left, right) => right.timestamp - left.timestamp)
    .slice(0, limit);
}
