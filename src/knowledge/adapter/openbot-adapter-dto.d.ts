// PolicyGeneration: runtime-validate integer 1..9007199254740991 with isPolicyGeneration; TS number alone is not validation.
// Sha256Hex: runtime-validate bare lowercase64; never prefix algorithm in digest.
// WriteActivationResult: activated iff created_version === current_version && lifecycle_state === published.
// GENERATED DRAFT: pending M1 joint freeze; no v2 runtime implementation.
// Tenant/actor claims are trusted gateway-verified mappings, not client authority.
// RollbackAuditDetails is audit-only semantics, never added v1 response fields.
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "SIGNATURE_INVALID"
  | "REPLAY_DETECTED"
  | "PERMISSION_DENIED"
  | "IDENTITY_REVOKED"
  | "POLICY_GENERATION_STALE"
  | "REDACTION_FAIL_CLOSED"
  | "RESOURCE_NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "LIFECYCLE_CONFLICT"
  | "TAMPERED_EXCERPT"
  | "ANCHOR_UNRESOLVABLE"
  | "RATE_LIMITED"
  | "CONTEXT_BUDGET_EXCEEDED"
  | "BACKEND_UNAVAILABLE";

export type CanonicalKbUri = `kb://org/${string}/doc/${string}@${number}${string}`;

export type LegacyKuUri = `ku://kb/${string}/doc/${string}@${string}`;

export type IdentityContext = {
  readonly request_id: string;
  readonly tenant_id: string;
  readonly actor: {
    readonly issuer: string;
    readonly subject_id: string;
    readonly actor_type: "human" | "agent" | "service";
    readonly roles: ReadonlyArray<string>;
    readonly department_ids: ReadonlyArray<string>;
    readonly ancestor_department_ids: ReadonlyArray<string>;
    readonly org_roles: ReadonlyArray<string>;
    readonly clearance_level: string;
    readonly clearance_tags: ReadonlyArray<string>;
    readonly policy_generation: PolicyGeneration;
    readonly session_id: string;
  };
  readonly agent?: {
    readonly agent_id: string;
    readonly profile_generation: number;
    readonly task_id: string;
  };
  readonly purpose:
    | "read"
    | "ground_internal_llm"
    | "ground_external_llm"
    | "export"
    | "eval_and_train";
};

export type KnowledgeBase = {
  readonly kb_id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly description: string;
  readonly space_type: "enterprise_public" | "department" | "personal";
  readonly visibility: "private" | "team" | "enterprise";
  readonly governance_tier: "l1_agile" | "l2_controlled";
  readonly owner_user_id: string;
  readonly owner_department_id: string;
  readonly tags: ReadonlyArray<string>;
  readonly status: "active" | "archived";
  readonly metadata: { readonly [key: string]: JsonValue };
  readonly created_at: string;
  readonly updated_at: string;
};

export type KnowledgeAsset = {
  readonly doc_id: string;
  readonly tenant_id: string;
  readonly kb_id: string;
  readonly owner_id: string;
  readonly title: string;
  readonly asset_type:
    | "document"
    | "web_snapshot"
    | "dataset"
    | "deliverable"
    | "structured_record"
    | "code_artifact";
  readonly source_kind: "upload" | "connector" | "web_crawl" | "agent_generated" | "api_sync";
  readonly source_ref: string;
  readonly visibility: "private" | "team" | "enterprise";
  readonly current_version: number;
  readonly current_version_id: string;
  readonly lifecycle_state:
    | "draft"
    | "in_review"
    | "approved"
    | "published"
    | "rejected"
    | "superseded"
    | "revoked";
  readonly archived: boolean;
  readonly archived_at: string | null;
  readonly tags: ReadonlyArray<string>;
  readonly metadata: { readonly [key: string]: JsonValue };
  readonly domain_metadata: {
    readonly schema_ref: string | null;
    readonly payload: { readonly [key: string]: JsonValue };
  };
  readonly valid_from: string | null;
  readonly valid_to: string | null;
};

export type DocumentVersion = {
  readonly doc_id: string;
  readonly version: number;
  readonly version_id: string;
  readonly version_label: string;
  readonly filename: string;
  readonly raw_hash: Sha256Hex;
  readonly semantic_hash: Sha256Hex;
  readonly lifecycle_state:
    | "draft"
    | "in_review"
    | "approved"
    | "published"
    | "rejected"
    | "superseded"
    | "revoked";
  readonly author_id: string;
  readonly reviewer_id: string;
  readonly publisher_id: string;
  readonly source_issue_id: string;
  readonly rollback_from_version: number | null;
  readonly created_at: string;
  readonly published_at: string;
  readonly hash_algorithm: "sha256";
};

export type EvidenceRecord = {
  readonly evidence_id: string;
  readonly tenant_id: string;
  readonly kb_id: string;
  readonly doc_id: string;
  readonly version: number;
  readonly version_id: string;
  readonly chunk_id: string;
  readonly anchor_id: string;
  readonly title: string;
  readonly section_path: ReadonlyArray<string>;
  readonly excerpt: string;
  readonly excerpt_hash: Sha256Hex;
  readonly canonical_uri: CanonicalKbUri;
  readonly locator: {
    readonly page: number;
    readonly char_start: number;
    readonly char_end: number;
    readonly table_cell: string | null;
  };
  readonly masking_summary: string;
  readonly verification_status: "verified" | "unverified" | "revoked" | "unresolvable";
  readonly hash_algorithm: "sha256";
};

export type SearchExchange = {
  readonly request: {
    readonly query: string;
    readonly mode: "keyword" | "vector" | "hybrid";
    readonly limit: number;
    readonly scope: {
      readonly mode: "all" | "none" | "spaces" | "documents";
      readonly kb_ids?: ReadonlyArray<string>;
      readonly doc_ids?: ReadonlyArray<string>;
      readonly space_types?: ReadonlyArray<"enterprise_public" | "department" | "personal">;
    };
    readonly filters: {
      readonly asset_types: ReadonlyArray<string>;
      readonly tags: ReadonlyArray<string>;
      readonly lifecycle_states: ReadonlyArray<string>;
    };
    readonly rerank: {
      readonly enabled: boolean;
      readonly reranker_id: string;
      readonly top_k: number;
    };
    readonly calibration: {
      readonly enabled: boolean;
      readonly min_calibrated_score: number;
    };
  };
  readonly response: {
    readonly mode: "keyword" | "vector" | "hybrid";
    readonly reranker_id: string;
    readonly calibrator_id: string;
    readonly calibration_applied: boolean;
    readonly candidate_budget_exhausted: boolean;
    readonly filtered_below_threshold: number;
    readonly hits: ReadonlyArray<{
      readonly doc_id: string;
      readonly kb_id: string;
      readonly version: number;
      readonly version_id: string;
      readonly chunk_id: string;
      readonly title: string;
      readonly score: number;
      readonly raw_score: number;
      readonly rerank_score: number;
      readonly calibrated_score: number;
      readonly excerpt: string;
      readonly excerpt_hash: Sha256Hex;
      readonly source_uri: string;
      readonly truncated: boolean;
      readonly masking_summary: string;
      readonly score_breakdown: {
        readonly keyword_rank: number;
        readonly vector_rank: number;
        readonly fusion_method: string;
      };
      readonly hash_algorithm: "sha256";
    }>;
  };
};

export type IngestionJob = {
  readonly job_id: string;
  readonly tenant_id: string;
  readonly kb_id: string;
  readonly doc_id: string;
  readonly version: number;
  readonly idempotency_key: string;
  readonly asset_type:
    | "document"
    | "web_snapshot"
    | "dataset"
    | "deliverable"
    | "structured_record"
    | "code_artifact";
  readonly status:
    | "queued"
    | "parsing"
    | "chunking"
    | "indexing"
    | "completed"
    | "failed"
    | "cancelled";
  readonly progress_pct: number;
  readonly stats: {
    readonly chunks_total: number;
    readonly chunks_indexed: number;
    readonly anchors_created: number;
  };
  readonly error_code: ErrorCode | null;
  readonly error_message: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export type ConnectorSyncExchange = {
  readonly connector_id: string;
  readonly kb_id: string;
  readonly cursor_in: string;
  readonly plan: {
    readonly to_upsert: ReadonlyArray<{
      readonly external_id: string;
      readonly content_hash: Sha256Hex;
      readonly asset_type:
        | "document"
        | "web_snapshot"
        | "dataset"
        | "deliverable"
        | "structured_record"
        | "code_artifact";
      readonly hash_algorithm: "sha256";
    }>;
    readonly to_tombstone: ReadonlyArray<{
      readonly external_id: string;
      readonly reason: string;
    }>;
    readonly unchanged_count: number;
  };
  readonly commit_result: {
    readonly cursor_out: string;
    readonly upserted_doc_ids: ReadonlyArray<string>;
    readonly revoked_doc_ids: ReadonlyArray<string>;
    readonly failed_items: ReadonlyArray<JsonValue>;
  };
};

export type ErrorEnvelope = {
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly request_id: string;
    readonly details: { readonly [key: string]: JsonValue };
  };
};

export type Sha256Hex = string;

export type PolicyGeneration = number;

export type SearchRequest = {
  readonly query: string;
  readonly mode: "keyword" | "vector" | "hybrid";
  readonly limit: number;
  readonly scope: {
    readonly mode: "all" | "none" | "spaces" | "documents";
    readonly kb_ids?: ReadonlyArray<string>;
    readonly doc_ids?: ReadonlyArray<string>;
    readonly space_types?: ReadonlyArray<"enterprise_public" | "department" | "personal">;
  };
  readonly filters: {
    readonly asset_types: ReadonlyArray<string>;
    readonly tags: ReadonlyArray<string>;
    readonly lifecycle_states: ReadonlyArray<string>;
  };
  readonly rerank: {
    readonly enabled: boolean;
    readonly reranker_id: string;
    readonly top_k: number;
  };
  readonly calibration: {
    readonly enabled: boolean;
    readonly min_calibrated_score: number;
  };
};

export type SearchResponse = {
  readonly mode: "keyword" | "vector" | "hybrid";
  readonly reranker_id: string;
  readonly calibrator_id: string;
  readonly calibration_applied: boolean;
  readonly candidate_budget_exhausted: boolean;
  readonly filtered_below_threshold: number;
  readonly hits: ReadonlyArray<{
    readonly doc_id: string;
    readonly kb_id: string;
    readonly version: number;
    readonly version_id: string;
    readonly chunk_id: string;
    readonly title: string;
    readonly score: number;
    readonly raw_score: number;
    readonly rerank_score: number;
    readonly calibrated_score: number;
    readonly excerpt: string;
    readonly excerpt_hash: Sha256Hex;
    readonly source_uri: string;
    readonly truncated: boolean;
    readonly masking_summary: string;
    readonly score_breakdown: {
      readonly keyword_rank: number;
      readonly vector_rank: number;
      readonly fusion_method: string;
    };
    readonly hash_algorithm: "sha256";
  }>;
};

export type KBMember = {
  readonly user_id: string;
  readonly role: "viewer" | "editor" | "admin";
  readonly granted_by: string;
  readonly granted_at: string;
};

export type KBMemberPage = {
  readonly items: ReadonlyArray<KBMember>;
  readonly next_cursor: string | null;
};

export type SpaceUpdate = {
  readonly name?: string;
  readonly description?: string;
  readonly visibility?: "private" | "team" | "enterprise";
  readonly governance_tier?: "l1_agile" | "l2_controlled";
  readonly tags?: ReadonlyArray<string>;
  readonly metadata?: { readonly [key: string]: JsonValue };
};

export type WriteActivationResult = {
  readonly created_version: number;
  readonly current_version: number;
  readonly lifecycle_state:
    | "draft"
    | "in_review"
    | "approved"
    | "published"
    | "rejected"
    | "superseded"
    | "revoked";
  readonly activated: boolean;
  readonly rollback_scope: "content_and_filename_only";
};

export type VersionPair = {
  readonly from_version: number;
  readonly to_version: number;
};

export type RollbackRequest = {
  readonly target_version: number;
};

export type RollbackAuditDetails = {
  readonly rollback_from_version: number;
  readonly previous_current_version: number;
  readonly created_version: number;
  readonly rollback_scope: "content_and_filename_only";
  readonly security_metadata_preserved: true;
};

export type VersionDiff = {
  readonly doc_id: string;
  readonly from_version: number;
  readonly to_version: number;
  readonly changes: ReadonlyArray<{
    readonly operation: "insert" | "delete" | "replace";
    readonly before: ReadonlyArray<string>;
    readonly after: ReadonlyArray<string>;
  }>;
};

export type AssetIngestRequest = {
  readonly kb_id: string;
  readonly content: string;
  readonly filename: string;
  readonly asset_type:
    | "document"
    | "web_snapshot"
    | "dataset"
    | "deliverable"
    | "structured_record"
    | "code_artifact";
  readonly idempotency_key: string;
};

export type SyncRequest = {
  readonly kb_id: string;
  readonly cursor_in: string;
};

export type VersionCoordinate = {
  readonly tenant_id: string;
  readonly kb_id: string;
  readonly doc_id: string;
  readonly version: number;
  readonly version_id: string;
};

export type DualUriMapping = {
  readonly coordinates: VersionCoordinate;
  readonly canonical_uri: CanonicalKbUri;
  readonly legacy_ku_uri: LegacyKuUri;
  readonly section_path: ReadonlyArray<string>;
};

export type AgentIntersectionDenyFixture = {
  readonly identity: IdentityContext;
  readonly kb_id: string;
  readonly user_is_member: false;
  readonly agent_allowed_kb_ids: ReadonlyArray<string>;
  readonly expected_allowed: false;
  readonly error: ErrorEnvelope;
};

export type KBLifecycleFixture = {
  readonly space: KnowledgeBase;
  readonly archived_asset: KnowledgeAsset;
  readonly restored_asset: KnowledgeAsset;
};

export type DualUriEvidenceFixture = {
  readonly evidence: EvidenceRecord;
  readonly mapping: DualUriMapping;
};

export type DocumentWriteResponse = {
  readonly doc_id: string;
  readonly version: number;
  readonly version_id: string;
  readonly version_label: string;
  readonly filename: string;
  readonly raw_hash: Sha256Hex;
  readonly semantic_hash: Sha256Hex;
  readonly lifecycle_state:
    | "draft"
    | "in_review"
    | "approved"
    | "published"
    | "rejected"
    | "superseded"
    | "revoked";
  readonly author_id: string;
  readonly reviewer_id: string;
  readonly publisher_id: string;
  readonly source_issue_id: string;
  readonly rollback_from_version: number | null;
  readonly created_at: string;
  readonly published_at: string;
  readonly hash_algorithm: "sha256";
  readonly created_version: number;
  readonly current_version: number;
  readonly activated: boolean;
  readonly rollback_scope: "content_and_filename_only";
};

export type HashVectorFixture = {
  readonly contract_status: "draft-pending-m1-freeze";
  readonly runtime_captured: false;
  readonly evidence_kind: "offline_algorithm_vector_only";
  readonly source_documents: ReadonlyArray<string>;
  readonly cases: ReadonlyArray<{
    readonly id: string;
    readonly raw: string;
    readonly normalized: string;
    readonly hash_algorithm: "sha256";
    readonly raw_hash: Sha256Hex;
    readonly semantic_hash: Sha256Hex;
  }>;
};

export type SignedCanonicalizationFixture = {
  readonly contract_status: "draft-pending-m1-freeze";
  readonly runtime_captured: false;
  readonly evidence_kind: "offline_algorithm_vector_only";
  readonly source_documents: ReadonlyArray<string>;
  readonly cases: ReadonlyArray<{
    readonly id: string;
    readonly method: "GET" | "POST";
    readonly signed_target: string;
    readonly nonce: string;
    readonly agent_header_present: boolean;
    readonly purpose_header_present: boolean;
    readonly purpose?: "read" | "ground_internal_llm";
    readonly body_utf8: string;
    readonly body_sha256: Sha256Hex;
    readonly canonical_lines_count: 6 | 8;
    readonly signature: Sha256Hex;
  }>;
  readonly test_only_secret: string;
  readonly timestamp: string;
  readonly actor_header: string;
  readonly agent_header: string;
  readonly draft_v2_examples: ReadonlyArray<{
    readonly evidence_kind: "draft_contract_example_only";
    readonly runtime_captured: false;
    readonly reason: "v2_runtime_prohibited_before_m1_freeze";
    readonly method: "POST";
    readonly path: "/v2/spaces" | "/v2/assets";
    readonly status: 200 | 403 | 409 | 422;
    readonly body: JsonValue;
  }>;
};

export type PolicyGenerationFixture = {
  readonly contract_status: "draft-pending-m1-freeze";
  readonly runtime_captured: false;
  readonly evidence_kind: "contract_scenario_fixture";
  readonly source_documents: ReadonlyArray<string>;
  readonly cases: ReadonlyArray<{
    readonly id: string;
    readonly submitted: {
      readonly policy_generation?: JsonValue;
    };
    readonly stored_generation: PolicyGeneration;
    readonly expected: {
      readonly allowed: boolean;
      readonly code: ErrorCode | null;
      readonly http_status: 200 | 400 | 403;
    };
  }>;
};

export type IdentityLifecycleFixture = {
  readonly contract_status: "draft-pending-m1-freeze";
  readonly runtime_captured: false;
  readonly evidence_kind: "contract_scenario_fixture";
  readonly source_documents: ReadonlyArray<string>;
  readonly cases: ReadonlyArray<{
    readonly id: string;
    readonly existing: ReadonlyArray<{
      readonly tenant_id: string;
      readonly issuer: string;
      readonly raw_sub: string;
      readonly user_id: string;
      readonly email: string;
      readonly status: "active" | "disabled";
      readonly policy_generation: PolicyGeneration;
    }>;
    readonly incoming: {
      readonly tenant_id: string;
      readonly issuer: string;
      readonly raw_sub: string;
      readonly user_id: string;
      readonly email: string;
      readonly status: "active" | "disabled";
      readonly policy_generation: PolicyGeneration;
    };
    readonly presented_generation: PolicyGeneration;
    readonly migration: {
      readonly type: "identity.rebound";
      readonly administrator_authorized: boolean;
      readonly from_issuer: string;
      readonly from_raw_sub: string;
      readonly to_issuer: string;
      readonly to_raw_sub: string;
    } | null;
    readonly expected: {
      readonly allowed: boolean;
      readonly code: ErrorCode | null;
      readonly user_id: string | null;
    };
  }>;
};

export type RollbackActivationFixture = {
  readonly contract_status: "draft-pending-m1-freeze";
  readonly runtime_captured: false;
  readonly evidence_kind: "contract_scenario_fixture";
  readonly source_documents: ReadonlyArray<string>;
  readonly cases: ReadonlyArray<{
    readonly id: string;
    readonly created_version: PolicyGeneration;
    readonly current_version: PolicyGeneration;
    readonly lifecycle_state:
      | "published"
      | "draft"
      | "in_review"
      | "approved"
      | "rejected"
      | "superseded"
      | "revoked";
    readonly activated: boolean;
    readonly rollback_scope: "content_and_filename_only";
  }>;
};

export type MinimumSliceWriteEndpoint = "POST /v2/spaces" | "POST /v2/assets";

export type DraftContractMetadata = {
  readonly contract_status: "draft-pending-m1-freeze";
  readonly runtime_v2_implemented: false;
};

// DualUriMapping requires authoritative VersionCoordinate lookup; strings alone
// cannot infer kb_id or opaque version_id. No canonical runtime URI rewrite.
