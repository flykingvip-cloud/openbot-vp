import type { KnowledgeObject } from "./types.ts";

export type KnowledgeBaseSummary = {
  id: string;
  title: string;
  description: string;
  documentCount: number;
  chunkCount?: number;
  relationCount?: number;
  /** Per-relation-type edge counts (引用/重复/冲突) backing the 关系构成 card. */
  relationBreakdown?: { reference: number; duplicate: number; conflict: number };
  conflictCount?: number;
  /** Average governance scores (0..1, null when unscored) for 知识健康度详情. */
  scoreAverages?: { quality: number | null; trust: number | null; freshness: number | null };
  /** Total retrieval citations (sum of chunk reference_count) across the space. */
  citationCount?: number;
  /** Distinct agents that have consumed/cited this space (from lineage). */
  activeAgentCount?: number;
  healthScore?: number;
  governanceStatus?: "healthy" | "attention" | "conflict";
  visibility: "private" | "team" | "enterprise";
  updatedAtMs: number;
  tags?: string[];
  reservedKind?: "personal_deliverables" | "team_deliverables";
  canWrite?: boolean;
  canAdmin?: boolean;
};

/** Knowledge base visibility scope; alias of {@link KnowledgeBaseSummary.visibility}. */
export type KnowledgeBaseVisibility = KnowledgeBaseSummary["visibility"];

export type KnowledgeEvidenceDto = {
  sourceKind: string;
  docId: string;
  docTitle: string;
  kbId: string;
  kbTitle?: string;
  versionId: string;
  versionLabel?: string;
  publishedAt?: number;
  score: number;
  chunkText: string;
  heading?: string;
  section?: string;
  sourceUri: string;
  governanceStatus?: "pending" | "confirmed" | "merged" | "archived" | "suppressed";
  governanceConflict?: boolean;
  governanceClaimConflict?: boolean;
};

export type KnowledgeBaseSearchRequest = {
  knowledgeBaseId: string;
  query: string;
  limit?: number;
};

export type KnowledgeBaseSearchResponse = {
  knowledgeBaseId: string;
  query: string;
  evidence: KnowledgeEvidenceDto[];
  searchMode: "indexed" | "substring";
  substringMatches: KnowledgeObject[];
};

export type KnowledgeBaseListResponse = {
  knowledgeBases: KnowledgeBaseSummary[];
};

export type KnowledgeBaseGetRequest = {
  knowledgeBaseId: string;
};

export type KnowledgeBaseGetResponse = {
  knowledgeBase: KnowledgeBaseSummary & {
    ownerId: string;
    documentIds: string[];
  };
};

export type KnowledgeBaseDocumentSummaryDto = {
  docId: string;
  title: string;
  contentType: string | null;
  updatedAtMs: number;
  indexed: boolean;
  /** Number of indexed chunks for this document (关联片段). */
  chunkCount?: number;
  /** Average governance trust_score (0..1) across the document's chunks (可信度). */
  trustScore?: number;
};

export type KnowledgeBaseSnippetSummaryDto = {
  chunkId: string;
  docId: string;
  docTitle: string;
  heading?: string;
  section?: string;
  excerpt: string;
  updatedAtMs: number;
  /** Governance trust_score (0..1) of the chunk; omitted when unscored. */
  trustScore?: number;
  /** Governance status (pending/confirmed/merged/archived/suppressed). */
  governanceStatus?: string;
  /** Times the chunk has been retrieved/cited by agents. */
  referenceCount?: number;
  /** Relation edges touching the chunk. */
  relationCount?: number;
};

export type KnowledgeBaseDocumentsListRequest = {
  knowledgeBaseId: string;
};

export type KnowledgeBaseDocumentsListResponse = {
  knowledgeBaseId: string;
  documents: KnowledgeBaseDocumentSummaryDto[];
};

export type KnowledgeBaseSourcePlaneDto = "passive" | "active";

export type KnowledgeBaseSourceListKindDto =
  | "document"
  | "upload"
  | "web"
  | "dataset"
  | "note"
  | "agent-knowledge"
  | "api"
  | "external"
  | "capability"
  | "localFolder"
  | "gitRepo"
  | "cloudDrive"
  | "mailAttachment";

export type KnowledgeBaseSourceListItemDto = {
  id: string;
  knowledgeBaseId: string;
  plane: KnowledgeBaseSourcePlaneDto;
  kind: KnowledgeBaseSourceListKindDto;
  title: string;
  formatLabel?: string;
  status?: string;
  sourceDescriptorId?: string;
  documentId?: string;
  /** True when the gateway can open the host-local original file. */
  canOpenOriginal?: boolean;
  /** True when sidebar can preview retained original bytes (or local_index). */
  canPreviewOriginal?: boolean;
  updatedAtMs: number;
  visibility: KnowledgeBaseSummary["visibility"];
};

export type KnowledgeBaseSourcesListRequest = {
  knowledgeBaseId: string;
  plane?: KnowledgeBaseSourcePlaneDto;
  kind?: KnowledgeBaseSourceListKindDto;
};

export type KnowledgeBaseSourcesListResponse = {
  knowledgeBaseId: string;
  sources: KnowledgeBaseSourceListItemDto[];
};

export type KnowledgeDocumentPreviewRequest = {
  knowledgeBaseId: string;
  documentId: string;
  render?: boolean;
};

export type KnowledgeDocumentPreviewResponse = {
  filename: string;
  relativePath?: string;
  mimeType: string;
  byteLength: number;
  textLike: boolean;
  renderKind?: "html";
  html?: string;
  base64?: string;
  source?: "original_store" | "local_index" | "index_text";
};

export type KnowledgeDocumentSaveRequest = {
  knowledgeBaseId: string;
  documentId: string;
  text: string;
  title?: string;
  fileName?: string;
};

export type KnowledgeDocumentSaveResponse = {
  knowledgeBaseId: string;
  documentId: string;
  ingest?: {
    attempted: boolean;
    skipped: boolean;
    chunkCount?: number;
  };
};

export type KnowledgeBaseSnippetsListRequest = {
  knowledgeBaseId: string;
  limit?: number;
};

export type KnowledgeBaseSnippetsListResponse = {
  knowledgeBaseId: string;
  snippets: KnowledgeBaseSnippetSummaryDto[];
};

export type KnowledgeBaseRecycleListRequest = {
  knowledgeBaseId: string;
};

export type KnowledgeBaseEvictedChunkSummaryDto = {
  chunkId: string;
  docId: string;
  docTitle: string;
  excerpt: string;
  /** Eviction reason: conflict group / duplicate group / suppressed. */
  reason: "conflict" | "duplicate" | "suppressed";
  updatedAtMs: number;
};

export type KnowledgeBaseRecycleListResponse = {
  knowledgeBaseId: string;
  documents: KnowledgeBaseDocumentSummaryDto[];
  /** Governance-evicted (suppressed) chunks with reasons — the 治理淘汰 detail. */
  evicted: KnowledgeBaseEvictedChunkSummaryDto[];
};

export type KnowledgeBaseDocumentMutationRequest = {
  knowledgeBaseId: string;
  documentId: string;
};

export type KnowledgeBaseDocumentMutationResponse = {
  knowledgeBase: KnowledgeBaseSummary & { ownerId: string; documentIds: string[] };
  documentId: string;
};

export type KnowledgeBaseWebPageSummaryDto = {
  docId: string;
  title: string;
  url: string;
  updatedAtMs: number;
  indexed: boolean;
  /** Number of indexed versions (change history across re-ingests). */
  versionCount?: number;
  /** Average governance freshness_score (0..1) of the page's chunks. */
  freshnessScore?: number;
  /** Latest snapshot's content-change ratio (0..1) — 内容变化率. */
  changeRatio?: number;
  /** Last time the page content actually changed (ms) — 最近变化. */
  lastChangedAtMs?: number;
  /** How many web snapshots were captured for this url (re-fetch count). */
  snapshotCount?: number;
  /** Auto-refresh enabled for this url (自动刷新). */
  refreshEnabled?: boolean;
  /** Auto-refresh cadence in ms. */
  refreshIntervalMs?: number;
  /** Next scheduled refresh time (ms). */
  refreshNextDueAtMs?: number;
  /** Last auto-refresh run time (ms). */
  refreshLastRefreshedAtMs?: number;
  /** Last auto-refresh outcome (initial/unchanged/changed/error). */
  refreshStatus?: string;
};

export type KnowledgeBaseWebListRequest = {
  knowledgeBaseId: string;
};

export type KnowledgeBaseWebListResponse = {
  knowledgeBaseId: string;
  webPages: KnowledgeBaseWebPageSummaryDto[];
};

export type KnowledgeBaseWebRefreshPolicyDto = {
  url: string;
  docId: string | null;
  enabled: boolean;
  intervalMs: number;
  lastRefreshedAtMs: number | null;
  nextDueAtMs: number | null;
  lastStatus: string | null;
  lastError: string | null;
};

export type KnowledgeBaseWebRefreshPolicyRequest = {
  knowledgeBaseId: string;
  url: string;
  docId?: string | null;
  enabled: boolean;
  intervalMs?: number;
};

export type KnowledgeBaseWebRefreshPolicyResponse = {
  knowledgeBaseId: string;
  policy: KnowledgeBaseWebRefreshPolicyDto;
};

export type KnowledgeBaseDatasetSummaryDto = {
  docId: string;
  title: string;
  contentType: string | null;
  format: string;
  updatedAtMs: number;
  indexed: boolean;
  /** Source records grouped into this dataset (记录数); set for grouped dataset imports. */
  recordCount?: number;
  /** Total indexed chunks across the dataset's records (关联片段). */
  chunkCount?: number;
  /** Average governance trust_score (0..1) across the dataset's chunks (可信度). */
  trustScore?: number;
  /** Total agent retrieval references across the dataset's chunks (引用次数). */
  referenceCount?: number;
  /** Most recent agent consumption (max last_hit_at) — 最近消费. */
  lastConsumedAtMs?: number;
  /** Parsed column count from the structural schema (字段). */
  columnCount?: number;
  /** Parsed data-row count from the structural schema (行数). */
  rowCount?: number;
  /** Parsed column names + inferred types. */
  columns?: Array<{ name: string; type: string }>;
};

export type KnowledgeBaseDatasetsListRequest = {
  knowledgeBaseId: string;
};

export type KnowledgeBaseDatasetsListResponse = {
  knowledgeBaseId: string;
  datasets: KnowledgeBaseDatasetSummaryDto[];
};

export type KnowledgeBaseAgentKnowledgeType =
  | "conversation_summary"
  | "long_term_memory"
  | "auto_sop"
  | "auto_relation"
  | "auto_analysis";

export type KnowledgeBaseAgentKnowledgeDto = {
  knowledgeId: string;
  kbId: string;
  agentId: string | null;
  type: KnowledgeBaseAgentKnowledgeType;
  title: string | null;
  summary: string | null;
  sourceLineageId: string | null;
  sourceDeliverableId: string | null;
  status: "pending" | "confirmed" | "archived";
  createdAtMs: number;
  updatedAtMs: number;
};

export type KnowledgeBaseAgentKnowledgeTypeCountDto = {
  type: KnowledgeBaseAgentKnowledgeType;
  count: number;
};

export type KnowledgeBaseAgentKnowledgeListRequest = {
  knowledgeBaseId: string;
};

export type KnowledgeBaseAgentKnowledgeListResponse = {
  knowledgeBaseId: string;
  items: KnowledgeBaseAgentKnowledgeDto[];
  summary: KnowledgeBaseAgentKnowledgeTypeCountDto[];
};

export type KnowledgeBaseAgentKnowledgeGenerateRequest = {
  knowledgeBaseId: string;
  sessionKey: string;
  modes?: Array<"summary" | "sop">;
};

export type KnowledgeBaseAgentKnowledgeGeneratedDto = {
  type: "conversation_summary" | "auto_sop";
  knowledgeId: string;
  title: string;
};

export type KnowledgeBaseAgentKnowledgeGenerateResponse = {
  knowledgeBaseId: string;
  generated: KnowledgeBaseAgentKnowledgeGeneratedDto[];
  reason?: string;
};

export type KnowledgeBaseMemberRoleDto = "viewer" | "editor" | "admin";

export type KnowledgeBaseMemberDto = {
  memberId: string;
  knowledgeBaseId: string;
  email: string;
  role: KnowledgeBaseMemberRoleDto;
  status: "pending" | "active";
  invitedByUserId: string;
  createdAtMs: number;
};

export type KnowledgeBaseMembersListRequest = {
  knowledgeBaseId: string;
};

export type KnowledgeBaseMembersListResponse = {
  knowledgeBaseId: string;
  members: KnowledgeBaseMemberDto[];
};

export type KnowledgeBaseMemberInviteRequest = {
  knowledgeBaseId: string;
  email: string;
  role?: KnowledgeBaseMemberRoleDto;
};

export type KnowledgeBaseMemberInviteResponse = {
  knowledgeBaseId: string;
  member: KnowledgeBaseMemberDto;
};

export type KnowledgeBaseCreateRequest = {
  title: string;
  description?: string;
  visibility?: KnowledgeBaseSummary["visibility"];
};

export type KnowledgeBaseCreateResponse = {
  knowledgeBase: KnowledgeBaseSummary & { ownerId: string; documentIds: string[] };
};

export type KnowledgeBaseUpdateRequest = {
  knowledgeBaseId: string;
  title?: string;
  description?: string;
  visibility?: KnowledgeBaseSummary["visibility"];
};

export type KnowledgeBaseUpdateResponse = {
  knowledgeBase: KnowledgeBaseSummary & { ownerId: string; documentIds: string[] };
};

export type KnowledgeBaseDeleteRequest = {
  knowledgeBaseId: string;
};

export type KnowledgeBaseDeleteResponse = {
  ok: true;
};

export type ArtifactSourceTypeDto =
  | "agent"
  | "collaboration"
  | "task"
  | "enterprise"
  | "personal"
  | "external";

export type ArtifactKindDto =
  | "document"
  | "report"
  | "agent_result"
  | "workflow_output"
  | "knowledge"
  | "note";

export type ArtifactGovernanceStatusDto = "verified" | "pending" | "conflict";

export type DeliverableGovernanceAction =
  | "viewRelations"
  | "viewCitations"
  | "viewSource"
  | "mergeKnowledge"
  | "markInvalid"
  | "assignExpert";

export type DeliverableDetailFocus = "preview" | "trace" | "citations" | "source" | "archive";

export type WorkspaceDeliverableDto = {
  deliverableId: string;
  title: string;
  kind: string;
  /** @deprecated Prefer `sourceType`. */
  source: "chat" | "agent" | "group" | "task";
  sourceType?: ArtifactSourceTypeDto;
  artifactKind?: ArtifactKindDto;
  governanceStatus?: ArtifactGovernanceStatusDto;
  pinned?: boolean;
  contentType?: string;
  creators: string[];
  primaryCreatorName?: string;
  groupId?: string;
  groupTitle?: string;
  taskId?: string;
  relatedKnowledgeBaseId?: string;
  previewKind?: "file" | "published" | "text";
  artifactFilename?: string;
  openUrl?: string;
  status: string;
  updatedAtMs: number;
  /** Runtime staleness signal (过时): source knowledge changed after this deliverable was archived. */
  stale?: boolean;
};

export type WorkspaceDeliverablesListResponse = {
  deliverables: WorkspaceDeliverableDto[];
};

export type WorkspaceDeliverableAttachRequest = {
  deliverableId: string;
  knowledgeBaseId: string;
};

export type WorkspaceDeliverableAttachResponse = {
  knowledgeBase: KnowledgeBaseSummary & { documentIds: string[] };
  documentId: string;
  relatedKnowledgeBaseId: string;
  ingest?: {
    attempted: boolean;
    skipped: boolean;
    chunkCount?: number;
  } | null;
};

export type WorkspaceDeliverableTraceStepKind =
  | "trigger"
  | "agent"
  | "knowledge"
  | "collaboration"
  | "task"
  | "review"
  | "output";

export type WorkspaceDeliverableTraceStepDto = {
  id: string;
  kind: WorkspaceDeliverableTraceStepKind;
  title: string;
  description: string;
  actorName?: string;
  atMs?: number;
};

export type WorkspaceDeliverableCitedKnowledgeDto = {
  kbId: string;
  kbTitle?: string;
  docId?: string;
  docTitle?: string;
  chunkText?: string;
  score?: number;
};

export type WorkspaceDeliverableModelUsageDto = {
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

/** Downstream 成果 generated from this deliverable's archived knowledge (Work Memory Network edge). */
export type WorkspaceDeliverableDownstreamLinkDto = {
  deliverableId: string;
  title?: string;
  agentName?: string;
  atMs?: number;
};

export type WorkspaceDeliverableTraceDto = {
  deliverableId: string;
  deliverable: WorkspaceDeliverableDto;
  steps: WorkspaceDeliverableTraceStepDto[];
  citedKnowledge: WorkspaceDeliverableCitedKnowledgeDto[];
  downstreamDeliverables?: WorkspaceDeliverableDownstreamLinkDto[];
  modelUsage?: WorkspaceDeliverableModelUsageDto | null;
  previewText?: string;
  dataSource: "live" | "reconstructed";
};

export type WorkspaceDeliverableTraceResponse = {
  trace: WorkspaceDeliverableTraceDto;
};

export type WorkspaceSearchGroupId =
  | "knowledge"
  | "enterprise"
  | "deliverables"
  | "capabilities"
  | "agents"
  | "owners";

export type WorkspaceSearchHit = {
  id: string;
  group: WorkspaceSearchGroupId;
  title: string;
  subtitle?: string;
  score?: number;
  objectId?: string;
  nodeId?: string;
  deliverableId?: string;
  capabilityId?: string;
  docId?: string;
  kbId?: string;
  governanceStatus?: "verified" | "pending" | "conflict";
  governanceClaimConflict?: boolean;
};

export type WorkspaceSearchGroup = {
  group: WorkspaceSearchGroupId;
  hits: WorkspaceSearchHit[];
};

export type WorkspaceSearchMode = "indexed" | "substring" | "mixed";

export type WorkspaceSearchRequest = {
  query?: string;
  limitPerGroup?: number;
};

export type WorkspaceSearchResponse = {
  query: string;
  searchMode: WorkspaceSearchMode;
  totalCount: number;
  groups: WorkspaceSearchGroup[];
  legacyResults: KnowledgeObject[];
};
