/**
 * Gateway-lifecycle family runners.
 *
 * Family files MUST NOT import from each other; cross-family helpers go
 * through `./runner-shared.js`.
 */

import type { PluginRegistry } from "../registry.js";
import type {
  PluginHookGatewayContext,
  PluginHookGatewayStartEvent,
  PluginHookGatewayStopEvent,
} from "../types.js";
import { runVoidHook } from "./runner-shared.js";
import type { HookRunnerLogger } from "./runner-types.js";

interface GatewayLifecycleEventDeps {
  registry: PluginRegistry;
  catchErrors: boolean;
  logger?: HookRunnerLogger;
}

/**
 * Run gateway_start hook.
 * Runs in parallel (fire-and-forget).
 */
export function makeRunGatewayStart(deps: GatewayLifecycleEventDeps) {
  return async function runGatewayStart(
    event: PluginHookGatewayStartEvent,
    ctx: PluginHookGatewayContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "gateway_start" }, event, ctx);
  };
}

/**
 * Run gateway_stop hook.
 * Runs in parallel (fire-and-forget).
 */
export function makeRunGatewayStop(deps: GatewayLifecycleEventDeps) {
  return async function runGatewayStop(
    event: PluginHookGatewayStopEvent,
    ctx: PluginHookGatewayContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "gateway_stop" }, event, ctx);
  };
}
