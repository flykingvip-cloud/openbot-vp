/**
 * Internal barrel for the `src/plugins/hooks/*` sub-modules.
 *
 * This file is for sub-module-internal convenience only. The public facade is
 * `src/plugins/hooks.ts`; consumers outside `src/plugins/hooks/**` should
 * import from there, not from this barrel.
 */

export { createHookRunner } from "./runner.js";
export type { HookRunner, HookRunnerLogger, HookRunnerOptions } from "./runner-types.js";
