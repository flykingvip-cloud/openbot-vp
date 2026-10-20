import type { DatabaseSync } from "node:sqlite";
import type { CollaborationMember, Deliverable, Task } from "@openbot/collaboration-core";
import { listAgentIds } from "../../../agents/agent-scope.js";
import { loadConfig } from "../../../config/config.js";
import {
  createWorkspaceCollaborationStores,
  listWorkspaceCollaborationGroupIds,
} from "../../collaboration-learning/shared.js";
import { getPersonalSkillAssetDetail } from "../../skill-lifecycle-store.js";
import { KB_CHUNK_META_TABLE } from "../kb-index-schema.js";
import {
  getKnowledgeChunkText,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
  getKnowledgeDocument,
} from "../kb-index.js";
import { resolveKnowledgeIngestEmbeddingProvider } from "../kb-ingest.js";
import { retrieveKnowledgeFromIndex } from "../kb-retrieve.js";
import { getKnowledgeBase } from "../knowledge-base-store.js";
import {
  listGenerationLineageForKnowledgeBase,
  listKnowledgeLineageByDeliverable,
  listKnowledgeLineageByLineageId,
} from "../knowledge-lineage-store.js";
import { getDeliverableArchiveKnowledgeBaseId } from "./archive-store.js";
import { enrichWorkspaceDeliverableArtifactFields } from "./artifact-fields.js";
import { resolveDeliverableDocumentId } from "./attach.js";
import {
  resolveConfiguredAgentDisplayName,
  resolveMemberDisplayLabel,
  resolvePrimaryCreatorDisplayName,
} from "./creator-display.js";
import {
  type DownstreamDeliverableLink,
  resolveDownstreamDeliverableLinks,
} from "./downstream-runtime.js";
import type {
  GetWorkspaceDeliverableTraceParams,
  GetWorkspaceDeliverableTraceResult,
  WorkspaceDeliverable,
  WorkspaceDeliverableCitedKnowledge,
  WorkspaceDeliverableDownstreamLink,
  WorkspaceDeliverableKind,
  WorkspaceDeliverableModelUsage,
  WorkspaceDeliverableTraceStep,
} from "./types.js";

function inferDeliverableKind(title: string, contentType?: string): WorkspaceDeliverableKind {
  const haystack = `${title} ${contentType ?? ""}`.toLowerCase();
  if (/(ppt|slides|deck|演示)/i.test(haystack)) {
    return "ppt";
  }
  if (/(proposal|方案|建议书)/i.test(haystack)) {
    return "proposal";
  }
  if (/(analysis|分析|洞察)/i.test(haystack)) {
    return "analysis";
  }
  if (/(meeting|会议|纪要)/i.test(haystack)) {
    return "meeting";
  }
  if (/(report|报告|总结|复盘)/i.test(haystack)) {
    return "report";
  }
  return "other";
}

function isActiveMember(member: CollaborationMember, userId: string): boolean {
  if (member.status !== "active" && member.status !== "invited") {
    return false;
  }
  return member.userId === userId;
}

function pushStep(
  steps: WorkspaceDeliverableTraceStep[],
  step: Omit<WorkspaceDeliverableTraceStep, "id"> & { id?: string },
): void {
  steps.push({
    id: step.id ?? `step-${steps.length + 1}`,
    kind: step.kind,
    title: step.title,
    description: step.description,
    actorName: step.actorName,
    atMs: step.atMs,
  });
}

function mapCollaborationDeliverable(params: {
  deliverable: Deliverable;
  groupId: string;
  groupTitle: string;
  members: CollaborationMember[];
  relatedKnowledgeBaseId?: string;
}): WorkspaceDeliverable {
  const creators = [
    params.deliverable.submittedBy,
    params.deliverable.createdBy,
    params.deliverable.publishedBy,
  ].filter((value): value is string => Boolean(value?.trim()));
  const uniqueCreators = [...new Set(creators)];
  const primaryCreatorName = resolvePrimaryCreatorDisplayName(uniqueCreators, params.members, {
    groupTitle: params.groupTitle,
  });
  return enrichWorkspaceDeliverableArtifactFields({
    deliverableId: params.deliverable.deliverableId,
    title: params.deliverable.title,
    kind: inferDeliverableKind(params.deliverable.title, params.deliverable.contentType),
    source: params.deliverable.taskId ? "task" : "group",
    creators: uniqueCreators,
    primaryCreatorName,
    groupId: params.groupId,
    groupTitle: params.groupTitle,
    taskId: params.deliverable.taskId,
    sourceLineageId: params.deliverable.sourceLineageId,
    relatedKnowledgeBaseId: params.relatedKnowledgeBaseId,
    status: params.deliverable.status,
    updatedAtMs: params.deliverable.updatedAtMs,
    contentType: params.deliverable.contentType,
  });
}

function buildCollaborationTraceSteps(params: {
  deliverable: Deliverable;
  groupTitle: string;
  members: CollaborationMember[];
  task?: Task | null;
}): WorkspaceDeliverableTraceStep[] {
  const steps: WorkspaceDeliverableTraceStep[] = [];
  const owner =
    resolveMemberDisplayLabel(
      params.deliverable.createdBy ?? params.deliverable.submittedBy ?? "",
      params.members,
    ) ||
    params.deliverable.createdBy ||
    "协作者";

  pushStep(steps, {
    kind: "trigger",
    title: "协作触发",
    description:
      params.deliverable.description?.trim() || `由 ${owner} 在 ${params.groupTitle} 发起交付`,
    actorName: owner,
    atMs: params.deliverable.createdAtMs,
  });

  if (params.task) {
    pushStep(steps, {
      kind: "task",
      title: "任务执行",
      description:
        params.task.description?.trim() ||
        `任务「${params.task.title}」状态：${params.task.status}`,
      actorName: owner,
      atMs: params.task.startedAtMs ?? params.task.createdAtMs,
    });
  } else if (params.deliverable.taskId) {
    pushStep(steps, {
      kind: "task",
      title: "任务关联",
      description: `关联任务 ${params.deliverable.taskId}`,
      actorName: owner,
      atMs: params.deliverable.createdAtMs,
    });
  }

  if (params.deliverable.submittedAtMs) {
    const submitter = resolveMemberDisplayLabel(
      params.deliverable.submittedBy ?? "",
      params.members,
    );
    pushStep(steps, {
      kind: "collaboration",
      title: "提交评审",
      description: `${submitter || owner} 提交成果进入评审流程`,
      actorName: submitter || owner,
      atMs: params.deliverable.submittedAtMs,
    });
  }

  if (params.deliverable.approvedAtMs) {
    const approver = resolveMemberDisplayLabel(params.deliverable.approvedBy ?? "", params.members);
    pushStep(steps, {
      kind: "review",
      title: "评审通过",
      description: approver ? `${approver} 批准该成果` : "成果已通过评审",
      actorName: approver || undefined,
      atMs: params.deliverable.approvedAtMs,
    });
  } else if (params.deliverable.status === "in_review") {
    pushStep(steps, {
      kind: "review",
      title: "评审中",
      description: "成果正在协作组内评审",
      atMs: params.deliverable.updatedAtMs,
    });
  }

  if (params.deliverable.publishedAtMs) {
    const publisher = resolveMemberDisplayLabel(
      params.deliverable.publishedBy ?? "",
      params.members,
    );
    pushStep(steps, {
      kind: "output",
      title: "成果发布",
      description: params.deliverable.title,
      actorName: publisher || owner,
      atMs: params.deliverable.publishedAtMs,
    });
  } else {
    pushStep(steps, {
      kind: "output",
      title: "成果输出",
      description: params.deliverable.title,
      actorName: owner,
      atMs: params.deliverable.updatedAtMs,
    });
  }

  return steps;
}

function buildAgentTraceSteps(skillId: string): {
  deliverable: WorkspaceDeliverable;
  steps: WorkspaceDeliverableTraceStep[];
  previewText?: string;
  modelUsage?: WorkspaceDeliverableModelUsage | null;
} {
  const detail = getPersonalSkillAssetDetail(skillId);
  const robotName =
    (detail.sourceRobot?.name?.trim() && !/^(bot-|agent-)/i.test(detail.sourceRobot.name)
      ? detail.sourceRobot.name
      : undefined) ||
    resolveConfiguredAgentDisplayName(detail.sourceRobot?.id ?? "") ||
    detail.sourceRobot?.name ||
    "Agent";
  const relatedKnowledgeBaseId =
    getDeliverableArchiveKnowledgeBaseId(`skill:${skillId}`) ?? undefined;
  const deliverable = enrichWorkspaceDeliverableArtifactFields({
    deliverableId: `skill:${skillId}`,
    title: detail.profile.name,
    kind: inferDeliverableKind(detail.profile.name, detail.profile.category),
    source: "agent",
    creators: [detail.sourceRobot?.id ?? robotName],
    primaryCreatorName: robotName,
    sourceLineageId: detail.sourceLineageId,
    relatedKnowledgeBaseId,
    status: "published",
    updatedAtMs: detail.lastUsedAt ?? Date.now(),
    contentType: detail.profile.assetType,
  });

  const steps: WorkspaceDeliverableTraceStep[] = [];
  pushStep(steps, {
    kind: "trigger",
    title: "Agent 任务触发",
    description: detail.profile.summary?.trim() || `${robotName} 接收工作任务`,
    actorName: robotName,
    atMs: detail.lastUsedAt ?? undefined,
  });
  pushStep(steps, {
    kind: "agent",
    title: "模型与工具执行",
    description: `累计执行 ${detail.usageCount} 次，最近于 ${detail.lastUsedAt ? new Date(detail.lastUsedAt).toLocaleString() : "未知时间"}`,
    actorName: robotName,
    atMs: detail.lastUsedAt ?? undefined,
  });
  if (detail.profile.tags.length > 0 || detail.profile.category) {
    pushStep(steps, {
      kind: "knowledge",
      title: "知识域引用",
      description: [
        detail.profile.category ? `分类：${detail.profile.category}` : "",
        detail.profile.tags.length > 0 ? `标签：${detail.profile.tags.join("、")}` : "",
      ]
        .filter(Boolean)
        .join("；"),
      actorName: robotName,
    });
  }
  pushStep(steps, {
    kind: "output",
    title: "成果输出",
    description: detail.profile.name,
    actorName: robotName,
    atMs: detail.lastUsedAt ?? undefined,
  });

  const previewText =
    detail.profile.outputDescription?.trim() || detail.profile.summary?.trim() || undefined;

  let modelUsage: WorkspaceDeliverableModelUsage | null = null;
  const runtime = detail as { runtime?: { modelPreferences?: unknown } };
  const prefs = runtime.runtime?.modelPreferences;
  if (prefs && typeof prefs === "object" && prefs !== null) {
    const record = prefs as Record<string, unknown>;
    const model = typeof record.model === "string" ? record.model : undefined;
    const provider = typeof record.provider === "string" ? record.provider : undefined;
    if (model || provider) {
      modelUsage = { model, provider };
    }
  }

  return { deliverable, steps, previewText, modelUsage };
}

async function resolveEmbeddingProvider() {
  const config = loadConfig();
  for (const agentId of listAgentIds(config)) {
    try {
      const provider = await resolveKnowledgeIngestEmbeddingProvider({ cfg: config, agentId });
      if (provider) {
        return provider;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/** Best-effort decoration of a downstream link: skill titles resolve cheaply, agents by id. */
function decorateDownstreamLink(
  link: DownstreamDeliverableLink,
): WorkspaceDeliverableDownstreamLink {
  let title: string | undefined;
  if (link.deliverableId.startsWith("skill:")) {
    const skillId = link.deliverableId.slice("skill:".length).trim();
    if (skillId) {
      try {
        title = getPersonalSkillAssetDetail(skillId).profile.name;
      } catch {
        title = undefined;
      }
    }
  }
  const agentName = link.agentId
    ? resolveConfiguredAgentDisplayName(link.agentId) || undefined
    : undefined;
  return { deliverableId: link.deliverableId, title, agentName, atMs: link.atMs };
}

/**
 * Downstream 成果↔成果 edges: deliverables generated from later runs that retrieved the
 * knowledge this deliverable was archived into (kbId). Generation rows carry no
 * deliverableId, so each is resolved to its committed deliverable via the commit sibling
 * sharing the same lineageId. Reuses the already-open kb index.
 */
function loadDownstreamDeliverableLinks(
  db: DatabaseSync,
  kbId: string,
  currentDeliverableId: string,
): WorkspaceDeliverableDownstreamLink[] {
  const links = resolveDownstreamDeliverableLinks({
    currentDeliverableId,
    downstreamGenerations: listGenerationLineageForKnowledgeBase(db, kbId),
    resolveCommittedDeliverable: (lineageId) => {
      const commit = listKnowledgeLineageByLineageId(db, lineageId).find(
        (entry) => entry.kind === "commit" && entry.deliverableId,
      );
      return commit?.deliverableId
        ? { deliverableId: commit.deliverableId, agentId: commit.agentId, atMs: commit.updatedAt }
        : null;
    },
  });
  return links.map(decorateDownstreamLink);
}

async function loadCitedKnowledge(params: {
  userId: string;
  deliverable: WorkspaceDeliverable;
  query: string;
}): Promise<{
  items: WorkspaceDeliverableCitedKnowledge[];
  dataSource: "lineage" | "live";
  downstream: WorkspaceDeliverableDownstreamLink[];
}> {
  const kbId =
    params.deliverable.relatedKnowledgeBaseId ??
    getDeliverableArchiveKnowledgeBaseId(params.deliverable.deliverableId) ??
    null;
  if (!kbId) {
    return { items: [], dataSource: "live", downstream: [] };
  }
  const knowledgeBase = getKnowledgeBase(kbId);
  if (!knowledgeBase || knowledgeBase.ownerId !== params.userId) {
    return { items: [], dataSource: "live", downstream: [] };
  }

  const documentId = resolveDeliverableDocumentId(params.deliverable.deliverableId);
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: knowledgeBase.ownerId,
    tenantId: knowledgeBase.tenantId,
  });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    const downstream = loadDownstreamDeliverableLinks(
      index.db,
      kbId,
      params.deliverable.deliverableId,
    );
    const lineage = [
      ...listKnowledgeLineageByDeliverable(index.db, params.deliverable.deliverableId),
      ...(params.deliverable.sourceLineageId
        ? listKnowledgeLineageByLineageId(index.db, params.deliverable.sourceLineageId)
        : []),
    ];
    const lineageChunkIds = [
      ...new Set(lineage.flatMap((entry) => entry.sourceChunkIds).filter(Boolean)),
    ];
    if (lineageChunkIds.length > 0) {
      const placeholders = lineageChunkIds.map(() => "?").join(", ");
      const rows = index.db
        .prepare(
          `SELECT m.chunk_id, m.kb_id, m.doc_id, d.title AS doc_title
             FROM ${KB_CHUNK_META_TABLE} m
             JOIN documents d ON d.doc_id = m.doc_id
            WHERE m.chunk_id IN (${placeholders})`,
        )
        .all(...lineageChunkIds) as Array<{
        chunk_id: string;
        kb_id: string;
        doc_id: string;
        doc_title: string;
      }>;
      const items = rows
        .filter((row) => row.kb_id === kbId)
        .map((row) => ({
          kbId,
          kbTitle: knowledgeBase.title,
          docId: row.doc_id,
          docTitle: row.doc_title,
          chunkText: getKnowledgeChunkText(index.db, row.chunk_id)?.slice(0, 280),
        }));
      if (items.length > 0) {
        return { items, dataSource: "lineage", downstream };
      }
    }

    const cited: WorkspaceDeliverableCitedKnowledge[] = [];
    if (documentId) {
      const doc = getKnowledgeDocument(index.db, documentId);
      if (doc && doc.kbId === kbId) {
        cited.push({
          kbId,
          kbTitle: knowledgeBase.title,
          docId: doc.docId,
          docTitle: doc.title,
        });
      }
    }

    const embeddingProvider = await resolveEmbeddingProvider();
    const hits = await retrieveKnowledgeFromIndex({
      index,
      kbIds: [kbId],
      query: params.query.trim() || params.deliverable.title,
      maxResults: 5,
      docId: documentId ?? undefined,
      embeddingProvider,
      governanceAware: false,
    });
    for (const hit of hits) {
      cited.push({
        kbId,
        kbTitle: knowledgeBase.title,
        docId: hit.docId,
        docTitle: hit.docTitle,
        chunkText: hit.chunkText.slice(0, 280),
        score: hit.score,
      });
    }

    const seen = new Set<string>();
    return {
      items: cited.filter((item) => {
        const key = `${item.docId ?? ""}:${item.chunkText ?? item.docTitle ?? ""}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      }),
      dataSource: "live",
      downstream,
    };
  } finally {
    index.close();
  }
}

export async function getWorkspaceDeliverableTrace(
  params: GetWorkspaceDeliverableTraceParams,
): Promise<GetWorkspaceDeliverableTraceResult | null> {
  const deliverableId = params.deliverableId.trim();
  if (!deliverableId) {
    return null;
  }

  const archiveKbId = getDeliverableArchiveKnowledgeBaseId(deliverableId) ?? undefined;

  if (deliverableId.startsWith("skill:")) {
    const skillId = deliverableId.slice("skill:".length).trim();
    if (!skillId) {
      return null;
    }
    try {
      const agentTrace = buildAgentTraceSteps(skillId);
      const deliverable = {
        ...agentTrace.deliverable,
        relatedKnowledgeBaseId:
          agentTrace.deliverable.relatedKnowledgeBaseId ?? archiveKbId ?? undefined,
      };
      const citation = await loadCitedKnowledge({
        userId: params.userId,
        deliverable,
        query: deliverable.title,
      });
      return {
        trace: {
          deliverableId,
          deliverable,
          steps: agentTrace.steps,
          citedKnowledge: citation.items,
          downstreamDeliverables: citation.downstream,
          modelUsage: agentTrace.modelUsage ?? null,
          previewText: agentTrace.previewText,
          dataSource:
            citation.dataSource === "lineage"
              ? "lineage"
              : citation.items.length > 0
                ? "live"
                : "reconstructed",
        },
      };
    } catch {
      return null;
    }
  }

  const { groupRootDir, groupStorage, objectStorage } = createWorkspaceCollaborationStores();
  const discoveredGroupIds = await listWorkspaceCollaborationGroupIds(groupRootDir);
  const scopedGroupIds = params.groupIds?.map((id) => id.trim()).filter(Boolean) ?? [];
  const groupIds =
    scopedGroupIds.length > 0
      ? discoveredGroupIds.filter((groupId) => scopedGroupIds.includes(groupId))
      : discoveredGroupIds;

  for (const groupId of groupIds) {
    const [profile, members] = await Promise.all([
      groupStorage.readProfile(groupId),
      groupStorage.readMembers(groupId),
    ]);
    if (!members.some((member) => isActiveMember(member, params.userId))) {
      continue;
    }
    const deliverable = await objectStorage.readObject<Deliverable>(
      groupId,
      "deliverable",
      deliverableId,
    );
    if (!deliverable) {
      continue;
    }
    const groupTitle = profile?.displayName?.trim() || profile?.groupCode?.trim() || groupId;
    let task: Task | null = null;
    if (deliverable.taskId) {
      task = (await objectStorage.readObject<Task>(groupId, "task", deliverable.taskId)) ?? null;
    }
    const mapped = mapCollaborationDeliverable({
      deliverable,
      groupId,
      groupTitle,
      members,
      relatedKnowledgeBaseId: archiveKbId,
    });
    const steps = buildCollaborationTraceSteps({
      deliverable,
      groupTitle,
      members,
      task,
    });
    const citation = await loadCitedKnowledge({
      userId: params.userId,
      deliverable: mapped,
      query: deliverable.title,
    });
    const previewText = deliverable.content?.trim().slice(0, 2000) || undefined;
    return {
      trace: {
        deliverableId,
        deliverable: mapped,
        steps,
        citedKnowledge: citation.items,
        downstreamDeliverables: citation.downstream,
        modelUsage: null,
        previewText,
        dataSource:
          citation.dataSource === "lineage"
            ? "lineage"
            : deliverable.content || citation.items.length > 0
              ? "live"
              : "reconstructed",
      },
    };
  }

  return null;
}
