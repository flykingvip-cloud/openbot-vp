/**
 * Tool-event family runners.
 *
 * Includes the synchronous `tool_result_persist` runner — that hook runs on
 * the hot path where session transcripts are appended synchronously.
 *
 * Family files MUST NOT import from each other; cross-family helpers go
 * through `./runner-shared.js`.
 */

import type { PluginRegistry } from "../registry.js";
import type {
  PluginHookAfterToolCallEvent,
  PluginHookBeforeToolCallEvent,
  PluginHookBeforeToolCallResult,
  PluginHookToolContext,
  PluginHookToolResultPersistContext,
  PluginHookToolResultPersistEvent,
  PluginHookToolResultPersistResult,
} from "../types.js";
import { getHooksForName, runModifyingHook, runVoidHook } from "./runner-shared.js";
import type { HookRunnerLogger } from "./runner-types.js";

interface ToolEventDeps {
  registry: PluginRegistry;
  catchErrors: boolean;
  logger?: HookRunnerLogger;
}

/**
 * Run before_tool_call hook.
 * Allows plugins to modify or block tool calls.
 * Runs sequentially.
 */
export function makeRunBeforeToolCall(deps: ToolEventDeps) {
  return async function runBeforeToolCall(
    event: PluginHookBeforeToolCallEvent,
    ctx: PluginHookToolContext,
  ): Promise<PluginHookBeforeToolCallResult | undefined> {
    return runModifyingHook<"before_tool_call", PluginHookBeforeToolCallResult>(
      { ...deps, hookName: "before_tool_call" },
      event,
      ctx,
      (acc, next) => ({
        params: next.params ?? acc?.params,
        block: next.block ?? acc?.block,
        blockReason: next.blockReason ?? acc?.blockReason,
      }),
    );
  };
}

/**
 * Run after_tool_call hook.
 * Runs in parallel (fire-and-forget).
 */
export function makeRunAfterToolCall(deps: ToolEventDeps) {
  return async function runAfterToolCall(
    event: PluginHookAfterToolCallEvent,
    ctx: PluginHookToolContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "after_tool_call" }, event, ctx);
  };
}

/**
 * Run tool_result_persist hook.
 *
 * This hook is intentionally synchronous: it runs in hot paths where session
 * transcripts are appended synchronously.
 *
 * Handlers are executed sequentially in priority order (higher first). Each
 * handler may return `{ message }` to replace the message passed to the next
 * handler.
 */
export function makeRunToolResultPersist(deps: ToolEventDeps) {
  return function runToolResultPersist(
    event: PluginHookToolResultPersistEvent,
    ctx: PluginHookToolResultPersistContext,
  ): PluginHookToolResultPersistResult | undefined {
    const hooks = getHooksForName(deps.registry, "tool_result_persist");
    if (hooks.length === 0) {
      return undefined;
    }

    let current = event.message;

    for (const hook of hooks) {
      try {
        // oxlint-disable-next-line typescript/no-explicit-any
        const out = (hook.handler as any)({ ...event, message: current }, ctx) as
          | PluginHookToolResultPersistResult
          | void
          | Promise<unknown>;

        // Guard against accidental async handlers (this hook is sync-only).
        // oxlint-disable-next-line typescript/no-explicit-any
        if (out && typeof (out as any).then === "function") {
          const msg =
            `[hooks] tool_result_persist handler from ${hook.pluginId} returned a Promise; ` +
            `this hook is synchronous and the result was ignored.`;
          if (deps.catchErrors) {
            deps.logger?.warn?.(msg);
            continue;
          }
          throw new Error(msg);
        }

        const next = (out as PluginHookToolResultPersistResult | undefined)?.message;
        if (next) {
          current = next;
        }
      } catch (err) {
        const msg = `[hooks] tool_result_persist handler from ${hook.pluginId} failed: ${String(err)}`;
        if (deps.catchErrors) {
          deps.logger?.error(msg);
        } else {
          throw new Error(msg, { cause: err });
        }
      }
    }

    return { message: current };
  };
}
