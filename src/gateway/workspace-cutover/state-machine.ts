import type {
  CreateWorkspaceCutoverOperationParams,
  TransitionWorkspaceCutoverParams,
  WorkspaceCutoverOperation,
  WorkspaceCutoverState,
} from "./types.js";

const FORWARD: Record<WorkspaceCutoverState, WorkspaceCutoverState[]> = {
  inventoried: ["prepared", "failed"],
  prepared: ["write_frozen", "inventoried", "failed"],
  write_frozen: ["copied_or_adopted", "prepared", "failed"],
  copied_or_adopted: ["verified", "write_frozen", "failed"],
  verified: ["dual_read_verified", "copied_or_adopted", "failed"],
  dual_read_verified: ["resolver_write_cutover", "verified", "failed"],
  resolver_write_cutover: ["compatibility_read_only", "failed"],
  compatibility_read_only: ["retired", "failed"],
  retired: [],
  failed: [],
};

const TERMINAL: ReadonlySet<WorkspaceCutoverState> = new Set(["retired", "failed"]);

const PRE_CUTOVER: ReadonlySet<WorkspaceCutoverState> = new Set([
  "inventoried",
  "prepared",
  "write_frozen",
  "copied_or_adopted",
  "verified",
  "dual_read_verified",
]);

export function isTerminalCutoverState(state: WorkspaceCutoverState): boolean {
  return TERMINAL.has(state);
}

export function isPreResolverWriteCutover(state: WorkspaceCutoverState): boolean {
  return PRE_CUTOVER.has(state);
}

export function canTransitionCutoverState(
  from: WorkspaceCutoverState,
  to: WorkspaceCutoverState,
): boolean {
  if (from === to) {
    return true;
  }
  return FORWARD[from]?.includes(to) ?? false;
}

export function createWorkspaceCutoverOperation(
  params: CreateWorkspaceCutoverOperationParams,
): WorkspaceCutoverOperation {
  const nowMs = params.nowMs ?? Date.now();
  return {
    operationId: params.operationId,
    resourceId: params.resourceId,
    sourceBindingId: params.sourceBindingId,
    targetBindingId: params.targetBindingId,
    expectedContentVersion: params.expectedContentVersion,
    state: "inventoried",
    retryCount: 0,
    lastError: null,
    compatibilityReadDeadlineMs: null,
    compatibilityReadAuditCount: 0,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function transitionWorkspaceCutoverOperation(
  params: TransitionWorkspaceCutoverParams,
): WorkspaceCutoverOperation {
  const { operation, nextState } = params;
  if (isTerminalCutoverState(operation.state) && operation.state !== nextState) {
    throw new Error(`cutover operation ${operation.operationId} is terminal (${operation.state})`);
  }
  if (!canTransitionCutoverState(operation.state, nextState)) {
    throw new Error(
      `invalid cutover transition ${operation.state} -> ${nextState} for ${operation.operationId}`,
    );
  }
  const nowMs = params.nowMs ?? Date.now();
  return {
    ...operation,
    state: nextState,
    retryCount: params.bumpRetry ? operation.retryCount + 1 : operation.retryCount,
    lastError: params.lastError ?? (nextState === "failed" ? operation.lastError : null),
    updatedAtMs: nowMs,
  };
}

/** Idempotent resume: same-state transition is a no-op copy with fresh timestamp optional. */
export function resumeWorkspaceCutoverOperation(
  operation: WorkspaceCutoverOperation,
  nowMs?: number,
): WorkspaceCutoverOperation {
  if (isTerminalCutoverState(operation.state)) {
    return operation;
  }
  return {
    ...operation,
    updatedAtMs: nowMs ?? Date.now(),
  };
}

/**
 * Returns which binding may receive writes for this cutover phase.
 * Fail-closed: unknown binding ids are not writable.
 */
export function resolveCutoverWritableBindingId(
  operation: WorkspaceCutoverOperation,
): string | null {
  switch (operation.state) {
    case "inventoried":
    case "prepared":
      return operation.sourceBindingId;
    case "write_frozen":
    case "copied_or_adopted":
    case "verified":
    case "dual_read_verified":
      return null;
    case "resolver_write_cutover":
    case "compatibility_read_only":
      return operation.targetBindingId;
    case "retired":
    case "failed":
      return null;
  }
}

/** After cutover, legacy source root must not accept writes. */
export function isCutoverSourceWriteBlocked(operation: WorkspaceCutoverOperation): boolean {
  return (
    operation.state === "resolver_write_cutover" ||
    operation.state === "compatibility_read_only" ||
    operation.state === "retired"
  );
}

export function findActiveCutoverOperation(
  operations: WorkspaceCutoverOperation[] | undefined,
  resourceId: string,
): WorkspaceCutoverOperation | null {
  if (!operations?.length) {
    return null;
  }
  return (
    operations.find(
      (operation) =>
        operation.resourceId === resourceId && !isTerminalCutoverState(operation.state),
    ) ?? null
  );
}
