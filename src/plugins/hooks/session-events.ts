/**
 * Session-event family runners.
 *
 * Family files MUST NOT import from each other; cross-family helpers go
 * through `./runner-shared.js`.
 */

import type { PluginRegistry } from "../registry.js";
import type {
  PluginHookSessionContext,
  PluginHookSessionEndEvent,
  PluginHookSessionStartEvent,
} from "../types.js";
import { runVoidHook } from "./runner-shared.js";
import type { HookRunnerLogger } from "./runner-types.js";

interface SessionEventDeps {
  registry: PluginRegistry;
  catchErrors: boolean;
  logger?: HookRunnerLogger;
}

/**
 * Run session_start hook.
 * Runs in parallel (fire-and-forget).
 */
export function makeRunSessionStart(deps: SessionEventDeps) {
  return async function runSessionStart(
    event: PluginHookSessionStartEvent,
    ctx: PluginHookSessionContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "session_start" }, event, ctx);
  };
}

/**
 * Run session_end hook.
 * Runs in parallel (fire-and-forget).
 */
export function makeRunSessionEnd(deps: SessionEventDeps) {
  return async function runSessionEnd(
    event: PluginHookSessionEndEvent,
    ctx: PluginHookSessionContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "session_end" }, event, ctx);
  };
}
