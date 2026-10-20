/**
 * Memory embedding error classification.
 *
 * Billing signals take priority over bare 429 / rate-limit tokens so
 * `429 insufficient_quota` is not mislabeled as a transient rate limit.
 * Reuses leaf matchers from agents failover helpers (no cycle through memory).
 */

import {
  isAuthErrorMessage,
  isAuthPermanentErrorMessage,
  isBillingErrorMessage,
  isOverloadedErrorMessage,
  isRateLimitErrorMessage,
  isTimeoutErrorMessage,
} from "../agents/pi-embedded-helpers/failover-matches.js";

export type MemoryEmbeddingErrorReason =
  | "billing"
  | "rate_limit"
  | "auth"
  | "timeout"
  | "overloaded"
  | "provider_error";

export type MemoryEmbeddingErrorClassification = {
  reason: MemoryEmbeddingErrorReason;
  /** Safe for tool payloads / logs (secrets stripped). */
  message: string;
  retryable: boolean;
};

const BILLING_SIGNAL_RE =
  /insufficient[_ ]quota|insufficient[_ ]credits|insufficient[_ ]balance|credit balance|payment required|plans\s*&\s*billing|billing hard limit|out of credits|used up your (?:credits|quota|points)/i;

const RATE_LIMIT_SIGNAL_RE =
  /rate[_ ]limit|too many requests|resource[_ ]exhausted|resource has been exhausted|tokens per (?:minute|day|hour)|requests per (?:minute|day|hour)|\btpm\b|\brpm\b|throttl|quota exceeded|exceeded your current quota/i;

const AUTH_SIGNAL_RE =
  /\b401\b|\b403\b|unauthorized|forbidden|invalid[_ ]?api[_ ]?key|incorrect api key|authentication|access denied|insufficient permissions/i;

const OVERLOADED_SIGNAL_RE = /overloaded_error|overloaded|high demand|capacity/i;

const TIMEOUT_SIGNAL_RE =
  /timeout|timed out|deadline exceeded|econnreset|econnrefused|enotfound|eai_again|socket hang up|network error|fetch failed|service unavailable/i;

const TRANSIENT_HTTP_RE = /\b(408|429|499|500|502|503|504|521|522|523|524|529)\b/;

const MODEL_NOT_FOUND_RE = /model[_ ]not[_ ]found|does not exist|unknown model|invalid model/i;

const FORMAT_ERROR_RE =
  /invalid[_ ]request|bad request|\b400\b|string should match|invalid request format/i;

const SECRET_PAIR_RE =
  /(?:api[_-]?key|authorization|bearer|token|secret|password)\s*[:=]\s*["']?[^\s"',;]+/gi;

const RETRY_AFTER_HEADER_RE = /retry-after\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i;
const RETRY_AFTER_SECONDS_RE = /retry after\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)?/i;

function asMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name || "embedding error";
  }
  if (typeof err === "string") {
    return err;
  }
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return "embedding error";
}

function getStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }
  const candidate =
    (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }
  if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
    return Number(candidate);
  }
  const fromMessage = asMessage(err).match(/\b([45]\d\d)\b/);
  if (fromMessage) {
    return Number(fromMessage[1]);
  }
  return undefined;
}

/** Strip credentials / Authorization material from provider error text. */
export function sanitizeEmbeddingErrorMessage(raw: string): string {
  return raw
    .replace(
      /\bAuthorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
      "Authorization=Bearer [redacted]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(SECRET_PAIR_RE, (match) => {
      const key = match.split(/[:=]/)[0]?.trim() || "secret";
      return `${key}=[redacted]`;
    })
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .trim();
}

function hasBillingSignal(message: string): boolean {
  return BILLING_SIGNAL_RE.test(message) || isBillingErrorMessage(message);
}

function hasRateLimitSignal(message: string): boolean {
  return RATE_LIMIT_SIGNAL_RE.test(message) || isRateLimitErrorMessage(message);
}

export function classifyMemoryEmbeddingError(err: unknown): MemoryEmbeddingErrorClassification {
  const raw = asMessage(err);
  const message = sanitizeEmbeddingErrorMessage(raw);
  const status = getStatusCode(err);

  // Billing wins even when the transport status is 429.
  if (hasBillingSignal(message) || status === 402) {
    return { reason: "billing", message, retryable: false };
  }

  if (status === 429 || hasRateLimitSignal(message) || /\b429\b/.test(message)) {
    // Bare 429 / Too Many Requests / resource_exhausted / TPM → rate_limit
    return { reason: "rate_limit", message, retryable: true };
  }

  if (
    status === 401 ||
    status === 403 ||
    isAuthPermanentErrorMessage(message) ||
    isAuthErrorMessage(message) ||
    AUTH_SIGNAL_RE.test(message)
  ) {
    return { reason: "auth", message, retryable: false };
  }

  if (MODEL_NOT_FOUND_RE.test(message) || FORMAT_ERROR_RE.test(message) || status === 400) {
    return { reason: "provider_error", message, retryable: false };
  }

  if (
    status === 529 ||
    isOverloadedErrorMessage(message) ||
    (OVERLOADED_SIGNAL_RE.test(message) && (status === 503 || status === undefined))
  ) {
    return { reason: "overloaded", message, retryable: true };
  }

  if (
    status === 408 ||
    status === 499 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 521 ||
    status === 522 ||
    status === 523 ||
    status === 524 ||
    isTimeoutErrorMessage(message) ||
    TIMEOUT_SIGNAL_RE.test(message) ||
    TRANSIENT_HTTP_RE.test(message)
  ) {
    return { reason: "timeout", message, retryable: true };
  }

  return { reason: "provider_error", message, retryable: false };
}

export function isRetryableMemoryEmbeddingError(err: unknown): boolean {
  const { reason, retryable } = classifyMemoryEmbeddingError(err);
  if (!retryable) {
    return false;
  }
  return reason === "rate_limit" || reason === "overloaded" || reason === "timeout";
}

/** Parse Retry-After (seconds) from error message / headers when present. */
export function extractEmbeddingRetryAfterMs(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const headers = (err as { headers?: Record<string, unknown>; response?: { headers?: unknown } })
      .headers;
    const responseHeaders = (err as { response?: { headers?: Record<string, unknown> } }).response
      ?.headers;
    for (const bag of [headers, responseHeaders]) {
      if (!bag || typeof bag !== "object") {
        continue;
      }
      const value =
        (bag as { "retry-after"?: unknown; "Retry-After"?: unknown })["retry-after"] ??
        (bag as { "Retry-After"?: unknown })["Retry-After"];
      if (typeof value === "string" || typeof value === "number") {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0) {
          return Math.round(seconds * 1000);
        }
      }
    }
    const retryAfterMs = (err as { retryAfterMs?: unknown }).retryAfterMs;
    if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
      return Math.round(retryAfterMs);
    }
  }

  const message = asMessage(err);
  const match = message.match(RETRY_AFTER_HEADER_RE) ?? message.match(RETRY_AFTER_SECONDS_RE);
  if (!match?.[1]) {
    return undefined;
  }
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return Math.round(seconds * 1000);
}

export function memoryEmbeddingUnavailableCopy(reason: MemoryEmbeddingErrorReason): {
  warning: string;
  action: string;
} {
  switch (reason) {
    case "billing":
      return {
        warning:
          "Memory search is unavailable because the embedding provider reports a billing or quota problem.",
        action:
          "Check the embedding provider balance and API key, top up credits, or switch provider (re-index required), then retry memory_search.",
      };
    case "rate_limit":
      return {
        warning:
          "Memory search is unavailable because the embedding provider rate-limited the request.",
        action:
          "Retry later; check embedding RPM/TPM limits and any Retry-After guidance, then retry memory_search.",
      };
    case "auth":
      return {
        warning:
          "Memory search is unavailable because the embedding provider rejected the API key or permissions.",
        action: "Check the embedding API key and permissions, then retry memory_search.",
      };
    case "timeout":
    case "overloaded":
      return {
        warning:
          "Memory search is unavailable because the embedding provider is temporarily unavailable.",
        action: "Retry memory_search shortly; this is usually a transient service issue.",
      };
    default:
      return {
        warning: "Memory search is unavailable due to an embedding/provider error.",
        action: "Check embedding provider configuration and retry memory_search.",
      };
  }
}
