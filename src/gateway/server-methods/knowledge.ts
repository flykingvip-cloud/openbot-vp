import fs from "node:fs";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import type { RetrievalContext } from "../../retrieval/types.js";
import {
  isKnowledgeBaseVisible,
  type VisibilityKnowledgeBase,
} from "../../retrieval/visibility-resolver.js";
import { resolveCollaborationGroupIdFromSessionKey } from "../collaboration-learning/shared.js";
import {
  ownershipProofFromLocalUser,
  ownershipProofFromTenantUser,
} from "../data-governance/ownership-proof.js";
import { resolveEmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import { EnterpriseDataStoreError } from "../enterprise-data/connector-action-store.js";
import { loadEnterpriseDataStore, saveEnterpriseDataStore } from "../enterprise-data/store.js";
import { KNOWLEDGE_AGENT_TYPES } from "../enterprise-data/types.js";
import {
  type AgentDeliverableInput,
  listKnowledgeBaseAgentKnowledgeFromIndex,
} from "../knowledge/agent-generated-knowledge-store.js";
import {
  type AgentKnowledgeGenerationMode,
  createAgentKnowledgeLlmCaller,
  extractTranscriptMessages,
  generateAndRecordAgentKnowledgeForKnowledgeBase,
} from "../knowledge/agent-knowledge-generator.js";
import { invokeKnowledgeCapability } from "../knowledge/capability-invoke-runtime.js";
import { previewKnowledgeIndexCapability } from "../knowledge/capability-preview.js";
import {
  normalizeKnowledgeConsumeRefs,
  type KnowledgeConsumeRef,
} from "../knowledge/consume-ref.js";
import { resolveKnowledgeSourceContext } from "../knowledge/context.js";
import {
  ensureReservedDeliverableFolders,
  isReservedDeliverableFolder,
  resolveReservedDeliverableFolderKind,
} from "../knowledge/deliverable-folders.js";
import { lookupDeliverableArchiveStatus } from "../knowledge/deliverables/archive-lookup.js";
import { listDeliverableArchiveKnowledgeBaseIds } from "../knowledge/deliverables/archive-store.js";
import { attachWorkspaceDeliverableToKnowledgeBase } from "../knowledge/deliverables/attach.js";
import { captureAgentOutputDeliverable } from "../knowledge/deliverables/auto-capture-runtime.js";
import { backfillStewardSessionDeliverables } from "../knowledge/deliverables/backfill-session-deliverables.js";
import { backfillEmployeeStewardWorkspaceDeliverables } from "../knowledge/deliverables/backfill-workspace-deliverables.js";
import { applyRuntimeGovernanceToDeliverables } from "../knowledge/deliverables/governance-runtime.js";
import { listWorkspaceDeliverables } from "../knowledge/deliverables/read-model.js";
import {
  resolveSaveArchiveKnowledgeBase,
  SAVE_ARCHIVE_KB_AUTO,
  SaveArchiveKnowledgeBaseError,
} from "../knowledge/deliverables/resolve-save-archive-kb.js";
import { saveAndArchiveWorkspaceDeliverable } from "../knowledge/deliverables/save-and-archive.js";
import {
  SAVE_CONFLICT_STALE,
  SAVE_DECISION_REQUIRED,
  SaveConflictStaleError,
  SaveDecisionRequiredError,
  type DeliverableSaveMode,
} from "../knowledge/deliverables/save-decision.js";
import { getWorkspaceDeliverableTrace } from "../knowledge/deliverables/trace-model.js";
import type { WorkspaceDeliverableSource } from "../knowledge/deliverables/types.js";
import {
  knowledgeDocumentIdFromSkillRef,
  resolveSkillAssetIdForDocument,
} from "../knowledge/document-display-title.js";
import { computeRawContentHash } from "../knowledge/document-fingerprint.js";
import { createEnterpriseKnowledgeAccessRequest } from "../knowledge/enterprise-knowledge-access-request.js";
import { buildKnowledgeFeedDailyDigest } from "../knowledge/feed/daily-digest.js";
import {
  computeKnowledgeHealthScore,
  getChunkRelationBreakdown,
  getChunkScoreAverages,
  getGovernanceSummary,
  sumChunkReferenceCounts,
} from "../knowledge/governance/chunk-governance-store.js";
import { parseKnowledgeIngestParseOptions } from "../knowledge/ingest-parse-options.js";
import {
  deleteKnowledgeDocumentFromIndex,
  deleteKnowledgeBaseRetrievalSummaries,
  openKnowledgeIndex,
  resolveKnowledgeIndexDbPath,
} from "../knowledge/kb-index.js";
import {
  listKnowledgeBaseDocumentsFromIndex,
  listKnowledgeBaseDatasetsFromIndex,
  listKnowledgeBaseEvictedChunksFromIndex,
  listKnowledgeBaseRecycledDocumentsFromIndex,
  listKnowledgeBaseSnippetsFromIndex,
  listKnowledgeBaseWebPagesFromIndex,
} from "../knowledge/knowledge-base-library-content.js";
import {
  inviteKnowledgeBaseMember,
  KnowledgeBaseMembersError,
  listKnowledgeBaseMembers,
  type KnowledgeBaseMemberRole,
} from "../knowledge/knowledge-base-members.js";
import {
  buildKnowledgeBasePermissionActor,
  canAdminKnowledgeBase,
  canReadKnowledgeBase,
  canWriteKnowledgeBase,
  resolveAuthorizedKnowledgeBase,
  type KnowledgeBasePermission,
} from "../knowledge/knowledge-base-permissions.js";
import { listKnowledgeBaseSources } from "../knowledge/knowledge-base-sources-list.js";
import {
  attachDocumentToKnowledgeBase,
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteDocumentFromKnowledgeBase,
  detachDocumentFromKnowledgeBase,
  getKnowledgeBase,
  KnowledgeBaseStoreError,
  listKnowledgeBases,
  restoreDocumentToKnowledgeBase,
  updateKnowledgeBase,
  type KnowledgeBase,
  type KnowledgeBaseVisibility,
} from "../knowledge/knowledge-base-store.js";
import { readKnowledgeCompatWarningStats } from "../knowledge/knowledge-compat-stats.js";
import {
  appendCompatWarnings,
  createSourceBindVisibilityIgnoredWarning,
  isSourceBindVisibilityInputRejected,
  readKnowledgeCompatFeatureFlags,
  resolvePersonalImportKnowledgeBase,
  type KnowledgeCompatWarning,
} from "../knowledge/knowledge-compat.js";
import {
  resolveKnowledgeDirectoryLayoutForBase,
  resolveKnowledgeIndexRootForBase,
} from "../knowledge/knowledge-directory.js";
import {
  KnowledgeDocumentPreviewUnavailableError,
  previewKnowledgeDocument,
} from "../knowledge/knowledge-document-preview.js";
import { countActiveAgentsForKnowledgeBase } from "../knowledge/knowledge-lineage-store.js";
import {
  assertKnowledgeOriginalWritable,
  withKnowledgeDocumentMutation,
} from "../knowledge/knowledge-original-store.js";
import { searchScopedKnowledgeBaseWithFallback } from "../knowledge/knowledge-retrieval-runtime.js";
import {
  authorizePersonalKnowledgeObjectAccess,
  isPersonalKnowledgeAuthError,
} from "../knowledge/personal-knowledge-auth.js";
import {
  attachmentToSourceBuffer,
  extractImageTextForKnowledge,
  fetchWebPageForKnowledge,
  importDatasetPersonalKnowledge,
  ingestAttachedPersonalKnowledgeDocument,
  ingestCollectedPersonalKnowledge,
  ingestKnowledgePayloadToBase,
  ingestUploadedPersonalKnowledge,
  ingestWebReferencePersonalKnowledge,
  type PersonalKnowledgeIngestOutcome,
} from "../knowledge/personal-knowledge-ingest.js";
import {
  collectPersonalKnowledge,
  comparePersonalKnowledgeVersions,
  listPersonalKnowledgeVersions,
  updatePersonalKnowledgeTags,
  uploadPersonalKnowledge,
} from "../knowledge/personal-mutations.js";
import { deleteReservedDeliverableOriginal } from "../knowledge/reserved-deliverable-original.js";
import { resolveWebClipContent } from "../knowledge/resolve-web-clip-content.js";
import { accessDocumentRetrievalSummary } from "../knowledge/retrieval-summary-document.js";
import { parseRetrievalSummaryFields } from "../knowledge/retrieval-summary-validation.js";
import {
  knowledgeAgentProfile,
  knowledgeActionsList,
  knowledgeCognitiveBundle,
  knowledgeContext,
  knowledgeDiscoveryList,
  knowledgeFeedList,
  knowledgeLineageExplain,
  knowledgeObject,
  knowledgeObjectForNode,
  knowledgeRecent,
  knowledgeRecentRecord,
  knowledgeRecommendations,
  knowledgeRelated,
  knowledgeRelationships,
  knowledgeResolve,
  knowledgeSearch,
} from "../knowledge/router.js";
import { resolveKnowledgeRuntimeContext } from "../knowledge/runtime/knowledge-runtime-context.js";
import { createSeatCapabilityAccessRequest } from "../knowledge/seat-capability-access.js";
import {
  buildLocalFolderBindingId,
  deleteLocalFolderBinding,
  findLocalFolderBinding,
  listLocalFolderBindings,
  upsertLocalFolderBinding,
} from "../knowledge/sources/local-folder-binding-store.js";
import { openLocalFolderDocument } from "../knowledge/sources/local-folder-open.js";
import { assertLocalFolderRootPathAllowed } from "../knowledge/sources/local-folder-path-policy.js";
import {
  activeDocumentCountForSource,
  scanLocalFolderBinding,
  unbindLocalFolderRuntime,
} from "../knowledge/sources/local-folder-runtime.js";
import { invalidateLocalFolderSyncPlan } from "../knowledge/sources/local-folder-sync-plan-store.js";
import {
  commitManagedLocalFolderSync,
  createManagedLocalFolderSyncPlan,
  withLocalFolderBindingOperationLock,
} from "../knowledge/sources/local-folder-sync.js";
import type {
  LocalFolderBindingMode,
  LocalFolderDeletePolicy,
  LocalFolderSyncCandidate,
  LocalFolderSyncCommitFile,
} from "../knowledge/sources/local-folder-types.js";
import {
  isLocalFolderWatcherRunning,
  startLocalFolderWatcher,
  stopLocalFolderWatcher,
} from "../knowledge/sources/local-folder-watcher.js";
import { loadPersonalKnowledgeObjectBySkillId } from "../knowledge/sources/personal-source.js";
import {
  getApiSourceCatalog,
  invokeApiSource,
  syncApiSourceCatalog,
} from "../knowledge/sources/source-api-runtime.js";
import {
  bindKnowledgeSource,
  backfillSourceBindingVisibilityStore,
  listKnowledgeSourceBindings,
  unbindKnowledgeSource,
} from "../knowledge/sources/source-binding-store.js";
import {
  deleteSourceDocumentLinksForDocId,
  deleteSourceDocumentLinksForSource,
} from "../knowledge/sources/source-document-link-store.js";
import { ingestKnowledgeSourceBinding } from "../knowledge/sources/source-ingest-runtime.js";
import type { KnowledgeSourceContext } from "../knowledge/sources/types.js";
import { listKnowledgeTimeline } from "../knowledge/timeline-read-model.js";
import type { KnowledgeObjectKind, KnowledgeTaskContext } from "../knowledge/types.js";
import {
  runDueWebSourceRefreshes,
  setWebSourceRefreshPolicy,
} from "../knowledge/web-source-refresh-store.js";
import { searchWorkspace } from "../knowledge/workspace-search.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { readSessionMessages } from "../session-utils.js";
import { SkillAssetStoreError } from "../skill-lifecycle-store.js";
import { deletePersonalSkillAsset, getPersonalSkillAssetDetail } from "../skill-lifecycle-store.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { loadSessionEntryForClient } from "../tenant-context.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_ENTERPRISE_DATA_FILE } from "../tenant-store-paths.js";
import { createKnowledgeConnectorHandlers } from "./knowledge-connector.js";
import { knowledgeGovernanceHandlers } from "./knowledge-governance.js";
import { exactMember, isRecord, stringValue } from "./request-params.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

const KNOWLEDGE_OBJECT_KINDS = [
  "document",
  "policy",
  "template",
  "project",
  "contract",
  "metric",
  "insight",
] as const;

const KNOWLEDGE_BASE_SOURCE_LIST_FILTER_KINDS = [
  "document",
  "upload",
  "web",
  "dataset",
  "note",
  "agent-knowledge",
  "api",
  "external",
  "capability",
] as const;

const ACTIVE_BIND_KINDS = ["api", "external", "capability"] as const;

function stringParam(value: unknown): string | undefined {
  // Callers distinguish undefined from null. stringValue is the same trim.
  return stringValue(value) ?? undefined;
}

function authenticatedClientDeviceId(client: GatewayClient | null): string | undefined {
  return stringParam(client?.connect.device?.id);
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArrayParam(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function parseDatasetImportRecords(value: unknown): { title?: string; text: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const records: { title?: string; text: string }[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const text = entry.trim();
      if (text) {
        records.push({ text });
      }
      continue;
    }
    if (isRecord(entry)) {
      const rec = entry;
      const rawText =
        typeof rec.text === "string"
          ? rec.text
          : typeof rec.content === "string"
            ? rec.content
            : "";
      const text = rawText.trim();
      if (!text) {
        continue;
      }
      const title =
        typeof rec.title === "string" && rec.title.trim() ? rec.title.trim() : undefined;
      records.push(title ? { title, text } : { text });
    }
  }
  return records;
}

function respondKnowledgeMutationError(respond: RespondFn, error: unknown) {
  const message =
    error instanceof SkillAssetStoreError
      ? error.message
      : error instanceof Error
        ? error.message
        : "knowledge mutation failed";
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

function parseTaskContext(value: unknown): KnowledgeTaskContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const record = value;
  const taskType = stringParam(record.taskType);
  if (!taskType) {
    return null;
  }
  return {
    taskType,
    sessionKey: stringParam(record.sessionKey) ?? null,
    seatId: stringParam(record.seatId) ?? null,
    agentId: stringParam(record.agentId) ?? null,
    requestedSourceHints: Array.isArray(record.requestedSourceHints)
      ? record.requestedSourceHints.filter(
          (item): item is "personal" | "enterprise" | "data" =>
            item === "personal" || item === "enterprise" || item === "data",
        )
      : undefined,
    requestedKinds: Array.isArray(record.requestedKinds)
      ? record.requestedKinds.filter(
          (item): item is KnowledgeObjectKind => exactMember(item, KNOWLEDGE_OBJECT_KINDS) !== null,
        )
      : undefined,
    requestedCapabilities: Array.isArray(record.requestedCapabilities)
      ? record.requestedCapabilities.filter((item): item is string => typeof item === "string")
      : undefined,
    agentType: exactMember(record.agentType, KNOWLEDGE_AGENT_TYPES) ?? undefined,
    requestedObjectIds: Array.isArray(record.requestedObjectIds)
      ? record.requestedObjectIds.filter((item): item is string => typeof item === "string")
      : undefined,
    knowledgeBaseId: stringParam(record.knowledgeBaseId) ?? null,
  };
}

function parseKnowledgeConsumeRefs(value: unknown): KnowledgeConsumeRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const refs: KnowledgeConsumeRef[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const record = item;
    const type = stringParam(record.type);
    const id = stringParam(record.id);
    const parentId = stringParam(record.parentId);
    if (!type || !id) {
      continue;
    }
    if (type === "knowledge-base") {
      refs.push({ type, id });
    } else if ((type === "knowledge-file" || type === "deliverable") && parentId) {
      refs.push({ type, id, parentId });
    } else if (type === "folder" || type === "api") {
      refs.push({ type, id, ...(parentId ? { parentId } : {}) });
    }
  }
  return normalizeKnowledgeConsumeRefs(refs);
}

function respondKnowledgeBaseError(respond: RespondFn, error: unknown) {
  const message =
    error instanceof KnowledgeBaseStoreError
      ? error.message
      : error instanceof Error
        ? error.message
        : "knowledge base operation failed";
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

function knowledgeBaseRetrievalContext(context: {
  userId: string | null;
  seatId: string | null;
  tenantId: string | null;
  departmentId?: string | null;
  roleCode?: string | null;
}): RetrievalContext {
  return {
    userId: context.userId,
    seatId: context.seatId,
    tenantId: context.tenantId,
    departmentId: context.departmentId ?? null,
    roleCodes: context.roleCode ? [context.roleCode] : undefined,
  };
}

function toVisibilityKnowledgeBase(base: KnowledgeBase): VisibilityKnowledgeBase {
  return {
    id: base.id,
    visibility: base.visibility,
    ownerId: base.ownerId,
    // Canonicalize the stored tenant id so legacy tenant aliases still match the
    // (already canonical) caller tenant — otherwise a pre-existing team/enterprise
    // base could be wrongly hidden from a same-tenant member.
    tenantId: canonicalizeTenantId(base.tenantId),
  };
}

async function enrichKnowledgeBaseRuntimeSummary(base: KnowledgeBase) {
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: base.ownerId,
    tenantId: base.tenantId,
    indexRoot: resolveKnowledgeIndexRootForBase(base),
  });
  try {
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      const summary = getGovernanceSummary(index.db, base.id);
      const conflictCount = summary.openConflictCount + summary.openClaimConflictCount;
      const relationBreakdown = getChunkRelationBreakdown(index.db, base.id);
      return {
        ...base,
        reservedKind: resolveReservedDeliverableFolderKind(base) ?? undefined,
        chunkCount: summary.indexedChunkCount,
        relationCount:
          relationBreakdown.reference + relationBreakdown.duplicate + relationBreakdown.conflict,
        relationBreakdown,
        conflictCount,
        citationCount: sumChunkReferenceCounts(index.db, base.id),
        activeAgentCount: countActiveAgentsForKnowledgeBase(index.db, base.id),
        scoreAverages: getChunkScoreAverages(index.db, base.id),
        healthScore: computeKnowledgeHealthScore(summary),
        governanceStatus:
          conflictCount > 0
            ? "conflict"
            : summary.openDuplicateCount > 0 ||
                summary.openStaleCount > 0 ||
                summary.openOrphanCount > 0
              ? "attention"
              : "healthy",
      };
    } finally {
      index.close();
    }
  } catch {
    return {
      ...base,
      reservedKind: resolveReservedDeliverableFolderKind(base) ?? undefined,
      chunkCount: 0,
      relationCount: 0,
      relationBreakdown: { reference: 0, duplicate: 0, conflict: 0 },
      conflictCount: 0,
      citationCount: 0,
      activeAgentCount: 0,
      scoreAverages: { quality: null, trust: null, freshness: null },
      healthScore: 100,
      governanceStatus: "healthy",
    };
  }
}

function normalizeKnowledgeBaseVisibilityParam(value: unknown): KnowledgeBaseVisibility {
  return value === "team" || value === "enterprise" ? value : "private";
}

function normalizeDeliverableSourceParam(value: unknown): WorkspaceDeliverableSource | undefined {
  return value === "chat" || value === "agent" || value === "group" || value === "task"
    ? value
    : undefined;
}

function normalizeKnowledgeBaseMemberRole(value: unknown): KnowledgeBaseMemberRole {
  return value === "admin" || value === "editor" ? value : "viewer";
}

function knowledgeBasePermissionActor(
  context: KnowledgeSourceContext,
  email: string | null | undefined,
) {
  return buildKnowledgeBasePermissionActor({ context, email });
}

function authorizedKnowledgeBase(
  kbId: string,
  context: KnowledgeSourceContext,
  email: string | null | undefined,
  permission: KnowledgeBasePermission,
): KnowledgeBase | null {
  if (!context.userId) {
    return null;
  }
  return resolveAuthorizedKnowledgeBase({
    knowledgeBaseId: kbId,
    actor: knowledgeBasePermissionActor(context, email),
    permission,
  });
}

function clientUserEmail(client: { user?: string | null } | null | undefined): string | null {
  return typeof client?.user === "string" ? client.user : null;
}

async function maybeIngestPersonalKnowledge(params: {
  knowledgeBaseId: string | undefined;
  ownerId: string | null;
  run: () => Promise<PersonalKnowledgeIngestOutcome>;
}): Promise<PersonalKnowledgeIngestOutcome | null> {
  if (!params.knowledgeBaseId || !params.ownerId) {
    return null;
  }
  return params.run();
}

async function findExistingKnowledgeDocumentIdByRawHash(params: {
  knowledgeBase: KnowledgeBase;
  attachment: import("../knowledge/personal-document-upload.js").PersonalDocumentUploadAttachment;
  indexRoot?: string;
}): Promise<string | null> {
  const source = attachmentToSourceBuffer(params.attachment);
  if (!source) {
    return null;
  }
  const dbPath = resolveKnowledgeIndexDbPath({
    ownerId: params.knowledgeBase.ownerId,
    tenantId: params.knowledgeBase.tenantId,
    indexRoot: resolveKnowledgeIndexRootForBase(params.knowledgeBase, {
      indexRoot: params.indexRoot,
    }),
  });
  if (!fs.existsSync(dbPath)) {
    return null;
  }
  const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
  try {
    const row = index.db
      .prepare(
        `SELECT d.doc_id AS doc_id
           FROM documents d
           JOIN document_versions dv ON dv.version_id = d.current_version_id
          WHERE d.kb_id = ? AND dv.raw_hash = ?
          ORDER BY d.updated_at DESC
          LIMIT 1`,
      )
      .get(params.knowledgeBase.id, computeRawContentHash(source.buffer)) as
      | { doc_id: string }
      | undefined;
    return row?.doc_id?.trim() || null;
  } finally {
    index.close();
  }
}

function resolveExistingPersonalKnowledgeObject(docId: string): {
  object: {
    id: string;
    title: string;
    source: "personal";
    kind: "document";
    summary: string;
    tags: string[];
    updatedAt: number;
  };
  skillId: string;
} | null {
  const skillId = docId.trim();
  if (!skillId) {
    return null;
  }
  const existing = loadPersonalKnowledgeObjectBySkillId(skillId);
  if (existing) {
    return {
      skillId,
      object: {
        id: existing.id,
        title: existing.title,
        source: "personal",
        kind: "document",
        summary: existing.summary,
        tags: existing.tags,
        updatedAt: existing.updatedAt,
      },
    };
  }
  return null;
}

function didPersonalKnowledgeIngestSucceed(
  ingest: PersonalKnowledgeIngestOutcome | null | undefined,
): boolean {
  if (!ingest) {
    return false;
  }
  return ingest.attempted && !ingest.skipped && !ingest.error;
}

function personalKnowledgeIngestFailureMessage(
  ingest: PersonalKnowledgeIngestOutcome | null | undefined,
): string | null {
  if (!ingest) {
    return null;
  }
  return ingest.error ?? (ingest.skipped ? (ingest.reason ?? "knowledge ingest failed") : null);
}

function isDigitizedKnowledgeIngest(
  ingest: PersonalKnowledgeIngestOutcome | null | undefined,
): boolean {
  return didPersonalKnowledgeIngestSucceed(ingest) && (ingest?.chunkCount ?? 0) > 0;
}

function rollbackUndigitizedPersonalCatalog(skillId: string) {
  const id = skillId.trim();
  if (!id) {
    return;
  }
  try {
    deletePersonalSkillAsset(id);
  } catch {
    // Construction still fails closed even if the catalog row cannot be removed.
  }
}

/** Knowledge-base construction succeeds only when the file is indexed. Catalog-only is not done. */
function completeKnowledgeBaseConstruction(params: {
  skillId: string;
  knowledgeBaseId?: string;
  ingest: PersonalKnowledgeIngestOutcome | null;
}): { ok: true } | { ok: false; message: string } {
  if (!params.knowledgeBaseId) {
    return { ok: true };
  }
  if (isDigitizedKnowledgeIngest(params.ingest)) {
    const base = getKnowledgeBase(params.knowledgeBaseId);
    if (!base) {
      return { ok: false, message: "knowledge base not found" };
    }
    assertKnowledgeOriginalWritable({
      kbId: base.id,
      docId: knowledgeDocumentIdFromSkillRef(base.id, params.skillId),
      originalsRoot: resolveKnowledgeDirectoryLayoutForBase(base).originalsRoot,
    });
    attachDocumentToKnowledgeBase(
      params.knowledgeBaseId,
      knowledgeDocumentIdFromSkillRef(params.knowledgeBaseId, params.skillId),
    );
    return { ok: true };
  }
  rollbackUndigitizedPersonalCatalog(params.skillId);
  return {
    ok: false,
    message:
      personalKnowledgeIngestFailureMessage(params.ingest) ??
      "knowledge ingest failed: document was not digitized",
  };
}

function maybeSkillDocumentId(documentId: string): string | null {
  const trimmed = documentId.trim();
  if (!trimmed) {
    return null;
  }
  return /^skill_[a-z0-9]+$/i.test(trimmed) ? trimmed : null;
}

async function hardDeleteKnowledgeBaseDocument(params: {
  knowledgeBase: KnowledgeBase;
  documentId: string;
  ownerId: string;
}): Promise<KnowledgeBase> {
  return withKnowledgeDocumentMutation(
    {
      kbId: params.knowledgeBase.id,
      docId: params.documentId,
      originalsRoot: resolveKnowledgeDirectoryLayoutForBase(params.knowledgeBase).originalsRoot,
    },
    async () => {
      const knowledgeBasesInScope = listKnowledgeBases({
        ownerId: params.knowledgeBase.ownerId,
        ...(params.knowledgeBase.tenantId ? { tenantId: params.knowledgeBase.tenantId } : {}),
      });
      const referencedElsewhere = knowledgeBasesInScope.some((base) => {
        if (base.id === params.knowledgeBase.id) {
          return false;
        }
        return (
          base.documentIds.includes(params.documentId) ||
          (base.recycledDocumentIds ?? []).includes(params.documentId)
        );
      });
      const { markKnowledgeOriginalDeleted, deleteKnowledgeOriginal } =
        await import("../knowledge/knowledge-original-store.js");
      const original = {
        kbId: params.knowledgeBase.id,
        docId: params.documentId,
        originalsRoot: resolveKnowledgeDirectoryLayoutForBase(params.knowledgeBase).originalsRoot,
      };
      // Persist before any destructive work/await. This terminal intent survives a
      // partial filesystem failure and blocks every preview fallback after restart.
      markKnowledgeOriginalDeleted(original);
      deleteKnowledgeOriginal(original);
      deleteKnowledgeOriginal({ kbId: original.kbId, docId: original.docId });
      if (referencedElsewhere) {
        // Other KBs keep their shared index/asset; only this KB's originals are revoked.
        return deleteDocumentFromKnowledgeBase(params.knowledgeBase.id, params.documentId);
      }
      deleteReservedDeliverableOriginal({
        knowledgeBase: params.knowledgeBase,
        documentId: params.documentId,
      });

      const indexRoot = resolveKnowledgeIndexRootForBase(params.knowledgeBase);
      const dbPath = resolveKnowledgeIndexDbPath({
        ownerId: params.knowledgeBase.ownerId,
        tenantId: params.knowledgeBase.tenantId,
        indexRoot,
      });
      // Membership is changed only after successful cleanup/index deletion. Never
      // restore a whole-store snapshot over unrelated writes while awaiting the index.
      if (fs.existsSync(dbPath)) {
        const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
        try {
          deleteKnowledgeDocumentFromIndex({
            db: index.db,
            index,
            docId: params.documentId,
          });
        } finally {
          index.close();
        }
      }
      // Drop Obsidian explicit metadata so removed docs cannot bleed into other graphs.
      try {
        const { deleteExplicitDocumentMetadata } =
          await import("../knowledge/explicit-metadata-store.js");
        deleteExplicitDocumentMetadata(params.documentId);
      } catch {
        // best-effort
      }
      try {
        deleteSourceDocumentLinksForDocId(params.documentId);
      } catch {
        // best-effort
      }
      const next = deleteDocumentFromKnowledgeBase(params.knowledgeBase.id, params.documentId);

      const skillId = maybeSkillDocumentId(params.documentId);
      if (
        skillId &&
        params.knowledgeBase.ownerId === params.ownerId &&
        params.knowledgeBase.visibility === "private"
      ) {
        try {
          getPersonalSkillAssetDetail(skillId);
          const stillReferenced = listKnowledgeBases({ ownerId: params.ownerId }).some((base) => {
            if (base.id === params.knowledgeBase.id) {
              return false;
            }
            return (
              base.documentIds.includes(skillId) ||
              (base.recycledDocumentIds ?? []).includes(skillId)
            );
          });
          if (!stillReferenced) {
            deletePersonalSkillAsset(skillId);
          }
        } catch {
          // Not a personal skill asset or already absent; deleting the KB source is enough.
        }
      }

      return next;
    },
  );
}

function resolveKnowledgeGovernanceOwnershipProof(context: {
  userId: string | null;
  tenantId: string | null;
}) {
  const userId = context.userId?.trim();
  if (!userId) {
    return undefined;
  }
  const tenantId = context.tenantId?.trim() || null;
  return tenantId
    ? ownershipProofFromTenantUser({ tenantId, userId })
    : ownershipProofFromLocalUser({ userId });
}

function resolveKnowledgeBaseIdForPersonalMutation(params: {
  explicitKbId: string | undefined;
  context: { userId: string | null; tenantId: string | null };
}): {
  knowledgeBaseId: string | undefined;
  compatWarnings: KnowledgeCompatWarning[];
  rejectedReason?: string;
} {
  return resolvePersonalImportKnowledgeBase({
    explicitKbId: params.explicitKbId,
    ownerId: params.context.userId,
    tenantId: params.context.tenantId,
  });
}

export const knowledgeHandlers: GatewayRequestHandlers = {
  "knowledge.search": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const payload = await knowledgeSearch(client, {
      query: stringParam(record.query),
      limit: numberParam(record.limit, 20),
    });
    respond(true, payload);
  },

  "knowledge.capability.preview": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    try {
      const context = await resolveKnowledgeSourceContext(client);
      if (!context.userId) {
        throw new Error("user context required");
      }
      const preview = await previewKnowledgeIndexCapability({
        ownerId: context.userId,
        tenantId: context.tenantId,
        limit: numberParam(record.limit, 5),
      });
      respond(true, { preview });
    } catch (error) {
      const message = error instanceof Error ? error.message : "capability preview failed";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.runtime.context": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const taskContext = parseTaskContext(record.taskContext) ?? { taskType: "general" };
    const selection = isRecord(record.selection) ? record.selection : undefined;
    const consumeRefs = parseKnowledgeConsumeRefs(selection?.refs);
    try {
      const runtime = await resolveKnowledgeRuntimeContext(client, {
        taskContext,
        query: stringParam(record.query),
        ...(consumeRefs.length > 0 ? { selection: { refs: consumeRefs } } : {}),
      });
      respond(true, runtime);
    } catch (error) {
      const message = error instanceof Error ? error.message : "knowledge runtime context failed";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.workspace.search": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    try {
      const payload = await searchWorkspace(client, {
        query: stringParam(record.query),
        limitPerGroup: numberParam(record.limitPerGroup, 5),
      });
      respond(true, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "workspace search failed";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.object": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const objectId = stringParam(record.objectId);
    const nodeId = stringParam(record.nodeId);
    if (!objectId && !nodeId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "objectId or nodeId required"),
      );
      return;
    }
    const object = objectId
      ? await knowledgeObject(client, { objectId })
      : nodeId
        ? await knowledgeObjectForNode(client, nodeId)
        : null;
    if (!object) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "knowledge object not found"),
      );
      return;
    }
    respond(true, { object });
  },

  "knowledge.recommendations": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const taskContext = parseTaskContext(record.taskContext);
    respond(true, {
      recommendations: await knowledgeRecommendations(client, {
        limit: numberParam(record.limit, 4),
        focusObjectId: stringParam(record.focusObjectId) ?? null,
        taskContext,
      }),
    });
  },

  "knowledge.discovery.list": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    respond(true, {
      events: await knowledgeDiscoveryList(client, {
        limit: numberParam(record.limit, 8),
        lookbackMs: numberParam(record.lookbackMs, 30 * 24 * 60 * 60 * 1000),
      }),
    });
  },

  "knowledge.actions.list": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    respond(true, {
      actions: await knowledgeActionsList(client, {
        limit: numberParam(record.limit, 4),
        knowledgeBaseId: stringParam(record.knowledgeBaseId) ?? null,
        focusObjectId: stringParam(record.focusObjectId) ?? null,
        deliverableId: stringParam(record.deliverableId) ?? null,
      }),
    });
  },

  "knowledge.recent": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    respond(true, {
      visits: await knowledgeRecent(client, {
        limit: numberParam(record.limit, 8),
      }),
    });
  },

  "knowledge.recent.record": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const objectId = stringParam(record.objectId);
    if (!objectId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "objectId required"));
      return;
    }
    respond(true, await knowledgeRecentRecord(client, { objectId }));
  },

  "knowledge.relationships": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    respond(true, {
      graph: await knowledgeRelationships(client, {
        query: stringParam(record.query),
        focusNodeId: stringParam(record.focusNodeId) ?? null,
        focusDocumentId: stringParam(record.focusDocumentId) ?? null,
        knowledgeBaseId: stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId) ?? null,
      }),
    });
  },

  "knowledge.related": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const objectId = stringParam(record.objectId);
    if (!objectId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "objectId required"));
      return;
    }
    respond(true, await knowledgeRelated(client, { objectId }));
  },

  "knowledge.resolve": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const taskContext = parseTaskContext(record.taskContext);
    if (!taskContext) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "taskContext.taskType required"),
      );
      return;
    }
    respond(
      true,
      await knowledgeResolve(client, {
        taskContext,
        query: stringParam(record.query),
      }),
    );
  },

  "knowledge.context": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const taskContext = parseTaskContext(record.taskContext);
    if (!taskContext) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "taskContext.taskType required"),
      );
      return;
    }
    respond(
      true,
      await knowledgeContext(client, {
        taskContext,
        query: stringParam(record.query),
      }),
    );
  },

  "knowledge.agent-profile": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const taskContext = parseTaskContext(record.taskContext);
    respond(true, {
      profile: await knowledgeAgentProfile(client, {
        agentId: stringParam(record.agentId),
        taskContext,
      }),
    });
  },

  "knowledge.feed.list": async ({ respond, client }) => {
    respond(true, await knowledgeFeedList(client));
  },

  // P2: daily digest over discovery + actions + recommendations (read model only).
  "knowledge.feed.digest": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const limit = numberParam(record.limit, 8);
    const [discovery, actions, recommendations] = await Promise.all([
      knowledgeDiscoveryList(client, { limit: 40 }),
      knowledgeActionsList(client, { limit }),
      knowledgeRecommendations(client, { limit }),
    ]);
    respond(true, {
      digest: buildKnowledgeFeedDailyDigest({
        discoveryEvents: discovery,
        actions,
        recommendations,
      }),
    });
  },

  // P2: timeline buckets from discovery events.
  "knowledge.timeline.list": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    respond(
      true,
      await listKnowledgeTimeline({
        client,
        limit: numberParam(record.limit, 40),
        lookbackMs: numberParam(record.lookbackMs, 14 * 24 * 60 * 60 * 1000),
      }),
    );
  },

  "knowledge.lineage.explain": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const objectId = stringParam(record.objectId);
    const lineageId = stringParam(record.lineageId);
    if (!objectId && !lineageId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "objectId or lineageId required"),
      );
      return;
    }
    try {
      respond(true, {
        explain: await knowledgeLineageExplain(client, { objectId, lineageId }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "lineage explain failed";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.cognitive.bundle": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const taskContext = parseTaskContext(record.taskContext);
    if (!taskContext) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "taskContext.taskType required"),
      );
      return;
    }
    respond(
      true,
      await knowledgeCognitiveBundle(client, {
        taskContext,
        query: stringParam(record.query),
      }),
    );
  },

  "knowledge.personal.collect": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const resolvedKb = resolveKnowledgeBaseIdForPersonalMutation({
      explicitKbId: stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId),
      context,
    });
    const kbId = resolvedKb.knowledgeBaseId;
    try {
      if (resolvedKb.rejectedReason) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, resolvedKb.rejectedReason),
        );
        return;
      }
      const authorizedKb = kbId
        ? authorizedKnowledgeBase(kbId, context, clientUser, "write")
        : null;
      if (kbId && !authorizedKb) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
        );
        return;
      }
      const result = collectPersonalKnowledge({
        title: stringParam(record.title) ?? "",
        summary: stringParam(record.summary) ?? "",
        tags: stringArrayParam(record.tags),
        sourceAgentId: stringParam(record.sourceAgentId),
        ownerUserId: context.userId,
        contextId: stringParam(record.contextId) ?? null,
      });
      const ingest = await maybeIngestPersonalKnowledge({
        knowledgeBaseId: kbId,
        ownerId: context.userId,
        run: () =>
          ingestCollectedPersonalKnowledge({
            knowledgeBaseId: kbId ?? "",
            skillId: result.skillId,
            title: result.object.title,
            summary: stringParam(record.summary) ?? "",
            ownerId: context.userId ?? "",
            knowledgeBase: authorizedKb ?? undefined,
            governanceOwnershipProof: resolveKnowledgeGovernanceOwnershipProof(context),
          }),
      });
      const construction = completeKnowledgeBaseConstruction({
        skillId: result.skillId,
        knowledgeBaseId: kbId,
        ingest,
      });
      if (!construction.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, construction.message));
        return;
      }
      respond(
        true,
        appendCompatWarnings(
          { ...result, ingest, ...(kbId ? { knowledgeBaseId: kbId } : {}) },
          resolvedKb.compatWarnings,
        ),
      );
    } catch (error) {
      respondKnowledgeMutationError(respond, error);
    }
  },

  "knowledge.personal.collectWeb": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const url = (stringParam(record.url) ?? "").trim();
    if (!/^https?:\/\//i.test(url)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "valid http(s) url required"),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const resolvedKb = resolveKnowledgeBaseIdForPersonalMutation({
      explicitKbId: stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId),
      context,
    });
    const kbId = resolvedKb.knowledgeBaseId;
    try {
      if (resolvedKb.rejectedReason) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, resolvedKb.rejectedReason),
        );
        return;
      }
      const authorizedKb = kbId
        ? authorizedKnowledgeBase(kbId, context, clientUser, "write")
        : null;
      if (kbId && !authorizedKb) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
        );
        return;
      }
      let resolvedClip: Awaited<ReturnType<typeof resolveWebClipContent>>;
      try {
        resolvedClip = await resolveWebClipContent({
          url,
          title: stringParam(record.title) ?? undefined,
          text: stringParam(record.text) ?? undefined,
          html: stringParam(record.html) ?? undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "web fetch failed";
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
        return;
      }
      const text = resolvedClip.text.trim();
      if (!text) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "web page had no extractable text"),
        );
        return;
      }
      const title = resolvedClip.title?.trim() || url;
      const snippet = text.length > 480 ? `${text.slice(0, 480).trim()}…` : text;
      const result = collectPersonalKnowledge({
        title,
        summary: `${snippet}\n\n来源: ${url}`,
        tags: stringArrayParam(record.tags),
        sourceAgentId: stringParam(record.sourceAgentId),
        contextId: url,
      });
      const ingest = await maybeIngestPersonalKnowledge({
        knowledgeBaseId: kbId,
        ownerId: context.userId,
        run: () =>
          ingestWebReferencePersonalKnowledge({
            knowledgeBaseId: kbId ?? "",
            skillId: result.skillId,
            title,
            url,
            text,
            ownerId: context.userId ?? "",
            knowledgeBase: authorizedKb ?? undefined,
          }),
      });
      const construction = completeKnowledgeBaseConstruction({
        skillId: result.skillId,
        knowledgeBaseId: kbId,
        ingest,
      });
      if (!construction.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, construction.message));
        return;
      }
      respond(
        true,
        appendCompatWarnings(
          {
            ...result,
            ingest,
            url,
            clipSource: resolvedClip.source,
            ...(kbId ? { knowledgeBaseId: kbId } : {}),
          },
          resolvedKb.compatWarnings,
        ),
      );
    } catch (error) {
      respondKnowledgeMutationError(respond, error);
    }
  },

  "knowledge.personal.importDataset": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const records = parseDatasetImportRecords(record.records);
    if (records.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "records required (non-empty text entries)"),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const resolvedKb = resolveKnowledgeBaseIdForPersonalMutation({
      explicitKbId: stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId),
      context,
    });
    const kbId = resolvedKb.knowledgeBaseId;
    try {
      if (resolvedKb.rejectedReason) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, resolvedKb.rejectedReason),
        );
        return;
      }
      const authorizedKb = kbId
        ? authorizedKnowledgeBase(kbId, context, clientUser, "write")
        : null;
      if (kbId && !authorizedKb) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
        );
        return;
      }
      if (!kbId || !context.userId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "user context required to import dataset"),
        );
        return;
      }
      const result = await importDatasetPersonalKnowledge({
        knowledgeBaseId: kbId,
        datasetTitle: stringParam(record.datasetTitle) ?? stringParam(record.title) ?? "数据集",
        records,
        ownerId: context.userId,
        knowledgeBase: authorizedKb ?? undefined,
        governanceOwnershipProof: resolveKnowledgeGovernanceOwnershipProof(context),
      });
      respond(
        true,
        appendCompatWarnings({ knowledgeBaseId: kbId, ...result }, resolvedKb.compatWarnings),
      );
    } catch (error) {
      respondKnowledgeMutationError(respond, error);
    }
  },

  "knowledge.web.setRefreshPolicy": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const url = (stringParam(record.url) ?? "").trim();
    if (!/^https?:\/\//i.test(url)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "valid http(s) url required"),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const resolvedKb = resolveKnowledgeBaseIdForPersonalMutation({
      explicitKbId: stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId),
      context,
    });
    const kbId = resolvedKb.knowledgeBaseId;
    if (resolvedKb.rejectedReason || !kbId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolvedKb.rejectedReason ?? "knowledgeBaseId required",
        ),
      );
      return;
    }
    const knowledgeBase = authorizedKnowledgeBase(kbId, context, clientUser, "write");
    if (!knowledgeBase) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
      );
      return;
    }
    try {
      const intervalMs = record.intervalMs;
      const policy = await setWebSourceRefreshPolicy({
        knowledgeBase,
        url,
        docId: stringParam(record.docId) ?? null,
        enabled: record.enabled !== false,
        ...(typeof intervalMs === "number" && Number.isFinite(intervalMs) ? { intervalMs } : {}),
      });
      respond(true, { knowledgeBaseId: kbId, policy });
    } catch (error) {
      respondKnowledgeMutationError(respond, error);
    }
  },

  "knowledge.web.runDueRefreshes": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const resolvedKb = resolveKnowledgeBaseIdForPersonalMutation({
      explicitKbId: stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId),
      context,
    });
    const kbId = resolvedKb.knowledgeBaseId;
    if (resolvedKb.rejectedReason || !kbId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          resolvedKb.rejectedReason ?? "knowledgeBaseId required",
        ),
      );
      return;
    }
    const knowledgeBase = authorizedKnowledgeBase(kbId, context, clientUser, "write");
    if (!knowledgeBase) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
      );
      return;
    }
    try {
      const results = await runDueWebSourceRefreshes({
        knowledgeBase,
        fetcher: (url) => fetchWebPageForKnowledge({ url }),
        limit: numberParam(record.limit, 25),
      });
      respond(true, { knowledgeBaseId: kbId, refreshed: results.length, results });
    } catch (error) {
      respondKnowledgeMutationError(respond, error);
    }
  },

  "knowledge.personal.upload": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const attachment = isRecord(record.attachment) ? record.attachment : null;
    const fileName = attachment ? stringParam(attachment.fileName) : undefined;
    const mimeType = attachment ? stringParam(attachment.mimeType) : undefined;
    const kind = attachment ? stringParam(attachment.kind) : undefined;
    if (!attachment || !fileName || !mimeType || !kind) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "attachment required"));
      return;
    }
    if (kind !== "text" && kind !== "image" && kind !== "binary") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid attachment kind"));
      return;
    }
    const size =
      typeof attachment.size === "number" && Number.isFinite(attachment.size) ? attachment.size : 0;
    const parsedAttachment = {
      fileName,
      mimeType,
      size,
      kind,
      // Preserve original bytes; stringParam trims source whitespace.
      textContent: typeof attachment.textContent === "string" ? attachment.textContent : undefined,
      dataUrl: stringParam(attachment.dataUrl),
    } as const;
    const ingestParseOptions = parseKnowledgeIngestParseOptions(record.ingestOptions);
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const resolvedKb = resolveKnowledgeBaseIdForPersonalMutation({
      explicitKbId: stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId),
      context,
    });
    const kbId = resolvedKb.knowledgeBaseId;
    try {
      if (resolvedKb.rejectedReason) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, resolvedKb.rejectedReason),
        );
        return;
      }
      const authorizedKb = kbId
        ? authorizedKnowledgeBase(kbId, context, clientUser, "write")
        : null;
      if (kbId && !authorizedKb) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
        );
        return;
      }
      const duplicateDocId =
        authorizedKb && kbId
          ? await findExistingKnowledgeDocumentIdByRawHash({
              knowledgeBase: authorizedKb,
              attachment: parsedAttachment,
            })
          : null;
      if (duplicateDocId) {
        const existing = resolveExistingPersonalKnowledgeObject(duplicateDocId);
        if (existing) {
          respond(true, {
            skillId: existing.skillId,
            object: existing.object,
            ingest: {
              attempted: true,
              skipped: true,
              reason: "duplicate document already exists in this knowledge base",
            },
            deduped: true,
            ...(kbId ? { knowledgeBaseId: kbId } : {}),
          });
          return;
        }
      }
      const contentOverride =
        parsedAttachment.kind === "image"
          ? await extractImageTextForKnowledge({ attachment: parsedAttachment, client })
          : stringParam(record.content);
      const result = uploadPersonalKnowledge({
        title: stringParam(record.title),
        summary: stringParam(record.summary),
        tags: stringArrayParam(record.tags),
        content: contentOverride,
        sourceAgentId: stringParam(record.sourceAgentId),
        ownerUserId: context.userId,
        attachment: parsedAttachment,
      });
      const ingest = await maybeIngestPersonalKnowledge({
        knowledgeBaseId: kbId,
        ownerId: context.userId,
        run: () =>
          ingestUploadedPersonalKnowledge({
            knowledgeBaseId: kbId ?? "",
            skillId: result.skillId,
            title: result.object.title,
            ownerId: context.userId ?? "",
            attachment: parsedAttachment,
            client,
            ...(parsedAttachment.kind === "image"
              ? { imageOcrText: contentOverride ?? undefined }
              : {}),
            knowledgeBase: authorizedKb ?? undefined,
            parseOptions: ingestParseOptions,
            governanceOwnershipProof: resolveKnowledgeGovernanceOwnershipProof(context),
          }),
      });
      const construction = completeKnowledgeBaseConstruction({
        skillId: result.skillId,
        knowledgeBaseId: kbId,
        ingest,
      });
      if (!construction.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, construction.message));
        return;
      }
      respond(
        true,
        appendCompatWarnings(
          { ...result, ingest, ...(kbId ? { knowledgeBaseId: kbId } : {}) },
          resolvedKb.compatWarnings,
        ),
      );
    } catch (error) {
      respondKnowledgeMutationError(respond, error);
    }
  },

  "knowledge.personal.uploadFolder": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const rawAttachments = Array.isArray(record.attachments) ? record.attachments : [];
    if (rawAttachments.length === 0) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "attachments required"));
      return;
    }
    // Bound a single folder import the same way dataset import is bounded.
    const FOLDER_UPLOAD_MAX_FILES = 200;
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const resolvedKb = resolveKnowledgeBaseIdForPersonalMutation({
      explicitKbId: stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId),
      context,
    });
    const kbId = resolvedKb.knowledgeBaseId;
    try {
      if (resolvedKb.rejectedReason) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, resolvedKb.rejectedReason),
        );
        return;
      }
      const authorizedKb = kbId
        ? authorizedKnowledgeBase(kbId, context, clientUser, "write")
        : null;
      if (kbId && !authorizedKb) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
        );
        return;
      }
      const folderName = stringParam(record.folderName) ?? null;
      const tags = stringArrayParam(record.tags);
      const sourceAgentId = stringParam(record.sourceAgentId);
      const ingestParseOptions = parseKnowledgeIngestParseOptions(record.ingestOptions);
      const documents: Array<{
        skillId: string;
        title: string;
        fileName: string;
        ingest: Awaited<ReturnType<typeof maybeIngestPersonalKnowledge>>;
      }> = [];
      const skipped: Array<{ fileName: string; reason: string }> = [];
      // Each file is uploaded + (best-effort) ingested independently so one bad
      // file never aborts the whole folder; failures are reported in `skipped`.
      for (let index = 0; index < rawAttachments.length; index += 1) {
        const entry = isRecord(rawAttachments[index]) ? rawAttachments[index] : null;
        const fileName = entry ? stringParam(entry.fileName) : undefined;
        if (documents.length >= FOLDER_UPLOAD_MAX_FILES) {
          skipped.push({
            fileName: fileName ?? `#${index + 1}`,
            reason: "folder upload file limit reached",
          });
          continue;
        }
        const mimeType = entry ? stringParam(entry.mimeType) : undefined;
        const kind = entry ? stringParam(entry.kind) : undefined;
        if (!entry || !fileName || !mimeType || !kind) {
          skipped.push({ fileName: fileName ?? `#${index + 1}`, reason: "invalid attachment" });
          continue;
        }
        if (kind !== "text" && kind !== "image" && kind !== "binary") {
          skipped.push({ fileName, reason: "invalid attachment kind" });
          continue;
        }
        const size = typeof entry.size === "number" && Number.isFinite(entry.size) ? entry.size : 0;
        const parsedAttachment = {
          fileName,
          mimeType,
          size,
          kind,
          textContent: typeof entry.textContent === "string" ? entry.textContent : undefined,
          dataUrl: stringParam(entry.dataUrl),
        } as const;
        try {
          const duplicateDocId =
            authorizedKb && kbId
              ? await findExistingKnowledgeDocumentIdByRawHash({
                  knowledgeBase: authorizedKb,
                  attachment: parsedAttachment,
                })
              : null;
          if (duplicateDocId) {
            skipped.push({
              fileName,
              reason: "duplicate document already exists in this knowledge base",
            });
            continue;
          }
          const contentOverride =
            parsedAttachment.kind === "image"
              ? await extractImageTextForKnowledge({ attachment: parsedAttachment, client })
              : undefined;
          const uploaded = uploadPersonalKnowledge({
            tags,
            sourceAgentId,
            ownerUserId: context.userId,
            ...(contentOverride ? { content: contentOverride } : {}),
            attachment: parsedAttachment,
          });
          const ingest = await maybeIngestPersonalKnowledge({
            knowledgeBaseId: kbId,
            ownerId: context.userId,
            run: () =>
              ingestUploadedPersonalKnowledge({
                knowledgeBaseId: kbId ?? "",
                skillId: uploaded.skillId,
                title: uploaded.object.title,
                ownerId: context.userId ?? "",
                attachment: parsedAttachment,
                client,
                ...(contentOverride ? { imageOcrText: contentOverride } : {}),
                knowledgeBase: authorizedKb ?? undefined,
                parseOptions: ingestParseOptions,
                governanceOwnershipProof: resolveKnowledgeGovernanceOwnershipProof(context),
              }),
          });
          const construction = completeKnowledgeBaseConstruction({
            skillId: uploaded.skillId,
            knowledgeBaseId: kbId,
            ingest,
          });
          if (!construction.ok) {
            skipped.push({ fileName, reason: construction.message });
            continue;
          }
          documents.push({
            skillId: uploaded.skillId,
            title: uploaded.object.title,
            fileName,
            ingest,
          });
        } catch (error) {
          skipped.push({
            fileName,
            reason: error instanceof Error ? error.message : "failed to import file",
          });
        }
      }
      respond(
        true,
        appendCompatWarnings(
          {
            folderName,
            imported: documents.length,
            total: rawAttachments.length,
            documents,
            skipped,
            ...(kbId ? { knowledgeBaseId: kbId } : {}),
          },
          resolvedKb.compatWarnings,
        ),
      );
    } catch (error) {
      respondKnowledgeMutationError(respond, error);
    }
  },

  "knowledge.personal.versions": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const objectId = stringParam(record.objectId);
    if (!objectId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "objectId required"));
      return;
    }
    try {
      const context = await resolveKnowledgeSourceContext(client);
      authorizePersonalKnowledgeObjectAccess({ objectId, userId: context.userId });
      respond(true, { versions: listPersonalKnowledgeVersions(objectId) });
    } catch (error) {
      if (isPersonalKnowledgeAuthError(error)) {
        const code =
          error.code === "UNAUTHORIZED"
            ? ErrorCodes.INVALID_REQUEST
            : error.code === "FORBIDDEN"
              ? ErrorCodes.INVALID_REQUEST
              : ErrorCodes.INVALID_REQUEST;
        respond(false, undefined, errorShape(code, error.message));
        return;
      }
      respondKnowledgeMutationError(respond, error);
    }
  },

  "knowledge.access.request": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const capabilityId = stringParam(record.capabilityId);
    const capabilityTitle = stringParam(record.capabilityTitle);
    if (!capabilityId || !capabilityTitle) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "capabilityId and capabilityTitle required"),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.tenantId || !context.seatId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "enterprise seat context required for data access request",
        ),
      );
      return;
    }
    try {
      const storePath = await resolveControlPlaneStorePathForClient(
        client,
        TENANT_ENTERPRISE_DATA_FILE,
      );
      const store = await loadEnterpriseDataStore(storePath);
      const nowIso = new Date().toISOString();
      const approval = createSeatCapabilityAccessRequest({
        store,
        tenantId: context.tenantId,
        seatId: context.seatId,
        capabilityId,
        capabilityTitle,
        requestedBy: context.userId ?? context.seatId,
        nowIso,
      });
      await saveEnterpriseDataStore(store, storePath);
      respond(true, {
        request: {
          requestId: approval.approvalId,
          governanceApprovalId: approval.approvalId,
          capabilityId,
          capabilityTitle,
          tenantId: context.tenantId,
          seatId: context.seatId,
          status: "pending" as const,
          createdAt: Date.parse(approval.requestedAt) || Date.now(),
        },
      });
    } catch (error) {
      if (error instanceof EnterpriseDataStoreError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
        return;
      }
      respondKnowledgeMutationError(respond, error);
    }
  },

  "knowledge.enterprise.access.request": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const projectionId = stringParam(record.projectionId);
    const projectionTitle = stringParam(record.projectionTitle);
    if (!projectionId || !projectionTitle) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "projectionId and projectionTitle required"),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.tenantId || !context.seatId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "enterprise seat context required for enterprise knowledge access request",
        ),
      );
      return;
    }
    try {
      const storePath = await resolveControlPlaneStorePathForClient(
        client,
        TENANT_ENTERPRISE_DATA_FILE,
      );
      const store = await loadEnterpriseDataStore(storePath);
      const nowIso = new Date().toISOString();
      const approval = createEnterpriseKnowledgeAccessRequest({
        store,
        tenantId: context.tenantId,
        seatId: context.seatId,
        projectionId,
        projectionTitle,
        requestedBy: context.userId ?? context.seatId,
        nowIso,
      });
      await saveEnterpriseDataStore(store, storePath);
      respond(true, {
        request: {
          requestId: approval.approvalId,
          governanceApprovalId: approval.approvalId,
          projectionId,
          projectionTitle,
          tenantId: context.tenantId,
          seatId: context.seatId,
          status: "pending" as const,
          createdAt: Date.parse(approval.requestedAt) || Date.now(),
        },
      });
    } catch (error) {
      if (error instanceof EnterpriseDataStoreError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
        return;
      }
      respondKnowledgeMutationError(respond, error);
    }
  },

  "knowledge.personal.updateTags": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const objectId = stringParam(record.objectId);
    if (!objectId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "objectId required"));
      return;
    }
    try {
      const context = await resolveKnowledgeSourceContext(client);
      authorizePersonalKnowledgeObjectAccess({
        objectId,
        userId: context.userId,
        requireWrite: true,
      });
      const object = updatePersonalKnowledgeTags({
        objectId,
        tags: stringArrayParam(record.tags) ?? [],
      });
      respond(true, { object });
    } catch (error) {
      if (isPersonalKnowledgeAuthError(error)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
        return;
      }
      respondKnowledgeMutationError(respond, error);
    }
  },

  "knowledge.personal.compareVersions": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const objectId = stringParam(record.objectId);
    const fromVersion = stringParam(record.fromVersion);
    const toVersion = stringParam(record.toVersion);
    if (!objectId || !fromVersion || !toVersion) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "objectId, fromVersion and toVersion required"),
      );
      return;
    }
    try {
      const context = await resolveKnowledgeSourceContext(client);
      authorizePersonalKnowledgeObjectAccess({ objectId, userId: context.userId });
      respond(true, {
        diff: comparePersonalKnowledgeVersions({ objectId, fromVersion, toVersion }),
      });
    } catch (error) {
      if (isPersonalKnowledgeAuthError(error)) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
        return;
      }
      respondKnowledgeMutationError(respond, error);
    }
  },

  "knowledge.base.create": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const title = stringParam(record.title);
    if (!title) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "title required"));
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to create a knowledge base"),
      );
      return;
    }
    const visibility = normalizeKnowledgeBaseVisibilityParam(record.visibility);
    if ((visibility === "team" || visibility === "enterprise") && !context.tenantId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "enterprise seat context required for team/enterprise knowledge base",
        ),
      );
      return;
    }
    if (visibility === "enterprise") {
      const actor = knowledgeBasePermissionActor(context, clientUserEmail(client));
      const canProvisionEnterprise = listKnowledgeBases().some((base) => {
        if (base.visibility !== "enterprise") {
          return false;
        }
        return canWriteKnowledgeBase({
          knowledgeBase: base,
          actor,
          members: listKnowledgeBaseMembers(base.id),
        });
      });
      if (!canProvisionEnterprise) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "not authorized to create enterprise knowledge base",
          ),
        );
        return;
      }
    }
    try {
      const knowledgeBase = createKnowledgeBase({
        title,
        description: stringParam(record.description) ?? "",
        ownerId: context.userId,
        tenantId: context.tenantId,
        visibility,
        backendKind: visibility === "private" ? "personal" : "enterprise",
        tags: stringArrayParam(record.tags) ?? [],
        robotIds: stringArrayParam(record.robotIds) ?? [],
      });
      respond(true, { knowledgeBase });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.list": async ({ respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    if (context.userId) {
      try {
        ensureReservedDeliverableFolders({
          ownerId: context.userId,
          tenantId: context.tenantId,
        });
      } catch {
        // Listing must still succeed if reserved folders cannot be created.
      }
    }
    const actor = knowledgeBasePermissionActor(context, client?.user);
    // A base is visible when the caller owns it, is an active member, OR it is a
    // team/enterprise base in the caller's tenant. Tenant visibility means a
    // brand-new member sees pre-existing shared team/enterprise spaces without
    // first creating any personal space; explicit membership additionally covers
    // bases shared individually. Members are only loaded for shared bases — a
    // private base stays owner-only.
    const knowledgeBases = listKnowledgeBases().filter((base) =>
      canReadKnowledgeBase({
        knowledgeBase: base,
        actor,
        members: base.visibility === "private" ? undefined : listKnowledgeBaseMembers(base.id),
      }),
    );
    respond(true, {
      knowledgeBases: await Promise.all(
        knowledgeBases.map(async (base) => {
          const members =
            base.visibility === "private" ? undefined : listKnowledgeBaseMembers(base.id);
          const summary = await enrichKnowledgeBaseRuntimeSummary(base);
          return {
            ...summary,
            canWrite: canWriteKnowledgeBase({ knowledgeBase: base, actor, members }),
            canAdmin: canAdminKnowledgeBase({ knowledgeBase: base, actor, members }),
          };
        }),
      ),
    });
  },

  "knowledge.base.get": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    if (!kbId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId required"));
      return;
    }
    const knowledgeBase = getKnowledgeBase(kbId);
    const context = await resolveKnowledgeSourceContext(client);
    if (
      !knowledgeBase ||
      !isKnowledgeBaseVisible(
        knowledgeBaseRetrievalContext(context),
        toVisibilityKnowledgeBase(knowledgeBase),
      )
    ) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledge base not found"));
      return;
    }
    respond(true, { knowledgeBase });
  },

  "knowledge.base.documents.list": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    if (!kbId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId required"));
      return;
    }
    const knowledgeBase = getKnowledgeBase(kbId);
    const context = await resolveKnowledgeSourceContext(client);
    if (
      !knowledgeBase ||
      !isKnowledgeBaseVisible(
        knowledgeBaseRetrievalContext(context),
        toVisibilityKnowledgeBase(knowledgeBase),
      )
    ) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledge base not found"));
      return;
    }
    try {
      const documents = await listKnowledgeBaseDocumentsFromIndex({
        knowledgeBase,
        indexRoot: resolveKnowledgeIndexRootForBase(knowledgeBase),
      });
      respond(true, { knowledgeBaseId: kbId, documents });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.document.summary": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId);
    const docId = stringParam(record.documentId);
    if (!kbId || !docId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId and documentId required"),
      );
      return;
    }
    if (record.retry !== undefined) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "automatic summary generation is not available; maintain summary fields explicitly",
        ),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const fields = record.fields;
    const base = authorizedKnowledgeBase(
      kbId,
      context,
      clientUserEmail(client),
      fields === undefined && record.retry !== true && record.metadata === undefined
        ? "read"
        : "write",
    );
    if (!base) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledge base not found"));
      return;
    }
    let parsedFields;
    if (fields !== undefined) {
      parsedFields = parseRetrievalSummaryFields(fields);
      if (!parsedFields) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid summary fields"));
        return;
      }
    }
    let metadata:
      | import("../knowledge/retrieval-summary.js").RetrievalSummary["sourceRelations"]
      | undefined;
    let editorialStatus: "draft" | "final" | undefined;
    if (record.metadata !== undefined) {
      if (
        !record.metadata ||
        typeof record.metadata !== "object" ||
        Array.isArray(record.metadata)
      ) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "invalid summary metadata"),
        );
        return;
      }
      const value = record.metadata as Record<string, unknown>;
      if (
        value.editorialStatus !== undefined &&
        value.editorialStatus !== "draft" &&
        value.editorialStatus !== "final"
      ) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "invalid editorial status"),
        );
        return;
      }
      editorialStatus = value.editorialStatus;
      if (value.sourceRelations !== undefined) {
        if (
          !Array.isArray(value.sourceRelations) ||
          value.sourceRelations.length > 50 ||
          !value.sourceRelations.every(
            (item) =>
              item &&
              typeof item === "object" &&
              ["revision-of", "derived-from", "duplicate-of", "supersedes"].includes(item.kind) &&
              typeof item.documentId === "string" &&
              item.documentId.length < 500 &&
              (item.versionId === undefined || typeof item.versionId === "string"),
          )
        ) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "invalid source relations"),
          );
          return;
        }
        metadata = value.sourceRelations;
      }
    }
    try {
      const summary = await accessDocumentRetrievalSummary({
        knowledgeBase: base,
        docId,
        indexRoot: resolveKnowledgeIndexRootForBase(base),
        fields: parsedFields,
        metadata:
          record.metadata === undefined && parsedFields === undefined
            ? undefined
            : {
                sourceRelations: metadata,
                editorialStatus,
                reviewedBy: context.userId ?? undefined,
              },
      });
      respond(true, { documentId: docId, summary: summary ?? null });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.document.preview": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    const documentId = stringParam(record.documentId) ?? stringParam(record.docId);
    if (!kbId || !documentId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId and documentId required"),
      );
      return;
    }
    const knowledgeBase = getKnowledgeBase(kbId);
    const context = await resolveKnowledgeSourceContext(client);
    if (
      !knowledgeBase ||
      !isKnowledgeBaseVisible(
        knowledgeBaseRetrievalContext(context),
        toVisibilityKnowledgeBase(knowledgeBase),
      )
    ) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledge base not found"));
      return;
    }
    try {
      const payload = await previewKnowledgeDocument({
        knowledgeBaseId: kbId,
        documentId,
        render: record.render === true,
        userId: context.userId,
        tenantId: context.tenantId,
        indexRoot: resolveKnowledgeIndexRootForBase(knowledgeBase),
      });
      respond(true, payload);
    } catch (error) {
      if (error instanceof KnowledgeDocumentPreviewUnavailableError) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, error.message, {
            details: { reason: error.code },
          }),
        );
        return;
      }
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.document.save": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    const documentId = stringParam(record.documentId) ?? stringParam(record.docId);
    const text = typeof record.text === "string" ? record.text : undefined;
    if (!kbId || !documentId || text === undefined) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId, documentId, and text required"),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const knowledgeBase = authorizedKnowledgeBase(kbId, context, clientUser, "write");
    if (!knowledgeBase || !context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
      );
      return;
    }
    const title = stringParam(record.title)?.trim() || documentId;
    const fileName = stringParam(record.fileName)?.trim() || `${title}.md`;
    try {
      const ingest = await ingestKnowledgePayloadToBase({
        knowledgeBase,
        documentId,
        title,
        fileName,
        mimeType: "text/markdown",
        buffer: Buffer.from(text, "utf8"),
        ownerId: context.userId,
        client,
        governanceOwnershipProof: resolveKnowledgeGovernanceOwnershipProof(context),
      });
      if (!isDigitizedKnowledgeIngest(ingest)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            personalKnowledgeIngestFailureMessage(ingest) ??
              "knowledge ingest failed: document was not digitized",
          ),
        );
        return;
      }
      respond(true, { knowledgeBaseId: kbId, documentId, ingest });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.snippets.list": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    if (!kbId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId required"));
      return;
    }
    const knowledgeBase = getKnowledgeBase(kbId);
    const context = await resolveKnowledgeSourceContext(client);
    if (
      !knowledgeBase ||
      !isKnowledgeBaseVisible(
        knowledgeBaseRetrievalContext(context),
        toVisibilityKnowledgeBase(knowledgeBase),
      )
    ) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledge base not found"));
      return;
    }
    try {
      const snippets = await listKnowledgeBaseSnippetsFromIndex({
        knowledgeBase,
        limit: numberParam(record.limit, 24),
      });
      respond(true, { knowledgeBaseId: kbId, snippets });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.recycle.list": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    if (!kbId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId required"));
      return;
    }
    const knowledgeBase = getKnowledgeBase(kbId);
    const context = await resolveKnowledgeSourceContext(client);
    if (
      !knowledgeBase ||
      !isKnowledgeBaseVisible(
        knowledgeBaseRetrievalContext(context),
        toVisibilityKnowledgeBase(knowledgeBase),
      )
    ) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledge base not found"));
      return;
    }
    try {
      const documents = await listKnowledgeBaseRecycledDocumentsFromIndex({ knowledgeBase });
      const evicted = await listKnowledgeBaseEvictedChunksFromIndex({ knowledgeBase });
      respond(true, { knowledgeBaseId: kbId, documents, evicted });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.web.list": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    if (!kbId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId required"));
      return;
    }
    const knowledgeBase = getKnowledgeBase(kbId);
    const context = await resolveKnowledgeSourceContext(client);
    if (
      !knowledgeBase ||
      !isKnowledgeBaseVisible(
        knowledgeBaseRetrievalContext(context),
        toVisibilityKnowledgeBase(knowledgeBase),
      )
    ) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledge base not found"));
      return;
    }
    try {
      const webPages = await listKnowledgeBaseWebPagesFromIndex({ knowledgeBase });
      respond(true, { knowledgeBaseId: kbId, webPages });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.datasets.list": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    if (!kbId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId required"));
      return;
    }
    const knowledgeBase = getKnowledgeBase(kbId);
    const context = await resolveKnowledgeSourceContext(client);
    if (
      !knowledgeBase ||
      !isKnowledgeBaseVisible(
        knowledgeBaseRetrievalContext(context),
        toVisibilityKnowledgeBase(knowledgeBase),
      )
    ) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledge base not found"));
      return;
    }
    try {
      const datasets = await listKnowledgeBaseDatasetsFromIndex({ knowledgeBase });
      respond(true, { knowledgeBaseId: kbId, datasets });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.agent-knowledge.list": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    if (!kbId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId required"));
      return;
    }
    const knowledgeBase = getKnowledgeBase(kbId);
    const context = await resolveKnowledgeSourceContext(client);
    if (
      !knowledgeBase ||
      !isKnowledgeBaseVisible(
        knowledgeBaseRetrievalContext(context),
        toVisibilityKnowledgeBase(knowledgeBase),
      )
    ) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledge base not found"));
      return;
    }
    try {
      // Best-effort: feed the KB's own agent deliverables into the typed projection so the
      // table materializes from real auto-captured agent output as well as in-index lineage.
      let deliverables: AgentDeliverableInput[] = [];
      if (context.userId) {
        try {
          const listed = await listWorkspaceDeliverables({ userId: context.userId, limit: 100 });
          deliverables = listed.deliverables
            .filter((item) => item.relatedKnowledgeBaseId === kbId && item.sourceType === "agent")
            .map((item) => ({
              deliverableId: item.deliverableId,
              title: item.title,
              source: item.source,
              sourceType: item.sourceType,
              artifactKind: item.artifactKind,
              sourceLineageId: item.sourceLineageId ?? null,
              agentId: item.primaryCreatorName ?? item.creators[0] ?? null,
              governanceStatus: item.governanceStatus,
              updatedAtMs: item.updatedAtMs,
            }));
        } catch {
          deliverables = [];
        }
      }
      const result = await listKnowledgeBaseAgentKnowledgeFromIndex({
        knowledgeBase,
        deliverables,
      });
      respond(true, { knowledgeBaseId: kbId, items: result.items, summary: result.summary });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.sources.list": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    if (!kbId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId required"));
      return;
    }
    const knowledgeBase = getKnowledgeBase(kbId);
    const context = await resolveKnowledgeSourceContext(client);
    if (
      !knowledgeBase ||
      !isKnowledgeBaseVisible(
        knowledgeBaseRetrievalContext(context),
        toVisibilityKnowledgeBase(knowledgeBase),
      )
    ) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledge base not found"));
      return;
    }
    const planeParam = stringParam(record.plane);
    const plane = planeParam === "passive" || planeParam === "active" ? planeParam : undefined;
    const kind = exactMember(stringParam(record.kind), KNOWLEDGE_BASE_SOURCE_LIST_FILTER_KINDS);
    try {
      let deliverables: AgentDeliverableInput[] = [];
      if (context.userId) {
        try {
          const listed = await listWorkspaceDeliverables({ userId: context.userId, limit: 100 });
          deliverables = listed.deliverables
            .filter((item) => item.relatedKnowledgeBaseId === kbId && item.sourceType === "agent")
            .map((item) => ({
              deliverableId: item.deliverableId,
              title: item.title,
              source: item.source,
              sourceType: item.sourceType,
              artifactKind: item.artifactKind,
              sourceLineageId: item.sourceLineageId ?? null,
              agentId: item.primaryCreatorName ?? item.creators[0] ?? null,
              governanceStatus: item.governanceStatus,
              updatedAtMs: item.updatedAtMs,
            }));
        } catch {
          deliverables = [];
        }
      }
      const indexRoot = resolveKnowledgeIndexRootForBase(knowledgeBase);
      const sources = await listKnowledgeBaseSources({
        knowledgeBase,
        deliverables,
        indexRoot,
        ...(plane ? { plane } : {}),
        ...(kind ? { kind } : {}),
      });
      respond(true, { knowledgeBaseId: kbId, sources });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.agent-knowledge.generate": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    const sessionKey = stringParam(record.sessionKey);
    if (!kbId || !sessionKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId and sessionKey required"),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const knowledgeBase = authorizedKnowledgeBase(kbId, context, clientUser, "write");
    if (!knowledgeBase) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
      );
      return;
    }
    const llm = createAgentKnowledgeLlmCaller();
    if (!llm) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "no model configured for knowledge generation"),
      );
      return;
    }
    try {
      const session = await loadSessionEntryForClient(sessionKey, client);
      const sessionId = session.entry?.sessionId;
      const rawMessages =
        sessionId && session.storePath
          ? readSessionMessages(sessionId, session.storePath, session.entry?.sessionFile)
          : [];
      const messages = extractTranscriptMessages(rawMessages);
      if (messages.length === 0) {
        respond(true, { knowledgeBaseId: kbId, generated: [], reason: "empty transcript" });
        return;
      }
      const modesRaw = Array.isArray(record.modes) ? record.modes : null;
      const modes = modesRaw
        ?.filter(
          (mode): mode is AgentKnowledgeGenerationMode => mode === "summary" || mode === "sop",
        )
        .filter((mode, index, all) => all.indexOf(mode) === index);
      const generated = await generateAndRecordAgentKnowledgeForKnowledgeBase({
        knowledgeBase,
        sessionKey,
        messages,
        llm,
        ...(modes && modes.length > 0 ? { modes } : {}),
      });
      respond(true, { knowledgeBaseId: kbId, generated });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.members.list": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    if (!kbId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId required"));
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const existing = authorizedKnowledgeBase(kbId, context, clientUser, "read");
    if (!existing) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to view knowledge base members"),
      );
      return;
    }
    const members = listKnowledgeBaseMembers(kbId);
    respond(true, { knowledgeBaseId: kbId, members });
  },

  "knowledge.base.members.invite": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    const email = stringParam(record.email);
    if (!kbId || !email) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId and email required"),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const existing = authorizedKnowledgeBase(kbId, context, clientUser, "admin");
    if (!existing || !context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to invite knowledge base members"),
      );
      return;
    }
    try {
      const member = inviteKnowledgeBaseMember({
        knowledgeBaseId: kbId,
        email,
        role: normalizeKnowledgeBaseMemberRole(record.role),
        invitedByUserId: context.userId,
      });
      respond(true, { knowledgeBaseId: kbId, member });
    } catch (error) {
      if (error instanceof KnowledgeBaseMembersError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
        return;
      }
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.documents.detach": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    const documentId = stringParam(record.documentId) ?? stringParam(record.docId);
    if (!kbId || !documentId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId and documentId required"),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const existing = authorizedKnowledgeBase(kbId, context, clientUser, "write");
    if (!existing) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
      );
      return;
    }
    try {
      const knowledgeBase = detachDocumentFromKnowledgeBase(kbId, documentId);
      respond(true, { knowledgeBase, documentId });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.documents.restore": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    const documentId = stringParam(record.documentId) ?? stringParam(record.docId);
    if (!kbId || !documentId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId and documentId required"),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const existing = authorizedKnowledgeBase(kbId, context, clientUser, "write");
    if (!existing) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
      );
      return;
    }
    try {
      const knowledgeBase = restoreDocumentToKnowledgeBase(kbId, documentId);
      respond(true, { knowledgeBase, documentId });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.documents.delete": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    const documentId = stringParam(record.documentId) ?? stringParam(record.docId);
    if (!kbId || !documentId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId and documentId required"),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const knowledgeBase = authorizedKnowledgeBase(kbId, context, clientUser, "write");
    if (!knowledgeBase || !context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
      );
      return;
    }
    try {
      const next = await hardDeleteKnowledgeBaseDocument({
        knowledgeBase,
        documentId,
        ownerId: context.userId,
      });
      respond(true, { knowledgeBase: next, documentId });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.update": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    if (!kbId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId required"));
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const existing = authorizedKnowledgeBase(kbId, context, clientUser, "admin");
    if (!existing) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
      );
      return;
    }
    if (isReservedDeliverableFolder(existing)) {
      const nextTitle = stringParam(record.title);
      const nextTags = stringArrayParam(record.tags);
      const nextVisibility =
        record.visibility === undefined
          ? undefined
          : normalizeKnowledgeBaseVisibilityParam(record.visibility);
      if (
        (nextTitle && nextTitle !== existing.title) ||
        nextTags !== undefined ||
        (nextVisibility && nextVisibility !== existing.visibility)
      ) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "reserved knowledge folder cannot be modified"),
        );
        return;
      }
    }
    const nextVisibility =
      record.visibility === undefined
        ? undefined
        : normalizeKnowledgeBaseVisibilityParam(record.visibility);
    if (
      nextVisibility &&
      (nextVisibility === "team" || nextVisibility === "enterprise") &&
      !context.tenantId &&
      !existing.tenantId
    ) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "enterprise seat context required for team/enterprise knowledge base",
        ),
      );
      return;
    }
    try {
      const knowledgeBase = updateKnowledgeBase(kbId, {
        title: stringParam(record.title),
        description: typeof record.description === "string" ? record.description : undefined,
        visibility: nextVisibility,
        robotIds: stringArrayParam(record.robotIds),
        tags: stringArrayParam(record.tags),
      });
      respond(true, { knowledgeBase });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.delete": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    if (!kbId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId required"));
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const existing = authorizedKnowledgeBase(kbId, context, clientUser, "admin");
    if (!existing) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to delete knowledge base"),
      );
      return;
    }
    if (isReservedDeliverableFolder(existing)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "reserved knowledge folder cannot be deleted"),
      );
      return;
    }
    try {
      const dbPath = resolveKnowledgeIndexDbPath({
        ownerId: existing.ownerId,
        tenantId: existing.tenantId,
        indexRoot: resolveKnowledgeIndexRootForBase(existing),
      });
      if (fs.existsSync(dbPath)) {
        const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
        try {
          deleteKnowledgeBaseRetrievalSummaries(index.db, kbId);
        } finally {
          index.close();
        }
      }
      respond(true, deleteKnowledgeBase(kbId));
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.attach": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    const documentId = stringParam(record.documentId);
    if (!kbId || !documentId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId and documentId required"),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    const existing = authorizedKnowledgeBase(kbId, context, clientUser, "write");
    if (!existing || !context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
      );
      return;
    }
    try {
      const skillId = resolveSkillAssetIdForDocument(documentId);
      const kbDocumentId = skillId ? knowledgeDocumentIdFromSkillRef(kbId, skillId) : documentId;
      let committed = false;
      const ingest = await ingestAttachedPersonalKnowledgeDocument({
        knowledgeBaseId: kbId,
        documentId: skillId ?? documentId,
        ownerId: context.userId,
        knowledgeBase: existing,
        governanceOwnershipProof: resolveKnowledgeGovernanceOwnershipProof(context),
        onIndexed: () => {
          attachDocumentToKnowledgeBase(kbId, kbDocumentId);
          committed = true;
        },
      });
      if (ingest.error) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, ingest.error, { reason: ingest.reason }),
        );
        return;
      }
      if (!committed) {
        await withKnowledgeDocumentMutation(
          {
            kbId,
            docId: kbDocumentId,
            originalsRoot: resolveKnowledgeDirectoryLayoutForBase(existing).originalsRoot,
          },
          async () => {
            assertKnowledgeOriginalWritable({
              kbId,
              docId: kbDocumentId,
              originalsRoot: resolveKnowledgeDirectoryLayoutForBase(existing).originalsRoot,
            });
            attachDocumentToKnowledgeBase(kbId, kbDocumentId);
          },
        );
      }
      const knowledgeBase = getKnowledgeBase(kbId);
      respond(true, { knowledgeBase, ingest });
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.base.search": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    const query = stringParam(record.query);
    if (!kbId || !query) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId and query required"),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    const retrievalContext = knowledgeBaseRetrievalContext(context);
    const { knowledgeBase, evidence, searchMode, substringMatches } =
      await searchScopedKnowledgeBaseWithFallback({
        client,
        knowledgeBaseId: kbId,
        query,
        retrievalContext,
        maxResults: numberParam(record.limit, 8),
        minScore: typeof record.minScore === "number" ? record.minScore : undefined,
        versionId: stringParam(record.versionId),
        docId: stringParam(record.documentId) ?? stringParam(record.docId),
      });
    if (!knowledgeBase) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "knowledge base not found"));
      return;
    }
    respond(true, {
      knowledgeBaseId: kbId,
      query,
      versionId: stringParam(record.versionId) ?? undefined,
      docId: stringParam(record.documentId) ?? stringParam(record.docId) ?? undefined,
      evidence,
      searchMode,
      substringMatches,
    });
  },

  "knowledge.deliverables.attach": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    const deliverableId = stringParam(record.deliverableId);
    if (!kbId || !deliverableId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId and deliverableId required"),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to attach deliverable"),
      );
      return;
    }
    try {
      const clientUser = clientUserEmail(client);
      const authorizedKb = authorizedKnowledgeBase(kbId, context, clientUser, "write");
      if (!authorizedKb) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
        );
        return;
      }
      const actor = await resolveEmployeeWorkbenchActor(client);
      const result = await attachWorkspaceDeliverableToKnowledgeBase({
        userId: context.userId,
        deliverableId,
        knowledgeBaseId: kbId,
        knowledgeBase: authorizedKb,
        groupIds: actor?.seatSpaceIds,
        governanceOwnershipProof: resolveKnowledgeGovernanceOwnershipProof(context),
      });
      respond(true, result);
    } catch (error) {
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.deliverables.saveAndArchive": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const kbId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    const sessionKey = stringParam(record.sessionKey);
    const title = stringParam(record.title);
    const content = stringParam(record.content);
    const contentBase64 = stringParam(record.contentBase64);
    if (!sessionKey || !title || (!content && !contentBase64)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "sessionKey, title, and content or contentBase64 required",
        ),
      );
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to save deliverable"),
      );
      return;
    }
    try {
      const clientUser = clientUserEmail(client);
      const groupId =
        stringParam(record.groupId) ||
        resolveCollaborationGroupIdFromSessionKey(sessionKey) ||
        undefined;
      // Chat preview "保存" may omit kbId or send auto/default. Gateway then
      // picks 个人成果 or 团队成果 — never a selected/enterprise folder.
      const resolved = resolveSaveArchiveKnowledgeBase({
        userId: context.userId,
        tenantId: context.tenantId,
        groupId,
        knowledgeBaseId: kbId,
        lookup: (id) => authorizedKnowledgeBase(id, context, clientUser, "write"),
        canWrite: (candidate) =>
          Boolean(authorizedKnowledgeBase(candidate.id, context, clientUser, "write")),
      });
      const authorizedKb = authorizedKnowledgeBase(
        resolved.knowledgeBase.id,
        context,
        clientUser,
        "write",
      );
      if (!authorizedKb) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
        );
        return;
      }
      const saveModeRaw = stringParam(record.saveMode);
      const saveMode: DeliverableSaveMode | null =
        saveModeRaw === "overwrite" || saveModeRaw === "save_as" ? saveModeRaw : null;
      const result = await saveAndArchiveWorkspaceDeliverable({
        client,
        userId: context.userId,
        sessionKey,
        knowledgeBaseId: authorizedKb.id,
        title,
        content: content ?? "",
        groupId,
        logicalId: stringParam(record.logicalId),
        filename: stringParam(record.filename),
        deliverableId: stringParam(record.deliverableId),
        agentId: stringParam(record.agentId),
        knowledgeBaseTitle: authorizedKb.title,
        saveMode,
        expectedRawHash: stringParam(record.expectedRawHash),
        saveAsFilename: stringParam(record.saveAsFilename),
        contentBase64,
        governanceOwnershipProof: resolveKnowledgeGovernanceOwnershipProof(context),
      });
      respond(true, result);
    } catch (error) {
      if (error instanceof SaveArchiveKnowledgeBaseError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
        return;
      }
      if (error instanceof SaveDecisionRequiredError) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, error.message, {
            reasonCode: SAVE_DECISION_REQUIRED,
            details: {
              code: SAVE_DECISION_REQUIRED,
              existing: error.existing,
              proposedRawHash: error.proposedRawHash,
              reason: error.reason,
              suggestedSaveAsFilename: error.suggestedSaveAsFilename,
            },
          }),
        );
        return;
      }
      if (error instanceof SaveConflictStaleError) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, error.message, {
            reasonCode: SAVE_CONFLICT_STALE,
            details: {
              code: SAVE_CONFLICT_STALE,
              existing: error.existing,
            },
          }),
        );
        return;
      }
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.deliverables.archiveLookup": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const sessionKey = stringParam(record.sessionKey);
    if (!sessionKey) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sessionKey required"));
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to look up archive"),
      );
      return;
    }
    try {
      const clientUser = clientUserEmail(client);
      const groupId =
        stringParam(record.groupId) ||
        resolveCollaborationGroupIdFromSessionKey(sessionKey) ||
        undefined;
      const resolved = resolveSaveArchiveKnowledgeBase({
        userId: context.userId,
        tenantId: context.tenantId,
        groupId,
        knowledgeBaseId: SAVE_ARCHIVE_KB_AUTO,
        lookup: (id) => authorizedKnowledgeBase(id, context, clientUser, "read"),
        canWrite: (candidate) =>
          Boolean(authorizedKnowledgeBase(candidate.id, context, clientUser, "read")),
      });
      const found = lookupDeliverableArchiveStatus({
        knowledgeBaseId: resolved.knowledgeBase.id,
        deliverableId: stringParam(record.deliverableId),
        logicalId: stringParam(record.logicalId),
      });
      if (!found?.record.documentId) {
        respond(true, { saved: false });
        return;
      }
      respond(true, {
        saved: true,
        deliverableId: found.deliverableId,
        knowledgeBaseId: found.record.knowledgeBaseId,
        knowledgeBaseTitle: resolved.knowledgeBase.title,
        documentId: found.record.documentId,
        logicalId: found.record.logicalId,
        filename: found.record.filename,
        rawHash: found.record.rawHash,
      });
    } catch (error) {
      if (error instanceof SaveArchiveKnowledgeBaseError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
        return;
      }
      respondKnowledgeBaseError(respond, error);
    }
  },

  "knowledge.deliverables.trace": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to read deliverable trace"),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const deliverableId = stringParam(record.deliverableId);
    if (!deliverableId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "deliverableId required"));
      return;
    }
    try {
      const actor = await resolveEmployeeWorkbenchActor(client);
      const result = await getWorkspaceDeliverableTrace({
        userId: context.userId,
        deliverableId,
        groupIds: actor?.seatSpaceIds,
      });
      if (!result) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "deliverable not found"));
        return;
      }
      const archiveMap = listDeliverableArchiveKnowledgeBaseIds();
      const trace = {
        ...result.trace,
        deliverable: {
          ...result.trace.deliverable,
          relatedKnowledgeBaseId:
            result.trace.deliverable.relatedKnowledgeBaseId ??
            archiveMap[result.trace.deliverable.deliverableId] ??
            undefined,
        },
      };
      respond(true, { trace });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to read deliverable trace";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.deliverables.list": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to list deliverables"),
      );
      return;
    }
    // One-time backfill: surface historical steward deliverables into 成果中心. Produced workspace
    // files by reference, plus declared deliverables scanned from the caller's own steward session
    // transcripts (owner-scoped). Idempotent + per-user markers; never breaks the list.
    try {
      backfillEmployeeStewardWorkspaceDeliverables({ userId: context.userId });
    } catch {
      // best-effort — a backfill failure must never block listing deliverables
    }
    try {
      backfillStewardSessionDeliverables({ userId: context.userId });
    } catch {
      // best-effort — a session-scan failure must never block listing deliverables
    }
    const record = params && typeof params === "object" ? params : {};
    const source = normalizeDeliverableSourceParam(record.source);
    const status =
      typeof record.status === "string" && record.status.trim() ? record.status.trim() : undefined;
    try {
      const actor = await resolveEmployeeWorkbenchActor(client);
      // Scope agent skill-asset deliverables to the agents this employee actually
      // owns/controls. The universal builtin steward is always present in
      // `seatAgentIds` and its id collides with the legacy `main` agent, so it is
      // excluded here — otherwise a brand-new employee would see other users'
      // steward/`main`-attributed assets from the machine-global skill store.
      const visibleAgentIds = actor
        ? actor.seatAgentIds.filter((id) => !isBuiltinStewardAgent(id))
        : undefined;
      const result = await listWorkspaceDeliverables({
        userId: context.userId,
        limit: numberParam(record.limit, 20),
        source,
        status,
        groupIds: actor?.seatSpaceIds,
        visibleAgentIds,
      });
      const archiveMap = listDeliverableArchiveKnowledgeBaseIds();
      const merged = result.deliverables.map((item) => ({
        ...item,
        relatedKnowledgeBaseId:
          item.relatedKnowledgeBaseId ?? archiveMap[item.deliverableId] ?? undefined,
      }));
      const deliverables = await applyRuntimeGovernanceToDeliverables({
        deliverables: merged,
        ownerId: context.userId,
        tenantId: context.tenantId,
      });
      respond(true, { deliverables });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to list deliverables";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.deliverables.capture": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to capture deliverable"),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const content = stringParam(record.content);
    if (!content || !content.trim()) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "content required"));
      return;
    }
    try {
      const result = captureAgentOutputDeliverable({
        ownerId: context.userId,
        agentId: stringParam(record.agentId) ?? "main",
        title: stringParam(record.title) ?? "",
        content,
        sessionKey: stringParam(record.sessionKey),
        messageId: stringParam(record.messageId),
        contextId: stringParam(record.contextId),
        tags: stringArrayParam(record.tags),
        force: record.force === true,
      });
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to capture deliverable";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.source.bind": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to bind source"),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const kind = exactMember(stringParam(record.kind), ACTIVE_BIND_KINDS);
    if (!kind) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "kind must be one of: api, external, capability (passive sources use the ingest RPCs)",
        ),
      );
      return;
    }
    const title = stringParam(record.title) ?? stringParam(record.endpoint) ?? "";
    if (!title.trim()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "title or endpoint required"),
      );
      return;
    }
    const resolvedKb = resolveKnowledgeBaseIdForPersonalMutation({
      explicitKbId: stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId),
      context,
    });
    const kbId = resolvedKb.knowledgeBaseId;
    const compatWarnings = [...resolvedKb.compatWarnings];
    if (stringParam(record.visibility)) {
      if (isSourceBindVisibilityInputRejected()) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "visibility is not accepted; source binding inherits knowledge base visibility",
          ),
        );
        return;
      }
      compatWarnings.push(createSourceBindVisibilityIgnoredWarning());
    }
    try {
      if (resolvedKb.rejectedReason) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, resolvedKb.rejectedReason),
        );
        return;
      }
      const authorizedKb = kbId
        ? authorizedKnowledgeBase(kbId, context, clientUser, "write")
        : null;
      if (!kbId || !authorizedKb) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
        );
        return;
      }
      // Active sources are registered only — never ingested into the chunk index.
      const descriptor = bindKnowledgeSource({
        kind,
        title,
        knowledgeBaseId: kbId,
        ownerId: context.userId,
        endpoint: stringParam(record.endpoint),
        visibility: authorizedKb.visibility,
      });
      respond(true, appendCompatWarnings({ binding: descriptor }, compatWarnings));
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to bind source";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.source.list": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to list source bindings"),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const bindings = listKnowledgeSourceBindings({
      knowledgeBaseId: stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId),
      ownerId: context.userId,
    });
    respond(true, { bindings });
  },

  "knowledge.compat.status": async ({ respond }) => {
    const backfill = backfillSourceBindingVisibilityStore();
    respond(true, {
      featureFlags: readKnowledgeCompatFeatureFlags(),
      warningStats: readKnowledgeCompatWarningStats(),
      sourceBindingVisibilityBackfill: backfill,
    });
  },

  "knowledge.source.ingest": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to ingest source"),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const sourceDescriptorId =
      stringParam(record.sourceDescriptorId) ?? stringParam(record.id) ?? "";
    const knowledgeBaseId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId) ?? "";
    if (!sourceDescriptorId || !knowledgeBaseId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sourceDescriptorId and knowledgeBaseId required"),
      );
      return;
    }
    const knowledgeBase = authorizedKnowledgeBase(knowledgeBaseId, context, clientUser, "write");
    if (!knowledgeBase) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
      );
      return;
    }
    try {
      const result = await ingestKnowledgeSourceBinding({
        sourceDescriptorId,
        knowledgeBase,
        context,
        client,
        ownerId: context.userId,
        governanceOwnershipProof: resolveKnowledgeGovernanceOwnershipProof(context),
        options: {
          path: stringParam(record.path) ?? undefined,
          method: stringParam(record.method) ?? undefined,
          body: isRecord(record.body) ? record.body : undefined,
          authorizedKnowledgeBaseIds: new Set([knowledgeBase.id]),
        },
      });
      if (!result.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, result.reason ?? "source ingest failed"),
        );
        return;
      }
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "source ingest failed";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.source.catalog.sync": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to sync API catalog"),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const sourceId = stringParam(record.sourceId) ?? stringParam(record.id) ?? "";
    if (!sourceId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sourceId required"));
      return;
    }
    const binding = listKnowledgeSourceBindings().find((item) => item.id === sourceId);
    const authorizedIds = new Set<string>();
    if (binding?.knowledgeBaseId) {
      const kb = authorizedKnowledgeBase(binding.knowledgeBaseId, context, clientUser, "read");
      if (kb) {
        authorizedIds.add(kb.id);
      }
    }
    try {
      const catalog = await syncApiSourceCatalog(sourceId, context, {
        path: stringParam(record.path) ?? undefined,
        authorizedKnowledgeBaseIds: authorizedIds.size > 0 ? authorizedIds : undefined,
      });
      respond(true, { catalog });
    } catch (error) {
      const message = error instanceof Error ? error.message : "catalog sync failed";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.source.catalog.get": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to read API catalog"),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const sourceId = stringParam(record.sourceId) ?? stringParam(record.id) ?? "";
    if (!sourceId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sourceId required"));
      return;
    }
    const catalog = getApiSourceCatalog(sourceId);
    respond(true, { catalog });
  },

  "knowledge.source.invoke": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to invoke API source"),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const sourceId = stringParam(record.sourceId) ?? stringParam(record.id) ?? "";
    const requestPath = stringParam(record.path) ?? "/";
    if (!sourceId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sourceId required"));
      return;
    }
    const binding = listKnowledgeSourceBindings().find((item) => item.id === sourceId);
    const authorizedIds = new Set<string>();
    if (binding?.knowledgeBaseId) {
      const kb = authorizedKnowledgeBase(binding.knowledgeBaseId, context, clientUser, "read");
      if (kb) {
        authorizedIds.add(kb.id);
      }
    }
    try {
      const result = await invokeApiSource(sourceId, requestPath, context, {
        method: stringParam(record.method) ?? undefined,
        body: isRecord(record.body) ? record.body : undefined,
        authorizedKnowledgeBaseIds: authorizedIds.size > 0 ? authorizedIds : undefined,
      });
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "API source invoke failed";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.source.unbind": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to unbind source"),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const id = stringParam(record.id);
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id required"));
      return;
    }
    // Authorize by KB write when the binding is attached to a space; otherwise require
    // owner match. Owner-only checks miss legacy/orphan rows whose ownerId drifted.
    const descriptor = listKnowledgeSourceBindings().find((item) => item.id === id);
    if (!descriptor) {
      respond(true, { ok: false });
      return;
    }
    const ownsBinding = descriptor.ownerId === context.userId;
    const canWriteKb = descriptor.knowledgeBaseId
      ? Boolean(authorizedKnowledgeBase(descriptor.knowledgeBaseId, context, clientUser, "write"))
      : false;
    if (!ownsBinding && !canWriteKb) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to unbind this source"),
      );
      return;
    }
    respond(true, { ok: unbindKnowledgeSource(id) });
  },

  "knowledge.capability.invoke": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const capabilityId = stringParam(record.capabilityId);
    if (!capabilityId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "capabilityId required"));
      return;
    }
    const context = await resolveKnowledgeSourceContext(client);
    try {
      // Governed, boundary-preserving invoke: auth + quota + audit over materialized
      // data; denials are returned as ok:false outcomes (not RPC errors).
      const outcome = await invokeKnowledgeCapability({ capabilityId, context, client });
      respond(true, outcome);
    } catch (error) {
      const message = error instanceof Error ? error.message : "capability invoke failed";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  // P1 local_index + P1.1 watchers + P3 managed_push (do NOT reuse knowledge.source.bind).
  "knowledge.local-folder.bind": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to bind local folder"),
      );
      return;
    }
    const ownerId = context.userId;
    const record = params && typeof params === "object" ? params : {};
    const rootPath = stringParam(record.rootPath);
    const modeRaw = stringParam(record.mode);
    const mode: LocalFolderBindingMode =
      modeRaw === "managed_push" ? "managed_push" : "local_index";
    // local_index needs an absolute path on the gateway host; managed_push keeps path on device only.
    if (mode === "local_index" && !rootPath) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "rootPath required for local_index (device-local absolute path; not stored on SourceDescriptor)",
        ),
      );
      return;
    }
    // Redline: managed_push must never accept or persist a host/client absolute path on the server.
    if (mode === "managed_push" && rootPath) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "managed_push must not send rootPath to the server; keep absolute paths device-local and sync via plan/commit",
        ),
      );
      return;
    }
    let resolvedRootPath = "";
    if (mode === "local_index" && rootPath) {
      const pathPolicy = assertLocalFolderRootPathAllowed({
        rootPath,
        allowOutsideDataRoot: record.allowOutsideDataRoot === true,
      });
      if (!pathPolicy.ok) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, pathPolicy.message));
        return;
      }
      resolvedRootPath = pathPolicy.resolvedPath;
    }
    const rootLabel =
      stringParam(record.rootLabel) ||
      (resolvedRootPath ? resolvedRootPath.split(/[/\\]/).filter(Boolean).at(-1) : undefined) ||
      "folder";
    const deletePolicyRaw = stringParam(record.deletePolicy);
    const deletePolicy: LocalFolderDeletePolicy = deletePolicyRaw === "sync" ? "sync" : "snapshot";
    // managed_push is bound to the authenticated connection device. The payload can only confirm
    // that identity; it is never an authority source by itself.
    const requestedDeviceId = stringParam(record.deviceId);
    const connectionDeviceId = authenticatedClientDeviceId(client);
    if (mode === "managed_push" && !requestedDeviceId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "deviceId required for managed_push (stable device identity; do not use shared 'local')",
        ),
      );
      return;
    }
    if (mode === "managed_push" && !connectionDeviceId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "authenticated connection device identity required for managed_push",
        ),
      );
      return;
    }
    if (
      mode === "managed_push" &&
      requestedDeviceId !== undefined &&
      connectionDeviceId !== requestedDeviceId
    ) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "deviceId must match the authenticated connection device",
        ),
      );
      return;
    }
    const directoryId = stringParam(record.directoryId);
    if (mode === "managed_push" && !directoryId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "directoryId required for managed_push (opaque stable directory identity)",
        ),
      );
      return;
    }
    const deviceId =
      mode === "managed_push" ? (connectionDeviceId ?? "local") : (requestedDeviceId ?? "local");
    const resolvedKb = resolveKnowledgeBaseIdForPersonalMutation({
      explicitKbId: stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId),
      context,
    });
    const kbId = resolvedKb.knowledgeBaseId;
    try {
      if (resolvedKb.rejectedReason) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, resolvedKb.rejectedReason),
        );
        return;
      }
      const authorizedKb = kbId
        ? authorizedKnowledgeBase(kbId, context, clientUser, "write")
        : null;
      if (!kbId || !authorizedKb) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to modify knowledge base"),
        );
        return;
      }
      // Precompute bindingId so the logical descriptor is unique per root/device
      // (not only per display label — avoids docId collisions across folders).
      const bindingId = buildLocalFolderBindingId({
        knowledgeBaseId: kbId,
        deviceId,
        rootPath: resolvedRootPath,
        mode,
        directoryId,
      });
      // local_index defaults watcher on; managed_push watcher runs on the device, not cloud.
      const watcherEnabled =
        mode === "local_index" ? record.watcherEnabled !== false : record.watcherEnabled === true;
      const persistBinding = () => {
        // Layer 1: logical descriptor only (never absolute path). The endpoint carries binding
        // identity rather than a filesystem path for stable uniqueness.
        const descriptor = bindKnowledgeSource({
          kind: "localFolder",
          title: rootLabel,
          knowledgeBaseId: kbId,
          ownerId,
          visibility: authorizedKb.visibility,
          endpoint: `local-folder://${bindingId}`,
          metadata: {
            folderLabel: rootLabel,
            deletePolicy,
            mode,
            bindingId,
          },
        });
        // Layer 2: device-local binding. managed_push never persists rootPath on the gateway.
        const binding = upsertLocalFolderBinding({
          bindingId,
          sourceDescriptorId: descriptor.id,
          knowledgeBaseId: kbId,
          deviceId,
          mode,
          directoryId,
          rootPath: resolvedRootPath,
          rootLabel,
          includeGlobs: stringArrayParam(record.includeGlobs),
          excludeGlobs: stringArrayParam(record.excludeGlobs),
          deletePolicy,
          watcherEnabled,
          status: "idle",
        });
        return { binding, descriptor };
      };

      if (mode === "managed_push") {
        const { binding, descriptor } = await withLocalFolderBindingOperationLock(
          bindingId,
          async () => {
            const persisted = persistBinding();
            // Any rebind changes the persisted revision and invalidates a lease created under the
            // previous delete policy or descriptor configuration.
            invalidateLocalFolderSyncPlan(bindingId);
            return persisted;
          },
        );
        respond(true, {
          sourceDescriptorId: descriptor.id,
          bindingId: binding.bindingId,
          rootLabel: binding.rootLabel,
          knowledgeBaseId: kbId,
          mode,
          watcherRunning: false,
          scan: null,
        });
        return;
      }

      const { binding, descriptor } = persistBinding();

      const scanSummary = await scanLocalFolderBinding({
        binding,
        knowledgeBase: authorizedKb,
        ownerId: context.userId,
        client,
        governanceOwnershipProof: resolveKnowledgeGovernanceOwnershipProof(context),
      });
      const watcherRunning = watcherEnabled ? startLocalFolderWatcher(binding) : false;
      respond(true, {
        sourceDescriptorId: descriptor.id,
        bindingId: binding.bindingId,
        rootLabel: binding.rootLabel,
        knowledgeBaseId: kbId,
        mode,
        watcherRunning,
        scan: scanSummary,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to bind local folder";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.local-folder.open-document": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to open local document"),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const documentId = stringParam(record.documentId);
    if (!documentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "documentId required"));
      return;
    }
    const knowledgeBaseId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    try {
      // Resolve first (dry-run) so we can authorize against the binding's KB before opening.
      const preview = await openLocalFolderDocument({
        documentId,
        knowledgeBaseId,
        dryRun: true,
      });
      const binding = findLocalFolderBinding({ bindingId: preview.bindingId });
      if (!binding) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "local folder binding not found"),
        );
        return;
      }
      if (!authorizedKnowledgeBase(binding.knowledgeBaseId, context, clientUser, "read")) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to open this document"),
        );
        return;
      }
      const result = await openLocalFolderDocument({
        documentId,
        knowledgeBaseId: binding.knowledgeBaseId,
      });
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to open original file";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.local-folder.scan-now": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to scan local folder"),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const binding = findLocalFolderBinding({
      bindingId: stringParam(record.bindingId),
      sourceDescriptorId: stringParam(record.sourceDescriptorId),
    });
    if (!binding) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "local folder binding not found"),
      );
      return;
    }
    const authorizedKb = authorizedKnowledgeBase(
      binding.knowledgeBaseId,
      context,
      clientUser,
      "write",
    );
    if (!authorizedKb) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to scan this knowledge base"),
      );
      return;
    }
    try {
      // managed_push without a co-located rootPath must use sync.plan/commit from the device.
      if (binding.mode === "managed_push" && !binding.rootPath.trim()) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "managed_push without device rootPath: use knowledge.local-folder.sync.plan/commit",
          ),
        );
        return;
      }
      const summary = await scanLocalFolderBinding({
        binding,
        knowledgeBase: authorizedKb,
        ownerId: context.userId,
        client,
        governanceOwnershipProof: resolveKnowledgeGovernanceOwnershipProof(context),
      });
      const refreshed = findLocalFolderBinding({ bindingId: binding.bindingId });
      respond(true, {
        accepted: summary.errors.length === 0 || summary.ingested > 0,
        bindingId: binding.bindingId,
        status: refreshed?.status ?? "idle",
        summary,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "scan failed";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.local-folder.unbind": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to unbind local folder"),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const sourceDescriptorId = stringParam(record.sourceDescriptorId);
    const binding = findLocalFolderBinding({
      bindingId: stringParam(record.bindingId),
      sourceDescriptorId,
    });
    if (!binding) {
      // Orphan SourceDescriptor (layer-2 binding missing) — still remove the sources list row.
      if (!sourceDescriptorId) {
        respond(true, { ok: false, purged: 0 });
        return;
      }
      const descriptor = listKnowledgeSourceBindings().find(
        (item) => item.id === sourceDescriptorId && item.kind === "localFolder",
      );
      if (!descriptor) {
        respond(true, { ok: false, purged: 0 });
        return;
      }
      const ownsBinding = descriptor.ownerId === context.userId;
      const canWriteKb = descriptor.knowledgeBaseId
        ? Boolean(authorizedKnowledgeBase(descriptor.knowledgeBaseId, context, clientUser, "write"))
        : false;
      if (!ownsBinding && !canWriteKb) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to unbind this knowledge base"),
        );
        return;
      }
      deleteSourceDocumentLinksForSource(sourceDescriptorId);
      respond(true, { ok: unbindKnowledgeSource(sourceDescriptorId), purged: 0 });
      return;
    }
    const authorizedKb = authorizedKnowledgeBase(
      binding.knowledgeBaseId,
      context,
      clientUser,
      "write",
    );
    if (!authorizedKb) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to unbind this knowledge base"),
      );
      return;
    }
    try {
      const purgeProjected = record.purgeProjected === true;
      const unbindCurrent = async (currentBinding: typeof binding) => {
        await stopLocalFolderWatcher(currentBinding.bindingId);
        const runtimeResult = await unbindLocalFolderRuntime({
          binding: currentBinding,
          knowledgeBase: authorizedKb,
          ownerId: context.userId,
          purgeProjected,
        });
        deleteLocalFolderBinding(currentBinding.bindingId);
        unbindKnowledgeSource(currentBinding.sourceDescriptorId);
        return runtimeResult;
      };

      if (binding.mode === "managed_push") {
        const runtimeResult = await withLocalFolderBindingOperationLock(
          binding.bindingId,
          async () => {
            const currentBinding = findLocalFolderBinding({ bindingId: binding.bindingId });
            if (!currentBinding) {
              return null;
            }
            if (
              !authorizedKnowledgeBase(currentBinding.knowledgeBaseId, context, clientUser, "write")
            ) {
              throw new Error("not authorized to unbind this knowledge base");
            }
            const result = await unbindCurrent(currentBinding);
            invalidateLocalFolderSyncPlan(currentBinding.bindingId);
            return result;
          },
        );
        respond(true, {
          ok: runtimeResult?.ok ?? false,
          purged: runtimeResult?.purged ?? 0,
        });
        return;
      }

      const runtimeResult = await unbindCurrent(binding);
      respond(true, { ok: runtimeResult.ok, purged: runtimeResult.purged });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unbind failed";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  // P3: client inventory → server issues a one-generation managed sync lease.
  "knowledge.local-folder.sync.plan": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required for local-folder sync.plan"),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const binding = findLocalFolderBinding({
      bindingId: stringParam(record.bindingId),
      sourceDescriptorId: stringParam(record.sourceDescriptorId),
    });
    if (!binding) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "local folder binding not found"),
      );
      return;
    }
    if (!authorizedKnowledgeBase(binding.knowledgeBaseId, context, clientUser, "write")) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to sync this knowledge base"),
      );
      return;
    }
    const requestedDeviceId = stringParam(record.deviceId);
    const connectionDeviceId = authenticatedClientDeviceId(client);
    if (!connectionDeviceId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "authenticated connection device identity required for managed folder sync",
        ),
      );
      return;
    }
    if (
      !requestedDeviceId ||
      requestedDeviceId !== connectionDeviceId ||
      binding.deviceId !== connectionDeviceId
    ) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "deviceId must match the authenticated connection device and managed folder binding",
        ),
      );
      return;
    }
    const deviceId = connectionDeviceId;
    if (binding.mode !== "managed_push") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sync.plan requires a managed_push binding"),
      );
      return;
    }
    try {
      if (!Array.isArray(record.candidates)) {
        throw new Error("candidates array required");
      }
      const candidates: LocalFolderSyncCandidate[] = record.candidates.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(`invalid sync candidate at index ${index}`);
        }
        const row = entry;
        const relativePath = stringParam(row.relativePath);
        if (!relativePath) {
          throw new Error(`relativePath required for sync candidate at index ${index}`);
        }
        return {
          relativePath,
          rawHash: stringParam(row.rawHash),
          sizeBytes:
            typeof row.sizeBytes === "number" && Number.isFinite(row.sizeBytes)
              ? row.sizeBytes
              : undefined,
          mtimeMs:
            typeof row.mtimeMs === "number" && Number.isFinite(row.mtimeMs)
              ? row.mtimeMs
              : undefined,
        };
      });
      const retainRelativePaths = Array.isArray(record.retainRelativePaths)
        ? record.retainRelativePaths.map((entry, index) => {
            if (typeof entry !== "string" || !entry.trim()) {
              throw new Error(`invalid retainRelativePaths at index ${index}`);
            }
            return entry;
          })
        : [];
      const plan = await createManagedLocalFolderSyncPlan({
        binding,
        deviceId,
        candidates,
        retainRelativePaths,
      });
      respond(true, plan);
    } catch (error) {
      const message = error instanceof Error ? error.message : "sync.plan failed";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  // P3: upload batches retain the lease; finalize applies only the server-side delete set.
  "knowledge.local-folder.sync.commit": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "user context required for local-folder sync.commit",
        ),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const binding = findLocalFolderBinding({
      bindingId: stringParam(record.bindingId),
      sourceDescriptorId: stringParam(record.sourceDescriptorId),
    });
    if (!binding) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "local folder binding not found"),
      );
      return;
    }
    const authorizedKb = authorizedKnowledgeBase(
      binding.knowledgeBaseId,
      context,
      clientUser,
      "write",
    );
    if (!authorizedKb) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to sync this knowledge base"),
      );
      return;
    }
    const requestedDeviceId = stringParam(record.deviceId);
    const connectionDeviceId = authenticatedClientDeviceId(client);
    if (!connectionDeviceId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "authenticated connection device identity required for managed folder sync",
        ),
      );
      return;
    }
    if (
      !requestedDeviceId ||
      requestedDeviceId !== connectionDeviceId ||
      binding.deviceId !== connectionDeviceId
    ) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "deviceId must match the authenticated connection device and managed folder binding",
        ),
      );
      return;
    }
    const deviceId = connectionDeviceId;
    if (binding.mode !== "managed_push") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "sync.commit requires a managed_push binding"),
      );
      return;
    }
    try {
      if ("deletedRelativePaths" in record || "applyDeletes" in record) {
        throw new Error("managed sync.commit does not accept client-controlled deletion fields");
      }
      const planId = stringParam(record.planId);
      if (!planId) {
        throw new Error("planId required for managed sync.commit");
      }
      const generation = record.generation;
      if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 1) {
        throw new Error("positive integer generation required for managed sync.commit");
      }
      const phaseRaw = stringParam(record.phase);
      if (phaseRaw !== "upload" && phaseRaw !== "finalize") {
        throw new Error("phase must be upload or finalize");
      }
      if (!Array.isArray(record.files)) {
        throw new Error("files array required for managed sync.commit");
      }
      const files: LocalFolderSyncCommitFile[] = record.files.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(`invalid sync commit file at index ${index}`);
        }
        const row = entry;
        const relativePath = stringParam(row.relativePath);
        if (!relativePath) {
          throw new Error(`relativePath required for sync commit file at index ${index}`);
        }
        return {
          relativePath,
          fileName: stringParam(row.fileName),
          mimeType: stringParam(row.mimeType),
          contentBase64: stringParam(row.contentBase64),
          textContent: typeof row.textContent === "string" ? row.textContent : undefined,
          rawHash: stringParam(row.rawHash),
        };
      });
      const result = await commitManagedLocalFolderSync({
        binding,
        knowledgeBase: authorizedKb,
        ownerId: context.userId,
        deviceId,
        planId,
        generation,
        phase: phaseRaw,
        files,
        client,
        governanceOwnershipProof: resolveKnowledgeGovernanceOwnershipProof(context),
      });
      respond(true, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "sync.commit failed";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "knowledge.local-folder.status": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    const clientUser = clientUserEmail(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required for local folder status"),
      );
      return;
    }
    const record = params && typeof params === "object" ? params : {};
    const knowledgeBaseId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
    let bindings = listLocalFolderBindings({
      knowledgeBaseId,
      sourceDescriptorId: stringParam(record.sourceDescriptorId),
    });
    if (stringParam(record.bindingId)) {
      const one = findLocalFolderBinding({ bindingId: stringParam(record.bindingId) });
      bindings = one ? [one] : [];
    }
    // Only return bindings for KBs the caller can read.
    const items = bindings
      .filter((binding) =>
        authorizedKnowledgeBase(binding.knowledgeBaseId, context, clientUser, "read"),
      )
      .map((binding) => ({
        bindingId: binding.bindingId,
        sourceDescriptorId: binding.sourceDescriptorId,
        knowledgeBaseId: binding.knowledgeBaseId,
        rootLabel: binding.rootLabel,
        status: binding.status,
        watcherEnabled: binding.watcherEnabled,
        watcherRunning: isLocalFolderWatcherRunning(binding.bindingId),
        deletePolicy: binding.deletePolicy,
        mode: binding.mode,
        lastScanAt: binding.lastScanAt,
        lastEventAt: binding.lastEventAt,
        lastError: binding.lastError,
        activeDocumentCount: activeDocumentCountForSource(binding.sourceDescriptorId),
      }));
    respond(true, { items });
  },
  ...createKnowledgeConnectorHandlers({ authorizedKnowledgeBase }),
  ...knowledgeGovernanceHandlers,
};
