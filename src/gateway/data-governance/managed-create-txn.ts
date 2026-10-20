/**
 * Managed second-wave create transaction:
 * allocate → pending Catalog → physical write → active.
 * On failure after pending: abort → marker-owned quarantine → recovery_required.
 */

import { randomUUID } from "node:crypto";
import type { QuarantinePathResult } from "./runtime-catalog.js";

export type ManagedCreateTxnStage =
  | "begin_pending"
  | "physical_write"
  | "activate"
  | "done"
  | "aborted";

export type ManagedCreateTxnResult<T> = {
  ok: true;
  value: T;
  resourceId: string;
  operationId: string;
  stage: "done";
};

export type ManagedCreateTxnFailure = {
  ok: false;
  resourceId?: string;
  operationId: string;
  stage: ManagedCreateTxnStage;
  error: string;
  recoveryRequired?: boolean;
  quarantine?: QuarantinePathResult;
};

export async function runManagedGovernedCreateTxn<T>(params: {
  /** Stable operation id for markers/receipts; allocated when omitted. */
  operationId?: string;
  beginPending: () => Promise<{ resourceId: string }>;
  physicalWrite: (ctx: { resourceId: string; operationId: string }) => Promise<T>;
  activate: (ctx: { resourceId: string; operationId: string }) => Promise<void>;
  abort: (ctx: {
    resourceId: string;
    operationId: string;
    reason: string;
  }) => Promise<{ recoveryRequired: boolean; quarantine?: QuarantinePathResult }>;
}): Promise<ManagedCreateTxnResult<T> | ManagedCreateTxnFailure> {
  const operationId = params.operationId?.trim() || `gov-create-${randomUUID()}`;
  let resourceId: string | undefined;
  let stage: ManagedCreateTxnStage = "begin_pending";
  try {
    const begun = await params.beginPending();
    resourceId = begun.resourceId;
    stage = "physical_write";
    const value = await params.physicalWrite({ resourceId, operationId });
    stage = "activate";
    await params.activate({ resourceId, operationId });
    return { ok: true, value, resourceId, operationId, stage: "done" };
  } catch (err) {
    const error = String((err as Error)?.message ?? err);
    if (!resourceId) {
      return { ok: false, operationId, stage, error };
    }
    try {
      const abortResult = await params.abort({
        resourceId,
        operationId,
        reason: error,
      });
      return {
        ok: false,
        resourceId,
        operationId,
        stage: "aborted",
        error,
        recoveryRequired: abortResult.recoveryRequired,
        quarantine: abortResult.quarantine,
      };
    } catch (abortErr) {
      return {
        ok: false,
        resourceId,
        operationId,
        stage: "aborted",
        error: `${error}; abort_failed:${String((abortErr as Error)?.message ?? abortErr)}`,
        recoveryRequired: true,
      };
    }
  }
}
