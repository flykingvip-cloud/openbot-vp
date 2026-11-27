/**
 * Default-off W2 golden-fixture interop helpers. Not registered on Gateway
 * routes and not a production Controlled Data Bridge unlock.
 */
import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "../../memory/embeddings.js";
import {
  AI_EXECUTION_TRACE_HEADER_KEYS,
  createAiExecutionTraceHeaderPropagator,
  type AiExecutionTraceHeaders,
} from "./ai-execution-trace-header-propagator.js";
import {
  REVOCATION_PURGE_CHANNELS,
  computeChannelReceiptHash,
  computeRevocationPurgeReceiptHash,
  type ChannelReceipt,
  type ChannelReceiptStatus,
  type RevocationPurgeReceipt,
} from "./revocation-purge-receipt.js";

export const W2_INTEROP_FIXTURE_SHA256 =
  "f8033a902af06b005fa591ab872a74f9569a3783fd3e7cef90c6dc94cf9d0fef";
export const W2_INTEROP_SOURCE_COMMIT = "37c982546f49bb8312670ad01be995d91f345043";

const FORBIDDEN_CREDENTIAL_FIELDS = new Set([
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

export const X_V21_HEADER_NAMES = {
  tenant_id: "X-V21-Tenant-Id",
  user_id: "X-V21-User-Id",
  agent_id: "X-V21-Agent-Id",
  trace_id: "X-V21-Trace-Id",
  run_id: "X-V21-Run-Id",
  plan_id: "X-V21-Plan-Id",
  policy_generation: "X-V21-Policy-Generation",
} as const;

export function createLoopbackEmbedProvider(): Pick<
  EmbeddingProvider,
  "id" | "model" | "embedBatch"
> {
  return {
    id: "slot:embed",
    model: "loopback-sha256-8",
    async embedBatch(texts: string[]): Promise<number[][]> {
      return texts.map((text) => {
        const digest = createHash("sha256").update(text, "utf8").digest();
        return Array.from(digest.subarray(0, 8), (byte) => byte / 255.0);
      });
    },
  };
}

export function projectXv21Headers(headers: AiExecutionTraceHeaders): Record<string, string> {
  return {
    "X-V21-Tenant-Id": headers.tenant_id,
    "X-V21-User-Id": headers.user_id,
    "X-V21-Agent-Id": headers.agent_id,
    "X-V21-Trace-Id": headers.trace_id,
    "X-V21-Run-Id": headers.run_id,
    "X-V21-Plan-Id": headers.plan_id,
    "X-V21-Policy-Generation": String(headers.policy_generation),
  };
}

export function pickSevenTraceKeys(bag: Record<string, unknown>): Partial<AiExecutionTraceHeaders> {
  const out: Record<string, unknown> = {};
  for (const key of AI_EXECUTION_TRACE_HEADER_KEYS) {
    if (key in bag) {
      out[key] = bag[key];
    }
  }
  return out as Partial<AiExecutionTraceHeaders>;
}

export function runSevenKeyHops(input: {
  trace: Record<string, unknown>;
  hop_payloads?: Record<string, unknown>[];
}):
  | {
      ok: true;
      hop_count: 3;
      key_order: readonly string[];
      headers: Record<string, string>;
      seven_keys: Partial<AiExecutionTraceHeaders>;
      final_bound: Record<string, unknown>;
    }
  | { ok: false; error: "VALIDATION_ERROR" | "PROPAGATOR_DISABLED" } {
  const propagator = createAiExecutionTraceHeaderPropagator({ enabled: true });
  // Hop 1: context accept
  const accept = propagator.propagate(input.trace);
  if (!accept.ok) {
    return { ok: false, error: "VALIDATION_ERROR" };
  }
  // Hop 2: header projection (official X-V21-* names) plus payload bind
  let bound: Record<string, unknown> = { ...input.trace };
  const headers = projectXv21Headers(accept.headers);
  for (const payload of input.hop_payloads ?? []) {
    bound = { ...bound, ...payload };
  }
  // Hop 3: propagate / bind — official seven keys must still be present
  const propagated = propagator.propagate(bound);
  if (!propagated.ok) {
    return { ok: false, error: "VALIDATION_ERROR" };
  }
  return {
    ok: true,
    hop_count: 3,
    key_order: [...AI_EXECUTION_TRACE_HEADER_KEYS],
    headers,
    seven_keys: pickSevenTraceKeys(bound),
    final_bound: bound,
  };
}

export function redactCredentialFields(record: Record<string, unknown>): {
  projection: Record<string, unknown>;
  redacted_fields: string[];
} {
  const projection: Record<string, unknown> = {};
  const redacted_fields: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (
      FORBIDDEN_CREDENTIAL_FIELDS.has(key) ||
      FORBIDDEN_CREDENTIAL_FIELDS.has(key.toLowerCase())
    ) {
      redacted_fields.push(key);
    } else {
      projection[key] = value;
    }
  }
  return { projection, redacted_fields };
}

export function createInteropSemanticCatalog(options: {
  enabled?: boolean;
  seed: Record<string, unknown>[];
}) {
  const enabled = options.enabled ?? false;
  let diskWrites = 0;
  return {
    enabled,
    diskWrites(): number {
      return diskWrites;
    },
    async read(input: { tenant_id: string; semantic_object_key?: string }) {
      if (!enabled) {
        return { ok: false as const, error: "ADAPTER_DISABLED", disk_writes: diskWrites };
      }
      const match = options.seed.find((row) => {
        if (row.tenant_id !== input.tenant_id) {
          return false;
        }
        if (input.semantic_object_key && row.semantic_object_key !== input.semantic_object_key) {
          return false;
        }
        return true;
      });
      if (!match) {
        return {
          ok: true as const,
          disk_writes: diskWrites,
          writable: false,
          redacted_fields: [] as string[],
        };
      }
      const { projection, redacted_fields } = redactCredentialFields(match);
      return {
        ok: true as const,
        ...projection,
        redacted_fields,
        disk_writes: diskWrites,
        writable: false,
      };
    },
    async write(_payload?: unknown) {
      if (!enabled) {
        return { ok: false as const, error: "ADAPTER_DISABLED", disk_writes: diskWrites };
      }
      // Fail closed: never increment disk writes, never persist.
      return {
        ok: false as const,
        error: "SEMANTIC_WRITE_FORBIDDEN",
        disk_writes: diskWrites,
      };
    },
  };
}

export function buildFourChannelReceipt(input: {
  task_id: string;
  tenant_id: string;
  subject_id: string;
  policy_generation: number;
  failures?: Record<string, string>;
}): RevocationPurgeReceipt {
  const failures = input.failures ?? {};
  const channels: ChannelReceipt[] = REVOCATION_PURGE_CHANNELS.map((channel) => {
    const status = (failures[channel] ?? "success") as ChannelReceiptStatus;
    return {
      channel,
      status,
      hash_algorithm: "sha256",
      receipt_hash: computeChannelReceiptHash({
        channel,
        status,
        tenant_id: input.tenant_id,
        subject_id: input.subject_id,
      }),
    };
  });
  const purged = channels.every((channel) => channel.status === "success");
  const body = {
    task_id: input.task_id,
    tenant_id: input.tenant_id,
    subject_id: input.subject_id,
    policy_generation: input.policy_generation,
    channels,
    purged,
    hash_algorithm: "sha256" as const,
  };
  return {
    ...body,
    receipt_hash: computeRevocationPurgeReceiptHash(body),
  };
}
