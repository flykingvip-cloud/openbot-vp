import type { TaskActionBoundary } from "../../agent-runtime/contracts/task.js";
import { checkTaskActionBoundary } from "../../agent-runtime/state/index.js";
import type { TypingCallbacks } from "../../channels/typing.js";
import type { HumanDelayConfig } from "../../config/types.js";
import { sleep } from "../../utils.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import { registerDispatcher } from "./dispatcher-registry.js";
import { normalizeReplyPayload, type NormalizeReplySkipReason } from "./normalize-reply.js";
import type { ResponsePrefixContext } from "./response-prefix-template.js";
import type { TypingController } from "./typing.js";

export type ReplyDeliveryContext = { taskBoundary?: TaskActionBoundary };

export type ReplyDispatchKind = "tool" | "block" | "final";

type ReplyDispatchErrorHandler = (err: unknown, info: { kind: ReplyDispatchKind }) => void;

type ReplyDispatchSkipHandler = (
  payload: ReplyPayload,
  info: { kind: ReplyDispatchKind; reason: NormalizeReplySkipReason },
) => void;

type ReplyDispatchDeliverer = (
  payload: ReplyPayload,
  info: { kind: ReplyDispatchKind } & ReplyDeliveryContext,
) => Promise<void>;

/** R85e: outcome of one completed deliver() (success or throw). */
export type ReplyDeliveryOutcome = {
  kind: ReplyDispatchKind;
  ok: boolean;
  error?: string;
};

type ReplyDeliveryResultHandler = (outcome: ReplyDeliveryOutcome) => void | Promise<void>;

const DEFAULT_HUMAN_DELAY_MIN_MS = 800;
const DEFAULT_HUMAN_DELAY_MAX_MS = 2500;

/** Generate a random delay within the configured range. */
function getHumanDelay(config: HumanDelayConfig | undefined): number {
  const mode = config?.mode ?? "off";
  if (mode === "off") {
    return 0;
  }
  const min =
    mode === "custom" ? (config?.minMs ?? DEFAULT_HUMAN_DELAY_MIN_MS) : DEFAULT_HUMAN_DELAY_MIN_MS;
  const max =
    mode === "custom" ? (config?.maxMs ?? DEFAULT_HUMAN_DELAY_MAX_MS) : DEFAULT_HUMAN_DELAY_MAX_MS;
  if (max <= min) {
    return min;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export type ReplyDispatcherOptions = {
  deliver: ReplyDispatchDeliverer;
  responsePrefix?: string;
  /** Static context for response prefix template interpolation. */
  responsePrefixContext?: ResponsePrefixContext;
  /** Dynamic context provider for response prefix template interpolation.
   * Called at normalization time, after model selection is complete. */
  responsePrefixContextProvider?: () => ResponsePrefixContext;
  onHeartbeatStrip?: () => void;
  onIdle?: () => void;
  onError?: ReplyDispatchErrorHandler;
  // AIDEV-NOTE: onSkip lets channels detect silent/empty drops (e.g. Telegram empty-response fallback).
  onSkip?: ReplyDispatchSkipHandler;
  /**
   * R85e: called after each deliver() settles (ok or throw).
   * Use this (or getDeliveryOutcomes) to confirm TaskOutcome — enqueue is not a receipt.
   */
  onDeliveryResult?: ReplyDeliveryResultHandler;
  /** Human-like delay between block replies for natural rhythm. */
  humanDelay?: HumanDelayConfig;
};

export type ReplyDispatcherWithTypingOptions = Omit<ReplyDispatcherOptions, "onIdle"> & {
  typingCallbacks?: TypingCallbacks;
  onReplyStart?: () => Promise<void> | void;
  onIdle?: () => void;
  /** Called when the typing controller is cleaned up (e.g., on NO_REPLY). */
  onCleanup?: () => void;
};

type ReplyDispatcherWithTypingResult = {
  dispatcher: ReplyDispatcher;
  replyOptions: Pick<GetReplyOptions, "onReplyStart" | "onTypingController" | "onTypingCleanup">;
  markDispatchIdle: () => void;
  /** Signal that the model run is complete so the typing controller can stop. */
  markRunComplete: () => void;
};

export type ReplyDispatcher = {
  sendToolResult: (payload: ReplyPayload, context?: ReplyDeliveryContext) => boolean;
  sendBlockReply: (payload: ReplyPayload, context?: ReplyDeliveryContext) => boolean;
  sendFinalReply: (payload: ReplyPayload, context?: ReplyDeliveryContext) => boolean;
  waitForIdle: () => Promise<void>;
  getQueuedCounts: () => Record<ReplyDispatchKind, number>;
  markComplete: () => void;
  /** R85e: settled deliver() outcomes in enqueue order (tool/block/final). */
  getDeliveryOutcomes?: () => readonly ReplyDeliveryOutcome[];
};

type NormalizeReplyPayloadInternalOptions = Pick<
  ReplyDispatcherOptions,
  "responsePrefix" | "responsePrefixContext" | "responsePrefixContextProvider" | "onHeartbeatStrip"
> & {
  onSkip?: (reason: NormalizeReplySkipReason) => void;
};

function normalizeReplyPayloadInternal(
  payload: ReplyPayload,
  opts: NormalizeReplyPayloadInternalOptions,
): ReplyPayload | null {
  // Prefer dynamic context provider over static context
  const prefixContext = opts.responsePrefixContextProvider?.() ?? opts.responsePrefixContext;

  return normalizeReplyPayload(payload, {
    responsePrefix: opts.responsePrefix,
    responsePrefixContext: prefixContext,
    onHeartbeatStrip: opts.onHeartbeatStrip,
    onSkip: opts.onSkip,
  });
}

export function createReplyDispatcher(options: ReplyDispatcherOptions): ReplyDispatcher {
  let sendChain: Promise<void> = Promise.resolve();
  // Track in-flight deliveries so we can emit a reliable "idle" signal.
  // Start with pending=1 as a "reservation" to prevent premature gateway restart.
  // This is decremented when markComplete() is called to signal no more replies will come.
  let pending = 1;
  let completeCalled = false;
  // Track whether we've sent a block reply (for human delay - skip delay on first block).
  let sentFirstBlock = false;
  // Serialize outbound replies to preserve tool/block/final order.
  const queuedCounts: Record<ReplyDispatchKind, number> = {
    tool: 0,
    block: 0,
    final: 0,
  };
  // R85e: record actual deliver() settlements (enqueue alone is not a receipt).
  const deliveryOutcomes: ReplyDeliveryOutcome[] = [];

  // Register this dispatcher globally for gateway restart coordination.
  const { unregister } = registerDispatcher({
    pending: () => pending,
    waitForIdle: () => sendChain,
  });

  const enqueue = (
    kind: ReplyDispatchKind,
    payload: ReplyPayload,
    context?: ReplyDeliveryContext,
  ) => {
    // Queue the captured identity, never a mutable reference to a later task.
    const boundary = context?.taskBoundary;
    const deliveryContext: ReplyDeliveryContext | undefined = boundary
      ? {
          taskBoundary: {
            sessionFile: boundary.sessionFile,
            binding: {
              ...boundary.binding,
              ...(boundary.binding.constraints
                ? { constraints: [...boundary.binding.constraints] }
                : {}),
            },
            constraints: [...boundary.constraints],
          },
        }
      : undefined;
    const normalized = normalizeReplyPayloadInternal(payload, {
      responsePrefix: options.responsePrefix,
      responsePrefixContext: options.responsePrefixContext,
      responsePrefixContextProvider: options.responsePrefixContextProvider,
      onHeartbeatStrip: options.onHeartbeatStrip,
      onSkip: (reason) => options.onSkip?.(payload, { kind, reason }),
    });
    if (!normalized) {
      return false;
    }
    queuedCounts[kind] += 1;
    pending += 1;

    // Determine if we should add human-like delay (only for block replies after the first).
    const shouldDelay = kind === "block" && sentFirstBlock;
    if (kind === "block") {
      sentFirstBlock = true;
    }

    sendChain = sendChain
      .then(async () => {
        // Add human-like delay between block replies for natural rhythm.
        if (shouldDelay) {
          const delayMs = getHumanDelay(options.humanDelay);
          if (delayMs > 0) {
            await sleep(delayMs);
          }
        }
        // Safe: deliver is called inside an async .then() callback, so even a synchronous
        // throw becomes a rejection that flows through .catch()/.finally(), ensuring cleanup.
        if (deliveryContext?.taskBoundary) {
          const refusal = checkTaskActionBoundary(deliveryContext.taskBoundary);
          if (refusal) {
            throw new Error(refusal);
          }
        }
        await options.deliver(normalized, { kind, ...deliveryContext });
        const outcome: ReplyDeliveryOutcome = { kind, ok: true };
        deliveryOutcomes.push(outcome);
        try {
          await options.onDeliveryResult?.(outcome);
        } catch {
          // delivery-result side effects must not fail the send chain
        }
      })
      .catch(async (err) => {
        const error = err instanceof Error ? err.message : String(err);
        const outcome: ReplyDeliveryOutcome = { kind, ok: false, error };
        deliveryOutcomes.push(outcome);
        options.onError?.(err, { kind });
        try {
          await options.onDeliveryResult?.(outcome);
        } catch {
          // delivery-result side effects must not break dispatcher cleanup
        }
      })
      .finally(() => {
        pending -= 1;
        // Clear reservation if:
        // 1. pending is now 1 (just the reservation left)
        // 2. markComplete has been called
        // 3. No more replies will be enqueued
        if (pending === 1 && completeCalled) {
          pending -= 1; // Clear the reservation
        }
        if (pending === 0) {
          // Unregister from global tracking when idle.
          unregister();
          options.onIdle?.();
        }
      });
    return true;
  };

  const markComplete = () => {
    if (completeCalled) {
      return;
    }
    completeCalled = true;
    // If no replies were enqueued (pending is still 1 = just the reservation),
    // schedule clearing the reservation after current microtasks complete.
    // This gives any in-flight enqueue() calls a chance to increment pending.
    void Promise.resolve().then(() => {
      if (pending === 1 && completeCalled) {
        // Still just the reservation, no replies were enqueued
        pending -= 1;
        if (pending === 0) {
          unregister();
          options.onIdle?.();
        }
      }
    });
  };

  return {
    sendToolResult: (payload, context) => enqueue("tool", payload, context),
    sendBlockReply: (payload, context) => enqueue("block", payload, context),
    sendFinalReply: (payload, context) => enqueue("final", payload, context),
    waitForIdle: () => sendChain,
    getQueuedCounts: () => ({ ...queuedCounts }),
    markComplete,
    getDeliveryOutcomes: () => deliveryOutcomes.slice(),
  };
}

export function createReplyDispatcherWithTyping(
  options: ReplyDispatcherWithTypingOptions,
): ReplyDispatcherWithTypingResult {
  const { typingCallbacks, onReplyStart, onIdle, onCleanup, ...dispatcherOptions } = options;
  const resolvedOnReplyStart = onReplyStart ?? typingCallbacks?.onReplyStart;
  const resolvedOnIdle = onIdle ?? typingCallbacks?.onIdle;
  const resolvedOnCleanup = onCleanup ?? typingCallbacks?.onCleanup;
  let typingController: TypingController | undefined;
  const dispatcher = createReplyDispatcher({
    ...dispatcherOptions,
    onIdle: () => {
      typingController?.markDispatchIdle();
      resolvedOnIdle?.();
    },
  });

  return {
    dispatcher,
    replyOptions: {
      onReplyStart: resolvedOnReplyStart,
      onTypingCleanup: resolvedOnCleanup,
      onTypingController: (typing) => {
        typingController = typing;
      },
    },
    markDispatchIdle: () => {
      typingController?.markDispatchIdle();
      resolvedOnIdle?.();
    },
    markRunComplete: () => {
      typingController?.markRunComplete();
    },
  };
}
