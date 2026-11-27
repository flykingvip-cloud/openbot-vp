/**
 * Default-off controlled models.embed proxy (W1B-2).
 *
 * Reuses the host EmbeddingProvider shape from src/memory/embeddings-*.ts.
 * Auth/billing hooks are aligned with createAuthorizedModelSession
 * (authorize first, then optional usage recording). This module is not
 * registered on any Gateway method table: there is no models.embed /
 * models.rerank RPC, and this proxy must not invent a live default-on
 * embed path. A provider must be injected even when the proxy is
 * explicitly enabled; createEmbeddingProvider is never called implicitly.
 */
import type { EmbeddingProvider } from "../../memory/embeddings.js";

export const MODELS_EMBED_PROXY_ENABLED_DEFAULT = false;
export const MODELS_EMBED_PROVIDER_TRACK = "openbot_models_embed_proxy" as const;

const FORBIDDEN_CREDENTIAL_KEYS = new Set([
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

export type ModelsEmbedAuthResult =
  | { ok: true; authorizationDecisionId?: string; planId?: string }
  | { ok: false; reason: string };

export type ModelsEmbedAuthHook = {
  /**
   * Mirrors createAuthorizedModelSession().authorize: fail-closed unless
   * the hook reports success. The proxy never acquires a live lease itself.
   */
  authorize(input: {
    runId: string;
    tenantId: string;
    userId?: string;
    agentId?: string;
  }): Promise<ModelsEmbedAuthResult> | ModelsEmbedAuthResult;
};

export type ModelsEmbedBillingHook = {
  /** Optional usage hook, analogous to authorized-session credit recording. */
  recordUsage(input: {
    runId: string;
    provider: string;
    model: string;
    textCount: number;
    charCount: number;
    authorizationDecisionId?: string;
  }): Promise<void> | void;
};

export type ModelsEmbedRequest = {
  tenant_id: string;
  policy_generation: number;
  run_id?: string;
  user_id?: string;
  agent_id?: string;
  provider: {
    track: typeof MODELS_EMBED_PROVIDER_TRACK;
    id?: string;
    model?: string;
  };
  inputs: string[];
};

export type ModelsEmbedResult =
  | {
      ok: true;
      tenant_id: string;
      provider: { track: typeof MODELS_EMBED_PROVIDER_TRACK; id: string; model: string };
      vectors: number[][];
      dim: number;
    }
  | {
      ok: false;
      reason:
        | "PROXY_DISABLED"
        | "INVALID_REQUEST"
        | "CREDENTIAL_FORBIDDEN"
        | "AUTH_DENIED"
        | "PROVIDER_NOT_INJECTED"
        | "EMBED_FAILED";
    };

function walkKeys(value: unknown, keys: string[] = []): string[] {
  if (value && typeof value === "object") {
    if (Array.isArray(value)) {
      for (const item of value) {
        walkKeys(item, keys);
      }
    } else {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        keys.push(key);
        walkKeys(child, keys);
      }
    }
  }
  return keys;
}

function isValidRequest(request: ModelsEmbedRequest): boolean {
  if (!request.tenant_id?.trim()) {
    return false;
  }
  if (!Number.isInteger(request.policy_generation) || request.policy_generation < 1) {
    return false;
  }
  if (request.provider?.track !== MODELS_EMBED_PROVIDER_TRACK) {
    return false;
  }
  if (!Array.isArray(request.inputs) || request.inputs.length === 0) {
    return false;
  }
  return request.inputs.every((item) => typeof item === "string");
}

export function createControlledModelsEmbedProxy(options?: {
  enabled?: boolean;
  provider?: Pick<EmbeddingProvider, "id" | "model" | "embedBatch">;
  auth?: ModelsEmbedAuthHook;
  billing?: ModelsEmbedBillingHook;
}) {
  const enabled = options?.enabled ?? MODELS_EMBED_PROXY_ENABLED_DEFAULT;
  return {
    enabled,
    async embed(request: ModelsEmbedRequest): Promise<ModelsEmbedResult> {
      if (!enabled) {
        return { ok: false, reason: "PROXY_DISABLED" };
      }
      if (walkKeys(request).some((key) => FORBIDDEN_CREDENTIAL_KEYS.has(key))) {
        return { ok: false, reason: "CREDENTIAL_FORBIDDEN" };
      }
      if (!isValidRequest(request)) {
        return { ok: false, reason: "INVALID_REQUEST" };
      }
      const provider = options?.provider;
      if (!provider) {
        return { ok: false, reason: "PROVIDER_NOT_INJECTED" };
      }
      const runId = request.run_id?.trim() || "embed-run";
      const auth = options?.auth
        ? await options.auth.authorize({
            runId,
            tenantId: request.tenant_id,
            userId: request.user_id,
            agentId: request.agent_id,
          })
        : ({ ok: false, reason: "AUTH_HOOK_REQUIRED" } satisfies ModelsEmbedAuthResult);
      if (!auth.ok) {
        return { ok: false, reason: "AUTH_DENIED" };
      }
      let vectors: number[][];
      try {
        vectors = await provider.embedBatch(request.inputs);
      } catch {
        return { ok: false, reason: "EMBED_FAILED" };
      }
      if (
        !Array.isArray(vectors) ||
        vectors.length !== request.inputs.length ||
        vectors.some((row) => !Array.isArray(row) || row.some((value) => typeof value !== "number"))
      ) {
        return { ok: false, reason: "EMBED_FAILED" };
      }
      const dim = vectors[0]?.length ?? 0;
      if (dim === 0 || vectors.some((row) => row.length !== dim)) {
        return { ok: false, reason: "EMBED_FAILED" };
      }
      const charCount = request.inputs.reduce((sum, text) => sum + text.length, 0);
      await options?.billing?.recordUsage({
        runId,
        provider: provider.id,
        model: provider.model,
        textCount: request.inputs.length,
        charCount,
        authorizationDecisionId: auth.authorizationDecisionId,
      });
      return {
        ok: true,
        tenant_id: request.tenant_id,
        provider: {
          track: MODELS_EMBED_PROVIDER_TRACK,
          id: provider.id,
          model: provider.model,
        },
        vectors,
        dim,
      };
    },
  };
}
