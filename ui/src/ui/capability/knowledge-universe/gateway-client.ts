import type { GatewayBrowserClient } from "../../gateway.ts";
import type {
  KnowledgeAccessRequest,
  KnowledgeAccessRequestResponse,
  KnowledgeAgentProfileResponse,
  KnowledgeEnterpriseAccessRequest,
  KnowledgeEnterpriseAccessRequestResponse,
  KnowledgeObjectRequest,
  KnowledgeObjectResponse,
  KnowledgePersonalCollectRequest,
  KnowledgePersonalCollectResponse,
  KnowledgePersonalCollectWebRequest,
  KnowledgePersonalCollectWebResponse,
  KnowledgePersonalCompareVersionsRequest,
  KnowledgePersonalCompareVersionsResponse,
  KnowledgePersonalImportDatasetRequest,
  KnowledgePersonalImportDatasetResponse,
  KnowledgePersonalUpdateTagsRequest,
  KnowledgePersonalUploadRequest,
  KnowledgePersonalUploadResponse,
  KnowledgePersonalVersionsResponse,
  KnowledgeRecommendationsRequest,
  KnowledgeRecommendationsResponse,
  KnowledgeDiscoveryListResponse,
  KnowledgeActionsListResponse,
  KnowledgeRecentRecordRequest,
  KnowledgeRecentRecordResponse,
  KnowledgeRecentResponse,
  KnowledgeRelatedRequest,
  KnowledgeRelatedResponse,
  KnowledgeRelationshipsRequest,
  KnowledgeRelationshipsResponse,
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
  KnowledgeGovernanceSummaryResponse,
  KnowledgeGovernanceTasksListResponse,
} from "./endpoints.ts";
import {
  mockKnowledgeAgentProfile,
  mockKnowledgeObject,
  mockKnowledgeRecommendations,
  mockKnowledgeRecent,
  mockKnowledgeRecordRecent,
  mockKnowledgeRelated,
  mockKnowledgeRelationships,
  mockKnowledgeSearch,
} from "./mock-backend.ts";

export type VaultSyncMemberSummary = {
  memberAccountId: string;
  role?: string;
  status?: string;
  hasWrappedKey?: boolean;
  keyEpoch?: number;
  joinedAt?: string;
  revokedAt?: string | null;
};

export type VaultSyncInviteSummary = {
  inviteId: string;
  invitedByAccountId?: string;
  inviteeAccountId?: string | null;
  role?: string;
  status?: string;
  createdAt?: string;
  expiresAt?: string;
  acceptedByAccountId?: string | null;
  inviteSaltB64?: string;
  wrappedBaseKeyB64?: string;
  keyEpoch?: number;
};

export type KnowledgeUniverseGateway = {
  search: (req: KnowledgeSearchRequest) => Promise<KnowledgeSearchResponse>;
  relationships: (req: KnowledgeRelationshipsRequest) => Promise<KnowledgeRelationshipsResponse>;
  object: (req: KnowledgeObjectRequest) => Promise<KnowledgeObjectResponse | null>;
  recommendations: (
    req: KnowledgeRecommendationsRequest,
  ) => Promise<KnowledgeRecommendationsResponse>;
  discovery: (req?: {
    limit?: number;
    lookbackMs?: number;
  }) => Promise<KnowledgeDiscoveryListResponse>;
  timeline: (req?: { limit?: number; lookbackMs?: number }) => Promise<unknown>;
  feedDigest: (req?: { limit?: number }) => Promise<unknown>;
  actions: (req?: {
    limit?: number;
    knowledgeBaseId?: string | null;
    focusObjectId?: string | null;
    deliverableId?: string | null;
  }) => Promise<KnowledgeActionsListResponse>;
  related: (req: KnowledgeRelatedRequest) => Promise<KnowledgeRelatedResponse>;
  recent: (req: { limit?: number }) => Promise<KnowledgeRecentResponse>;
  recordRecent: (req: KnowledgeRecentRecordRequest) => Promise<KnowledgeRecentRecordResponse>;
  agentProfile: (req: { agentId?: string }) => Promise<KnowledgeAgentProfileResponse>;
  collectPersonal: (
    req: KnowledgePersonalCollectRequest,
  ) => Promise<KnowledgePersonalCollectResponse>;
  uploadPersonal: (req: KnowledgePersonalUploadRequest) => Promise<KnowledgePersonalUploadResponse>;
  collectWebPersonal: (
    req: KnowledgePersonalCollectWebRequest,
  ) => Promise<KnowledgePersonalCollectWebResponse>;
  importDatasetPersonal: (
    req: KnowledgePersonalImportDatasetRequest,
  ) => Promise<KnowledgePersonalImportDatasetResponse>;
  requestAccess: (req: KnowledgeAccessRequest) => Promise<KnowledgeAccessRequestResponse>;
  requestEnterpriseAccess: (
    req: KnowledgeEnterpriseAccessRequest,
  ) => Promise<KnowledgeEnterpriseAccessRequestResponse>;
  listPersonalVersions: (req: { objectId: string }) => Promise<KnowledgePersonalVersionsResponse>;
  updatePersonalTags: (req: KnowledgePersonalUpdateTagsRequest) => Promise<KnowledgeObjectResponse>;
  comparePersonalVersions: (
    req: KnowledgePersonalCompareVersionsRequest,
  ) => Promise<KnowledgePersonalCompareVersionsResponse>;
  listKnowledgeBases: () => Promise<import("./workspace-endpoints.ts").KnowledgeBaseListResponse>;
  getKnowledgeBase: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseGetRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseGetResponse>;
  listKnowledgeBaseDocuments: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseDocumentsListRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseDocumentsListResponse>;
  listKnowledgeBaseSources: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseSourcesListRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseSourcesListResponse>;
  previewKnowledgeDocument: (
    req: import("./workspace-endpoints.ts").KnowledgeDocumentPreviewRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeDocumentPreviewResponse>;
  saveKnowledgeDocument: (
    req: import("./workspace-endpoints.ts").KnowledgeDocumentSaveRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeDocumentSaveResponse>;
  listKnowledgeBaseSnippets: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseSnippetsListRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseSnippetsListResponse>;
  listKnowledgeBaseRecycle: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseRecycleListRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseRecycleListResponse>;
  detachKnowledgeBaseDocument: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseDocumentMutationRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseDocumentMutationResponse>;
  deleteKnowledgeBaseDocument: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseDocumentMutationRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseDocumentMutationResponse>;
  restoreKnowledgeBaseDocument: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseDocumentMutationRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseDocumentMutationResponse>;
  listKnowledgeBaseWebPages: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseWebListRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseWebListResponse>;
  setWebRefreshPolicy: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseWebRefreshPolicyRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseWebRefreshPolicyResponse>;
  listKnowledgeBaseDatasets: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseDatasetsListRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseDatasetsListResponse>;
  listKnowledgeBaseAgentKnowledge: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseAgentKnowledgeListRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseAgentKnowledgeListResponse>;
  generateAgentKnowledge: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseAgentKnowledgeGenerateRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseAgentKnowledgeGenerateResponse>;
  listKnowledgeBaseMembers: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseMembersListRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseMembersListResponse>;
  inviteKnowledgeBaseMember: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseMemberInviteRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseMemberInviteResponse>;
  createKnowledgeBase: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseCreateRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseCreateResponse>;
  updateKnowledgeBase: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseUpdateRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseUpdateResponse>;
  deleteKnowledgeBase: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseDeleteRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseDeleteResponse>;
  searchKnowledgeBase: (
    req: import("./workspace-endpoints.ts").KnowledgeBaseSearchRequest,
  ) => Promise<import("./workspace-endpoints.ts").KnowledgeBaseSearchResponse>;
  listWorkspaceDeliverables: (req?: {
    limit?: number;
  }) => Promise<import("./workspace-endpoints.ts").WorkspaceDeliverablesListResponse>;
  getWorkspaceDeliverableTrace: (req: {
    deliverableId: string;
  }) => Promise<import("./workspace-endpoints.ts").WorkspaceDeliverableTraceResponse>;
  attachWorkspaceDeliverable: (
    req: import("./workspace-endpoints.ts").WorkspaceDeliverableAttachRequest,
  ) => Promise<import("./workspace-endpoints.ts").WorkspaceDeliverableAttachResponse>;
  deleteWorkspaceDeliverable: (req: { deliverableId: string }) => Promise<{ ok?: boolean }>;
  searchWorkspace: (
    req: import("./workspace-endpoints.ts").WorkspaceSearchRequest,
  ) => Promise<import("./workspace-endpoints.ts").WorkspaceSearchResponse>;
  previewCapability: (req: {
    capabilityId: string;
    limit?: number;
  }) => Promise<import("./endpoints.ts").KnowledgeCapabilityPreviewResponse>;
  captureDeliverable: (
    req: import("./endpoints.ts").KnowledgeDeliverableCaptureRequest,
  ) => Promise<import("./endpoints.ts").KnowledgeDeliverableCaptureResponse>;
  listSources: (
    req?: import("./endpoints.ts").KnowledgeSourceListRequest,
  ) => Promise<import("./endpoints.ts").KnowledgeSourceListResponse>;
  bindSource: (
    req: import("./endpoints.ts").KnowledgeSourceBindRequest,
  ) => Promise<import("./endpoints.ts").KnowledgeSourceBindResponse>;
  unbindSource: (
    req: import("./endpoints.ts").KnowledgeSourceUnbindRequest,
  ) => Promise<import("./endpoints.ts").KnowledgeSourceUnbindResponse>;
  ingestSource: (
    req: import("./endpoints.ts").KnowledgeSourceIngestRequest,
  ) => Promise<import("./endpoints.ts").KnowledgeSourceIngestResponse>;
  createVaultSync: (req: {
    password: string;
    deviceId?: string;
    platform?: string;
    ownerAccountId?: string;
  }) => Promise<{ vaultId: string; deviceId: string; status?: string }>;
  syncVaultSync: (req: {
    vaultId: string;
    deviceId: string;
    rootPath: string;
    password: string;
    selectiveSync?: {
      includeFolders?: boolean;
      includeImages?: boolean;
      includeAudio?: boolean;
      includeVideo?: boolean;
      includePdf?: boolean;
      includeOtherAttachments?: boolean;
      excludeGlobs?: string[];
    };
  }) => Promise<{
    status?: string;
    push?: { uploaded?: number };
    pull?: { applied?: number; conflicts?: number };
    reindexPaths?: string[];
  }>;
  listVaultSync: (req?: {
    ownerAccountId?: string;
  }) => Promise<{ vaults?: Array<{ vaultId: string; status?: string }> }>;
  vaultSyncStatus: (req: { vaultId: string }) => Promise<{
    status?: string;
    teamEnabled?: boolean;
    ownerAccountId?: string;
  }>;
  vaultSyncInventory: (req: {
    vaultId: string;
    cursor?: string;
    limit?: number;
  }) => Promise<{ items?: unknown[]; nextCursor?: string | null; truncated?: boolean }>;
  vaultSyncHistory: (req: {
    vaultId: string;
    opaquePathId?: string;
    relativePath?: string;
    password?: string;
    deviceId?: string;
    rootPath?: string;
  }) => Promise<{ opaquePathId?: string; revisions?: unknown[] }>;
  vaultSyncTrash: (req: {
    vaultId: string;
    cursor?: string;
    limit?: number;
  }) => Promise<{ items?: unknown[]; nextCursor?: string | null; truncated?: boolean }>;
  restoreVaultSync: (req: {
    vaultId: string;
    deviceId: string;
    rootPath: string;
    password: string;
    revisionId: string;
  }) => Promise<{
    status?: string;
    relativePath?: string;
    restoredFromRevisionId?: string;
    newRevisionId?: string;
  }>;
  getVaultSyncSelectiveSync: (req: {
    vaultId: string;
    deviceId: string;
    rootPath?: string;
  }) => Promise<{
    selectiveSync?: {
      includeFolders?: boolean;
      includeImages?: boolean;
      includeAudio?: boolean;
      includeVideo?: boolean;
      includePdf?: boolean;
      includeOtherAttachments?: boolean;
      excludeGlobs?: string[];
    };
  }>;
  setVaultSyncSelectiveSync: (req: {
    vaultId: string;
    deviceId: string;
    rootPath?: string;
    selectiveSync?: {
      includeFolders?: boolean;
      includeImages?: boolean;
      includeAudio?: boolean;
      includeVideo?: boolean;
      includePdf?: boolean;
      includeOtherAttachments?: boolean;
      excludeGlobs?: string[];
    };
  }) => Promise<{ ok?: boolean; selectiveSync?: unknown }>;
  listVaultSyncDevices: (req: { vaultId: string }) => Promise<{
    devices?: Array<{
      deviceId: string;
      status?: string;
      platform?: string;
      label?: string;
    }>;
  }>;
  revokeVaultSyncDevice: (req: { vaultId: string; deviceId: string }) => Promise<{ ok?: boolean }>;
  enableVaultSyncTeamWithPassword: (req: {
    vaultId: string;
    ownerAccountId: string;
    password: string;
  }) => Promise<{ vaultId?: string; teamEnabled?: boolean; member?: VaultSyncMemberSummary }>;
  listVaultSyncMembers: (req: { vaultId: string }) => Promise<{
    vaultId?: string;
    members?: VaultSyncMemberSummary[];
  }>;
  revokeVaultSyncMember: (req: {
    vaultId: string;
    memberAccountId: string;
    actorAccountId: string;
  }) => Promise<{ member?: VaultSyncMemberSummary }>;
  createVaultSyncInviteWithPassword: (req: {
    vaultId: string;
    invitedByAccountId: string;
    password: string;
    inviteeAccountId?: string | null;
    role?: "admin" | "member";
    ttlMs?: number;
  }) => Promise<{ invite?: VaultSyncInviteSummary; inviteSecret?: string }>;
  listVaultSyncInvites: (req: { vaultId: string }) => Promise<{
    vaultId?: string;
    invites?: VaultSyncInviteSummary[];
  }>;
  revokeVaultSyncInvite: (req: {
    vaultId: string;
    inviteId: string;
    actorAccountId: string;
  }) => Promise<{ invite?: VaultSyncInviteSummary }>;
  acceptVaultSyncInviteWithSecret: (req: {
    vaultId: string;
    inviteId: string;
    memberAccountId: string;
    inviteSecret: string;
  }) => Promise<{ member?: VaultSyncMemberSummary }>;
  bumpVaultSyncEncryptionVersion?: (req: {
    vaultId: string;
    expectedCurrent?: number;
  }) => Promise<{ encryptionVersion?: number }>;
  invokeCapability: (
    req: import("./endpoints.ts").KnowledgeCapabilityInvokeRequest,
  ) => Promise<import("./endpoints.ts").KnowledgeCapabilityInvokeResponse>;
  governanceSummary: (req?: { kbId?: string }) => Promise<KnowledgeGovernanceSummaryResponse>;
  governanceTasksList: (req?: {
    kbId?: string;
    status?: string;
    limit?: number;
  }) => Promise<KnowledgeGovernanceTasksListResponse>;
  governanceClaimsList: (req?: {
    kbId?: string;
    chunkIds?: string[];
    normalizedKey?: string;
    limit?: number;
  }) => Promise<import("./endpoints.ts").KnowledgeGovernanceClaimsListResponse>;
  governanceTaskGraph: (req: {
    taskId: string;
  }) => Promise<import("./endpoints.ts").KnowledgeGovernanceTaskGraphResponse>;
  governanceTaskUpdate: (req: {
    taskId: string;
    status: "resolved" | "dismissed";
    kbId?: string;
    canonicalClaimId?: string;
  }) => Promise<{ ok: boolean }>;
  bindLocalFolder: (
    req: import("./endpoints.ts").LocalFolderBindRequest,
  ) => Promise<import("./endpoints.ts").LocalFolderBindResponse>;
  localFolderStatus: (
    req: import("./endpoints.ts").LocalFolderStatusRequest,
  ) => Promise<import("./endpoints.ts").LocalFolderStatusResponse>;
  scanLocalFolderNow: (
    req: import("./endpoints.ts").LocalFolderScanNowRequest,
  ) => Promise<import("./endpoints.ts").LocalFolderScanNowResponse>;
  openLocalFolderDocument: (
    req: import("./endpoints.ts").LocalFolderOpenDocumentRequest,
  ) => Promise<import("./endpoints.ts").LocalFolderOpenDocumentResponse>;
  localFolderSyncPlan: (
    req: import("./endpoints.ts").LocalFolderSyncPlanRequest,
  ) => Promise<import("./endpoints.ts").LocalFolderSyncPlanResponse>;
  localFolderSyncCommit: (
    req: import("./endpoints.ts").LocalFolderSyncCommitRequest,
  ) => Promise<import("./endpoints.ts").LocalFolderSyncCommitResponse>;
  bindPassiveConnector: (
    req: import("./endpoints.ts").PassiveConnectorBindRequest,
  ) => Promise<import("./endpoints.ts").PassiveConnectorBindResponse>;
  unbindLocalFolder: (
    req: import("./endpoints.ts").LocalFolderUnbindRequest,
  ) => Promise<import("./endpoints.ts").LocalFolderUnbindResponse>;
  listPassiveConnectorProviders?: () => Promise<unknown>;
  unbindPassiveConnector?: (req: {
    bindingId?: string;
    sourceDescriptorId?: string;
    purgeProjected?: boolean;
  }) => Promise<unknown>;
  passiveConnectorStatus?: (req?: {
    knowledgeBaseId?: string;
    kind?: string;
    bindingId?: string;
  }) => Promise<unknown>;
  passiveConnectorSyncPlan?: (req: {
    bindingId?: string;
    sourceDescriptorId?: string;
    candidates: Array<{ relativePath: string; rawHash?: string }>;
  }) => Promise<unknown>;
  passiveConnectorSyncCommit?: (req: {
    bindingId?: string;
    sourceDescriptorId?: string;
    files: Array<{
      relativePath: string;
      textContent?: string;
      contentBase64?: string;
      rawHash?: string;
    }>;
    deletedRelativePaths?: string[];
  }) => Promise<unknown>;
  runtimeReindexVaultSync: (req: {
    vaultId: string;
    knowledgeBaseId?: string;
    rootPath?: string;
    touchedRelativePaths: string[];
    persistBinding?: boolean;
  }) => Promise<{ ok?: boolean }>;
  putVaultSyncBlob: (req: {
    vaultId: string;
    deviceId: string;
    ciphertextHash: string;
    contentBase64: string;
  }) => Promise<{ blobId?: string }>;
  commitVaultSyncRevision: (req: {
    revision: import("../../vault-sync/client-sync-types.ts").FileRevisionWire;
    idempotencyKey?: string;
  }) => Promise<{
    result?: { status?: string; revisionId?: string; conflictGroupId?: string | null };
  }>;
  listVaultSyncRevisionsSince: (req: {
    vaultId: string;
    cursor?: string;
    limit?: number;
  }) => Promise<{
    revisions?: import("../../vault-sync/client-sync-types.ts").FileRevisionWire[];
    nextCursor?: string | null;
  }>;
  getVaultSyncRevision?: (req: { vaultId: string; revisionId: string }) => Promise<{
    revision?: import("../../vault-sync/client-sync-types.ts").FileRevisionWire | null;
  }>;
  listVaultSyncRevisionsForPath?: (req: { vaultId: string; opaquePathId: string }) => Promise<{
    opaquePathId?: string;
    revisions?: import("../../vault-sync/client-sync-types.ts").FileRevisionWire[];
  }>;
  getVaultSyncBlob: (req: {
    vaultId: string;
    blobId: string;
  }) => Promise<{ contentBase64?: string }>;
  revokeVaultSyncMemberAndRotate?: (req: {
    vaultId: string;
    memberAccountId: string;
    actorAccountId: string;
  }) => Promise<{ member?: VaultSyncMemberSummary }>;
  createVaultSyncUploadSession?: (req: {
    vaultId: string;
    deviceId: string;
    ciphertextHash: string;
    totalSizeBytes: number;
    chunkSize?: number;
  }) => Promise<{ session?: Record<string, unknown> }>;
  getVaultSyncUploadSession?: (req: {
    vaultId: string;
    uploadId: string;
  }) => Promise<{ session?: Record<string, unknown> }>;
  putVaultSyncUploadChunk?: (req: {
    vaultId: string;
    uploadId: string;
    chunkIndex: number;
    contentBase64: string;
  }) => Promise<{ session?: Record<string, unknown> }>;
  completeVaultSyncUploadSession?: (req: {
    vaultId: string;
    uploadId: string;
  }) => Promise<{ blobId?: string }>;
  abortVaultSyncUploadSession?: (req: { vaultId: string; uploadId: string }) => Promise<unknown>;
  getVaultSyncQuota?: (req: { vaultId: string }) => Promise<unknown>;
  enableVaultSyncTeam?: (req: {
    vaultId: string;
    ownerAccountId: string;
    publicKeyB64: string;
    ephemeralPublicKeyB64: string;
    wrappedBaseKeyB64: string;
    keyEpoch?: number;
  }) => Promise<unknown>;
  rotateVaultSyncMemberWraps?: (req: {
    vaultId: string;
    actorAccountId: string;
    keyEpoch: number;
    wraps: Array<{
      memberAccountId: string;
      ephemeralPublicKeyB64: string;
      wrappedBaseKeyB64: string;
    }>;
  }) => Promise<{ members?: VaultSyncMemberSummary[] }>;
  createVaultSyncInvite?: (req: {
    vaultId: string;
    invitedByAccountId: string;
    inviteSaltB64: string;
    wrappedBaseKeyB64: string;
    inviteId?: string;
    inviteeAccountId?: string | null;
    role?: "admin" | "member";
    ttlMs?: number;
  }) => Promise<{ invite?: VaultSyncInviteSummary }>;
  acceptVaultSyncInvite?: (req: {
    vaultId: string;
    inviteId: string;
    memberAccountId: string;
    publicKeyB64: string;
    ephemeralPublicKeyB64: string;
    wrappedBaseKeyB64: string;
  }) => Promise<{ member?: VaultSyncMemberSummary }>;
};

export function createMockKnowledgeUniverseGateway(): KnowledgeUniverseGateway {
  return {
    search: async (req) => mockKnowledgeSearch(req),
    relationships: async (req) => mockKnowledgeRelationships(req),
    object: async (req) => mockKnowledgeObject(req),
    recommendations: async (req) => mockKnowledgeRecommendations(req),
    discovery: async () => ({ events: [] }),
    actions: async (req) => ({
      actions: mockKnowledgeRecommendations({ limit: req?.limit ?? 4 }).recommendations.map(
        (item, index) => ({
          actionId: `mock-open:${item.object.id}`,
          actionType: "open_object" as const,
          title: item.object.title.trim() || "查看相关知识",
          reason: item.reason,
          score: 40 - index,
          context: { objectId: item.object.id },
          executable: true,
        }),
      ),
    }),
    related: async (req) => mockKnowledgeRelated(req),
    recent: async () => mockKnowledgeRecent(),
    recordRecent: async (req) => mockKnowledgeRecordRecent(req),
    agentProfile: async () => mockKnowledgeAgentProfile(),
    collectPersonal: async (req) => ({
      skillId: "skill-mock",
      object: {
        id: "obj:personal:skill-mock",
        title: req.title,
        source: "personal",
        kind: "document",
        summary: req.summary,
        tags: req.tags ?? [],
        updatedAt: Date.now(),
      },
    }),
    uploadPersonal: async (req) => ({
      skillId: "skill-upload-mock",
      object: {
        id: "obj:personal:skill-upload-mock",
        title: req.title ?? req.attachment.fileName,
        source: "personal",
        kind: "document",
        summary: req.summary ?? `Imported source ${req.attachment.fileName}`,
        tags: req.tags ?? ["imported-source"],
        updatedAt: Date.now(),
      },
    }),
    collectWebPersonal: async (req) => ({
      skillId: "skill-web-mock",
      url: req.url,
      object: {
        id: "obj:personal:skill-web-mock",
        title: req.title ?? req.url,
        source: "personal",
        kind: "document",
        summary: `Web reference ${req.url}`,
        tags: req.tags ?? [],
        updatedAt: Date.now(),
      },
    }),
    importDatasetPersonal: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      attempted: true,
      imported: req.records.length,
      skipped: 0,
      chunkCount: req.records.length,
      documentIds: req.records.map((_, index) => `dataset:mock:${index}`),
    }),
    requestAccess: async (req) => ({
      request: {
        requestId: "req-mock",
        capabilityId: req.capabilityId,
        capabilityTitle: req.capabilityTitle,
        status: "pending",
        createdAt: Date.now(),
      },
    }),
    requestEnterpriseAccess: async (req) => ({
      request: {
        requestId: "req-enterprise-mock",
        projectionId: req.projectionId,
        projectionTitle: req.projectionTitle,
        status: "pending",
        createdAt: Date.now(),
      },
    }),
    listPersonalVersions: async () => ({
      versions: [
        { version: "1.0.0", createdAt: Date.now(), summary: "Initial version" },
        { version: "1.0.1", createdAt: Date.now(), summary: "Tags updated" },
      ],
    }),
    updatePersonalTags: async (req) => ({
      object: {
        id: req.objectId,
        title: "Mock knowledge",
        source: "personal",
        kind: "document",
        summary: "mock",
        tags: req.tags,
        updatedAt: Date.now(),
      },
    }),
    comparePersonalVersions: async (req) => ({
      diff: {
        skillId: "skill-mock",
        fromVersion: req.fromVersion,
        toVersion: req.toVersion,
        changedFields: [{ field: "tags", before: ["a"], after: ["b"] }],
      },
    }),
    listKnowledgeBases: async () => ({
      knowledgeBases: [
        {
          id: "kb-mock",
          title: "Mock Library",
          description: "",
          documentCount: 1,
          visibility: "private",
          updatedAtMs: Date.now(),
        },
      ],
    }),
    getKnowledgeBase: async (req) => ({
      knowledgeBase: {
        id: req.knowledgeBaseId,
        title: "Mock Library",
        description: "",
        documentCount: 1,
        visibility: "private",
        updatedAtMs: Date.now(),
        ownerId: "user-mock",
        documentIds: ["obj:personal:1"],
      },
    }),
    listKnowledgeBaseDocuments: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      documents: [
        {
          docId: "obj:personal:1",
          title: "Mock document",
          contentType: "text/markdown",
          updatedAtMs: Date.now(),
          indexed: true,
        },
      ],
    }),
    listKnowledgeBaseSources: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      sources: [
        {
          id: "doc:obj:personal:1",
          knowledgeBaseId: req.knowledgeBaseId,
          plane: "passive",
          kind: "note",
          title: "Mock document",
          status: "indexed",
          documentId: "obj:personal:1",
          canPreviewOriginal: true,
          updatedAtMs: Date.now(),
          visibility: "private",
        },
        {
          id: "binding:src-mock-api",
          knowledgeBaseId: req.knowledgeBaseId,
          plane: "active",
          kind: "api",
          title: "Mock API source",
          status: "unknown",
          sourceDescriptorId: "src-mock-api",
          updatedAtMs: Date.now(),
          visibility: "private",
        },
      ].filter((item) =>
        req.plane ? item.plane === req.plane : true,
      ) as import("./workspace-endpoints.ts").KnowledgeBaseSourceListItemDto[],
    }),
    previewKnowledgeDocument: async () => ({
      filename: "mock.md",
      mimeType: "text/markdown",
      byteLength: 12,
      textLike: true,
      base64: btoa("# mock note"),
      source: "original_store" as const,
    }),
    saveKnowledgeDocument: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      documentId: req.documentId,
      ingest: { attempted: true, skipped: false, chunkCount: 1 },
    }),
    listKnowledgeBaseSnippets: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      snippets: [
        {
          chunkId: "chunk-mock-1",
          docId: "obj:personal:1",
          docTitle: "Mock document",
          heading: "Overview",
          excerpt: "Mock indexed snippet for library workspace.",
          updatedAtMs: Date.now(),
        },
      ],
    }),
    listKnowledgeBaseRecycle: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      documents: [],
      evicted: [],
    }),
    detachKnowledgeBaseDocument: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      documentId: req.documentId,
      knowledgeBase: {
        id: req.knowledgeBaseId,
        title: "Mock Library",
        description: "",
        documentCount: 0,
        visibility: "private",
        updatedAtMs: Date.now(),
        ownerId: "user-mock",
        documentIds: [],
      },
    }),
    deleteKnowledgeBaseDocument: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      documentId: req.documentId,
      knowledgeBase: {
        id: req.knowledgeBaseId,
        title: "Mock Library",
        description: "",
        documentCount: 0,
        visibility: "private",
        updatedAtMs: Date.now(),
        ownerId: "user-mock",
        documentIds: [],
      },
    }),
    restoreKnowledgeBaseDocument: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      documentId: req.documentId,
      knowledgeBase: {
        id: req.knowledgeBaseId,
        title: "Mock Library",
        description: "",
        documentCount: 1,
        visibility: "private",
        updatedAtMs: Date.now(),
        ownerId: "user-mock",
        documentIds: [req.documentId],
      },
    }),
    listKnowledgeBaseWebPages: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      webPages: [
        {
          docId: "web-mock-1",
          title: "Product docs",
          url: "https://docs.example.com/product",
          updatedAtMs: Date.now(),
          indexed: true,
        },
      ],
    }),
    listKnowledgeBaseDatasets: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      datasets: [
        {
          docId: "dataset-mock-1",
          title: "Sales export",
          contentType: "text/csv",
          format: "CSV",
          updatedAtMs: Date.now(),
          indexed: true,
        },
      ],
    }),
    setWebRefreshPolicy: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      policy: {
        url: req.url,
        docId: req.docId ?? null,
        enabled: req.enabled,
        intervalMs: req.intervalMs ?? 24 * 60 * 60 * 1000,
        lastRefreshedAtMs: null,
        nextDueAtMs: req.enabled ? Date.now() + (req.intervalMs ?? 24 * 60 * 60 * 1000) : null,
        lastStatus: null,
        lastError: null,
      },
    }),
    listKnowledgeBaseAgentKnowledge: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      items: [],
      summary: [],
    }),
    generateAgentKnowledge: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      generated: [],
    }),
    listKnowledgeBaseMembers: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      members: [],
    }),
    inviteKnowledgeBaseMember: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      member: {
        memberId: "member-mock-1",
        knowledgeBaseId: req.knowledgeBaseId,
        email: req.email,
        role: req.role ?? "viewer",
        status: "pending",
        invitedByUserId: "user-mock",
        createdAtMs: Date.now(),
      },
    }),
    createKnowledgeBase: async (req) => ({
      knowledgeBase: {
        id: "kb-created-mock",
        title: req.title,
        description: req.description ?? "",
        documentCount: 0,
        visibility: "private",
        updatedAtMs: Date.now(),
        ownerId: "user-mock",
        documentIds: [],
      },
    }),
    updateKnowledgeBase: async (req) => ({
      knowledgeBase: {
        id: req.knowledgeBaseId,
        title: req.title ?? "Mock Library",
        description: req.description ?? "",
        documentCount: 0,
        visibility: req.visibility ?? "private",
        updatedAtMs: Date.now(),
        ownerId: "user-mock",
        documentIds: [],
      },
    }),
    deleteKnowledgeBase: async () => ({ ok: true as const }),
    searchKnowledgeBase: async (req) => ({
      knowledgeBaseId: req.knowledgeBaseId,
      query: req.query,
      evidence: [],
      searchMode: "substring",
      substringMatches: [],
    }),
    listWorkspaceDeliverables: async () => ({
      deliverables: [
        {
          deliverableId: "skill:skill-mock",
          title: "Mock deliverable",
          kind: "report",
          source: "agent",
          sourceType: "agent",
          artifactKind: "agent_result",
          governanceStatus: "pending",
          creators: ["Agent"],
          status: "published",
          updatedAtMs: Date.now(),
        },
      ],
    }),
    getWorkspaceDeliverableTrace: async (req) => ({
      trace: {
        deliverableId: req.deliverableId,
        deliverable: {
          deliverableId: req.deliverableId,
          title: "Mock deliverable",
          kind: "report",
          source: "agent",
          sourceType: "agent",
          artifactKind: "agent_result",
          governanceStatus: "pending",
          creators: ["Agent"],
          status: "published",
          updatedAtMs: Date.now(),
        },
        steps: [],
        citedKnowledge: [],
        modelUsage: null,
        dataSource: "reconstructed",
      },
    }),
    attachWorkspaceDeliverable: async (req) => ({
      knowledgeBase: {
        id: req.knowledgeBaseId,
        title: "Mock Library",
        description: "",
        documentCount: 1,
        visibility: "private",
        updatedAtMs: Date.now(),
        documentIds: ["skill-mock"],
      },
      documentId: "skill-mock",
      relatedKnowledgeBaseId: req.knowledgeBaseId,
      ingest: { attempted: true, skipped: false, chunkCount: 1 },
    }),
    deleteWorkspaceDeliverable: async () => ({ ok: true }),
    searchWorkspace: async (req) => {
      const query = (req.query ?? "").trim();
      const search = mockKnowledgeSearch({ query, limit: 20 });
      const relationships = mockKnowledgeRelationships({ query });
      const groups = [
        {
          group: "knowledge" as const,
          hits: search.results
            .filter((item) => item.source !== "enterprise")
            .slice(0, 5)
            .map((item) => ({
              id: `object:${item.id}`,
              group: "knowledge" as const,
              title: item.title,
              subtitle: item.summary,
              objectId: item.id,
              nodeId: relationships.graph.nodes.find((node) => node.objectId === item.id)?.id,
            })),
        },
        {
          group: "enterprise" as const,
          hits: search.results
            .filter((item) => item.source === "enterprise")
            .slice(0, 5)
            .map((item) => ({
              id: `object:${item.id}`,
              group: "enterprise" as const,
              title: item.title,
              subtitle: item.summary,
              objectId: item.id,
              nodeId: relationships.graph.nodes.find((node) => node.objectId === item.id)?.id,
            })),
        },
        { group: "deliverables" as const, hits: [] },
        {
          group: "capabilities" as const,
          hits: (search.dataCapabilities ?? []).slice(0, 5).map((item) => ({
            id: `capability:${item.id}`,
            group: "capabilities" as const,
            title: item.title,
            subtitle: item.summary,
            capabilityId: item.id,
          })),
        },
        {
          group: "agents" as const,
          hits: relationships.graph.nodes
            .filter((node) => node.kind === "agent")
            .slice(0, 5)
            .map((node) => ({
              id: `node:${node.id}`,
              group: "agents" as const,
              title: node.title,
              subtitle: node.summary,
              nodeId: node.id,
              objectId: node.objectId,
            })),
        },
        {
          group: "owners" as const,
          hits: relationships.graph.nodes
            .filter((node) => node.kind === "owner")
            .slice(0, 5)
            .map((node) => ({
              id: `node:${node.id}`,
              group: "owners" as const,
              title: node.title,
              subtitle: node.summary,
              nodeId: node.id,
              objectId: node.objectId,
            })),
        },
      ];
      const totalCount = groups.reduce((sum, group) => sum + group.hits.length, 0);
      return {
        query,
        searchMode: "substring" as const,
        totalCount,
        groups,
        legacyResults: search.results,
      };
    },
    governanceSummary: async () => ({
      summary: {
        openConflictCount: 0,
        openClaimConflictCount: 0,
        openDuplicateCount: 0,
        openOrphanCount: 0,
        openStaleCount: 0,
        suppressedChunkCount: 0,
        indexedChunkCount: 0,
        llmUsage: {
          llmCallCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          creditsCharged: 0,
          lastCallAt: null,
        },
      },
    }),
    governanceTasksList: async () => ({ tasks: [] }),
    governanceClaimsList: async () => ({ claims: [] }),
    governanceTaskGraph: async () => ({
      graph: { nodes: [], edges: [] },
      claims: [],
      focusNodeId: null,
    }),
    previewCapability: async (req) => ({
      preview: { capabilityId: req.capabilityId, indexedChunkCount: 0, items: [] },
    }),
    captureDeliverable: async (req) => ({
      captured: Boolean(req.content?.trim()),
      reason: req.content?.trim() ? "captured" : "empty",
      skillId: "skill-capture-mock",
      deliverableId: "skill:skill-capture-mock",
    }),
    listSources: async () => ({ bindings: [] }),
    bindSource: async (req) => ({
      binding: {
        id: "src:mock",
        kind: req.kind,
        plane: "active",
        title: req.title ?? req.endpoint ?? "Mock source",
        knowledgeBaseId: req.knowledgeBaseId,
        visibility: req.visibility,
        freshness: "unknown",
        endpoint: req.endpoint,
        createdAtMs: Date.now(),
      },
    }),
    unbindSource: async () => ({ ok: true }),
    ingestSource: async (req) => ({
      ok: true,
      sourceDescriptorId: req.sourceDescriptorId,
      knowledgeBaseId: req.knowledgeBaseId,
      documentId: `srcdir:mock-${req.sourceDescriptorId.slice(0, 8)}`,
      ingest: { attempted: true, skipped: false, chunkCount: 1 },
    }),
    createVaultSync: async () => ({
      vaultId: "vault-mock",
      deviceId: "device-mock",
      status: "idle_synced",
    }),
    syncVaultSync: async () => ({
      status: "idle_synced",
      push: { uploaded: 0 },
      pull: { applied: 0, conflicts: 0 },
      reindexPaths: [],
    }),
    listVaultSync: async () => ({ vaults: [] }),
    vaultSyncStatus: async () => ({ status: "idle_synced", teamEnabled: false }),
    vaultSyncInventory: async () => ({ items: [], nextCursor: null, truncated: false }),
    vaultSyncHistory: async () => ({ opaquePathId: "", revisions: [] }),
    vaultSyncTrash: async () => ({ items: [], nextCursor: null, truncated: false }),
    restoreVaultSync: async () => ({
      status: "idle_synced",
      relativePath: "restored.md",
      restoredFromRevisionId: "rev-mock",
      newRevisionId: "rev-new",
    }),
    getVaultSyncSelectiveSync: async () => ({
      selectiveSync: {
        includeImages: true,
        excludeGlobs: [],
      },
    }),
    setVaultSyncSelectiveSync: async (req) => ({
      ok: true,
      selectiveSync: req.selectiveSync ?? { includeImages: true, excludeGlobs: [] },
    }),
    listVaultSyncDevices: async () => ({
      devices: [{ deviceId: "device-mock", status: "active", platform: "desktop" }],
    }),
    revokeVaultSyncDevice: async () => ({ ok: true }),
    enableVaultSyncTeamWithPassword: async () => ({
      teamEnabled: true,
      member: { memberAccountId: "owner@example.com", role: "owner", status: "active" },
    }),
    listVaultSyncMembers: async () => ({
      members: [{ memberAccountId: "owner@example.com", role: "owner", status: "active" }],
    }),
    revokeVaultSyncMember: async (req) => ({
      member: { memberAccountId: req.memberAccountId, role: "member", status: "revoked" },
    }),
    createVaultSyncInviteWithPassword: async () => ({
      invite: {
        inviteId: "invite-mock",
        role: "member",
        status: "pending",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      inviteSecret: "mock-invite-secret-once",
    }),
    listVaultSyncInvites: async () => ({ invites: [] }),
    revokeVaultSyncInvite: async (req) => ({
      invite: { inviteId: req.inviteId, status: "revoked" },
    }),
    acceptVaultSyncInviteWithSecret: async (req) => ({
      member: { memberAccountId: req.memberAccountId, role: "member", status: "active" },
    }),
    invokeCapability: async (req) => ({
      ok: true,
      capabilityId: req.capabilityId,
      accessState: "granted",
      data: {
        title: "Mock capability",
        summary: "Mock governed capability data",
        sourceSystems: ["MockCRM"],
        scenarios: ["lookup"],
        freshness: "fresh",
      },
      auditId: "audit-mock",
    }),
    governanceTaskUpdate: async () => ({ ok: true }),
    bindLocalFolder: async () =>
      ({ bindingId: "mock-local-folder" }) as import("./endpoints.ts").LocalFolderBindResponse,
    localFolderStatus: async () =>
      ({ items: [] }) as import("./endpoints.ts").LocalFolderStatusResponse,
    scanLocalFolderNow: async () =>
      ({ ok: true }) as unknown as import("./endpoints.ts").LocalFolderScanNowResponse,
    openLocalFolderDocument: async (req) =>
      ({
        ok: true,
        documentId: req.documentId,
        bindingId: "mock-local-folder",
        relativePath: "mock.docx",
        absolutePath: "/tmp/mock.docx",
      }) as import("./endpoints.ts").LocalFolderOpenDocumentResponse,
    localFolderSyncPlan: async () =>
      ({
        planId: "mock-plan",
        actions: [],
      }) as unknown as import("./endpoints.ts").LocalFolderSyncPlanResponse,
    localFolderSyncCommit: async () =>
      ({ ok: true }) as unknown as import("./endpoints.ts").LocalFolderSyncCommitResponse,
    bindPassiveConnector: async () =>
      ({ bindingId: "mock-passive" }) as import("./endpoints.ts").PassiveConnectorBindResponse,
    unbindLocalFolder: async () =>
      ({ ok: true }) as import("./endpoints.ts").LocalFolderUnbindResponse,
    runtimeReindexVaultSync: async () => ({ ok: true }),
    putVaultSyncBlob: async () => ({ blobId: "mock-blob" }),
    commitVaultSyncRevision: async () => ({ result: { status: "ok", revisionId: "rev-mock" } }),
    listVaultSyncRevisionsSince: async () => ({ revisions: [], nextCursor: null }),
    getVaultSyncBlob: async () => ({ contentBase64: "" }),
    feedDigest: async () => ({ items: [] }),
    timeline: async () => ({ events: [] }),
  };
}

export type KnowledgeUniverseRpcClient = {
  request: GatewayBrowserClient["request"];
};

export function createKnowledgeUniverseGateway(
  client: KnowledgeUniverseRpcClient | null | undefined,
): KnowledgeUniverseGateway {
  if (!client) {
    return createMockKnowledgeUniverseGateway();
  }
  return {
    search: (req) => client.request("knowledge.search", req),
    relationships: (req) => client.request("knowledge.relationships", req),
    object: async (req) => {
      try {
        return await client.request<KnowledgeObjectResponse>("knowledge.object", req);
      } catch {
        // Do not fabricate a knowledge object on RPC failure — surface "not found"
        // so the UI shows an empty/error state instead of mock data.
        return null;
      }
    },
    recommendations: (req) => client.request("knowledge.recommendations", req),
    discovery: (req) => client.request("knowledge.discovery.list", req ?? {}),
    timeline: (req?: { limit?: number; lookbackMs?: number }) =>
      client.request("knowledge.timeline.list", req ?? {}),
    feedDigest: (req?: { limit?: number }) => client.request("knowledge.feed.digest", req ?? {}),
    actions: (req) => client.request("knowledge.actions.list", req ?? {}),
    related: (req) => client.request("knowledge.related", req),
    recent: (req) => client.request("knowledge.recent", req),
    recordRecent: (req) => client.request("knowledge.recent.record", req),
    agentProfile: (req) => client.request("knowledge.agent-profile", req),
    collectPersonal: (req) => client.request("knowledge.personal.collect", req),
    uploadPersonal: (req) => client.request("knowledge.personal.upload", req),
    collectWebPersonal: (req) => client.request("knowledge.personal.collectWeb", req),
    importDatasetPersonal: (req) => client.request("knowledge.personal.importDataset", req),
    requestAccess: (req) => client.request("knowledge.access.request", req),
    requestEnterpriseAccess: (req) => client.request("knowledge.enterprise.access.request", req),
    listPersonalVersions: (req) => client.request("knowledge.personal.versions", req),
    updatePersonalTags: (req) => client.request("knowledge.personal.updateTags", req),
    comparePersonalVersions: (req) => client.request("knowledge.personal.compareVersions", req),
    listKnowledgeBases: () => client.request("knowledge.base.list"),
    getKnowledgeBase: (req) => client.request("knowledge.base.get", req),
    listKnowledgeBaseDocuments: (req) => client.request("knowledge.base.documents.list", req),
    listKnowledgeBaseSources: (req) => client.request("knowledge.base.sources.list", req),
    previewKnowledgeDocument: (req) => client.request("knowledge.document.preview", req),
    saveKnowledgeDocument: (req) => client.request("knowledge.document.save", req),
    listKnowledgeBaseSnippets: (req) => client.request("knowledge.base.snippets.list", req),
    listKnowledgeBaseRecycle: (req) => client.request("knowledge.base.recycle.list", req),
    detachKnowledgeBaseDocument: (req) => client.request("knowledge.base.documents.detach", req),
    deleteKnowledgeBaseDocument: (req) => client.request("knowledge.base.documents.delete", req),
    restoreKnowledgeBaseDocument: (req) => client.request("knowledge.base.documents.restore", req),
    listKnowledgeBaseWebPages: (req) => client.request("knowledge.base.web.list", req),
    setWebRefreshPolicy: (req) => client.request("knowledge.web.setRefreshPolicy", req),
    listKnowledgeBaseDatasets: (req) => client.request("knowledge.base.datasets.list", req),
    listKnowledgeBaseAgentKnowledge: (req) =>
      client.request("knowledge.base.agent-knowledge.list", req),
    generateAgentKnowledge: (req) => client.request("knowledge.base.agent-knowledge.generate", req),
    listKnowledgeBaseMembers: (req) => client.request("knowledge.base.members.list", req),
    inviteKnowledgeBaseMember: (req) => client.request("knowledge.base.members.invite", req),
    createKnowledgeBase: (req) => client.request("knowledge.base.create", req),
    updateKnowledgeBase: (req) => client.request("knowledge.base.update", req),
    deleteKnowledgeBase: (req) => client.request("knowledge.base.delete", req),
    searchKnowledgeBase: (req) => client.request("knowledge.base.search", req),
    listWorkspaceDeliverables: (req) => client.request("knowledge.deliverables.list", req ?? {}),
    getWorkspaceDeliverableTrace: (req) => client.request("knowledge.deliverables.trace", req),
    attachWorkspaceDeliverable: (req) => client.request("knowledge.deliverables.attach", req),
    deleteWorkspaceDeliverable: (req) => client.request("knowledge.deliverables.delete", req),
    searchWorkspace: (req) => client.request("knowledge.workspace.search", req),
    previewCapability: (req) => client.request("knowledge.capability.preview", req),
    captureDeliverable: (req) => client.request("knowledge.deliverables.capture", req),
    listSources: (req) => client.request("knowledge.source.list", req ?? {}),
    bindSource: (req) => client.request("knowledge.source.bind", req),
    unbindSource: (req) => client.request("knowledge.source.unbind", req),
    ingestSource: (req) => client.request("knowledge.source.ingest", req),
    // P0 scaffold — dedicated localFolder RPCs (never knowledge.source.bind).
    bindLocalFolder: (req: import("./endpoints.ts").LocalFolderBindRequest) =>
      client.request("knowledge.local-folder.bind", req),
    scanLocalFolderNow: (req: import("./endpoints.ts").LocalFolderScanNowRequest) =>
      client.request("knowledge.local-folder.scan-now", req),
    openLocalFolderDocument: (req: import("./endpoints.ts").LocalFolderOpenDocumentRequest) =>
      client.request("knowledge.local-folder.open-document", req),
    unbindLocalFolder: (req: import("./endpoints.ts").LocalFolderUnbindRequest) =>
      client.request("knowledge.local-folder.unbind", req),
    localFolderStatus: (req?: import("./endpoints.ts").LocalFolderStatusRequest) =>
      client.request("knowledge.local-folder.status", req ?? {}),
    localFolderSyncPlan: (req: import("./endpoints.ts").LocalFolderSyncPlanRequest) =>
      client.request("knowledge.local-folder.sync.plan", req),
    localFolderSyncCommit: (req: import("./endpoints.ts").LocalFolderSyncCommitRequest) =>
      client.request("knowledge.local-folder.sync.commit", req),
    // P5 passive connectors (git / cloudDrive / mail) — never knowledge.source.bind.
    listPassiveConnectorProviders: () => client.request("knowledge.connector.providers", {}),
    bindPassiveConnector: (req: {
      kind: "gitRepo" | "cloudDrive" | "mailAttachment";
      knowledgeBaseId: string;
      label: string;
      locator: string;
      deletePolicy?: "sync" | "snapshot";
      config?: Record<string, string>;
    }) => client.request("knowledge.connector.bind", req),
    unbindPassiveConnector: (req: {
      bindingId?: string;
      sourceDescriptorId?: string;
      purgeProjected?: boolean;
    }) => client.request("knowledge.connector.unbind", req),
    passiveConnectorStatus: (req?: {
      knowledgeBaseId?: string;
      kind?: string;
      bindingId?: string;
    }) => client.request("knowledge.connector.status", req ?? {}),
    passiveConnectorSyncPlan: (req: {
      bindingId?: string;
      sourceDescriptorId?: string;
      candidates: Array<{ relativePath: string; rawHash?: string }>;
    }) => client.request("knowledge.connector.sync.plan", req),
    passiveConnectorSyncCommit: (req: {
      bindingId?: string;
      sourceDescriptorId?: string;
      files: Array<{
        relativePath: string;
        textContent?: string;
        contentBase64?: string;
        rawHash?: string;
      }>;
      deletedRelativePaths?: string[];
    }) => client.request("knowledge.connector.sync.commit", req),
    createVaultSync: (req: {
      password: string;
      deviceId?: string;
      platform?: string;
      ownerAccountId?: string;
    }) => client.request("knowledge.vault-sync.create", req),
    syncVaultSync: (req: {
      vaultId: string;
      deviceId: string;
      rootPath: string;
      password: string;
      selectiveSync?: {
        includeFolders?: boolean;
        includeImages?: boolean;
        includeAudio?: boolean;
        includeVideo?: boolean;
        includePdf?: boolean;
        includeOtherAttachments?: boolean;
        excludeGlobs?: string[];
      };
    }) => client.request("knowledge.vault-sync.sync", req),
    listVaultSync: (req?: { ownerAccountId?: string }) =>
      client.request("knowledge.vault-sync.list", req ?? {}),
    vaultSyncStatus: (req: { vaultId: string }) =>
      client.request("knowledge.vault-sync.status", req),
    vaultSyncInventory: (req: { vaultId: string; cursor?: string; limit?: number }) =>
      client.request("knowledge.vault-sync.inventory", req),
    vaultSyncHistory: (req: {
      vaultId: string;
      opaquePathId?: string;
      relativePath?: string;
      password?: string;
      deviceId?: string;
      rootPath?: string;
    }) => client.request("knowledge.vault-sync.history", req),
    vaultSyncTrash: (req: { vaultId: string; cursor?: string; limit?: number }) =>
      client.request("knowledge.vault-sync.trash", req),
    restoreVaultSync: (req: {
      vaultId: string;
      deviceId: string;
      rootPath: string;
      password: string;
      revisionId: string;
    }) => client.request("knowledge.vault-sync.restore", req),
    getVaultSyncSelectiveSync: (req: { vaultId: string; deviceId: string; rootPath?: string }) =>
      client.request("knowledge.vault-sync.selective-sync.get", req),
    setVaultSyncSelectiveSync: (req: {
      vaultId: string;
      deviceId: string;
      rootPath?: string;
      selectiveSync?: {
        includeFolders?: boolean;
        includeImages?: boolean;
        includeAudio?: boolean;
        includeVideo?: boolean;
        includePdf?: boolean;
        includeOtherAttachments?: boolean;
        excludeGlobs?: string[];
      };
    }) => client.request("knowledge.vault-sync.selective-sync.set", req),
    listVaultSyncDevices: (req: { vaultId: string }) =>
      client.request("knowledge.vault-sync.devices.list", req),
    revokeVaultSyncDevice: (req: { vaultId: string; deviceId: string }) =>
      client.request("knowledge.vault-sync.devices.revoke", req),
    enableVaultSyncTeamWithPassword: (req: {
      vaultId: string;
      ownerAccountId: string;
      password: string;
    }) => client.request("knowledge.vault-sync.team.enable-with-password", req),
    bumpVaultSyncEncryptionVersion: (req: { vaultId: string; expectedCurrent?: number }) =>
      client.request("knowledge.vault-sync.encryption-version.bump", req),
    createVaultSyncUploadSession: (req: {
      vaultId: string;
      deviceId: string;
      ciphertextHash: string;
      totalSizeBytes: number;
      chunkSize?: number;
    }) => client.request("knowledge.vault-sync.blobs.upload-session.create", req),
    getVaultSyncUploadSession: (req: { vaultId: string; uploadId: string }) =>
      client.request("knowledge.vault-sync.blobs.upload-session.get", req),
    putVaultSyncUploadChunk: (req: {
      vaultId: string;
      uploadId: string;
      chunkIndex: number;
      contentBase64: string;
    }) => client.request("knowledge.vault-sync.blobs.upload-session.put-chunk", req),
    completeVaultSyncUploadSession: (req: { vaultId: string; uploadId: string }) =>
      client.request("knowledge.vault-sync.blobs.upload-session.complete", req),
    abortVaultSyncUploadSession: (req: { vaultId: string; uploadId: string }) =>
      client.request("knowledge.vault-sync.blobs.upload-session.abort", req),
    getVaultSyncQuota: (req: { vaultId: string }) =>
      client.request("knowledge.vault-sync.quota.get", req),
    enableVaultSyncTeam: (req: {
      vaultId: string;
      ownerAccountId: string;
      publicKeyB64: string;
      ephemeralPublicKeyB64: string;
      wrappedBaseKeyB64: string;
      keyEpoch?: number;
    }) => client.request("knowledge.vault-sync.team.enable", req),
    listVaultSyncMembers: (req: { vaultId: string }) =>
      client.request("knowledge.vault-sync.members.list", req),
    revokeVaultSyncMember: (req: {
      vaultId: string;
      memberAccountId: string;
      actorAccountId: string;
    }) => client.request("knowledge.vault-sync.members.revoke", req),
    rotateVaultSyncMemberWraps: (req: {
      vaultId: string;
      actorAccountId: string;
      keyEpoch: number;
      wraps: Array<{
        memberAccountId: string;
        ephemeralPublicKeyB64: string;
        wrappedBaseKeyB64: string;
      }>;
    }) => client.request("knowledge.vault-sync.members.rotate-wraps", req),
    createVaultSyncInvite: (req: {
      vaultId: string;
      invitedByAccountId: string;
      inviteSaltB64: string;
      wrappedBaseKeyB64: string;
      inviteId?: string;
      inviteeAccountId?: string | null;
      role?: "admin" | "member";
      ttlMs?: number;
    }) => client.request("knowledge.vault-sync.invites.create", req),
    createVaultSyncInviteWithPassword: (req: {
      vaultId: string;
      invitedByAccountId: string;
      password: string;
      inviteeAccountId?: string | null;
      role?: "admin" | "member";
      ttlMs?: number;
    }) => client.request("knowledge.vault-sync.invites.create-with-password", req),
    listVaultSyncInvites: (req: { vaultId: string }) =>
      client.request("knowledge.vault-sync.invites.list", req),
    revokeVaultSyncInvite: (req: { vaultId: string; inviteId: string; actorAccountId: string }) =>
      client.request("knowledge.vault-sync.invites.revoke", req),
    acceptVaultSyncInvite: (req: {
      vaultId: string;
      inviteId: string;
      memberAccountId: string;
      publicKeyB64: string;
      ephemeralPublicKeyB64: string;
      wrappedBaseKeyB64: string;
    }) => client.request("knowledge.vault-sync.invites.accept", req),
    acceptVaultSyncInviteWithSecret: (req: {
      vaultId: string;
      inviteId: string;
      memberAccountId: string;
      inviteSecret: string;
    }) => client.request("knowledge.vault-sync.invites.accept-with-secret", req),
    putVaultSyncBlob: (req) => client.request("knowledge.vault-sync.blobs.put", req),
    commitVaultSyncRevision: (req) => client.request("knowledge.vault-sync.revisions.commit", req),
    listVaultSyncRevisionsSince: (req) =>
      client.request("knowledge.vault-sync.revisions.list-since", req),
    getVaultSyncRevision: (req) => client.request("knowledge.vault-sync.revisions.get", req),
    listVaultSyncRevisionsForPath: (req) =>
      client.request("knowledge.vault-sync.revisions.list-for-path", req),
    getVaultSyncBlob: (req) => client.request("knowledge.vault-sync.blobs.get", req),
    revokeVaultSyncMemberAndRotate: (req) =>
      client.request("knowledge.vault-sync.members.revoke-and-rotate", req),
    runtimeReindexVaultSync: (req: {
      vaultId: string;
      knowledgeBaseId?: string;
      rootPath?: string;
      touchedRelativePaths: string[];
      persistBinding?: boolean;
    }) => client.request("knowledge.vault-sync.runtime.reindex", req),
    invokeCapability: (req) => client.request("knowledge.capability.invoke", req),
    governanceSummary: (req) => client.request("knowledge.governance.summary", req ?? {}),
    governanceTasksList: (req) => client.request("knowledge.governance.tasks.list", req ?? {}),
    governanceClaimsList: (req) => client.request("knowledge.governance.claims.list", req ?? {}),
    governanceTaskGraph: (req) => client.request("knowledge.governance.tasks.graph", req),
    governanceTaskUpdate: (req) => client.request("knowledge.governance.tasks.update", req),
  };
}
