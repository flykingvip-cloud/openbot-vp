/**
 * Plugin Hook Runner — Public Types
 *
 * These are the types re-exported by the `src/plugins/hooks.ts` facade. They
 * are kept here, separate from the runner implementation, so that consumers
 * (and the per-family runner files) can depend on the type surface without
 * pulling in the implementation graph.
 *
 * The `HookRunner` type is defined as `ReturnType<typeof createHookRunner>`
 * via a type-only import. Type-only imports are fully erased at runtime, so
 * this does not create a runtime cycle with `runner.ts`.
 */

// Type-only import — erased at emit time, no runtime dependency on runner.ts.
import type { createHookRunner } from "./runner.js";

export type HookRunnerLogger = {
  debug?: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type HookRunnerOptions = {
  logger?: HookRunnerLogger;
  /** If true, errors in hooks will be caught and logged instead of thrown */
  catchErrors?: boolean;
};

/**
 * The aggregate hook runner produced by `createHookRunner`. Defined here so
 * that the facade and downstream consumers (e.g. `hook-runner-global.ts`) can
 * depend on a single canonical type without importing the runner factory.
 */
export type HookRunner = ReturnType<typeof createHookRunner>;
