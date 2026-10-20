import type {
  DataCapabilityDescriptor,
  ExternalDataSourceSummary,
  GraphViewModel,
  KnowledgeActionSuggestion,
  KnowledgeAgentProfile,
  KnowledgeDiscoveryEvent,
  KnowledgeObject,
  KnowledgeRecommendationItem,
  KnowledgeRecentVisit,
  KnowledgeRelatedGroups,
  KnowledgeSourceBrowse,
  KnowledgeSourceSummary,
  KnowledgeTaskContext,
  RelationshipGraph,
  RelationshipNode,
} from "./types.ts";

export type KnowledgeSearchRequest = {
  query?: string;
  limit?: number;
};

// --- P2 timeline / feed digest read models ---

export type KnowledgeTimelineBucket = {
  dayKey: string;
  label: string;
  events: KnowledgeDiscoveryEvent[];
};

export type KnowledgeTimelineResponse = {
  buckets: KnowledgeTimelineBucket[];
  totalEvents: number;
  lookbackMs: number;
  generatedAt: number;
};

export type KnowledgeFeedDigestHighlight = {
  kind: "discovery" | "action" | "recommendation";
  title: string;
  summary: string;
  timestamp: number;
  refId?: string;
};

export type KnowledgeFeedDigestCounts = {
  newKnowledge: number;
  governance: number;
  relations: number;
  usage: number;
  actions: number;
  recommendations: number;
};

export type KnowledgeFeedDigest = {
  dayKey: string;
  generatedAt: number;
  headline: string;
  counts: KnowledgeFeedDigestCounts;
  highlights: KnowledgeFeedDigestHighlight[];
};

export type KnowledgeFeedDigestResponse = {
  digest: KnowledgeFeedDigest;
};

export type KnowledgeSearchResponse = {
  results: KnowledgeObject[];
  sourceSummary: KnowledgeSourceSummary;
  dataCapabilities?: DataCapabilityDescriptor[];
  sourceBrowse?: KnowledgeSourceBrowse;
  externalDataSources?: ExternalDataSourceSummary[];
};

export type KnowledgePersonalCollectRequest = {
  title: string;
  summary: string;
  tags?: string[];
  sourceAgentId?: string;
  contextId?: string | null;
  knowledgeBaseId?: string;
};

export type PersonalKnowledgeIngestOutcomeDto = {
  attempted: boolean;
  skipped: boolean;
  reason?: string;
  chunkCount?: number;
  versionLabel?: string | null;
  error?: string;
};

export type KnowledgeCompatWarningDto = {
  code: "implicit_personal_inbox" | "source_bind_visibility_ignored";
  message: string;
};

export type KnowledgePersonalCollectResponse = {
  object: KnowledgeObject;
  skillId: string;
  knowledgeBaseId?: string;
  ingest?: PersonalKnowledgeIngestOutcomeDto | null;
  compatWarnings?: KnowledgeCompatWarningDto[];
};

export type KnowledgePersonalUploadResponse = KnowledgePersonalCollectResponse;

export type KnowledgePersonalDocumentAttachment = {
  fileName: string;
  mimeType: string;
  size: number;
  kind: "text" | "image" | "binary";
  textContent?: string;
  dataUrl?: string;
};

export type KnowledgeIngestParseOptionsDto = {
  chunkingStrategy?: "auto" | "paragraph" | "fixed";
  ocrEnabled?: boolean;
};

export type KnowledgePersonalUploadRequest = {
  title?: string;
  summary?: string;
  tags?: string[];
  content?: string;
  attachment: KnowledgePersonalDocumentAttachment;
  sourceAgentId?: string;
  knowledgeBaseId?: string;
  ingestOptions?: KnowledgeIngestParseOptionsDto;
};

export type KnowledgePersonalUploadFolderRequest = {
  folderName?: string;
  tags?: string[];
  sourceAgentId?: string;
  knowledgeBaseId?: string;
  attachments: KnowledgePersonalDocumentAttachment[];
  ingestOptions?: KnowledgeIngestParseOptionsDto;
};

export type KnowledgePersonalUploadFolderDocument = {
  skillId: string;
  title: string;
  fileName: string;
  ingest?: PersonalKnowledgeIngestOutcomeDto | null;
};

export type KnowledgePersonalUploadFolderResponse = {
  folderName?: string | null;
  imported: number;
  total: number;
  knowledgeBaseId?: string;
  documents: KnowledgePersonalUploadFolderDocument[];
  skipped: Array<{ fileName: string; reason: string }>;
  compatWarnings?: KnowledgeCompatWarningDto[];
};

export type KnowledgePersonalCollectWebRequest = {
  url: string;
  title?: string;
  /** Plain text captured in-browser (skips server-side fetch when provided). */
  text?: string;
  /** HTML captured in-browser (converted server-side; skips fetch when provided). */
  html?: string;
  tags?: string[];
  knowledgeBaseId?: string;
};

export type KnowledgePersonalCollectWebResponse = KnowledgePersonalCollectResponse & {
  url?: string;
  clipSource?: "client-text" | "client-html" | "server-fetch";
};

export type KnowledgeDatasetImportRecord = { title?: string; text: string };

export type KnowledgePersonalImportDatasetRequest = {
  datasetTitle: string;
  records: KnowledgeDatasetImportRecord[];
  knowledgeBaseId?: string;
};

export type KnowledgePersonalImportDatasetResponse = {
  knowledgeBaseId?: string;
  attempted: boolean;
  imported: number;
  skipped: number;
  chunkCount: number;
  documentIds: string[];
  compatWarnings?: KnowledgeCompatWarningDto[];
};

export type KnowledgeAccessRequest = {
  capabilityId: string;
  capabilityTitle: string;
};

export type KnowledgeAccessRequestResponse = {
  request: {
    requestId: string;
    capabilityId: string;
    capabilityTitle: string;
    status: "pending";
    createdAt: number;
  };
};

export type KnowledgeEnterpriseAccessRequest = {
  projectionId: string;
  projectionTitle: string;
};

export type KnowledgeEnterpriseAccessRequestResponse = {
  request: {
    requestId: string;
    projectionId: string;
    projectionTitle: string;
    status: "pending";
    createdAt: number;
  };
};

export type KnowledgePersonalVersionsResponse = {
  versions: Array<{
    version: string;
    createdAt: number;
    summary: string;
  }>;
};

export type KnowledgePersonalUpdateTagsRequest = {
  objectId: string;
  tags: string[];
};

export type KnowledgePersonalCompareVersionsRequest = {
  objectId: string;
  fromVersion: string;
  toVersion: string;
};

export type KnowledgePersonalCompareVersionsResponse = {
  diff: {
    skillId: string;
    fromVersion: string;
    toVersion: string;
    changedFields: Array<{
      field: string;
      before: unknown;
      after: unknown;
    }>;
  };
};

export type KnowledgeObjectRequest = {
  objectId?: string;
  nodeId?: string;
  knowledgeBaseId?: string | null;
  kbId?: string | null;
};

export type KnowledgeObjectResponse = {
  object: KnowledgeObject;
};

export type KnowledgeRelationshipsRequest = {
  query?: string;
  focusNodeId?: string | null;
  focusDocumentId?: string | null;
  knowledgeBaseId?: string | null;
  kbId?: string | null;
};

export type KnowledgeRelationshipsResponse = {
  graph: RelationshipGraph;
};

export type KnowledgeRecommendationsRequest = {
  limit?: number;
  focusObjectId?: string | null;
  taskContext?: KnowledgeTaskContext;
};

export type KnowledgeRecommendationsResponse = {
  recommendations: KnowledgeRecommendationItem[];
};

export type KnowledgeDiscoveryListResponse = {
  events: KnowledgeDiscoveryEvent[];
};

export type KnowledgeActionsListResponse = {
  actions: KnowledgeActionSuggestion[];
};

export type KnowledgeRelatedRequest = {
  objectId: string;
};

export type KnowledgeRelatedResponse = KnowledgeRelatedGroups;

export type KnowledgeRecentResponse = {
  visits: KnowledgeRecentVisit[];
};

export type KnowledgeRecentRecordRequest = {
  objectId: string;
};

export type KnowledgeRecentRecordResponse = {
  visits: KnowledgeRecentVisit[];
};

export type KnowledgeResolveRequest = {
  taskContext: KnowledgeTaskContext;
  query?: string;
};

export type KnowledgeResolveResponse = {
  objects: KnowledgeObject[];
  graph: RelationshipGraph;
  profile: KnowledgeAgentProfile;
};

export type KnowledgeContextRequest = {
  taskContext: KnowledgeTaskContext;
  query?: string;
};

export type KnowledgeContextResponse = {
  primaryObjects: KnowledgeObject[];
  relatedObjects: KnowledgeObject[];
  recommendedCapabilities: KnowledgeObject[];
  recommendedAgents: RelationshipNode[];
  recommendedOwners: RelationshipNode[];
  graph: RelationshipGraph;
  promptBlock?: string;
};

export type KnowledgeAgentProfileResponse = {
  profile: KnowledgeAgentProfile;
};

export type KnowledgeUniverseHomeSnapshot = {
  query: string;
  sourceSummary: KnowledgeSourceSummary;
  graph: RelationshipGraph;
  graphViewModel: GraphViewModel;
  searchResults: KnowledgeObject[];
  dataCapabilities: DataCapabilityDescriptor[];
  sourceBrowse: KnowledgeSourceBrowse;
  externalDataSources: ExternalDataSourceSummary[];
  recommendations: KnowledgeRecommendationItem[];
  discoveryEvents: KnowledgeDiscoveryEvent[];
  actionSuggestions: KnowledgeActionSuggestion[];
  recentVisits: KnowledgeRecentVisit[];
  relatedGroups: KnowledgeRelatedGroups | null;
  selectedNodeId: string | null;
  selectedObject: KnowledgeObject | null;
  /** True when discovery/actions gateway methods were unavailable and empty fallbacks were used. */
  homeInsightsDegraded?: boolean;
};

export type KnowledgeGovernanceLlmUsageSummary = {
  llmCallCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  creditsCharged: number;
  lastCallAt: number | null;
};

export type KnowledgeGovernanceSummary = {
  openConflictCount: number;
  openClaimConflictCount: number;
  openDuplicateCount: number;
  openOrphanCount: number;
  openStaleCount: number;
  suppressedChunkCount: number;
  indexedChunkCount: number;
  llmUsage: KnowledgeGovernanceLlmUsageSummary;
};

export type KnowledgeGovernanceTaskStatus = "open" | "in_review" | "resolved" | "dismissed";

export type KnowledgeGovernanceTaskType =
  | "duplicate"
  | "conflict"
  | "claim_conflict"
  | "stale"
  | "orphan";

export type KnowledgeClaimRecord = {
  id: string;
  kbId: string;
  chunkId: string;
  subject: string;
  predicate: string | null;
  objectValue: string;
  normalizedKey: string;
  claimText: string;
  extractionMethod: string;
  governanceStatus: "pending" | "confirmed" | "suppressed";
  conflictGroupId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type KnowledgeGovernanceTask = {
  id: string;
  kbId: string;
  taskType: KnowledgeGovernanceTaskType;
  status: KnowledgeGovernanceTaskStatus;
  priority: number;
  relatedChunkIds: string[];
  proposedResolution: Record<string, unknown> | null;
  assignedTo: string | null;
  createdAt: number;
  updatedAt: number;
};

export type KnowledgeGovernanceSummaryResponse = {
  summary: KnowledgeGovernanceSummary;
};

export type KnowledgeGovernanceTasksListResponse = {
  tasks: KnowledgeGovernanceTask[];
};

export type KnowledgeGovernanceClaimsListResponse = {
  claims: KnowledgeClaimRecord[];
};

export type KnowledgeCapabilityPreviewResponse = {
  preview: {
    capabilityId: string;
    indexedChunkCount: number;
    items: import("./types.ts").KnowledgeCapabilityPreviewItem[];
  };
};

export type KnowledgeGovernanceTaskGraphResponse = {
  graph: import("./types.ts").RelationshipGraph;
  claims: KnowledgeClaimRecord[];
  focusNodeId: string | null;
};

// --- Active/passive source descriptor + capability runtime + deliverable auto-capture ---
// Mirrors the backend contracts:
//   knowledge.source.bind/list/unbind  (src/gateway/knowledge/sources/source-descriptor.ts)
//   knowledge.capability.invoke         (src/gateway/knowledge/capability-invoke-runtime.ts)
//   knowledge.deliverables.capture      (src/gateway/knowledge/deliverables/auto-capture-runtime.ts)

export type KnowledgeSourceKind =
  | "upload"
  | "web"
  | "dataset"
  | "api"
  | "external"
  | "enterprise"
  | "capability"
  /** Durable passive folder source; paths live on device-local LocalFolderBinding. */
  | "localFolder"
  | "gitRepo"
  | "cloudDrive"
  | "mailAttachment";

// --- Local folder three-layer contracts (P0 scaffold; do not use knowledge.source.bind) ---

export type LocalFolderBindingMode = "local_index" | "managed_push";
export type LocalFolderDeletePolicy = "sync" | "snapshot";
export type LocalFolderBindingStatus = "idle" | "scanning" | "error";

export type LocalFolderBinding = {
  bindingId: string;
  sourceDescriptorId: string;
  knowledgeBaseId: string;
  deviceId: string;
  mode: LocalFolderBindingMode;
  directoryId?: string;
  /** Device-local only — never sent into cloud SourceDescriptor. */
  rootPath: string;
  rootLabel: string;
  includeGlobs: string[];
  excludeGlobs: string[];
  deletePolicy: LocalFolderDeletePolicy;
  watcherEnabled: boolean;
  status: LocalFolderBindingStatus;
  lastScanAt?: number;
  lastEventAt?: number;
  lastError?: string;
};

export type SourceDocumentLinkState = "active" | "tombstoned" | "snapshotted_deleted";

export type SourceDocumentLink = {
  sourceDescriptorId: string;
  docId: string;
  relativePath: string;
  state: SourceDocumentLinkState;
  lastSeenAt: number;
  lastIngestedVersionId?: string;
  rawHash?: string;
  semanticHash?: string;
};

export type LocalFolderBindRequest = {
  knowledgeBaseId: string;
  rootLabel: string;
  directoryId?: string;
  rootPath?: string;
  deviceId?: string;
  mode?: LocalFolderBindingMode;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  deletePolicy?: LocalFolderDeletePolicy;
  watcherEnabled?: boolean;
};

export type LocalFolderBindResponse = {
  sourceDescriptorId: string;
  bindingId: string;
  rootLabel: string;
  knowledgeBaseId: string;
};

export type LocalFolderScanNowRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
};

export type LocalFolderScanNowResponse = {
  accepted: boolean;
  bindingId: string;
  status: LocalFolderBindingStatus;
};

export type LocalFolderUnbindRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
  purgeProjected?: boolean;
};

export type LocalFolderUnbindResponse = { ok: boolean };

export type LocalFolderOpenDocumentRequest = {
  documentId: string;
  knowledgeBaseId?: string;
};

export type LocalFolderOpenDocumentResponse = {
  ok: true;
  documentId: string;
  bindingId: string;
  relativePath: string;
  absolutePath: string;
};

export type LocalFolderStatusRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
  knowledgeBaseId?: string;
};

export type LocalFolderStatusItem = {
  bindingId: string;
  sourceDescriptorId: string;
  knowledgeBaseId: string;
  rootLabel: string;
  status: LocalFolderBindingStatus;
  watcherEnabled: boolean;
  watcherRunning?: boolean;
  deletePolicy: LocalFolderDeletePolicy;
  mode: LocalFolderBindingMode;
  lastScanAt?: number;
  lastEventAt?: number;
  lastError?: string;
  activeDocumentCount?: number;
};

export type LocalFolderStatusResponse = { items: LocalFolderStatusItem[] };

export type LocalFolderSyncCandidate = {
  relativePath: string;
  rawHash?: string;
  sizeBytes?: number;
  mtimeMs?: number;
};

export type LocalFolderSyncPlanRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
  deviceId: string;
  candidates: LocalFolderSyncCandidate[];
  retainRelativePaths?: string[];
};

export type LocalFolderSyncNeedUpload = {
  relativePath: string;
  reason: "missing" | "hash_mismatch" | "no_hash";
  docId: string;
};

export type LocalFolderSyncPlanResponse = {
  bindingId: string;
  sourceDescriptorId: string;
  needUpload: LocalFolderSyncNeedUpload[];
  unchanged: string[];
  missingOnDevice: string[];
  planId: string;
  generation: number;
  deviceId: string;
  expiresAtMs: number;
};

export type LocalFolderSyncCommitFile = {
  relativePath: string;
  fileName?: string;
  mimeType?: string;
  contentBase64?: string;
  textContent?: string;
  rawHash?: string;
};

export type LocalFolderSyncCommitRequest = {
  bindingId?: string;
  sourceDescriptorId?: string;
  deviceId: string;
  planId: string;
  generation: number;
  phase: "upload" | "finalize";
  files: LocalFolderSyncCommitFile[];
};

export type LocalFolderSyncCommitDocument = {
  relativePath: string;
  docId: string;
  originalStored: boolean;
  chunkCount: number;
  vectorCount: number;
  ready: boolean;
};

export type LocalFolderSyncCommitResponse = {
  bindingId: string;
  sourceDescriptorId: string;
  ingested: number;
  skipped: number;
  tombstoned: number;
  snapshotted: number;
  errors: string[];
  documents?: LocalFolderSyncCommitDocument[];
};

/** passive = chunk-indexed + retrievable (RAG); active = register-only, consumed via governed runtime. */
export type KnowledgeSourcePlane = "passive" | "active";

export type KnowledgeSourceVisibility = "private" | "team" | "enterprise";

export type KnowledgeSourceDescriptor = {
  id: string;
  kind: KnowledgeSourceKind;
  plane: KnowledgeSourcePlane;
  title: string;
  knowledgeBaseId?: string;
  ownerId?: string;
  visibility?: KnowledgeSourceVisibility;
  freshness?: "fresh" | "stale" | "unknown";
  endpoint?: string;
  metadata?: Record<string, string>;
  createdAtMs: number;
};

/** Only active source kinds may be bound here; passive sources use the ingest RPCs. */
export type KnowledgeSourceBindRequest = {
  kind: "api" | "external" | "capability";
  title?: string;
  endpoint?: string;
  knowledgeBaseId?: string;
  visibility?: KnowledgeSourceVisibility;
  metadata?: Record<string, string>;
};

export type KnowledgeSourceBindResponse = { binding: KnowledgeSourceDescriptor };

export type KnowledgeSourceListRequest = { knowledgeBaseId?: string };

export type KnowledgeSourceListResponse = { bindings: KnowledgeSourceDescriptor[] };

export type KnowledgeSourceUnbindRequest = { id: string };

export type KnowledgeSourceUnbindResponse = { ok: boolean };

export type KnowledgeSourceIngestRequest = {
  sourceDescriptorId: string;
  knowledgeBaseId: string;
  path?: string;
  method?: string;
  body?: Record<string, unknown>;
};

export type KnowledgeSourceIngestResponse = {
  ok: boolean;
  sourceDescriptorId: string;
  documentId?: string;
  knowledgeBaseId?: string;
  reason?: string;
  ingest?: PersonalKnowledgeIngestOutcomeDto | null;
};

export type KnowledgeDeliverableCaptureRequest = {
  content: string;
  title?: string;
  agentId?: string;
  sessionKey?: string;
  messageId?: string;
  contextId?: string;
  tags?: string[];
  /** Bypass the length gate for explicitly-flagged high-value outputs. */
  force?: boolean;
};

export type KnowledgeDeliverableCaptureResponse = {
  captured: boolean;
  reason: "captured" | "duplicate" | "too-short" | "empty";
  skillId?: string;
  deliverableId?: string;
};

export type KnowledgeCapabilityInvokeRequest = { capabilityId: string };

export type KnowledgeCapabilityInvokeResponse = {
  ok: boolean;
  capabilityId: string;
  /** Resolved seat access state for the capability (e.g. granted / denied); display-only. */
  accessState: string;
  reason?: "not-authorized" | "not-found" | "no-tenant" | "no-seat" | "quota-exceeded";
  /** Materialized, governed capability metadata — never a live connector call. */
  data?: {
    title: string;
    summary: string;
    sourceSystems: string[];
    scenarios: string[];
    freshness: "fresh" | "stale" | "unknown";
  };
  auditId?: string;
};

export type PassiveConnectorBindRequest = {
  kind: "gitRepo" | "cloudDrive" | "mailAttachment";
  knowledgeBaseId: string;
  label: string;
  locator: string;
  deletePolicy?: "sync" | "snapshot";
  deviceId?: string;
  config?: Record<string, string>;
};

export type PassiveConnectorBindResponse = {
  bindingId: string;
  sourceDescriptorId: string;
  label: string;
  providerReady: boolean;
};
