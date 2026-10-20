/**
 * P0-d durable one-writer workspace cutover state machine.
 */

export type WorkspaceCutoverState =
  | "inventoried"
  | "prepared"
  | "write_frozen"
  | "copied_or_adopted"
  | "verified"
  | "dual_read_verified"
  | "resolver_write_cutover"
  | "compatibility_read_only"
  | "retired";

const TRANSITIONS: Record<WorkspaceCutoverState, readonly WorkspaceCutoverState[]> = {
  inventoried: ["prepared"],
  prepared: ["write_frozen"],
  write_frozen: ["copied_or_adopted"],
  copied_or_adopted: ["verified"],
  verified: ["dual_read_verified"],
  dual_read_verified: ["resolver_write_cutover"],
  resolver_write_cutover: ["compatibility_read_only"],
  compatibility_read_only: ["retired"],
  retired: [],
};

export type WorkspaceCutoverOperation = {
  operationId: string;
  resourceId: string;
  sourceBindingId: string;
  targetBindingId: string;
  expectedContentVersion: string;
  state: WorkspaceCutoverState;
  retryCount: number;
  lastError: string | null;
  compatibilityExpiresAt: string | null;
  /** True after resolver_write_cutover — rollback must not restore old writer. */
  cutoverCommitted: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CutoverStore = {
  load(operationId: string): Promise<WorkspaceCutoverOperation | null>;
  save(operation: WorkspaceCutoverOperation): Promise<void>;
};

export function createMemoryCutoverStore(): CutoverStore {
  const map = new Map<string, WorkspaceCutoverOperation>();
  return {
    async load(operationId) {
      const value = map.get(operationId);
      return value ? { ...value } : null;
    },
    async save(operation) {
      map.set(operation.operationId, { ...operation });
    },
  };
}

export function canTransition(from: WorkspaceCutoverState, to: WorkspaceCutoverState): boolean {
  return TRANSITIONS[from].includes(to);
}

export async function advanceCutover(params: {
  store: CutoverStore;
  operationId: string;
  nextState: WorkspaceCutoverState;
  nowIso: string;
  error?: string | null;
}): Promise<WorkspaceCutoverOperation> {
  const current = await params.store.load(params.operationId);
  if (!current) {
    throw new Error("cutover_operation_not_found");
  }
  if (!canTransition(current.state, params.nextState)) {
    throw new Error(`invalid_cutover_transition:${current.state}->${params.nextState}`);
  }
  const next: WorkspaceCutoverOperation = {
    ...current,
    state: params.nextState,
    updatedAt: params.nowIso,
    lastError: params.error ?? null,
    retryCount: params.error ? current.retryCount + 1 : current.retryCount,
    cutoverCommitted: current.cutoverCommitted || params.nextState === "resolver_write_cutover",
  };
  await params.store.save(next);
  return next;
}

/**
 * Rollback policy:
 * - before cutover: restore original single writer (return to write_frozen/prepared caller-driven)
 * - after cutover: never restore old writable root; roll forward or restore target from snapshot
 */
export function resolveCutoverRollback(operation: WorkspaceCutoverOperation): {
  mode: "restore_original_writer" | "roll_forward_or_restore_target";
  allowOldWriter: boolean;
} {
  if (operation.cutoverCommitted || operation.state === "resolver_write_cutover") {
    return { mode: "roll_forward_or_restore_target", allowOldWriter: false };
  }
  if (operation.state === "compatibility_read_only" || operation.state === "retired") {
    return { mode: "roll_forward_or_restore_target", allowOldWriter: false };
  }
  return { mode: "restore_original_writer", allowOldWriter: true };
}

export function assertSingleWritableCanonical(bindings: Array<{ role: string; state: string }>) {
  const writers = bindings.filter((b) => b.role === "canonical" && b.state === "active");
  if (writers.length !== 1) {
    throw new Error(`expected_one_writable_canonical:got_${writers.length}`);
  }
}
