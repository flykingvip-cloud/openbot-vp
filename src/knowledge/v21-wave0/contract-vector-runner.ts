/**
 * Side-effect-free port of Team A contracts/v21-reuse-v1/check.ts reject()
 * (pinned at 02bf5873 / 9d25ea96). Keep logic aligned with the pinned check.ts;
 * do not “fix” Team A rules here — file a V21-DELTA-* instead.
 */
export type Vector = {
  id: string;
  schema: string;
  expect: "accept" | "reject";
  payload: Record<string, unknown>;
  code?: string;
};

const FORBIDDEN = new Set([
  "api_key",
  "api_token",
  "password",
  "bearer_token",
  "secret",
  "credential",
  "access_token",
  "private_key",
  "dsn",
  "connection_string",
  "jdbc_url",
  "authorization",
]);

function walk(value: unknown, keys: string[] = []): string[] {
  if (value && typeof value === "object") {
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, keys));
    } else {
      Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
        keys.push(k);
        walk(v, keys);
      });
    }
  }
  return keys;
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function policyOk(v: unknown): boolean {
  return isInt(v) && v >= 1 && v <= 9007199254740991;
}

export function rejectVector(payload: Record<string, unknown>, schema: string): string | null {
  const keys = walk(payload);
  if (keys.some((k) => FORBIDDEN.has(k))) {
    return "CREDENTIAL_FORBIDDEN";
  }
  if (keys.includes("text_to_sql") || payload.query_kind === "text_to_sql") {
    return "TEXT_TO_SQL_FORBIDDEN";
  }
  const pathValue = typeof payload.path === "string" ? payload.path : "";
  if (schema === "OpenApiPath" && pathValue.startsWith("/v3/spaces")) {
    return "SPACE_PATH_FORBIDDEN";
  }
  if (payload.visibility === "partial_available") {
    return "PARTIAL_PUBLICATION_FORBIDDEN";
  }
  if (
    schema === "ControlledDataBridgeDeclaration" &&
    payload.mode !== "A" &&
    payload.mode !== "B" &&
    payload.mode !== "C"
  ) {
    return "MODE_UNMATCHED";
  }
  if (schema === "RevocationPurgeReceipt") {
    const channels = Array.isArray(payload.channels)
      ? (payload.channels as Array<Record<string, unknown>>)
      : [];
    const expected = [
      "primary_storage_acl",
      "vector_fts_index",
      "cache_materialized_snapshot",
      "agent_history_cogniweave",
    ];
    const names = channels.map((c) => c.channel);
    const ok =
      names.length === 4 &&
      expected.every((n, i) => names[i] === n) &&
      channels.every((c) => c.status === "success");
    if (
      (payload.purged && !ok) ||
      names.length !== 4 ||
      [...names]
        .slice()
        .toSorted((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0))
        .join() !==
        [...expected]
          .slice()
          .toSorted((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0))
          .join()
    ) {
      return "CHANNEL_INCOMPLETE";
    }
  }
  if ("policy_generation" in payload && !policyOk(payload.policy_generation)) {
    return "VALIDATION_ERROR";
  }
  const idFields = [
    "tenant_id",
    "user_id",
    "agent_id",
    "trace_id",
    "run_id",
    "plan_id",
    "candidate_id",
    "memory_resource_id",
    "snapshot_id",
    "task_id",
    "subject_id",
    "notice_id",
    "receipt_id",
    "owner_agent_id",
  ];
  for (const field of idFields) {
    if (
      field in payload &&
      (typeof payload[field] !== "string" || !/^syn_[a-z0-9_.:-]{1,120}$/.test(payload[field]))
    ) {
      return "VALIDATION_ERROR";
    }
  }
  const handle = (payload.provider as Record<string, unknown> | undefined)?.handle;
  if (
    handle !== undefined &&
    (typeof handle !== "string" || !/^slot:[a-z0-9_.-]{1,64}$/.test(handle))
  ) {
    return "VALIDATION_ERROR";
  }
  const tracks = new Set([
    "openbot_public_execution",
    "openbot_fallback",
    "openbot_models_embed_proxy",
    "openbot_models_rerank_proxy",
    "host_injected_external_provider",
  ]);
  const track = (payload.provider as Record<string, unknown> | undefined)?.track;
  if (track !== undefined && (typeof track !== "string" || !tracks.has(track))) {
    return "VALIDATION_ERROR";
  }
  const systems = new Set(["openbot", "knowledge_sdk", "aor", "cogniweave"]);
  const cost = payload.cost_attribution as Record<string, unknown> | undefined;
  if (cost && (typeof cost.system !== "string" || !systems.has(cost.system))) {
    return "VALIDATION_ERROR";
  }
  if (schema === "RedactedPlanView" && "resources_excluded" in payload) {
    return "VALIDATION_ERROR";
  }
  if (schema === "ErrorEnvelope") {
    const err = payload.error as Record<string, unknown> | undefined;
    const messages = new Set(["request_rejected", "conflict", "stale_policy", "not_authorized"]);
    if (!err || typeof err.message !== "string" || !messages.has(err.message)) {
      return "VALIDATION_ERROR";
    }
  }
  const allowed: Record<string, string[]> = {
    LLMInvokeRequest: [
      "tenant_id",
      "user_id",
      "agent_id",
      "trace_id",
      "run_id",
      "plan_id",
      "policy_generation",
      "provider",
      "messages",
      "max_output_tokens",
    ],
    LLMInvokeResponse: [
      "tenant_id",
      "trace_id",
      "run_id",
      "provider",
      "text",
      "fallback_used",
      "usage",
    ],
    EmbedRequest: ["tenant_id", "policy_generation", "provider", "inputs"],
    EmbedResponse: ["tenant_id", "provider", "vectors", "dim"],
    RerankRequest: ["tenant_id", "policy_generation", "provider", "query", "candidates"],
    RerankResponse: ["tenant_id", "provider", "rankings"],
    ControlledDataBridgeDeclaration: [
      "mode",
      "tenant_id",
      "policy_generation",
      "freshness_ts",
      "masking_receipt",
      "tombstone",
      "user_delegation_handle",
      "service_credential_handle",
      "row_level_predicate",
      "snapshot_id",
      "query_kind",
    ],
    MemoryDiscoveryMetadata: [
      "tenant_id",
      "resource_type",
      "memory_resource_id",
      "owner_agent_id",
      "policy_generation",
      "discoverable",
      "freshness_ts",
      "label",
    ],
    Channel4InvalidationNotice: [
      "notice_id",
      "tenant_id",
      "memory_resource_id",
      "policy_generation",
      "channel",
      "reason_code",
    ],
    RevocationPurgeReceipt: [
      "task_id",
      "tenant_id",
      "subject_id",
      "policy_generation",
      "channels",
      "purged",
      "hash_algorithm",
      "receipt_hash",
    ],
    AIExecutionTrace: [
      "tenant_id",
      "user_id",
      "agent_id",
      "trace_id",
      "run_id",
      "plan_id",
      "policy_generation",
      "cost_attribution",
    ],
    ErrorEnvelope: ["error"],
    RedactedPlanView: ["view", "redacted_unauthorized_count", "redaction_code"],
    AuditPlanView: ["view", "resources_excluded"],
    ProductionJob: [
      "job_id",
      "tenant_id",
      "status",
      "whole_document_atomic_publication",
      "visibility",
      "active_published_production_id",
    ],
  };
  if (allowed[schema]) {
    const extra = Object.keys(payload).filter((k) => !allowed[schema].includes(k));
    if (extra.length) {
      return extra.some((k) => FORBIDDEN.has(k)) ? "CREDENTIAL_FORBIDDEN" : "VALIDATION_ERROR";
    }
  }
  const required: Record<string, string[]> = {
    LLMInvokeRequest: [
      "tenant_id",
      "user_id",
      "agent_id",
      "trace_id",
      "run_id",
      "plan_id",
      "policy_generation",
      "provider",
      "messages",
    ],
    EmbedRequest: ["tenant_id", "policy_generation", "provider", "inputs"],
    RerankRequest: ["tenant_id", "policy_generation", "provider", "query", "candidates"],
    AIExecutionTrace: [
      "tenant_id",
      "user_id",
      "agent_id",
      "trace_id",
      "run_id",
      "plan_id",
      "policy_generation",
      "cost_attribution",
    ],
    MemoryDiscoveryMetadata: [
      "tenant_id",
      "resource_type",
      "memory_resource_id",
      "owner_agent_id",
      "policy_generation",
      "discoverable",
      "freshness_ts",
    ],
    ModeADeclaration: [
      "mode",
      "tenant_id",
      "policy_generation",
      "freshness_ts",
      "masking_receipt",
      "tombstone",
      "user_delegation_handle",
      "query_kind",
    ],
    ModeBDeclaration: [
      "mode",
      "tenant_id",
      "policy_generation",
      "freshness_ts",
      "masking_receipt",
      "tombstone",
      "service_credential_handle",
      "row_level_predicate",
      "query_kind",
    ],
    ModeCDeclaration: [
      "mode",
      "tenant_id",
      "policy_generation",
      "freshness_ts",
      "masking_receipt",
      "tombstone",
      "snapshot_id",
      "query_kind",
    ],
  };
  const modeRequired: Record<string, string> = {
    A: "ModeADeclaration",
    B: "ModeBDeclaration",
    C: "ModeCDeclaration",
  };
  if (
    schema === "ControlledDataBridgeDeclaration" &&
    typeof payload.mode === "string" &&
    modeRequired[payload.mode]
  ) {
    const needMode = required[modeRequired[payload.mode]];
    if (needMode.some((k) => !(k in payload))) {
      return "VALIDATION_ERROR";
    }
  }
  const need = required[schema];
  if (need && need.some((k) => !(k in payload))) {
    return "VALIDATION_ERROR";
  }
  if (schema === "MemoryDiscoveryMetadata" && payload.resource_type !== "agent_memory") {
    return "VALIDATION_ERROR";
  }
  return null;
}

export function evaluateVector(vector: Vector): {
  id: string;
  ok: boolean;
  actual: "accept" | "reject";
  code: string | null;
} {
  const code = rejectVector(vector.payload, vector.schema);
  const actual = code ? "reject" : "accept";
  const ok =
    actual === vector.expect &&
    (vector.expect === "accept" || !vector.code || vector.code === code);
  return { id: vector.id, ok, actual, code };
}
