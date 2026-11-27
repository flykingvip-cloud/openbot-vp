import type { DatabaseSync } from "node:sqlite";
import { resolveEmployeeWorkbenchActor } from "../../employee-workbench-scope.js";
import type { GatewayClient } from "../../server-methods/types.js";
import { resolveKnowledgeSourceContext } from "../context.js";
import { listDeliverableArchiveKnowledgeBaseIds } from "../deliverables/archive-store.js";
import { listWorkspaceDeliverables } from "../deliverables/read-model.js";
import {
  listGovernanceTasks,
  sumReferenceCountsForChunks,
} from "../governance/chunk-governance-store.js";
import type { GovernanceTaskType } from "../governance/types.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "../kb-index.js";
import {
  authorizeKnowledgeBaseAccess,
  clientKnowledgeEmail,
  createKnowledgeBaseAccessCache,
} from "../knowledge-access-gate.js";
import { loadKnowledgeBundle, knowledgeRecommendationsFromBundle } from "../router.js";
import type {
  KnowledgeActionSuggestion,
  KnowledgeActionTrustLabel,
  KnowledgeActionType,
} from "./types.js";

function scoreToTrustLabel(score: number): KnowledgeActionTrustLabel {
  if (score >= 85) {
    return "high";
  }
  if (score >= 65) {
    return "medium";
  }
  return "low";
}

function governanceActionType(taskType: GovernanceTaskType): KnowledgeActionType {
  if (taskType === "duplicate") {
    return "merge_duplicate";
  }
  if (taskType === "conflict" || taskType === "claim_conflict") {
    return "review_conflict";
  }
  if (taskType === "stale") {
    return "update_knowledge";
  }
  return "open_governance";
}

function governanceActionTitle(taskType: GovernanceTaskType): string {
  if (taskType === "duplicate") {
    return "合并重复片段";
  }
  if (taskType === "claim_conflict") {
    return "确认事实说法";
  }
  if (taskType === "conflict") {
    return "复核知识冲突";
  }
  if (taskType === "stale") {
    return "更新过期知识";
  }
  return "处理孤儿片段";
}

function governanceActionReason(taskType: GovernanceTaskType): string {
  if (taskType === "duplicate") {
    return "治理引擎发现重复内容，合并后可提升检索质量";
  }
  if (taskType === "claim_conflict") {
    return "同一主题下存在不一致事实，需要专家确认";
  }
  if (taskType === "conflict") {
    return "冲突会污染 Agent 消费结果，建议尽快处理";
  }
  if (taskType === "stale") {
    return "片段新鲜度偏低，建议更新或抑制";
  }
  return "长期未被引用的片段可能影响图谱健康度";
}

function governanceTaskEvidenceLabel(taskType: GovernanceTaskType): string {
  if (taskType === "duplicate") {
    return "检测到重复片段";
  }
  if (taskType === "claim_conflict") {
    return "事实说法不一致";
  }
  if (taskType === "conflict") {
    return "片段内容冲突";
  }
  if (taskType === "stale") {
    return "片段新鲜度偏低";
  }
  return "孤儿片段待处理";
}

function buildGovernanceEvidence(params: {
  db: DatabaseSync;
  taskType: GovernanceTaskType;
  kbId: string;
  relatedChunkIds: string[];
}): string[] {
  const evidence: string[] = [governanceTaskEvidenceLabel(params.taskType)];
  const chunkCount = params.relatedChunkIds.length;
  if (chunkCount > 0) {
    evidence.push(`涉及 ${chunkCount} 个相关片段`);
  }
  evidence.push(`知识库 ${params.kbId}`);
  const citationTotal = sumReferenceCountsForChunks(params.db, params.relatedChunkIds);
  if (citationTotal > 0) {
    evidence.push(`相关片段累计被引用 ${citationTotal} 次`);
  }
  return evidence;
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

export function buildGovernanceActionSuggestions(params: {
  db: DatabaseSync;
  knowledgeBaseId?: string | null;
  limit: number;
}): KnowledgeActionSuggestion[] {
  const tasks = listGovernanceTasks({
    db: params.db,
    kbId: params.knowledgeBaseId ?? undefined,
    status: "open",
    limit: params.limit,
  });
  return tasks.map((task) => {
    const score = 90 - task.priority;
    return {
      actionId: `gov-action:${task.id}`,
      actionType: governanceActionType(task.taskType),
      title: governanceActionTitle(task.taskType),
      reason: governanceActionReason(task.taskType),
      score,
      context: {
        knowledgeBaseId: task.kbId,
        governanceTaskId: task.id,
      },
      executable: true,
      evidence: buildGovernanceEvidence({
        db: params.db,
        taskType: task.taskType,
        kbId: task.kbId,
        relatedChunkIds: task.relatedChunkIds,
      }),
      trustLabel: scoreToTrustLabel(score),
    };
  });
}

async function buildArchiveActionSuggestions(params: {
  client: GatewayClient | null;
  knowledgeBaseId?: string | null;
  deliverableId?: string | null;
  limit: number;
}): Promise<KnowledgeActionSuggestion[]> {
  const actor = await resolveEmployeeWorkbenchActor(params.client);
  if (!actor?.userId) {
    return [];
  }
  const archives = listDeliverableArchiveKnowledgeBaseIds();
  const { deliverables } = await listWorkspaceDeliverables({
    userId: actor.userId,
    groupIds: actor.seatSpaceIds,
    limit: 30,
  });
  return deliverables
    .filter((item) => {
      if (archives[item.deliverableId]) {
        return false;
      }
      if (params.deliverableId && item.deliverableId !== params.deliverableId) {
        return false;
      }
      return item.status === "approved" || item.status === "published";
    })
    .slice(0, params.limit)
    .map((item, index) => {
      const score = params.deliverableId ? 100 : 80 - index;
      return {
        actionId: `archive:${item.deliverableId}`,
        actionType: "archive_deliverable" as const,
        title: "归档成果到知识库",
        reason: `「${item.title}」已完成，沉淀后可进入 chunk 索引与 Agent 检索`,
        score,
        context: {
          deliverableId: item.deliverableId,
          knowledgeBaseId: params.knowledgeBaseId ?? undefined,
        },
        executable: true,
        evidence: [`成果「${item.title}」状态为 ${item.status}`, "归档后进入知识检索链路"],
        trustLabel: scoreToTrustLabel(score),
      };
    });
}

function buildRelationActionSuggestions(params: {
  focusObjectId?: string | null;
  knowledgeBaseId?: string | null;
  limit: number;
  client: GatewayClient | null;
}): Promise<KnowledgeActionSuggestion[]> {
  if (!params.focusObjectId) {
    return Promise.resolve([]);
  }
  return loadKnowledgeBundle(params.client).then((bundle) => {
    const recommendations = knowledgeRecommendationsFromBundle(bundle, {
      focusObjectId: params.focusObjectId,
      limit: params.limit,
    });
    return recommendations.map((item, index) => {
      const score = 55 - index;
      const targetTitle = item.object.title.trim();
      return {
        actionId: `relation:${params.focusObjectId}:${item.object.id}`,
        actionType: "establish_relation" as const,
        title: targetTitle ? `关联「${targetTitle}」` : "建立知识关联",
        reason: item.reason,
        score,
        context: {
          objectId: params.focusObjectId ?? undefined,
          targetObjectId: item.object.id,
          knowledgeBaseId: params.knowledgeBaseId ?? undefined,
        },
        executable: true,
        evidence: [item.reason, `推荐关联「${item.object.title}」`],
        trustLabel: scoreToTrustLabel(score),
      };
    });
  });
}

export async function buildKnowledgeActionSuggestions(params: {
  client: GatewayClient | null;
  knowledgeBaseId?: string | null;
  focusObjectId?: string | null;
  deliverableId?: string | null;
  limit?: number;
}): Promise<KnowledgeActionSuggestion[]> {
  const limit = Math.min(Math.max(params.limit ?? 4, 1), 12);
  const context = await resolveKnowledgeSourceContext(params.client);
  const email = clientKnowledgeEmail(params.client);
  if (!context.userId) {
    return [];
  }
  const requestedKbId = params.knowledgeBaseId?.trim() || null;
  if (requestedKbId) {
    const authorized = authorizeKnowledgeBaseAccess({
      knowledgeBaseId: requestedKbId,
      context,
      email,
      permission: "read",
    });
    if (!authorized) {
      return [];
    }
  }
  const canRead = createKnowledgeBaseAccessCache({
    context,
    email,
    permission: "read",
  });
  const governanceActions =
    (await withUserKnowledgeIndex(params.client, (db) =>
      buildGovernanceActionSuggestions({
        db,
        knowledgeBaseId: params.knowledgeBaseId,
        limit,
      }),
    )) ?? [];
  const archiveActions = await buildArchiveActionSuggestions({
    client: params.client,
    knowledgeBaseId: params.knowledgeBaseId,
    deliverableId: params.deliverableId,
    limit: Math.max(1, Math.floor(limit / 2)),
  });
  const relationActions = await buildRelationActionSuggestions({
    client: params.client,
    focusObjectId: params.focusObjectId,
    knowledgeBaseId: params.knowledgeBaseId,
    limit: Math.max(1, Math.floor(limit / 3)),
  });

  const merged = [...archiveActions, ...governanceActions, ...relationActions]
    .filter((action) => {
      const kbId = action.context?.knowledgeBaseId?.trim();
      if (!kbId) {
        // Suggestions that are not KB-scoped (e.g. deliverable-only) stay
        // if they were already produced under the caller's workbench scope.
        return !requestedKbId;
      }
      return canRead(kbId);
    })
    .toSorted((left, right) => right.score - left.score)
    .slice(0, limit);

  if (merged.length > 0) {
    return merged;
  }

  const bundle = await loadKnowledgeBundle(params.client);
  const fallback = knowledgeRecommendationsFromBundle(bundle, {
    focusObjectId: params.focusObjectId,
    limit,
  });
  return fallback.map((item, index) => {
    const score = 40 - index;
    const objectTitle = item.object.title.trim();
    return {
      actionId: `open:${item.object.id}`,
      actionType: "open_object" as const,
      // Surface the concrete knowledge title so the home ticker is actionable at a glance.
      title: objectTitle || "查看相关知识",
      reason: item.reason,
      score,
      context: {
        objectId: item.object.id,
        knowledgeBaseId: params.knowledgeBaseId ?? undefined,
      },
      executable: true,
      evidence: [item.reason],
      trustLabel: scoreToTrustLabel(score),
    };
  });
}
