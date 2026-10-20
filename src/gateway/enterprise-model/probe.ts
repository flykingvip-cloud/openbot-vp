/**
 * Lightweight provider probes (list models / health) — no inference cost.
 * Uses SSRF-guarded fetch by default; private/loopback requires explicit policy.
 */

import { fetchWithSsrFGuard } from "../../infra/net/fetch-guard.js";
import type { LookupFn } from "../../infra/net/ssrf.js";
import type { SsrFPolicy } from "../../infra/net/ssrf.js";
import { SsrFBlockedError } from "../../infra/net/ssrf.js";
import { EnterpriseModelError } from "./errors.js";
import type {
  EnterpriseModelCredentialSecret,
  EnterpriseModelProbeCode,
  EnterpriseModelProviderType,
} from "./types.js";

/**
 * Admin-saved enterprise connections are explicit endpoints, including private
 * or self-hosted OpenAI-compatible servers. Probes of those saved rows may use
 * this policy. Do not apply it to URLs that an enterprise admin has not stored.
 */
export const SAVED_ENTERPRISE_ENDPOINT_SSRF_POLICY: SsrFPolicy = {
  allowPrivateNetwork: true,
};

export type ProbeDiscoveredModel = {
  upstreamModelId: string;
  displayName?: string;
};

export type ProbeResult = {
  ok: boolean;
  code: EnterpriseModelProbeCode;
  message: string;
  discoveredModels: ProbeDiscoveredModel[];
};

export type ProbeConnectionInput = {
  providerType: EnterpriseModelProviderType;
  protocol: string;
  baseUrl?: string;
  secret: EnterpriseModelCredentialSecret;
  /** Override fetch (still SSRF-checked unless skipSsrfGuard). */
  fetchImpl?: typeof fetch;
  /** Override DNS lookup for tests. */
  lookupFn?: LookupFn;
  timeoutMs?: number;
  /**
   * SSRF policy for enterprise-supplied baseUrl.
   * Default: private/loopback/metadata blocked.
   * Private/local model endpoints require explicit allowPrivateNetwork.
   */
  ssrfPolicy?: SsrFPolicy;
  /**
   * When true, skip SSRF guard and use raw fetch/fetchImpl.
   * Only for trusted test harnesses — never for production admin RPC.
   */
  skipSsrfGuard?: boolean;
};

function defaultBaseUrl(providerType: EnterpriseModelProviderType): string {
  switch (providerType) {
    case "anthropic":
      return "https://api.anthropic.com";
    case "openai":
      return "https://api.openai.com/v1";
    default:
      return "";
  }
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function classifyHttpStatus(status: number): EnterpriseModelProbeCode {
  if (status === 401 || status === 403) {
    return "ENTERPRISE_MODEL_INVALID_CREDENTIAL";
  }
  if (status === 429) {
    return "ENTERPRISE_MODEL_RATE_LIMITED";
  }
  if (status === 404) {
    return "ENTERPRISE_MODEL_PROTOCOL_MISMATCH";
  }
  if (status >= 500) {
    return "ENTERPRISE_MODEL_NETWORK_UNREACHABLE";
  }
  return "ENTERPRISE_MODEL_PROTOCOL_MISMATCH";
}

function classifyNetworkError(error: unknown): EnterpriseModelProbeCode {
  if (error instanceof SsrFBlockedError) {
    return "ENTERPRISE_MODEL_FORBIDDEN";
  }
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (
    message.includes("ssrf") ||
    message.includes("blocked") ||
    message.includes("private") ||
    message.includes("not allowed")
  ) {
    return "ENTERPRISE_MODEL_FORBIDDEN";
  }
  if (message.includes("abort") || message.includes("timeout")) {
    return "ENTERPRISE_MODEL_TIMEOUT";
  }
  return "ENTERPRISE_MODEL_NETWORK_UNREACHABLE";
}

function parseOpenAiModels(payload: unknown): ProbeDiscoveredModel[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }
  const out: ProbeDiscoveredModel[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const id =
      typeof (row as { id?: unknown }).id === "string" ? (row as { id: string }).id.trim() : "";
    if (!id) {
      continue;
    }
    out.push({ upstreamModelId: id, displayName: id });
  }
  return out;
}

/**
 * Probe provider without charging inference: prefer GET /models (OpenAI-compatible)
 * or Anthropic models list endpoint.
 *
 * Network access: defaults to fetchWithSsrFGuard (blocks loopback/private/metadata).
 * Pass ssrfPolicy.allowPrivateNetwork for explicitly approved private endpoints.
 */
export async function probeEnterpriseModelConnection(
  input: ProbeConnectionInput,
): Promise<ProbeResult> {
  const apiKey = input.secret.apiKey?.trim();
  if (!apiKey) {
    return {
      ok: false,
      code: "ENTERPRISE_MODEL_INVALID_CREDENTIAL",
      message: "apiKey required",
      discoveredModels: [],
    };
  }

  const base =
    normalizeBaseUrl(input.baseUrl ?? "") || normalizeBaseUrl(defaultBaseUrl(input.providerType));
  if (!base) {
    return {
      ok: false,
      code: "ENTERPRISE_MODEL_INVALID_REQUEST",
      message: "baseUrl required for this provider type",
      discoveredModels: [],
    };
  }

  const timeoutMs = input.timeoutMs ?? 15_000;
  const isAnthropic = input.providerType === "anthropic" || input.protocol.includes("anthropic");
  const url = isAnthropic
    ? `${base}/v1/models`
    : base.endsWith("/v1")
      ? `${base}/models`
      : `${base}/v1/models`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...input.secret.headers,
  };
  if (isAnthropic) {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    let response: Response;
    let release: (() => Promise<void>) | undefined;
    if (input.skipSsrfGuard) {
      const fetchImpl = input.fetchImpl ?? fetch;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetchImpl(url, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } else {
      const guarded = await fetchWithSsrFGuard({
        url,
        timeoutMs,
        policy: input.ssrfPolicy,
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
        ...(input.lookupFn ? { lookupFn: input.lookupFn } : {}),
        init: {
          method: "GET",
          headers,
        },
      });
      response = guarded.response;
      release = guarded.release;
    }

    try {
      if (!response.ok) {
        const code = classifyHttpStatus(response.status);
        return {
          ok: false,
          code,
          message: `probe failed with HTTP ${response.status}`,
          discoveredModels: [],
        };
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return {
          ok: false,
          code: "ENTERPRISE_MODEL_PROTOCOL_MISMATCH",
          message: "response is not JSON",
          discoveredModels: [],
        };
      }
      const discoveredModels = parseOpenAiModels(payload);
      return {
        ok: true,
        code: "OK",
        message: `verified; discovered ${discoveredModels.length} models`,
        discoveredModels,
      };
    } finally {
      await release?.();
    }
  } catch (error) {
    const code = classifyNetworkError(error);
    return {
      ok: false,
      code,
      message: error instanceof Error ? error.message : String(error),
      discoveredModels: [],
    };
  }
}

export async function probeOrThrow(input: ProbeConnectionInput): Promise<ProbeResult> {
  const result = await probeEnterpriseModelConnection(input);
  if (!result.ok) {
    throw new EnterpriseModelError(result.code, result.message, {
      retryable:
        result.code === "ENTERPRISE_MODEL_TIMEOUT" ||
        result.code === "ENTERPRISE_MODEL_NETWORK_UNREACHABLE" ||
        result.code === "ENTERPRISE_MODEL_RATE_LIMITED",
    });
  }
  return result;
}
