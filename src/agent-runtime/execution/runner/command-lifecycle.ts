/**
 * @deprecated Removed in Phase 4. Use `createUnifiedExecutionLifecycle({ mode: "command", ...params })`.
 *
 * This factory was a thin wrapper around `createUnifiedExecutionLifecycle` since Phase 2.
 * It is now a tombstone that throws at call time to prove no caller remains.
 */
export function createCommandExecutionLifecycle(..._args: unknown[]): never {
  throw new Error(
    "Removed: createCommandExecutionLifecycle was retired in Phase 4. " +
      'Use createUnifiedExecutionLifecycle({ mode: "command", ...params }) instead.',
  );
}
