export type PolicyGeneration = number;
export type ProviderTrack =
  | "openbot_public_execution"
  | "openbot_fallback"
  | "openbot_models_embed_proxy"
  | "openbot_models_rerank_proxy"
  | "host_injected_external_provider";
export interface ProviderRef {
  track: ProviderTrack;
  handle: string;
  model_id?: string;
}
export interface LLMInvokeRequest {
  tenant_id: string;
  user_id: string;
  agent_id: string;
  trace_id: string;
  run_id: string;
  plan_id: string;
  policy_generation: PolicyGeneration;
  provider: ProviderRef;
  messages: Array<{ role: "system" | "user" | "assistant"; text: string }>;
  max_output_tokens?: number;
}
export interface LLMInvokeResponse {
  tenant_id: string;
  trace_id: string;
  run_id: string;
  provider: ProviderRef;
  text: string;
  fallback_used: boolean;
  usage: { input_tokens: number; output_tokens: number };
}
export interface EmbedRequest {
  tenant_id: string;
  policy_generation: PolicyGeneration;
  provider: ProviderRef;
  inputs: string[];
}
export interface EmbedResponse {
  tenant_id: string;
  provider: ProviderRef;
  dim: number;
  vectors: number[][];
}
export interface RerankRequest {
  tenant_id: string;
  policy_generation: PolicyGeneration;
  provider: ProviderRef;
  query: string;
  candidates: Array<{ candidate_id: string; text: string }>;
}
export interface RerankResponse {
  tenant_id: string;
  provider: ProviderRef;
  rankings: Array<{ candidate_id: string; score: number }>;
}
export type MaskingReceipt = {
  receipt_id: string;
  profile: "none" | "standard" | "strict";
  hash_algorithm: "sha256";
  receipt_hash: string;
};
export type Tombstone = { active: boolean; revoked_at: string | null };
export interface ModeADeclaration {
  mode: "A";
  tenant_id: string;
  policy_generation: PolicyGeneration;
  freshness_ts: string;
  masking_receipt: MaskingReceipt;
  tombstone: Tombstone;
  user_delegation_handle: string;
  query_kind: "structured_select" | "object_get" | "snapshot_read";
}
export interface ModeBDeclaration {
  mode: "B";
  tenant_id: string;
  policy_generation: PolicyGeneration;
  freshness_ts: string;
  masking_receipt: MaskingReceipt;
  tombstone: Tombstone;
  service_credential_handle: string;
  row_level_predicate: {
    field: "org_id" | "tenant_id" | "owner_id" | "classification";
    op: "eq" | "in";
    value: string;
  };
  query_kind: "structured_select";
}
export interface ModeCDeclaration {
  mode: "C";
  tenant_id: string;
  policy_generation: PolicyGeneration;
  freshness_ts: string;
  masking_receipt: MaskingReceipt;
  tombstone: Tombstone;
  snapshot_id: string;
  query_kind: "snapshot_read";
}
export type ControlledDataBridgeDeclaration =
  | ModeADeclaration
  | ModeBDeclaration
  | ModeCDeclaration;
export interface MemoryDiscoveryMetadata {
  tenant_id: string;
  resource_type: "agent_memory";
  memory_resource_id: string;
  owner_agent_id: string;
  policy_generation: PolicyGeneration;
  discoverable: boolean;
  freshness_ts: string;
  label?: string;
}
export interface ChannelReceipt {
  channel:
    | "primary_storage_acl"
    | "vector_fts_index"
    | "cache_materialized_snapshot"
    | "agent_history_cogniweave";
  status: "success" | "failed" | "timeout" | "missing";
  hash_algorithm: "sha256";
  receipt_hash: string;
  completed_at?: string;
}
export interface Channel4InvalidationNotice {
  notice_id: string;
  tenant_id: string;
  memory_resource_id: string;
  policy_generation: PolicyGeneration;
  channel: "agent_history_cogniweave";
  reason_code: "ACCESS_REVOKED" | "OWNER_DISABLED" | "POLICY_GENERATION_STALE";
}
export interface RevocationPurgeReceipt {
  task_id: string;
  tenant_id: string;
  subject_id: string;
  policy_generation: PolicyGeneration;
  channels: [ChannelReceipt, ChannelReceipt, ChannelReceipt, ChannelReceipt];
  purged: boolean;
  hash_algorithm: "sha256";
  receipt_hash: string;
}
export interface AIExecutionTrace {
  tenant_id: string;
  user_id: string;
  agent_id: string;
  trace_id: string;
  run_id: string;
  plan_id: string;
  policy_generation: PolicyGeneration;
  cost_attribution: {
    system: "openbot" | "knowledge_sdk" | "aor" | "cogniweave";
    component: string;
    units: "tokens" | "ms" | "calls";
    quantity: number;
  };
}
export type AuditPlanView = {
  view: "audit" | "governance";
  resources_excluded: Array<{ resource_id: string; permission_denied: string }>;
};
export type RedactedPlanView = {
  view: "agent" | "end_user";
  redacted_unauthorized_count: number;
  redaction_code: string;
};
export type KnowledgeRetrievalPlanView = AuditPlanView | RedactedPlanView;
