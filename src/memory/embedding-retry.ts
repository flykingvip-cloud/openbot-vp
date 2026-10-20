import { sleep } from "../utils.js";
import {
  classifyMemoryEmbeddingError,
  extractEmbeddingRetryAfterMs,
  isRetryableMemoryEmbeddingError,
} from "./embedding-error.js";

export type EmbeddingRetryDeps = {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
};

export type EmbeddingRetryOptions = {
  /** Total attempts including the first try. Default 4 (1 + 3 retries). */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Extra jitter factor applied on top of exponential delay (0–1). Default 0.2 */
  jitter?: number;
  label?: string;
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (info: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    err: unknown;
    reason: string;
  }) => void;
  deps?: EmbeddingRetryDeps;
};

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8000;
const DEFAULT_JITTER = 0.2;

function resolveDelayMs(params: {
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: number;
  err: unknown;
  random: () => number;
}): number {
  const retryAfterMs = extractEmbeddingRetryAfterMs(params.err);
  const exponential = params.baseDelayMs * 2 ** Math.max(0, params.attempt - 1);
  const base =
    typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs)
      ? Math.max(retryAfterMs, params.baseDelayMs)
      : exponential;
  const capped = Math.min(base, params.maxDelayMs);
  const jitterFactor = 1 + params.random() * params.jitter;
  return Math.max(0, Math.round(capped * jitterFactor));
}

/**
 * Shared exponential backoff + jitter retry for memory embedding calls.
 * Only retries when `shouldRetry` (default: transient embedding classes) allows it.
 */
export async function retryMemoryEmbedding<T>(
  fn: () => Promise<T>,
  options: EmbeddingRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const jitter = Math.min(1, Math.max(0, options.jitter ?? DEFAULT_JITTER));
  const shouldRetry = options.shouldRetry ?? isRetryableMemoryEmbeddingError;
  const sleepFn = options.deps?.sleep ?? sleep;
  const random = options.deps?.random ?? Math.random;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !shouldRetry(err)) {
        break;
      }
      const classification = classifyMemoryEmbeddingError(err);
      const delayMs = resolveDelayMs({
        attempt,
        baseDelayMs,
        maxDelayMs,
        jitter,
        err,
        random,
      });
      options.onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        err,
        reason: classification.reason,
      });
      await sleepFn(delayMs);
    }
  }
  throw lastErr ?? new Error("memory embedding retry failed");
}
