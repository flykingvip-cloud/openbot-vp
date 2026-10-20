/**
 * Shared helpers used by every per-family runner.
 *
 * Kept narrow on purpose — only the helpers that are consumed by two or more
 * family files live here. Family-specific merge functions live in their owning
 * family file.
 *
 * Family files MUST NOT import from each other (enforced by the
 * `hooks-event-family-isolation` architecture-manifest rule). Cross-family
 * primitives go through this module instead.
 */

import { concatOptionalTextSegments } from "../../shared/text/join-segments.js";
import type { PluginRegistry } from "../registry.js";
import type {
  PluginHookBeforeModelResolveResult,
  PluginHookBeforePromptBuildResult,
  PluginHookName,
  PluginHookRegistration,
} from "../types.js";
import type { HookRunnerLogger } from "./runner-types.js";

/**
 * Get hooks for a specific hook name, sorted by priority (higher first).
 */
export function getHooksForName<K extends PluginHookName>(
  registry: PluginRegistry,
  hookName: K,
): PluginHookRegistration<K>[] {
  return (registry.typedHooks as PluginHookRegistration<K>[])
    .filter((h) => h.hookName === hookName)
    .toSorted((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/**
 * Standard error-handling hook. Logs (when `catchErrors` is true) or rethrows
 * (when `catchErrors` is false). Returns `void` either way; rethrowing exits
 * by throwing.
 */
export function handleHookError(params: {
  hookName: PluginHookName;
  pluginId: string;
  error: unknown;
  catchErrors: boolean;
  logger?: HookRunnerLogger;
}): void {
  const msg = `[hooks] ${params.hookName} handler from ${params.pluginId} failed: ${String(
    params.error,
  )}`;
  if (params.catchErrors) {
    params.logger?.error(msg);
    return;
  }
  throw new Error(msg, { cause: params.error });
}

/**
 * Run a hook that doesn't return a value (fire-and-forget style).
 * All handlers are executed in parallel for performance.
 */
export async function runVoidHook<K extends PluginHookName>(
  params: {
    registry: PluginRegistry;
    hookName: K;
    catchErrors: boolean;
    logger?: HookRunnerLogger;
  },
  event: Parameters<NonNullable<PluginHookRegistration<K>["handler"]>>[0],
  ctx: Parameters<NonNullable<PluginHookRegistration<K>["handler"]>>[1],
): Promise<void> {
  const hooks = getHooksForName(params.registry, params.hookName);
  if (hooks.length === 0) {
    return;
  }

  params.logger?.debug?.(`[hooks] running ${params.hookName} (${hooks.length} handlers)`);

  const promises = hooks.map(async (hook) => {
    try {
      await (hook.handler as (event: unknown, ctx: unknown) => Promise<void>)(event, ctx);
    } catch (err) {
      handleHookError({
        hookName: params.hookName,
        pluginId: hook.pluginId,
        error: err,
        catchErrors: params.catchErrors,
        logger: params.logger,
      });
    }
  });

  await Promise.all(promises);
}

/**
 * Run a hook that can return a modifying result.
 * Handlers are executed sequentially in priority order, and results are merged.
 */
export async function runModifyingHook<K extends PluginHookName, TResult>(
  params: {
    registry: PluginRegistry;
    hookName: K;
    catchErrors: boolean;
    logger?: HookRunnerLogger;
  },
  event: Parameters<NonNullable<PluginHookRegistration<K>["handler"]>>[0],
  ctx: Parameters<NonNullable<PluginHookRegistration<K>["handler"]>>[1],
  mergeResults?: (accumulated: TResult | undefined, next: TResult) => TResult,
): Promise<TResult | undefined> {
  const hooks = getHooksForName(params.registry, params.hookName);
  if (hooks.length === 0) {
    return undefined;
  }

  params.logger?.debug?.(
    `[hooks] running ${params.hookName} (${hooks.length} handlers, sequential)`,
  );

  let result: TResult | undefined;

  for (const hook of hooks) {
    try {
      const handlerResult = await (
        hook.handler as (event: unknown, ctx: unknown) => Promise<TResult>
      )(event, ctx);

      if (handlerResult !== undefined && handlerResult !== null) {
        if (mergeResults && result !== undefined) {
          result = mergeResults(result, handlerResult);
        } else {
          result = handlerResult;
        }
      }
    } catch (err) {
      handleHookError({
        hookName: params.hookName,
        pluginId: hook.pluginId,
        error: err,
        catchErrors: params.catchErrors,
        logger: params.logger,
      });
    }
  }

  return result;
}

/**
 * Merge two `before_model_resolve` results — keep the first defined override
 * so higher-priority hooks win.
 */
export function mergeBeforeModelResolve(
  acc: PluginHookBeforeModelResolveResult | undefined,
  next: PluginHookBeforeModelResolveResult,
): PluginHookBeforeModelResolveResult {
  return {
    modelOverride: acc?.modelOverride ?? next.modelOverride,
    providerOverride: acc?.providerOverride ?? next.providerOverride,
  };
}

/**
 * Merge two `before_prompt_build` results — system prompts overwrite, prepend
 * / append context segments concatenate.
 */
export function mergeBeforePromptBuild(
  acc: PluginHookBeforePromptBuildResult | undefined,
  next: PluginHookBeforePromptBuildResult,
): PluginHookBeforePromptBuildResult {
  return {
    systemPrompt: next.systemPrompt ?? acc?.systemPrompt,
    prependContext: concatOptionalTextSegments({
      left: acc?.prependContext,
      right: next.prependContext,
    }),
    prependSystemContext: concatOptionalTextSegments({
      left: acc?.prependSystemContext,
      right: next.prependSystemContext,
    }),
    appendSystemContext: concatOptionalTextSegments({
      left: acc?.appendSystemContext,
      right: next.appendSystemContext,
    }),
  };
}
