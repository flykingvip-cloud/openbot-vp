import type { ErrorShape } from "../protocol/index.js";
import { idempotencyPayloadConflictError } from "./idempotency-payload.js";
import type { GatewayRequestContext, RespondFn } from "./types.js";

export type IdempotencyInflightResult = {
  ok: boolean;
  payload?: unknown;
  error?: ErrorShape;
  meta?: Record<string, unknown>;
};

type InflightReservation = {
  payloadFingerprint: string;
  promise: Promise<IdempotencyInflightResult>;
};

const inflightByContext = new WeakMap<GatewayRequestContext, Map<string, InflightReservation>>();

export function getIdempotencyInflightMap(
  context: GatewayRequestContext,
): Map<string, InflightReservation> {
  let inflight = inflightByContext.get(context);
  if (!inflight) {
    inflight = new Map();
    inflightByContext.set(context, inflight);
  }
  return inflight;
}

/**
 * Join an in-flight same-key same-payload request (timeout retry), or run `work`
 * once and share its result with joiners. Different payload → 409 conflict.
 */
export async function joinOrRunIdempotencyInflight(params: {
  context: GatewayRequestContext;
  dedupeKey: string;
  payloadFingerprint: string;
  respond: RespondFn;
  work: () => Promise<IdempotencyInflightResult>;
}): Promise<void> {
  const inflightMap = getIdempotencyInflightMap(params.context);
  const existing = inflightMap.get(params.dedupeKey);
  if (existing) {
    if (existing.payloadFingerprint !== params.payloadFingerprint) {
      params.respond(false, undefined, idempotencyPayloadConflictError());
      return;
    }
    const result = await existing.promise;
    const meta = result.meta ? { ...result.meta, cached: true } : { cached: true };
    params.respond(result.ok, result.payload, result.error, meta);
    return;
  }

  const work = params.work();
  inflightMap.set(params.dedupeKey, {
    payloadFingerprint: params.payloadFingerprint,
    promise: work,
  });
  try {
    const result = await work;
    params.respond(result.ok, result.payload, result.error, result.meta);
  } finally {
    inflightMap.delete(params.dedupeKey);
  }
}
