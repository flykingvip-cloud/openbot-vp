/**
 * Knowledge-engineering integrity lint. Pure helpers over existing
 * consume receipts, raw_hash, and preview text. Not an RPC and not an ingest gate.
 */
import type { KnowledgeConsumeReceiptItem } from "../consume-ref.js";

export type IntegrityLintResult = {
  ok: boolean;
  reason?: string;
};

const USABLE_RECEIPT_STATUSES = new Set(["consumed", "partial"]);

export function isReceiptUsable(receipt: Pick<KnowledgeConsumeReceiptItem, "status">): boolean {
  return USABLE_RECEIPT_STATUSES.has(receipt.status);
}

export function lintReceipt(
  receipt: Pick<KnowledgeConsumeReceiptItem, "status">,
): IntegrityLintResult {
  if (isReceiptUsable(receipt)) {
    return { ok: true };
  }
  return { ok: false, reason: `consume receipt not usable: ${receipt.status}` };
}

export function assertReceiptUsable(receipt: Pick<KnowledgeConsumeReceiptItem, "status">): void {
  const result = lintReceipt(receipt);
  if (!result.ok) {
    throw new Error(result.reason);
  }
}

export function lintRawHash(expected: string, actual: string): IntegrityLintResult {
  const want = expected.trim();
  const got = actual.trim();
  if (!want) {
    return { ok: false, reason: "raw_hash missing" };
  }
  if (want !== got) {
    return { ok: false, reason: "raw_hash mismatch" };
  }
  return { ok: true };
}

export function assertRawHash(expected: string, actual: string): void {
  const result = lintRawHash(expected, actual);
  if (!result.ok) {
    throw new Error(result.reason);
  }
}

export function lintSpanInPreview(previewText: string, span: string): IntegrityLintResult {
  const needle = span.trim();
  if (!needle) {
    return { ok: false, reason: "evidence span empty" };
  }
  if (!previewText.includes(needle)) {
    return { ok: false, reason: "evidence span not found in preview" };
  }
  return { ok: true };
}

export function assertSpanInPreview(previewText: string, span: string): void {
  const result = lintSpanInPreview(previewText, span);
  if (!result.ok) {
    throw new Error(result.reason);
  }
}
