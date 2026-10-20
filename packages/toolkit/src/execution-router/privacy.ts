import type { ExecutionReceipt } from "../contracts.js";
import type { ObservedToolkitReceipt } from "./contracts.js";

const FORBIDDEN_KEYS = new Set([
  "text",
  "body",
  "content",
  "prompt",
  "message",
  "attachment",
  "attachments",
  "token",
  "secret",
  "password",
  "apikey",
  "args",
  "arguments",
  "result",
  "output",
]);

function walkForbiddenKeys(value: unknown, seen: WeakSet<object>): void {
  if (value == null || typeof value !== "object") {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      walkForbiddenKeys(item, seen);
    }
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new Error(`execution-router extra forbids field "${key}"`);
    }
    walkForbiddenKeys(child, seen);
  }
}

export function assertNoSensitiveFields(record: Record<string, unknown>): void {
  walkForbiddenKeys(record, new WeakSet<object>());
}

export function isForbiddenObservationKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key.toLowerCase());
}

/**
 * Counts and identifiers only. Drops evidence metadata, error details,
 * and side-effect bodies so nested secrets cannot enter the snapshot.
 */
export function projectToolkitReceipt(receipt: ExecutionReceipt): ObservedToolkitReceipt {
  const errorCode =
    receipt.error && typeof receipt.error.code === "string" && receipt.error.code.length > 0
      ? receipt.error.code
      : undefined;
  return {
    receiptId: receipt.receiptId,
    toolId: receipt.toolId,
    operation: receipt.operation,
    status: receipt.status,
    startedAt: receipt.startedAt,
    ...(receipt.completedAt ? { completedAt: receipt.completedAt } : {}),
    ...(receipt.approvalId ? { approvalId: receipt.approvalId } : {}),
    ...(receipt.idempotencyKey ? { idempotencyKey: receipt.idempotencyKey } : {}),
    ...(receipt.inputDigest ? { inputDigest: receipt.inputDigest } : {}),
    ...(receipt.outputDigest ? { outputDigest: receipt.outputDigest } : {}),
    evidenceCount: Array.isArray(receipt.evidence) ? receipt.evidence.length : 0,
    sideEffectCount: Array.isArray(receipt.sideEffects) ? receipt.sideEffects.length : 0,
    ...(errorCode ? { errorCode } : {}),
  };
}
