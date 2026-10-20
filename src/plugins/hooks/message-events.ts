/**
 * Message-event family runners.
 *
 * Includes the synchronous `before_message_write` runner — that hook runs on
 * the hot path where session transcripts are appended synchronously.
 *
 * Family files MUST NOT import from each other; cross-family helpers go
 * through `./runner-shared.js`.
 */

import type { PluginRegistry } from "../registry.js";
import type {
  PluginHookBeforeMessageWriteEvent,
  PluginHookBeforeMessageWriteResult,
  PluginHookMessageContext,
  PluginHookMessageReceivedEvent,
  PluginHookMessageSendingEvent,
  PluginHookMessageSendingResult,
  PluginHookMessageSentEvent,
} from "../types.js";
import { getHooksForName, runModifyingHook, runVoidHook } from "./runner-shared.js";
import type { HookRunnerLogger } from "./runner-types.js";

interface MessageEventDeps {
  registry: PluginRegistry;
  catchErrors: boolean;
  logger?: HookRunnerLogger;
}

/**
 * Run message_received hook.
 * Runs in parallel (fire-and-forget).
 */
export function makeRunMessageReceived(deps: MessageEventDeps) {
  return async function runMessageReceived(
    event: PluginHookMessageReceivedEvent,
    ctx: PluginHookMessageContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "message_received" }, event, ctx);
  };
}

/**
 * Run message_sending hook.
 * Allows plugins to modify or cancel outgoing messages.
 * Runs sequentially.
 */
export function makeRunMessageSending(deps: MessageEventDeps) {
  return async function runMessageSending(
    event: PluginHookMessageSendingEvent,
    ctx: PluginHookMessageContext,
  ): Promise<PluginHookMessageSendingResult | undefined> {
    return runModifyingHook<"message_sending", PluginHookMessageSendingResult>(
      { ...deps, hookName: "message_sending" },
      event,
      ctx,
      (acc, next) => ({
        content: next.content ?? acc?.content,
        cancel: next.cancel ?? acc?.cancel,
      }),
    );
  };
}

/**
 * Run message_sent hook.
 * Runs in parallel (fire-and-forget).
 */
export function makeRunMessageSent(deps: MessageEventDeps) {
  return async function runMessageSent(
    event: PluginHookMessageSentEvent,
    ctx: PluginHookMessageContext,
  ): Promise<void> {
    return runVoidHook({ ...deps, hookName: "message_sent" }, event, ctx);
  };
}

/**
 * Run before_message_write hook.
 *
 * This hook is intentionally synchronous: it runs on the hot path where
 * session transcripts are appended synchronously.
 *
 * Handlers are executed sequentially in priority order (higher first).
 * If any handler returns { block: true }, the message is NOT written
 * to the session JSONL and we return immediately.
 * If a handler returns { message }, the modified message replaces the
 * original for subsequent handlers and the final write.
 */
export function makeRunBeforeMessageWrite(deps: MessageEventDeps) {
  return function runBeforeMessageWrite(
    event: PluginHookBeforeMessageWriteEvent,
    ctx: { agentId?: string; sessionKey?: string },
  ): PluginHookBeforeMessageWriteResult | undefined {
    const hooks = getHooksForName(deps.registry, "before_message_write");
    if (hooks.length === 0) {
      return undefined;
    }

    let current = event.message;

    for (const hook of hooks) {
      try {
        // oxlint-disable-next-line typescript/no-explicit-any
        const out = (hook.handler as any)({ ...event, message: current }, ctx) as
          | PluginHookBeforeMessageWriteResult
          | void
          | Promise<unknown>;

        // Guard against accidental async handlers (this hook is sync-only).
        // oxlint-disable-next-line typescript/no-explicit-any
        if (out && typeof (out as any).then === "function") {
          const msg =
            `[hooks] before_message_write handler from ${hook.pluginId} returned a Promise; ` +
            `this hook is synchronous and the result was ignored.`;
          if (deps.catchErrors) {
            deps.logger?.warn?.(msg);
            continue;
          }
          throw new Error(msg);
        }

        const result = out as PluginHookBeforeMessageWriteResult | undefined;

        // If any handler blocks, return immediately.
        if (result?.block) {
          return { block: true };
        }

        // If handler provided a modified message, use it for subsequent handlers.
        if (result?.message) {
          current = result.message;
        }
      } catch (err) {
        const msg = `[hooks] before_message_write handler from ${hook.pluginId} failed: ${String(err)}`;
        if (deps.catchErrors) {
          deps.logger?.error(msg);
        } else {
          throw new Error(msg, { cause: err });
        }
      }
    }

    // If message was modified by any handler, return it.
    if (current !== event.message) {
      return { message: current };
    }

    return undefined;
  };
}
