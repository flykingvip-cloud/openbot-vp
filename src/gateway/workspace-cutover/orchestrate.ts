import {
  resumeWorkspaceCutoverOperation,
  transitionWorkspaceCutoverOperation,
} from "./state-machine.js";
import type { WorkspaceCutoverStore } from "./store.js";
import type { WorkspaceCutoverOperation, WorkspaceCutoverState } from "./types.js";

export type AdvanceCutoverParams = {
  store: WorkspaceCutoverStore;
  operationId: string;
  nextState: WorkspaceCutoverState;
  nowMs?: number;
  lastError?: string | null;
  bumpRetry?: boolean;
  compatibilityReadDeadlineMs?: number | null;
};

/** Persisted advance — safe to call again after process restart. */
export function advanceCutoverOperation(params: AdvanceCutoverParams): WorkspaceCutoverOperation {
  const existing = params.store.get(params.operationId);
  if (!existing) {
    throw new Error(`cutover operation not found: ${params.operationId}`);
  }
  const resumed = resumeWorkspaceCutoverOperation(existing, params.nowMs);
  const next =
    resumed.state === params.nextState
      ? resumed
      : transitionWorkspaceCutoverOperation({
          operation: resumed,
          nextState: params.nextState,
          nowMs: params.nowMs,
          lastError: params.lastError,
          bumpRetry: params.bumpRetry,
        });
  const withDeadline =
    params.compatibilityReadDeadlineMs !== undefined
      ? { ...next, compatibilityReadDeadlineMs: params.compatibilityReadDeadlineMs }
      : next;
  params.store.save(withDeadline);
  return withDeadline;
}

export type RecordCompatibilityReadParams = {
  operation: WorkspaceCutoverOperation;
  nowMs?: number;
};

export function recordCompatibilityReadAudit(
  params: RecordCompatibilityReadParams,
): WorkspaceCutoverOperation {
  const nowMs = params.nowMs ?? Date.now();
  const { operation } = params;
  if (
    operation.state !== "compatibility_read_only" &&
    operation.state !== "resolver_write_cutover"
  ) {
    throw new Error(`compatibility read audit only allowed after cutover (${operation.state})`);
  }
  if (
    operation.compatibilityReadDeadlineMs != null &&
    nowMs > operation.compatibilityReadDeadlineMs
  ) {
    throw new Error(`compatibility read window expired for ${operation.operationId}`);
  }
  return {
    ...operation,
    compatibilityReadAuditCount: operation.compatibilityReadAuditCount + 1,
    updatedAtMs: nowMs,
  };
}

export function isCompatibilityReadExpired(
  operation: WorkspaceCutoverOperation,
  nowMs?: number,
): boolean {
  if (operation.compatibilityReadDeadlineMs == null) {
    return false;
  }
  return (nowMs ?? Date.now()) > operation.compatibilityReadDeadlineMs;
}
