/**
 * P2-a deletion authorization markers — logical validity is authoritative.
 * Physical file delete is cleanup only and must never re-authorize erase.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { isLegalHoldActive } from "./envelope.js";
import { getCurrentReceiptAttemptId } from "./lifecycle-receipt-store.js";
import { resolveDeletionAuthMarkerRoot } from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";
import type {
  ActorRef,
  CatalogRecord,
  GovernanceDeletionAuthMarker,
  GovernanceLifecycleReceipt,
} from "./types.js";

export type DeletionMarkerInvalidReason =
  | "marker_lifecycle_state"
  | "marker_hold_blocks"
  | "marker_active_op_mismatch"
  | "marker_version_stale"
  | "marker_expired"
  | "marker_attempt_mismatch"
  | "marker_missing"
  | "marker_resource_mismatch"
  | "marker_receipt_mismatch"
  | "marker_tenant_mismatch"
  | "marker_operation_mismatch"
  | "marker_binding_mismatch"
  | "marker_locator_mismatch"
  | "marker_object_key_mismatch"
  | "marker_receipt_resource_mismatch"
  | "marker_receipt_tenant_mismatch"
  | "marker_receipt_operation_mismatch"
  | "marker_receipt_not_open";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function resolveMarkerPath(operationId: string, attemptId: string, stateDir?: string): string {
  const op = assertSafeRecoveryReceiptToken(operationId, "operationId");
  const attempt = assertSafeRecoveryReceiptToken(attemptId, "stage");
  const root = path.resolve(resolveDeletionAuthMarkerRoot(stateDir ?? resolveStateDir()));
  const dest = path.resolve(root, `${op}-${attempt}.json`);
  const rel = path.relative(root, dest);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("invalid_deletion_marker_path");
  }
  return dest;
}

function normalizeObjectKey(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return value;
}

export function writeDeletionAuthMarker(params: {
  operationId: string;
  attemptId: string;
  resourceId: string;
  bindingId: string;
  locator: string;
  objectKey?: string | null;
  governanceVersion: number;
  actor: ActorRef;
  tenantId: string | null;
  receiptId: string;
  ttlMs?: number;
  stateDir?: string;
}): GovernanceDeletionAuthMarker {
  const now = Date.now();
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + (params.ttlMs ?? DEFAULT_TTL_MS)).toISOString();
  const marker: GovernanceDeletionAuthMarker = {
    markerId: `${params.operationId}:${params.attemptId}`,
    operationId: params.operationId,
    attemptId: params.attemptId,
    resourceId: params.resourceId,
    bindingId: params.bindingId,
    locator: path.resolve(params.locator),
    objectKey: normalizeObjectKey(params.objectKey),
    governanceVersion: params.governanceVersion,
    expiresAt,
    issuedAt,
    actor: params.actor,
    tenantId: params.tenantId,
    receiptId: params.receiptId,
  };
  const dest = resolveMarkerPath(params.operationId, params.attemptId, params.stateDir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(marker, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return marker;
}

export function readDeletionAuthMarker(params: {
  operationId: string;
  attemptId: string;
  stateDir?: string;
}): GovernanceDeletionAuthMarker | null {
  const dest = resolveMarkerPath(params.operationId, params.attemptId, params.stateDir);
  if (!fs.existsSync(dest)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(dest, "utf8")) as GovernanceDeletionAuthMarker;
  } catch {
    return null;
  }
}

/** Cleanup only — failure must not resurrect logical validity. */
export function cleanupDeletionAuthMarker(params: {
  operationId: string;
  attemptId: string;
  stateDir?: string;
}): boolean {
  const dest = resolveMarkerPath(params.operationId, params.attemptId, params.stateDir);
  try {
    if (!fs.existsSync(dest)) {
      return false;
    }
    fs.unlinkSync(dest);
    return true;
  } catch {
    return false;
  }
}

export function isDeletionAuthMarkerExpired(
  marker: GovernanceDeletionAuthMarker,
  nowMs = Date.now(),
): boolean {
  const exp = Date.parse(marker.expiresAt);
  return !Number.isFinite(exp) || exp <= nowMs;
}

/**
 * Authoritative Gate A2 validity — always re-read Catalog before destructive work.
 * Binds marker to Catalog record, receipt, and current canonical binding/locator/objectKey.
 */
export function validateDeletionAuthMarkerLogical(params: {
  marker: GovernanceDeletionAuthMarker | null;
  record: CatalogRecord;
  receipt: GovernanceLifecycleReceipt;
  nowMs?: number;
}): { ok: true } | { ok: false; reason: DeletionMarkerInvalidReason } {
  if (!params.marker) {
    return { ok: false, reason: "marker_missing" };
  }
  const { marker, record, receipt } = params;
  const env = record.envelope;

  if (receipt.status !== "open") {
    return { ok: false, reason: "marker_receipt_not_open" };
  }
  if (receipt.operationId !== marker.operationId) {
    return { ok: false, reason: "marker_receipt_operation_mismatch" };
  }
  if (receipt.resourceId !== marker.resourceId) {
    return { ok: false, reason: "marker_receipt_resource_mismatch" };
  }
  if (receipt.tenantId !== marker.tenantId) {
    return { ok: false, reason: "marker_receipt_tenant_mismatch" };
  }
  if (marker.receiptId !== receipt.receiptId) {
    return { ok: false, reason: "marker_receipt_mismatch" };
  }
  if (marker.resourceId !== env.resourceId) {
    return { ok: false, reason: "marker_resource_mismatch" };
  }
  if (marker.tenantId !== env.tenantId) {
    return { ok: false, reason: "marker_tenant_mismatch" };
  }
  if (env.lifecycleState !== "deletion_pending") {
    return { ok: false, reason: "marker_lifecycle_state" };
  }
  if (isLegalHoldActive(env)) {
    return { ok: false, reason: "marker_hold_blocks" };
  }
  if (env.activeLifecycleOperation?.operationId !== marker.operationId) {
    return { ok: false, reason: "marker_active_op_mismatch" };
  }
  if (receipt.operationId !== env.activeLifecycleOperation?.operationId) {
    return { ok: false, reason: "marker_operation_mismatch" };
  }
  if (env.governanceVersion !== marker.governanceVersion) {
    return { ok: false, reason: "marker_version_stale" };
  }
  if (isDeletionAuthMarkerExpired(marker, params.nowMs)) {
    return { ok: false, reason: "marker_expired" };
  }
  const currentAttempt = getCurrentReceiptAttemptId(receipt);
  if (!currentAttempt || currentAttempt !== marker.attemptId) {
    return { ok: false, reason: "marker_attempt_mismatch" };
  }

  if (marker.bindingId !== env.canonicalBindingId) {
    return { ok: false, reason: "marker_binding_mismatch" };
  }
  const canonical = record.bindings.find(
    (b) => b.bindingId === env.canonicalBindingId && b.role === "canonical",
  );
  if (!canonical || canonical.bindingId !== marker.bindingId) {
    return { ok: false, reason: "marker_binding_mismatch" };
  }
  if (path.resolve(canonical.locator) !== path.resolve(marker.locator)) {
    return { ok: false, reason: "marker_locator_mismatch" };
  }
  if (normalizeObjectKey(canonical.objectKey) !== normalizeObjectKey(marker.objectKey)) {
    return { ok: false, reason: "marker_object_key_mismatch" };
  }

  return { ok: true };
}
