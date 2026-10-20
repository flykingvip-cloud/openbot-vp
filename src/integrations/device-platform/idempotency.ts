import { createHash, timingSafeEqual } from "node:crypto";
import { DevicePlatformError, type IntegrationIdempotencyRecord } from "./types.js";

export type ToolIdempotencyDecision =
  | { kind: "reserved" }
  | { kind: "duplicate"; inflight: boolean; response?: Record<string, unknown> }
  | { kind: "conflict" };

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function bodyHash(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

/**
 * Reserve before the caller leaves pending. A second call with the same body
 * while inflight is a duplicate. A different body is a conflict.
 */
export function reserveIdempotency(
  records: Record<string, IntegrationIdempotencyRecord>,
  key: string,
  hash: string,
  nowIso: string,
  authorizationRef?: string,
): { records: Record<string, IntegrationIdempotencyRecord>; decision: ToolIdempotencyDecision } {
  const existing = records[key];
  if (!existing) {
    return {
      records: {
        ...records,
        [key]: {
          key,
          hash,
          inflight: true,
          createdAt: nowIso,
          ...(authorizationRef ? { authorizationRef } : {}),
        },
      },
      decision: { kind: "reserved" },
    };
  }
  if (!hashesEqual(existing.hash, hash)) {
    return { records, decision: { kind: "conflict" } };
  }
  if (existing.inflight) {
    return { records, decision: { kind: "duplicate", inflight: true } };
  }
  return {
    records,
    decision: { kind: "duplicate", inflight: false, response: existing.response },
  };
}

export function completeIdempotency(
  records: Record<string, IntegrationIdempotencyRecord>,
  key: string,
  hash: string,
  response: Record<string, unknown>,
): Record<string, IntegrationIdempotencyRecord> {
  const existing = records[key];
  if (!existing || !existing.inflight || !hashesEqual(existing.hash, hash)) {
    throw new DevicePlatformError("IDEMPOTENCY_CONFLICT", "Idempotency reservation is missing");
  }
  return {
    ...records,
    [key]: { ...existing, inflight: false, response },
  };
}

/** Drop in-flight reservations only. Completed responses stay for duplicate replay. */
export function dropInflightIdempotency(
  records: Record<string, IntegrationIdempotencyRecord>,
  predicate?: (record: IntegrationIdempotencyRecord) => boolean,
): Record<string, IntegrationIdempotencyRecord> {
  const next: Record<string, IntegrationIdempotencyRecord> = {};
  for (const [key, record] of Object.entries(records)) {
    if (record.inflight && (!predicate || predicate(record))) {
      continue;
    }
    next[key] = record;
  }
  return next;
}
