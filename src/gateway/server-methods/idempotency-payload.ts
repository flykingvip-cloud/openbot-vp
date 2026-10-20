import { createHash } from "node:crypto";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { DedupeEntry } from "../server-shared.js";

/**
 * Stable request fingerprint for side-effecting idempotency keys.
 * Key order does not matter. A missing fingerprint on a cached entry fails closed
 * (conflict) so a replay cannot return another request's payload.
 */
export function fingerprintIdempotencyPayload(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).toSorted();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function idempotencyPayloadConflictError() {
  return errorShape(ErrorCodes.INVALID_REQUEST, "idempotency key reused with a different payload", {
    details: { code: "IDEMPOTENCY_PAYLOAD_CONFLICT", status: 409 },
  });
}

export function classifyIdempotencyReplay(
  entry: DedupeEntry | undefined,
  payloadFingerprint: string,
): { kind: "miss" } | { kind: "replay"; entry: DedupeEntry } | { kind: "conflict" } {
  if (!entry) {
    return { kind: "miss" };
  }
  if (!entry.payloadFingerprint || entry.payloadFingerprint !== payloadFingerprint) {
    return { kind: "conflict" };
  }
  return { kind: "replay", entry };
}
