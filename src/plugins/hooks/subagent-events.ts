/**
 * Subagent-event family runners.
 *
 * Family files MUST NOT import from each other; cross-family helpers go
 * through `./runner-shared.js`.
 */

import type { PluginRegistry } from "../registry.js";
import type {
  PluginHookSubagentContext,
  PluginHookSubagentDeliveryTargetEvent,
  PluginHookSubagentDeliveryTargetResult,
  PluginHookSubagentEndedEvent,
  PluginHookSubagentSpawnedEvent,
  PluginHookSubagentSpawningEvent,
  PluginHookSubagentSpawningResult,
} from "../types.js";
import { runModifyingHook, runVoidHook } from "./runner-shared.js";
import type { HookRunnerLogger } from "./runner-types.js";

interface SubagentEventDeps {
  registry: PluginRegistry;
  catchErrors: boolean;
  logger?: HookRunnerLogger;
}

/**
 * Merge two `subagent_spawning` results — error short-circuits, otherwise OR
 * the readiness flags.
 */
function mergeSubagentSpawningResult(
  acc: PluginHookSubagentSpawningResult | undefined,
  next: PluginHookSubagentSpawningResult,
): PluginHookSubagentSpawningResult {
  if (acc?.status === "error") {
    return acc;
  }
  if (next.status === "error") {
    return next;
  }
  return {
    status: "ok",
    threadBindingReady: Boolean(acc?.threadBindingReady || next.threadBindingReady),
  };
}

/**
 * Merge two `subagent_delivery_target` results — first hook with an `origin`
 * wins (priority order ensures determinism).
 */
function mergeSubagentDeliveryTargetResult(
  acc: PluginHookSubagentDeliveryTargetResult | undefined,
  next: PluginHookSubagentDeliveryTargetResult,
): PluginHookSubagentDeliveryTargetResult {
  if (acc?.origin) {
    return acc;
  }
  return next;
}

/**
 * Run subagent_spawning hook.
 * Runs sequentially so channel plugins can deterministically provision session bindings.
 */
export function makeRunSubagentSpawning(deps: SubagentEventDeps) {
  return async function runSubagentSpawning(
    event: PluginHookSubagentSpawningEvent,
    ctx: PluginHookSubagentContext,
  ): Promise<PluginHookSubagentSpawningResult | undefined> {
    return runModifyingHook<"subagent_spawning", PluginHookSubagentSpawningResult>(
      { ...deps, hookName: "subagent_spawning" },
      event,
      ctx,
      mergeSubagentSpawningResult,
    );
  };
}

/**
 * Run subagent_delivery_target hook.
 * Runs sequentially so channel plugins can deterministically resolve routing.
 */
export function makeRunSubagentDeliveryTarget(deps: SubagentEventDeps) {
  return async function runSubagentDeliveryTarget(
    event: PluginHookSubagentDeliveryTargetEvent,
    ctx: PluginHookSubagentContext,
  ): Promise<PluginHookSubagentDeliveryTargetResult | undefined> {
    return runModifyingHook<"subagent_delivery_target", PluginHookSubagentDeliveryTargetResult>(
      { ...deps, hookName: "subagent_delivery_target" },
      event,
      ctx,
      mergeSubagentDeliveryTargetResult,
    );
  };
}

/**
 * Run subagent_spawned hook.
 * Runs in parallel (fire-and-forget).
 */
export function makeRunSubagentSpawned(deps: SubagentEventDeps) {
  return async function runSubagentSpawned(
    event: PluginHookSubagentSpawnedEvent,
    ctx: PluginHookSubagentContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "subagent_spawned" }, event, ctx);
  };
}

/**
 * Run subagent_ended hook.
 * Runs in parallel (fire-and-forget).
 */
export function makeRunSubagentEnded(deps: SubagentEventDeps) {
  return async function runSubagentEnded(
    event: PluginHookSubagentEndedEvent,
    ctx: PluginHookSubagentContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "subagent_ended" }, event, ctx);
  };
}
