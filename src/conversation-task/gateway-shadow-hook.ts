/**
 * ConversationTask Runtime — P2.5 gateway bridge (admission §5 AC2/AC5; design §1.2).
 *
 * The CTR-owned single entry point the gateway calls, fire-and-forget, for every
 * authenticated inbound turn (mirroring the existing `message_received` hook). It
 * owns the module-singleton shadow runtime so the gateway wiring is a one-liner
 * that imports and calls `observeInboundTurnShadow(...)`.
 *
 * Channel-agnostic by construction: it takes a small normalized, server-derived
 * input (never the raw MsgContext and never client-supplied identity), so every
 * built-in and extension channel shares the exact same boundary. If the hook is
 * uninitialized it is a no-op (fail-safe), and it never throws into the caller.
 *
 * Wiring (applied by the reply-pipeline owner at the single choke point
 * `src/auto-reply/reply/dispatch-from-config.ts`, next to the message_received
 * fire-and-forget hooks):
 *
 *   import { observeInboundTurnShadow } from "../../conversation-task/gateway-shadow-hook.js";
 *   // ...after tenant/identity are resolved, before/around the existing hooks:
 *   observeInboundTurnShadow({
 *     tenantId: sourceContext.tenantId,                 // null for un-authenticated channel turns => skipped
 *     requesterId: ctx.GatewayClientPlatformUserId ?? sourceContext.userId ?? null,
 *     conversationId: ctx.SessionKey ?? null,
 *     employeeScopeAllowed: sourceContext.hasEnterpriseScope === true,
 *     messageId: ctx.MessageSid ?? ctx.MessageSidFirst ?? "",
 *     text: ctx.BodyForCommands ?? ctx.Body ?? "",
 *   });
 *
 * That call is synchronous, non-blocking, and never alters the reply.
 */

import {
  createShadowRuntime,
  type CreateShadowRuntimeOptions,
  type ShadowObserveStatus,
  type ShadowRuntime,
  type ShadowServerContext,
} from "./shadow-observer.js";
import type { TurnMode } from "./types.js";

/** Normalized, server-derived inbound turn. No raw MsgContext, no client identity. */
export type GatewayShadowInput = {
  /** Server-resolved tenant; `null`/absent => the observer skips (fail-closed). */
  tenantId: string | null | undefined;
  requesterId: string | null | undefined;
  /** Conversation id (= SessionKey). */
  conversationId: string | null | undefined;
  /** Server-side employee/workbench scope decision. */
  employeeScopeAllowed: boolean;
  messageId: string;
  text: string;
  /** Optional server-side visibility set; defaults to the single bound conversation. */
  authorizedConversationIds?: ReadonlySet<string>;
  /** Bounded prior-turn text (newest last), ACL-filtered to this conversation. */
  priorTurns?: readonly string[];
  hasActiveTaskBinding?: boolean;
  turnMode?: TurnMode;
};

let runtime: ShadowRuntime | null = null;

/** Initialize the module-singleton shadow runtime once. Idempotent (first call wins). */
export function initShadowHook(options: CreateShadowRuntimeOptions): void {
  if (runtime) {
    return;
  }
  runtime = createShadowRuntime(options);
}

/** True once `initShadowHook` has run. */
export function isShadowHookInitialized(): boolean {
  return runtime !== null;
}

/**
 * Observe one inbound turn in shadow mode. Synchronous, non-blocking, never throws.
 * Returns `"uninitialized"` when the hook has not been set up (a safe no-op), else the
 * observer's status. The actual shadow write happens asynchronously via the runner.
 */
export function observeInboundTurnShadow(
  input: GatewayShadowInput,
): ShadowObserveStatus | "uninitialized" {
  const rt = runtime;
  if (!rt) {
    return "uninitialized";
  }
  try {
    const conversationId = input.conversationId ?? "";
    const ctx: ShadowServerContext = {
      tenantId: input.tenantId,
      requesterId: input.requesterId,
      conversationId: input.conversationId,
      authorizedConversationIds:
        input.authorizedConversationIds ?? new Set(conversationId ? [conversationId] : []),
      employeeScopeAllowed: input.employeeScopeAllowed,
    };
    return rt.observer.observe(ctx, {
      messageId: input.messageId,
      text: input.text,
      ...(input.priorTurns != null ? { priorTurns: input.priorTurns } : undefined),
      ...(input.hasActiveTaskBinding != null
        ? { hasActiveTaskBinding: input.hasActiveTaskBinding }
        : undefined),
      ...(input.turnMode != null ? { turnMode: input.turnMode } : undefined),
    });
  } catch {
    // The bridge must never throw into the reply path.
    return "error";
  }
}

/** Graceful shutdown: drain the runner (bounded) and close per-tenant books. */
export async function shutdownShadowHook(capMs?: number): Promise<void> {
  const rt = runtime;
  runtime = null;
  if (rt) {
    await rt.shutdown(capMs);
  }
}

/** TEST-ONLY: reset the singleton between tests. */
export function resetShadowHookForTests(): void {
  runtime = null;
}
