/**
 * P2-a lifecycle access helpers — write deny + restart recovery from Catalog + receipt.
 */

import { getLifecycleReceipt } from "./lifecycle-receipt-store.js";
import { getSharedDataGovernanceCatalog } from "./runtime-catalog.js";
import type { CatalogRecord, GovernanceLifecycleReceipt } from "./types.js";

export type RecoverLifecycleResult =
  | {
      ok: true;
      canResume: true;
      record: CatalogRecord;
      receipt: GovernanceLifecycleReceipt;
    }
  | {
      ok: true;
      canResume: false;
      recoveryRequired: true;
      reason: string;
      record?: CatalogRecord;
      receipt?: GovernanceLifecycleReceipt | null;
    }
  | { ok: false; conflict: "not_found" };

/**
 * After restart: bind Catalog activeLifecycleOperation to durable committed receipt,
 * or surface recovery_required when inconsistent / prepared-only / failed.
 */
export async function recoverLifecycleFromCatalogAndReceipt(params: {
  resourceId: string;
  stateDir?: string;
}): Promise<RecoverLifecycleResult> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir: params.stateDir });
  const record = await catalog.get(params.resourceId);
  if (!record) {
    return { ok: false, conflict: "not_found" };
  }

  if (record.envelope.lifecycleState === "recovery_required") {
    return {
      ok: true,
      canResume: false,
      recoveryRequired: true,
      reason: "catalog_recovery_required",
      record,
    };
  }

  const active = record.envelope.activeLifecycleOperation;
  if (!active) {
    return {
      ok: true,
      canResume: false,
      recoveryRequired: true,
      reason: "no_active_lifecycle_operation",
      record,
    };
  }

  const receipt = getLifecycleReceipt({
    operationId: active.operationId,
    stateDir: params.stateDir,
  });
  if (!receipt) {
    return {
      ok: true,
      canResume: false,
      recoveryRequired: true,
      reason: "receipt_missing",
      record,
    };
  }
  if (receipt.status === "prepared" || receipt.status === "failed") {
    return {
      ok: true,
      canResume: false,
      recoveryRequired: true,
      reason: `receipt_${receipt.status}_without_commit`,
      record,
      receipt,
    };
  }
  if (receipt.resourceId !== record.envelope.resourceId) {
    return {
      ok: true,
      canResume: false,
      recoveryRequired: true,
      reason: "receipt_resource_mismatch",
      record,
      receipt,
    };
  }
  if (receipt.status === "cancelled" || receipt.status === "completed") {
    return {
      ok: true,
      canResume: false,
      recoveryRequired: true,
      reason: `receipt_${receipt.status}_with_active_op`,
      record,
      receipt,
    };
  }
  if (receipt.status !== "open") {
    return {
      ok: true,
      canResume: false,
      recoveryRequired: true,
      reason: "receipt_not_open",
      record,
      receipt,
    };
  }
  if (receipt.operationId !== active.operationId) {
    return {
      ok: true,
      canResume: false,
      recoveryRequired: true,
      reason: "operation_id_mismatch",
      record,
      receipt,
    };
  }

  return { ok: true, canResume: true, record, receipt };
}
