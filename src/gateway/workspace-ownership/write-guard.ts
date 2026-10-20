import type { WorkspaceOwnerScope, WritableWorkspaceOwnerScope } from "./types.js";

export class WorkspaceOwnershipRejectedError extends Error {
  readonly code = "WORKSPACE_OWNERSHIP_UNKNOWN";

  constructor(readonly reason: string) {
    super(`workspace write rejected: ${reason}`);
    this.name = "WorkspaceOwnershipRejectedError";
  }
}

export function isWritableOwnerScope(
  scope: WorkspaceOwnerScope,
): scope is WritableWorkspaceOwnerScope {
  return scope.kind !== "unknown";
}

/**
 * Write callers must reject unknown ownership before filesystem resolution (P0-b).
 */
export function requireProvedOwnerScopeForWrite(
  scope: WorkspaceOwnerScope,
): asserts scope is WritableWorkspaceOwnerScope {
  if (scope.kind === "unknown") {
    throw new WorkspaceOwnershipRejectedError(scope.reason);
  }
}

/**
 * Handler adapter: resolve scope first, then fail closed before touching disk.
 */
export function gateWorkspaceWrite<T>(scope: WorkspaceOwnerScope, run: () => T): T {
  requireProvedOwnerScopeForWrite(scope);
  return run();
}
