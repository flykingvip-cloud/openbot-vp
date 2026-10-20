import fs from "node:fs";
import path from "node:path";
import { tenantPartition } from "./cognitive-approval-grant-store.js";
import {
  readJsonIfPresent,
  withCognitiveFileLock,
  writeJsonDurable,
} from "./cognitive-file-lock.js";
import { canonicalizeCognitiveJson } from "./cognitive-mutation-store.js";
import { resolveCognitiveMergeReceiptRoot } from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";
import type { CognitiveMergeReceipt, CognitiveMergeReceiptStatus } from "./types.js";

const LOCK_TIMEOUT = "cognitive_merge_receipt_lock_timeout";

const TERMINAL: ReadonlySet<CognitiveMergeReceiptStatus> = new Set([
  "applied",
  "conflicted",
  "rejected",
  "failed",
]);

function receiptPath(params: {
  mergeId: string;
  tenantId: string | null;
  stateDir: string;
}): string {
  const mergeId = assertSafeRecoveryReceiptToken(params.mergeId, "operationId");
  const partition = assertSafeRecoveryReceiptToken(tenantPartition(params.tenantId), "operationId");
  const root = path.resolve(resolveCognitiveMergeReceiptRoot(params.stateDir), partition);
  const dest = path.resolve(root, `${mergeId}.json`);
  const rel = path.relative(root, dest);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("invalid_cognitive_merge_receipt_path");
  }
  return dest;
}

function parseReceipt(value: unknown): CognitiveMergeReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as CognitiveMergeReceipt;
  if (raw.kind !== "cognitive_merge_receipt" || typeof raw.mergeId !== "string") {
    return null;
  }
  return raw;
}

export function computeCognitiveMergeFingerprint(params: {
  targetResourceId: string;
  sourceResourceIds: string[];
  policyVersion: string;
  expectedConflictGraphHash: string;
}): string {
  return canonicalizeCognitiveJson({
    targetResourceId: params.targetResourceId,
    sourceResourceIds: [...params.sourceResourceIds].toSorted(),
    policyVersion: params.policyVersion,
    expectedConflictGraphHash: params.expectedConflictGraphHash,
  });
}

export function getCognitiveMergeReceipt(params: {
  mergeId: string;
  tenantId: string | null;
  stateDir: string;
}): CognitiveMergeReceipt | null {
  return parseReceipt(readJsonIfPresent(receiptPath(params)));
}

export function listCognitiveMergeReceipts(params: {
  tenantId: string | null;
  stateDir: string;
}): CognitiveMergeReceipt[] {
  const partition = assertSafeRecoveryReceiptToken(tenantPartition(params.tenantId), "operationId");
  const root = path.resolve(resolveCognitiveMergeReceiptRoot(params.stateDir), partition);
  if (!fs.existsSync(root)) {
    return [];
  }
  const out: CognitiveMergeReceipt[] = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const parsed = parseReceipt(readJsonIfPresent(path.join(root, name)));
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

export async function createCognitiveMergeReceiptUnique(params: {
  receipt: CognitiveMergeReceipt;
  stateDir: string;
}): Promise<
  { ok: true; receipt: CognitiveMergeReceipt } | { ok: false; existing: CognitiveMergeReceipt }
> {
  const dest = receiptPath({
    mergeId: params.receipt.mergeId,
    tenantId: params.receipt.tenantId,
    stateDir: params.stateDir,
  });
  let existing: CognitiveMergeReceipt | null = null;
  let created: CognitiveMergeReceipt | null = null;
  await withCognitiveFileLock(`${dest}.lock`, LOCK_TIMEOUT, () => {
    const prior = parseReceipt(readJsonIfPresent(dest));
    if (prior) {
      existing = prior;
      return;
    }
    writeJsonDurable(dest, params.receipt);
    created = params.receipt;
  });
  if (existing) {
    return { ok: false, existing };
  }
  if (!created) {
    throw new Error("cognitive_merge_receipt_create_failed");
  }
  return { ok: true, receipt: created };
}

export async function putCognitiveMergeReceipt(params: {
  receipt: CognitiveMergeReceipt;
  stateDir: string;
}): Promise<CognitiveMergeReceipt> {
  const dest = receiptPath({
    mergeId: params.receipt.mergeId,
    tenantId: params.receipt.tenantId,
    stateDir: params.stateDir,
  });
  const next: CognitiveMergeReceipt = { ...params.receipt, updatedAt: new Date().toISOString() };
  await withCognitiveFileLock(`${dest}.lock`, LOCK_TIMEOUT, () => {
    writeJsonDurable(dest, next);
  });
  return next;
}

export function isTerminalMergeReceiptStatus(status: CognitiveMergeReceiptStatus): boolean {
  return TERMINAL.has(status);
}
