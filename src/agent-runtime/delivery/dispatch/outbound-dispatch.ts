import { sleepWithAbort } from "../../../infra/backoff.js";
import { deliverOutboundPayloads } from "../../../infra/outbound/deliver.js";
import { confirmedDeliveryMessageIds } from "../../../shared/delivery-receipt.js";

const TRANSIENT_OUTBOUND_DELIVERY_ERROR_PATTERNS: readonly RegExp[] = [
  /\berrorcode=unavailable\b/i,
  /\bstatus\s*[:=]\s*"?unavailable\b/i,
  /\bUNAVAILABLE\b/,
  /no active .* listener/i,
  /gateway not connected/i,
  /gateway closed \(1006/i,
  /gateway timeout/i,
  /\b(econnreset|econnrefused|etimedout|enotfound|ehostunreach|network error)\b/i,
];

const PERMANENT_OUTBOUND_DELIVERY_ERROR_PATTERNS: readonly RegExp[] = [
  /unsupported channel/i,
  /unknown channel/i,
  /chat not found/i,
  /user not found/i,
  /bot was blocked by the user/i,
  /forbidden: bot was kicked/i,
  /recipient is not a valid/i,
  /outbound not configured for channel/i,
];

export function summarizeOutboundDeliveryError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || "error";
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error) || String(error);
  } catch {
    return String(error);
  }
}

export function isTransientOutboundDeliveryError(error: unknown): boolean {
  const message = summarizeOutboundDeliveryError(error);
  if (!message) {
    return false;
  }
  if (PERMANENT_OUTBOUND_DELIVERY_ERROR_PATTERNS.some((re) => re.test(message))) {
    return false;
  }
  return TRANSIENT_OUTBOUND_DELIVERY_ERROR_PATTERNS.some((re) => re.test(message));
}

export type OutboundDeliveryRetryInfo = {
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
  summary: string;
};

const DEFAULT_TRANSIENT_RETRY_DELAYS_MS: readonly number[] = [5_000, 10_000, 20_000];

export async function retryTransientOutboundDelivery<T>(params: {
  signal?: AbortSignal;
  delaysMs?: readonly number[];
  onRetry?: (info: OutboundDeliveryRetryInfo) => void;
  run: () => Promise<T>;
}): Promise<T> {
  const retryDelaysMs = params.delaysMs ?? DEFAULT_TRANSIENT_RETRY_DELAYS_MS;
  let retryIndex = 0;
  for (;;) {
    if (params.signal?.aborted) {
      throw new Error("outbound delivery aborted");
    }
    try {
      return await params.run();
    } catch (err) {
      const delayMs = retryDelaysMs[retryIndex];
      if (delayMs == null || !isTransientOutboundDeliveryError(err) || params.signal?.aborted) {
        throw err;
      }
      const nextAttempt = retryIndex + 2;
      const maxAttempts = retryDelaysMs.length + 1;
      params.onRetry?.({
        nextAttempt,
        maxAttempts,
        delayMs,
        error: err,
        summary: summarizeOutboundDeliveryError(err),
      });
      retryIndex += 1;
      await sleepWithAbort(delayMs, params.signal);
    }
  }
}

export type OutboundDispatchResult = {
  results: Awaited<ReturnType<typeof deliverOutboundPayloads>>;
  confirmedMessageIds: string[] | undefined;
  lastMessageId: string | undefined;
};

/**
 * Canonical outbound delivery dispatch with optional bounded transient retry
 * and normalized receipt extraction.
 */
export async function dispatchOutboundDelivery(
  params: Parameters<typeof deliverOutboundPayloads>[0] & {
    deliver?: typeof deliverOutboundPayloads;
    retryTransient?: boolean;
    retryDelaysMs?: readonly number[];
    onRetry?: (info: OutboundDeliveryRetryInfo) => void;
  },
): Promise<OutboundDispatchResult> {
  const {
    deliver = deliverOutboundPayloads,
    retryTransient,
    retryDelaysMs,
    onRetry,
    ...deliverParams
  } = params;
  const run = () => deliver(deliverParams);
  const results = retryTransient
    ? await retryTransientOutboundDelivery({
        signal: deliverParams.abortSignal,
        delaysMs: retryDelaysMs,
        onRetry,
        run,
      })
    : await run();
  return {
    results,
    confirmedMessageIds: confirmedDeliveryMessageIds(results),
    lastMessageId: results.at(-1)?.messageId,
  };
}
