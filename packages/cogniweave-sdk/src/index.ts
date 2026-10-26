export type {
  AtomClaimType,
  AtomStatus,
  AtomUpsertDecision,
  CanonicalStatus,
  CognitivePackage,
  DerivedStatus,
  DistillationKeys,
  DistillationResult,
  DroppedPath,
  EngineConfig,
  EngineEnvironment,
  EntityRecord,
  EventProvenance,
  EventSkeleton,
  EvidenceLocator,
  EvidenceRecord,
  EvidenceSearchResult,
  MemoryAtom,
  MemoryAtomApplicability,
  MemoryAtomClaim,
  MemoryAtomTrigger,
  MemoryGovernanceMetrics,
  MemoryLifecycleMetadata,
  MemoryMetrics,
  MemoryPartitionKeyV1,
  MemoryPrivacyMetadata,
  MemoryProvenance,
  MemoryState,
  MemorySubject,
  MemorySubjectBinding,
  MemorySubjectOwnerType,
  MemorySubjectScopeType,
  AuthorizeMemoryAccessInput,
  AuthorizeMemoryAccessResult,
  AuthorizeMemoryDenyReason,
  MemoryTransferClass,
  SeatMemoryScopeTransfer,
  MemoryTrace,
  MemoryVersioning,
  NodeType,
  PackageAnswer,
  PackageRiskMarker,
  PackageWhy,
  ProblemRecord,
  ReasonDebugPayload,
  ReasoningPath,
  RelationRecord,
  RelationType,
  ResolveSourceLifecycleSelectorInput,
  ScenarioRecord,
  SeedCandidate,
  Scope,
  ScopeInput,
  ScopeVisibility,
  CogniWeaveSubjectContext,
  SourceBinding,
  SourceLifecycleInput,
  SourceLifecycleMode,
  SourceLifecycleReceipt,
  SourceLifecycleSelector,
  SourceObjectLink,
  SourceObjectType,
  SourceType,
  TaskFrame,
  TaskProvenance,
  TaskType,
  TracePackageResult,
  TraceReasoningSessionResult,
  WriteBackResult,
  WriteBackStatus,
  WriteJournal,
  WriteJournalDerivedPlan,
  WriteJournalObjectIds,
  WriteOperationRecord,
  WritePlan,
} from "./models.js";

export { resolveSourceLifecycleSelector } from "./models.js";

export type {
  AtomHybridHit,
  AtomQueryHit,
  CogniWeaveEngine,
  CompactJournalsOptions,
  CompactJournalsResult,
  FrameTaskOptions,
  IngestInput,
  IngestResult,
  MemoryEngine,
  QueryAtomsHybridOptions,
  QueryAtomsOptions,
  RebuildFromTruthOptions,
  RecoverFromCanonicalOptions,
  RecoverFromCanonicalResult,
  RepairIndexesOptions,
  ReasonOptions,
  ResolveEvidenceOptions,
  SearchEvidenceOptions,
  TraceOptions,
  UpsertAtomsOptions,
} from "./contracts.js";

export {
  CogniWeaveError,
  DistillationError,
  EvidenceAccessError,
  IdempotencyConflictError,
  ReasoningError,
  ScopeViolationError,
  StorageConsistencyError,
  ValidationError,
} from "./errors.js";

export {
  OPERATION_KEY_VERSION,
  PARTITION_KEY_VERSION,
  STABLE_CHECKSUM_METADATA_KEYS,
  computeDedupKey,
  computeEntityKey,
  computeEventKey,
  computeIngestionChecksum,
  computeScopeFingerprint,
  computeWriteOperationKey,
  createDataPlaneId,
  createMemoryPartitionKeyV1,
  normalizeClaim,
  normalizeTrigger,
  resolveSourceLocatorForOperationKey,
  serializeScope,
  stableMetadataForChecksum,
} from "./keys.js";

export { resolveScope, validateScope } from "./scope.js";

export type {
  AtomConflictResolution,
  AtomTypePolicy,
  AtomTypeStability,
  DualSourceCoverageMetric,
  MemoryRetentionClass,
  MemorySyncEligibility,
} from "./domain/atom-v2.js";
export {
  ATOM_IDENTITY_BOUNDARY_KEYS,
  DEFAULT_ATOM_TYPE_POLICIES,
  attachSeparatedScores,
  computeDualSourceCoverage,
  hasAtomIdentityBoundaryViolation,
  resolveAtomTypePolicy,
  scoreAdmission,
  scorePromotion,
  scoreRetrieval,
  stripAtomIdentityBoundary,
  withAtomV2Defaults,
} from "./domain/atom-v2.js";

export {
  LOCAL_TENANT_SENTINEL,
  authorizeMemoryAccess,
  createMemorySubjectBinding,
  createMemorySubjectBindingId,
  isLiveMemorySubjectBinding,
  isMemorySubjectOwnerType,
  markMemorySubjectBindingUnbound,
  normalizeMemorySubject,
  resolveLocalMemorySubject,
  resolveMemorySubjectTenantId,
  serializePartitionKey,
} from "./subject/binding.js";

export type {
  ApplySeatMemorySuccessionInput,
  SeatMemorySuccessionResult,
} from "./subject/succession.js";
export {
  applySeatMemorySuccession,
  applySeatSuccession,
  resolveSeatMemoryScopeId,
} from "./subject/succession.js";

export { DEFAULT_QUERY_EXCLUDE_STATUSES, isAtomRetrievable } from "./retrieval/lifecycle-gate.js";
export type { AtomLifecycleFilterReason, AtomRetrievability } from "./retrieval/lifecycle-gate.js";

export {
  applyRelationBoost,
  mergeHybridScores,
  rerankHybridHits,
  scoreAtomLexical,
  scoreDocumentLexical,
} from "./retrieval/hybrid.js";
export type { HybridChannelScores, HybridScoredAtom } from "./retrieval/hybrid.js";

export type { PromotionConsentContext, PromotionDecision } from "./sync/promotion-decision.js";
export { decidePromotion } from "./sync/promotion-decision.js";
export type { PromotionDecisionKind, PromotionPolicy } from "./sync/promotion-policy.js";
export { DEFAULT_PROMOTION_POLICY, resolvePromotionPolicy } from "./sync/promotion-policy.js";
export type { CloudPromotionEnvelope } from "./sync/promotion-envelope.js";
export {
  PROMOTION_CLAIM_STATEMENT_MAX_CHARS,
  PROMOTION_ENVELOPE_DENYLIST,
  assertPromotionEnvelopeHygiene,
  buildPromotionEnvelope,
} from "./sync/promotion-envelope.js";
export type { PromotionConsentMutation } from "./sync/consent.js";
export { grantPromotionConsent, revokePromotionConsent } from "./sync/consent.js";

export type {
  SyncOutbox,
  SyncOutboxEnqueueInput,
  SyncOutboxEntry,
  SyncOutboxOperation,
  SyncOutboxStatus,
} from "./sync/outbox.js";
export {
  FileSyncOutbox,
  InMemorySyncOutbox,
  buildSyncOutboxEntryId,
  resolveSyncOutboxDir,
  resolveSyncOutboxStorePath,
} from "./sync/outbox.js";
export type {
  CloudAuthContext,
  CloudDeleteTombstoneInput,
  CloudIntelligenceClient,
  CloudOpResult,
  CloudPullInput,
  CloudPullItem,
  CloudPullResult,
  CloudPushInput,
  CloudRejectCode,
  InMemoryCloudClientOptions,
} from "./sync/cloud-client.js";
export {
  InMemoryCloudIntelligenceClient,
  createCloudIdempotencyKey,
  createCloudNonce,
} from "./sync/cloud-client.js";
export { enqueuePromotionOutbox } from "./sync/enqueue-promotion.js";
export type { DrainOutboxResult } from "./sync/drain-outbox.js";
export { drainOutbox, nextOutboxBackoffMs } from "./sync/drain-outbox.js";
export type {
  LocalIntelligenceMirror,
  MirrorEntry,
  MirrorFreshness,
  MirrorFreshnessStatus,
  MirrorLiveEntry,
  MirrorPullBatchItem,
  MirrorQueryFilter,
  MirrorTombstoneEntry,
} from "./sync/local-mirror.js";
export {
  FileLocalIntelligenceMirror,
  InMemoryLocalIntelligenceMirror,
  buildMirrorEtag,
  resolveLocalMirrorDir,
  resolveLocalMirrorStorePath,
  shouldApplyMirrorItem,
} from "./sync/local-mirror.js";
export type { PullIntoMirrorResult } from "./sync/pull-mirror.js";
export { pullIntoMirror } from "./sync/pull-mirror.js";

export type { MetadataQueryFilter, VectorSearchHit } from "./storage/types.js";

export {
  attachDedupKey,
  normalizeTaskFrame,
  validateMemoryAtom,
  validateTaskFrame,
} from "./validation.js";

export { DEFAULT_ATOM_TYPES, NODE_TYPES, RELATION_TYPES } from "./graph/schema.js";

export { InMemoryCogniWeaveEngine } from "./runtime/in-memory-engine.js";
export type { CogniWeaveRuntime, CreateCogniWeaveRuntimeOptions } from "./runtime/bootstrap.js";
export { createCogniWeaveRuntime } from "./runtime/bootstrap.js";
export type {
  DefaultDistillationStrategyOptions,
  DefaultTaskFramingStrategyOptions,
  DistillationStrategy,
  DistillationStrategyInput,
  LlmDistillationProvider,
  LlmDistillationProviderInput,
  LlmFallbackDistillationStrategyOptions,
  LlmFallbackTaskFramingStrategyOptions,
  LlmTaskFramingProvider,
  LlmTaskFramingProviderInput,
  TaskFramingStrategy,
  TaskFramingStrategyInput,
  TaskFramingStrategyResult,
} from "./runtime/strategies.js";
export {
  createDefaultDistillationStrategy,
  createDefaultTaskFramingStrategy,
  LlmFallbackDistillationStrategy,
  LlmFallbackTaskFramingStrategy,
  RuleBasedDistillationStrategy,
  RuleBasedTaskFramingStrategy,
} from "./runtime/strategies.js";
export type {
  HttpDistillationProviderOptions,
  HttpTaskFramingProviderOptions,
  MultiCallHttpDistillationProviderOptions,
} from "./runtime/llm-provider.js";
export {
  createHttpDistillationProvider,
  createHttpTaskFramingProvider,
  HttpDistillationProvider,
  HttpTaskFramingProvider,
  MultiCallHttpDistillationProvider,
} from "./runtime/llm-provider.js";
export type {
  PathTemplate,
  ResolvedTemplateRelation,
  TemplateRegistryConfig,
  TemplateRelation,
  TemplateStep,
} from "./runtime/templates.js";
export {
  createDefaultTemplateRegistry,
  DEFAULT_TEMPLATE_REGISTRY,
  DEBUG_TEMPLATE,
  GENERIC_TEMPLATE,
  resolveTemplateRelation,
  selectPathTemplate,
  TemplateRegistry,
  validatePathTemplate,
} from "./runtime/templates.js";

export {
  InMemoryGraphStore,
  InMemoryMetadataStore,
  InMemoryVectorStore,
} from "./storage/in-memory.js";

export type { GraphStore, MetadataBundle, MetadataStore, VectorStore } from "./storage/types.js";

export { rebuildFromTruth, repairDerivedIndexes } from "./journal/repair.js";

export type {
  AdapterDescriptor,
  AdapterKind,
  AdapterResolution,
  BackendAdapterConfig,
} from "./adapters/contracts.js";
export { createAdapterBundle } from "./adapters/factory.js";
export { PlaceholderGraphStore } from "./adapters/graph.js";
export type {
  LocalMetadataBootstrapResult,
  LocalMetadataReadonlyOpenFailureCode,
  LocalMetadataReadonlyOpenResult,
  LocalMetadataStoreConfig,
  LocalMetadataTables,
} from "./adapters/local-metadata.js";
export {
  buildLocalMetadataSchema,
  LOCAL_METADATA_SCHEMA_VERSION,
  LOCAL_METADATA_TABLES,
  LocalMetadataStore,
  openLocalMetadataStoreReadonly,
} from "./adapters/local-metadata.js";
export { PlaceholderMetadataStore } from "./adapters/metadata.js";
export type {
  Neo4jCypherClient,
  Neo4jCypherTransaction,
  Neo4jGraphBootstrapResult,
  Neo4jGraphDocument,
  Neo4jGraphEdge,
  Neo4jGraphStoreConfig,
  Neo4jQueryResult,
} from "./adapters/neo4j-graph.js";
export { buildNeo4jGraphSchema, Neo4jGraphStore } from "./adapters/neo4j-graph.js";
export type {
  PgVectorBootstrapResult,
  PgVectorStoreConfig,
  PgVectorTables,
} from "./adapters/pgvector-vector.js";
export { buildPgVectorSchema, PGVECTOR_TABLES, PgVectorStore } from "./adapters/pgvector-vector.js";
export type {
  PostgresMetadataStoreConfig,
  PostgresMetadataTables,
  PostgresQueryResult,
  PostgresSchemaBootstrapResult,
  PostgresSqlTransaction,
  PostgresSqlClient,
} from "./adapters/postgres-metadata.js";
export {
  buildPostgresMetadataSchema,
  POSTGRES_METADATA_TABLES,
  PostgresMetadataStore,
} from "./adapters/postgres-metadata.js";
export type { CreatePgSqlClientOptions, PgSqlClientHandle } from "./adapters/postgres-client.js";
export { createPgSqlClient, resolveCogniWeavePostgresUrl } from "./adapters/postgres-client.js";
export type {
  LocalToPostgresMigrationCounts,
  LocalToPostgresMigrationResult,
  MigrateLocalCanonicalToPostgresInput,
} from "./migration/local-to-postgres.js";
export { migrateLocalCanonicalToPostgres } from "./migration/local-to-postgres.js";
export { PlaceholderVectorStore } from "./adapters/vector.js";

export type {
  DistillRequest,
  FrameTaskRequest,
  ReasonDebugResponse,
  ReasonRequest,
  RebuildFromTruthRequest,
  RepairIndexesRequest,
  ResolveEvidenceRequest,
  RestContext,
  RestHeaders,
  RestHttpSurface,
  RestResponse,
  RestApiSurface,
  WriteBackRequest,
} from "./rest/contracts.js";

export { CogniWeaveRestService } from "./rest/service.js";
export type { CogniWeaveHttpServerOptions, CogniWeaveRequestEnvelope } from "./rest/node-server.js";
export {
  createCogniWeaveHttpServer,
  handleCogniWeaveHttpRequest,
  routeCogniWeaveHttpRequest,
} from "./rest/node-server.js";

export type {
  CliCommand,
  CogniWeaveCliBootstrapTargetResult,
  CogniWeaveCliConfigSnapshot,
  CogniWeaveCliErrorCode,
  CogniWeaveCliJsonAction,
  CogniWeaveCliJsonCode,
  CogniWeaveCliJsonErrorAction,
  CogniWeaveCliJsonErrorEnvelope,
  CogniWeaveCliJsonEnvelope,
  CogniWeaveCliOptions,
  CogniWeaveServePlan,
} from "./cli.js";
export {
  bootstrapAdapterBundle,
  buildCogniWeaveCliConfigSnapshot,
  buildCogniWeaveEngineConfig,
  buildCogniWeaveServePlan,
  buildCogniWeaveHttpServerOptions,
  formatBootstrapSummary,
  parseCogniWeaveCliArgs,
  runCogniWeaveCli,
} from "./cli.js";
