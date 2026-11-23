import type { CollaborationMember, Deliverable } from "@openbot/collaboration-core";
import {
  createWorkspaceCollaborationStores,
  listWorkspaceCollaborationGroupIds,
} from "../../collaboration-learning/shared.js";
import {
  ownershipProofFromLocalUser,
  ownershipProofFromTenantUser,
} from "../../data-governance/ownership-proof.js";
import type { GovernanceOwnershipProof } from "../../data-governance/write-gate.js";
import { getPersonalSkillAssetDetail } from "../../skill-lifecycle-store.js";
import {
  deriveAgentKnowledgeTypeFromLineage,
  recordAgentGeneratedKnowledgeInIndex,
} from "../agent-generated-knowledge-store.js";
import {
  enqueueAgentKnowledgeGenerationInIndex,
  isAgentKnowledgeAutoGenerateEnabled,
} from "../agent-knowledge-generation-queue-store.js";
import { knowledgeDocumentIdFromSkillRef } from "../document-display-title.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "../kb-index.js";
import {
  attachDocumentToKnowledgeBase,
  detachDocumentFromKnowledgeBase,
  getKnowledgeBase,
  KnowledgeBaseStoreError,
  type KnowledgeBase,
} from "../knowledge-base-store.js";
import {
  listKnowledgeLineageByLineageId,
  upsertKnowledgeLineage,
} from "../knowledge-lineage-store.js";
import {
  ingestAttachedPersonalKnowledgeDocument,
  ingestKnowledgePayloadToBase,
  type PersonalKnowledgeIngestOutcome,
} from "../personal-knowledge-ingest.js";
import { parsePersonalObjectId } from "../personal-mutations.js";
import { setDeliverableArchiveKnowledgeBaseId } from "./archive-store.js";
import { inferDeliverableIngestMimeType } from "./ingest-mime.js";

export type AttachWorkspaceDeliverableResult = {
  knowledgeBase: KnowledgeBase;
  documentId: string;
  ingest: PersonalKnowledgeIngestOutcome;
  relatedKnowledgeBaseId: string;
};

export type ResolvedCollaborationDeliverable = {
  deliverable: Deliverable;
  groupId: string;
  groupTitle: string;
  members: CollaborationMember[];
};

export function resolveDeliverableDocumentId(
  deliverableId: string,
  knowledgeBaseId?: string,
): string | null {
  const trimmed = deliverableId.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("skill:")) {
    const skillId = trimmed.slice("skill:".length).trim();
    return skillId
      ? knowledgeBaseId
        ? knowledgeDocumentIdFromSkillRef(knowledgeBaseId, skillId)
        : skillId
      : null;
  }
  const personalId = parsePersonalObjectId(trimmed);
  if (personalId) {
    return knowledgeBaseId
      ? knowledgeDocumentIdFromSkillRef(knowledgeBaseId, personalId)
      : personalId;
  }
  return trimmed;
}

function isActiveMember(member: CollaborationMember, userId: string): boolean {
  if (member.status !== "active" && member.status !== "invited") {
    return false;
  }
  return member.userId === userId;
}

export async function resolveCollaborationDeliverable(params: {
  userId: string;
  deliverableId: string;
  groupIds?: string[];
}): Promise<ResolvedCollaborationDeliverable | null> {
  const deliverableId = params.deliverableId.trim();
  if (!deliverableId || deliverableId.startsWith("skill:")) {
    return null;
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
    return {
      deliverable,
      groupId,
      groupTitle: profile?.displayName?.trim() || profile?.groupCode?.trim() || groupId,
      members,
    };
  }
  return null;
}

function collaborationDeliverableToIngestPayload(deliverable: Deliverable): {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
} | null {
  const content = deliverable.content?.trim() || deliverable.description?.trim();
  if (!content) {
    return null;
  }
  const contentType = deliverable.contentType?.trim() || "text/markdown";
  const extension = contentType.includes("html")
    ? "html"
    : contentType.includes("json")
      ? "json"
      : contentType.includes("csv")
        ? "csv"
        : contentType.includes("markdown") || contentType.includes("md")
          ? "md"
          : "txt";
  return {
    fileName: `${deliverable.deliverableId}.${extension}`,
    mimeType: contentType,
    buffer: Buffer.from(content, "utf8"),
  };
}

function assertIngestCommitted(outcome: PersonalKnowledgeIngestOutcome): void {
  if (!outcome.attempted) {
    throw new KnowledgeBaseStoreError(outcome.reason ?? "knowledge runtime commit did not run");
  }
  if (outcome.error) {
    throw new KnowledgeBaseStoreError(outcome.error);
  }
}

function resolveAttachGovernanceOwnershipProof(params: {
  userId: string;
  tenantId?: string | null;
  governanceOwnershipProof?: GovernanceOwnershipProof;
}): GovernanceOwnershipProof {
  if (params.governanceOwnershipProof) {
    return params.governanceOwnershipProof;
  }
  const tenantId = params.tenantId?.trim() || null;
  return tenantId
    ? ownershipProofFromTenantUser({ tenantId, userId: params.userId })
    : ownershipProofFromLocalUser({ userId: params.userId });
}

function resolveSkillSourceLineageId(deliverableId: string): string | null {
  if (!deliverableId.startsWith("skill:")) {
    return null;
  }
  const skillId = deliverableId.slice("skill:".length).trim();
  if (!skillId) {
    return null;
  }
  try {
    return getPersonalSkillAssetDetail(skillId).sourceLineageId?.trim() || null;
  } catch {
    return null;
  }
}

async function writeCommitLineage(params: {
  knowledgeBase: KnowledgeBase;
  deliverableId: string;
  sourceLineageId: string | null;
  indexRoot?: string;
  sourceRelationIds?: string[];
}): Promise<void> {
  const sourceLineageId = params.sourceLineageId?.trim();
  if (!sourceLineageId) {
    return;
  }
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.knowledgeBase.ownerId,
    tenantId: params.knowledgeBase.tenantId,
    indexRoot: params.indexRoot,
  });
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    const generation = listKnowledgeLineageByLineageId(index.db, sourceLineageId).find(
      (entry) => entry.kind === "generation",
    );
    upsertKnowledgeLineage({
      db: index.db,
      lineageId: sourceLineageId,
      kind: "commit",
      deliverableId: params.deliverableId,
      sourceChunkIds: generation?.sourceChunkIds ?? [],
      sourceKnowledgeBaseIds: [
        ...new Set([params.knowledgeBase.id, ...(generation?.sourceKnowledgeBaseIds ?? [])]),
      ],
      sourceAgentIds: generation?.sourceAgentIds ?? [],
      sourceTaskIds: generation?.sourceTaskIds ?? [],
      sourceRelationIds: [
        ...new Set([...(generation?.sourceRelationIds ?? []), ...(params.sourceRelationIds ?? [])]),
      ],
      agentId: generation?.agentId ?? null,
      sessionKey: generation?.sessionKey ?? null,
      messageId: generation?.messageId ?? null,
      groupId: generation?.groupId ?? null,
    });
    // Push-time agent-knowledge capture: committing a generated deliverable into a KB
    // materializes a confirmed, typed agent_generated_knowledge row (idempotent with the
    // read-time lineage projection, keyed by the same lineage id).
    recordAgentGeneratedKnowledgeInIndex(index.db, {
      knowledgeId: `lin:${sourceLineageId}`,
      kbId: params.knowledgeBase.id,
      type: generation ? deriveAgentKnowledgeTypeFromLineage(generation) : "auto_analysis",
      agentId: generation?.agentId ?? null,
      title: params.deliverableId,
      sourceLineageId,
      sourceDeliverableId: params.deliverableId,
      status: "confirmed",
    });
    // Auto-generation enqueue (opt-in): when the committed deliverable traces back to a
    // chat session, queue an LLM summary/SOP job so the maintenance tick can summarize it
    // out-of-band. No-op unless OPENBOT_KNOWLEDGE_AUTO_GENERATE is enabled.
    if (isAgentKnowledgeAutoGenerateEnabled() && generation?.sessionKey) {
      enqueueAgentKnowledgeGenerationInIndex(index.db, {
        kbId: params.knowledgeBase.id,
        sessionKey: generation.sessionKey,
        agentId: generation.agentId ?? null,
      });
    }
  } finally {
    index.close();
  }
}

export async function attachWorkspaceDeliverableToKnowledgeBase(params: {
  userId: string;
  deliverableId: string;
  knowledgeBaseId: string;
  knowledgeBase?: KnowledgeBase;
  groupIds?: string[];
  storePath?: string;
  archiveStorePath?: string;
  indexRoot?: string;
  /** Keep overwrite on the archived document instead of a new capture skill. */
  documentId?: string | null;
  ingestTitle?: string | null;
  ingestFileName?: string | null;
  ingestContent?: string | null;
  ingestBase64?: string | null;
  derivedFromDocumentId?: string | null;
  derivedFromRawHash?: string | null;
  /** Trusted proof from authenticated call entry — required when the KB is tenant-scoped. */
  governanceOwnershipProof?: GovernanceOwnershipProof;
  /** Preview save: FTS now, sqlite-vec in the gateway tick. */
  deferEmbedding?: boolean;
}): Promise<AttachWorkspaceDeliverableResult> {
  const knowledgeBase =
    params.knowledgeBase ?? getKnowledgeBase(params.knowledgeBaseId, params.storePath);
  if (!knowledgeBase) {
    throw new KnowledgeBaseStoreError("not authorized to modify knowledge base");
  }
  const sourceDocumentId =
    params.documentId?.trim() || resolveDeliverableDocumentId(params.deliverableId);
  if (!sourceDocumentId) {
    throw new KnowledgeBaseStoreError("invalid deliverableId");
  }
  const skillId = parsePersonalObjectId(sourceDocumentId) ?? sourceDocumentId;
  const documentId = /^skill_[a-z0-9]+$/i.test(skillId)
    ? knowledgeDocumentIdFromSkillRef(params.knowledgeBaseId, skillId)
    : sourceDocumentId;
  const wasAttached = knowledgeBase.documentIds.includes(documentId);
  const updated = attachDocumentToKnowledgeBase(
    params.knowledgeBaseId,
    documentId,
    params.storePath,
  );
  const governanceOwnershipProof = resolveAttachGovernanceOwnershipProof({
    userId: params.userId,
    tenantId: knowledgeBase.tenantId,
    governanceOwnershipProof: params.governanceOwnershipProof,
  });
  let ingest: PersonalKnowledgeIngestOutcome;
  try {
    const collaboration = await resolveCollaborationDeliverable({
      userId: params.userId,
      deliverableId: params.deliverableId,
      groupIds: params.groupIds,
    });
    let sourceLineageId = resolveSkillSourceLineageId(params.deliverableId);
    const ingestBase64 = params.ingestBase64?.replace(/\s+/g, "") || "";
    const ingestContent = params.ingestContent?.trim() || "";
    const ingestFileName =
      params.ingestFileName?.trim() || (ingestBase64 || ingestContent ? `${documentId}.md` : "");
    if (collaboration) {
      sourceLineageId = collaboration.deliverable.sourceLineageId?.trim() || sourceLineageId;
    }
    if (ingestBase64) {
      ingest = await ingestKnowledgePayloadToBase({
        knowledgeBase,
        documentId,
        title:
          params.ingestTitle?.trim() || collaboration?.deliverable.title || params.deliverableId,
        fileName: ingestFileName,
        mimeType: inferDeliverableIngestMimeType(ingestFileName),
        buffer: Buffer.from(ingestBase64.replace(/^data:[^;]+;base64,/i, ""), "base64"),
        ownerId: params.userId,
        indexRoot: params.indexRoot,
        governanceOwnershipProof,
        deferEmbedding: params.deferEmbedding === true,
      });
    } else if (ingestContent) {
      ingest = await ingestKnowledgePayloadToBase({
        knowledgeBase,
        documentId,
        title:
          params.ingestTitle?.trim() || collaboration?.deliverable.title || params.deliverableId,
        fileName: ingestFileName,
        mimeType: inferDeliverableIngestMimeType(ingestFileName),
        buffer: Buffer.from(ingestContent, "utf8"),
        ownerId: params.userId,
        indexRoot: params.indexRoot,
        governanceOwnershipProof,
        deferEmbedding: params.deferEmbedding === true,
      });
    } else if (collaboration) {
      const payload = collaborationDeliverableToIngestPayload(collaboration.deliverable);
      if (!payload) {
        throw new KnowledgeBaseStoreError("deliverable has no ingestible content");
      }
      ingest = await ingestKnowledgePayloadToBase({
        knowledgeBase,
        documentId,
        title: collaboration.deliverable.title,
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        buffer: payload.buffer,
        ownerId: params.userId,
        indexRoot: params.indexRoot,
        governanceOwnershipProof,
        deferEmbedding: params.deferEmbedding === true,
      });
    } else {
      ingest = await ingestAttachedPersonalKnowledgeDocument({
        knowledgeBaseId: params.knowledgeBaseId,
        documentId: skillId,
        ownerId: params.userId,
        knowledgeBase,
        storePath: params.storePath,
        indexRoot: params.indexRoot,
        governanceOwnershipProof,
        deferEmbedding: params.deferEmbedding === true,
      });
    }
    assertIngestCommitted(ingest);
    const derivedFromDocumentId = params.derivedFromDocumentId?.trim();
    const derivedFromRawHash = params.derivedFromRawHash?.trim();
    await writeCommitLineage({
      knowledgeBase,
      deliverableId: params.deliverableId,
      sourceLineageId,
      indexRoot: params.indexRoot,
      sourceRelationIds:
        derivedFromDocumentId && derivedFromRawHash
          ? [`derived:${derivedFromDocumentId}@${derivedFromRawHash}`]
          : derivedFromDocumentId
            ? [`derived:${derivedFromDocumentId}`]
            : [],
    });
  } catch (error) {
    if (!wasAttached) {
      try {
        detachDocumentFromKnowledgeBase(params.knowledgeBaseId, documentId, params.storePath);
      } catch {
        // Best-effort rollback; surface the original commit failure.
      }
    }
    throw error;
  }
  setDeliverableArchiveKnowledgeBaseId({
    deliverableId: params.deliverableId,
    knowledgeBaseId: params.knowledgeBaseId,
    storePath: params.archiveStorePath,
  });
  return {
    knowledgeBase: updated,
    documentId,
    ingest,
    relatedKnowledgeBaseId: params.knowledgeBaseId,
  };
}
