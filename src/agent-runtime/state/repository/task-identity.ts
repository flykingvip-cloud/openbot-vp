import { createHash, randomBytes } from "node:crypto";

/** Legacy body-hash helper (not the sole identity source — see allocateTaskInstanceId). */
export function taskIdForText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `task-${digest}`;
}

/**
 * C3: independent instance IDs (not body-hash-only).
 * - same body again without inboundRequestId → new id
 * - same inbound request retry (same inboundRequestId) → idempotent same id
 */
export function allocateTaskInstanceId(params?: {
  inboundRequestId?: string;
  entropy?: string | number;
}): string {
  const inbound = params?.inboundRequestId?.trim();
  if (inbound) {
    const digest = createHash("sha256").update(`inbound-req:${inbound}`).digest("hex").slice(0, 12);
    return `task-${digest}`;
  }
  const entropy = `${Date.now()}:${randomBytes(16).toString("hex")}:${params?.entropy ?? ""}:${process.hrtime.bigint()}`;
  const digest = createHash("sha256").update(entropy).digest("hex").slice(0, 12);
  return `task-${digest}`;
}
