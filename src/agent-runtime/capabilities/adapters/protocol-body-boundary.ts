import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { streamSimple } from "@earendil-works/pi-ai/compat";
import {
  applyUserVisibleOutputGate,
  detectedToolNamesFromGate,
  PROTOCOL_FAILURE_USER_TEXT,
} from "../../../agents/model-output-boundary.js";
import {
  allocateModelResponseAttemptId,
  buildProtocolViolationFact,
  persistProtocolViolationFact,
  PROTOCOL_VIOLATION_STOP_REASON,
  type ProtocolBoundaryState,
} from "../../../agents/protocol-violation.js";
import { emitAgentEvent } from "../../../infra/agent-events.js";
import { normalizeToolCallNameForDispatch, isToolCallBlockType } from "../../model/index.js";

export type ProtocolBodyBoundaryResult =
  | { status: "none" }
  | { status: "stripped-mixed" }
  | { status: "terminated"; classification: string };

export type EnforceProtocolTextContext = {
  runId: string;
  attemptOrTurnId: string;
  sessionId?: string;
  agentId?: string;
  provider?: string;
  model?: string;
  allowedToolNames?: Set<string>;
  boundaryState?: ProtocolBoundaryState;
};

/**
 * Body protocol text is never promoted to executable tool calls.
 * Pure-body violations terminate with protocol_violation; mixed messages keep
 * adapter-normalized native calls and only strip/record the body markup.
 */
export function enforceProtocolTextNonExecutionInMessage(
  message: unknown,
  ctx?: EnforceProtocolTextContext,
): ProtocolBodyBoundaryResult {
  if (!message || typeof message !== "object") {
    return { status: "none" };
  }
  const typedMessage = message as {
    content?: unknown;
    stopReason?: unknown;
  };
  if (!Array.isArray(typedMessage.content)) {
    return { status: "none" };
  }
  const content = typedMessage.content as Array<Record<string, unknown>>;
  const hasNativeToolCall = content.some((block) => isToolCallBlockType(block?.type));

  const textBlocks = content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
  const gated = applyUserVisibleOutputGate(textBlocks);
  if (!gated.detected) {
    return { status: "none" };
  }

  const detectedNames = detectedToolNamesFromGate(gated);
  const allowed = ctx?.allowedToolNames;
  let classification:
    | "pure_body"
    | "mixed_native_and_body"
    | "incomplete_body"
    | "unknown_tool_name_in_body"
    | "no_tools_available" = hasNativeToolCall ? "mixed_native_and_body" : "pure_body";
  if (!hasNativeToolCall) {
    if (gated.incomplete) {
      classification = "incomplete_body";
    } else if (!allowed || allowed.size === 0) {
      classification = "no_tools_available";
    } else if (
      detectedNames.some((name) => !allowed.has(normalizeToolCallNameForDispatch(name, allowed)))
    ) {
      classification = "unknown_tool_name_in_body";
    }
  }

  const nonTextBlocks = content.filter((block) => block?.type !== "text");

  const recordFact = (
    terminated: boolean,
    displayOutcome: "failure_copy" | "stripped_partial" | "stripped_empty",
    nativeExecutionStatus: "none" | "requested",
  ) => {
    if (!ctx) {
      return;
    }
    const fact = buildProtocolViolationFact({
      runId: ctx.runId,
      attemptOrTurnId: ctx.attemptOrTurnId,
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      provider: ctx.provider,
      model: ctx.model,
      protocol: gated.protocol,
      classification,
      allowedToolNames: allowed ?? [],
      detectedToolNames: detectedNames,
      rawText: textBlocks,
      displayOutcome,
      nativeExecutionStatus,
      terminated,
    });
    persistProtocolViolationFact(fact);
    if (ctx.boundaryState) {
      ctx.boundaryState.lastFact = fact;
      if (terminated) {
        ctx.boundaryState.terminated = true;
      }
    }
    emitAgentEvent({
      runId: ctx.runId,
      stream: "lifecycle",
      data: {
        event: "protocol_violation",
        eventId: fact.eventId,
        classification: fact.classification,
        protocol: fact.protocol,
        terminated,
        nativeExecutionStatus: fact.nativeExecutionStatus,
        detectedToolNames: fact.detectedToolNames,
        ...(terminated ? { stopReason: PROTOCOL_VIOLATION_STOP_REASON } : {}),
      },
    });
  };

  if (hasNativeToolCall) {
    const visible = gated.visibleText.trim();
    typedMessage.content = [
      ...nonTextBlocks,
      ...(visible ? [{ type: "text", text: gated.visibleText }] : []),
    ];
    // Mixed: never pretreat native as executed; empty stripped body is stripped_empty
    // (not failure_copy — failure copy is only for pure-body terminate).
    recordFact(false, visible ? "stripped_partial" : "stripped_empty", "requested");
    return { status: "stripped-mixed" };
  }

  // Pure body: never synthesize toolCall; explicit failure + terminate (§4 / §7.1).
  typedMessage.content = [...nonTextBlocks, { type: "text", text: PROTOCOL_FAILURE_USER_TEXT }];
  typedMessage.stopReason = PROTOCOL_VIOLATION_STOP_REASON;
  recordFact(true, "failure_copy", "none");
  return { status: "terminated", classification };
}

function wrapStreamEnforceProtocolTextNonExecution(
  stream: ReturnType<typeof streamSimple>,
  ctx: EnforceProtocolTextContext,
): ReturnType<typeof streamSimple> {
  const originalResult = stream.result.bind(stream);
  stream.result = async () => {
    const message = await originalResult();
    enforceProtocolTextNonExecutionInMessage(message, ctx);
    return message;
  };
  return stream;
}

export function wrapStreamFnEnforceProtocolTextNonExecution(
  baseFn: StreamFn,
  ctx: EnforceProtocolTextContext,
): StreamFn {
  return (model, context, options) => {
    // One attemptOrTurnId per model-response stream invocation; multi-callback
    // within the same stream reuses it via the closed-over perResponseCtx.
    const attemptOrTurnId = ctx.boundaryState
      ? allocateModelResponseAttemptId(ctx.boundaryState)
      : ctx.attemptOrTurnId;
    const perResponseCtx: EnforceProtocolTextContext = { ...ctx, attemptOrTurnId };
    const maybeStream = baseFn(model, context, options);
    if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
      return Promise.resolve(maybeStream).then((stream) =>
        wrapStreamEnforceProtocolTextNonExecution(stream, perResponseCtx),
      );
    }
    return wrapStreamEnforceProtocolTextNonExecution(maybeStream, perResponseCtx);
  };
}
