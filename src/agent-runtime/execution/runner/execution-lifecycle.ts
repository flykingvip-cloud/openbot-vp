/**
 * @deprecated Removed in Phase 4. Use `createUnifiedExecutionLifecycle({ mode: "turn", runId, host })`.
 *
 * This factory was a thin wrapper around `createUnifiedExecutionLifecycle` since Phase 2.
 * It is now a tombstone that throws at call time to prove no caller remains.
 */
export function createExecutionLifecycle(..._args: unknown[]): never {
  throw new Error(
    "Removed: createExecutionLifecycle was retired in Phase 4. " +
      'Use createUnifiedExecutionLifecycle({ mode: "turn", runId, host }) instead.',
  );
}
