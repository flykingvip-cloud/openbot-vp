/**
 * @deprecated Removed in Phase 4. Use `createUnifiedExecutionLifecycle({ mode: "work_item", ports })`.
 *
 * This factory was a thin wrapper around `createUnifiedExecutionLifecycle` since Phase 2.
 * It is now a tombstone that throws at call time to prove no caller remains.
 *
 * Re-exported types remain available from unified-lifecycle.ts.
 */
export type {
  SupervisorWorkItemAdmission,
  SupervisorWorkItemLifecyclePorts,
} from "./unified-lifecycle.js";

export function createSupervisorWorkItemLifecycle(..._args: unknown[]): never {
  throw new Error(
    "Removed: createSupervisorWorkItemLifecycle was retired in Phase 4. " +
      'Use createUnifiedExecutionLifecycle({ mode: "work_item", ports }) instead.',
  );
}
