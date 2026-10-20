import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { parseReplyDirectives } from "../auto-reply/reply/reply-directives.js";
import { SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import { emitAgentEvent } from "../infra/agent-events.js";
import { createInlineCodeState } from "../markdown/code-spans.js";
import { stripAssistantScratchpadFromContent } from "../shared/text/assistant-scratchpad.js";
import { getRunReplyLanguage } from "../shared/text/run-reply-language.js";
import { visibleReplyNeedsChineseRewrite } from "../shared/text/visible-reply-language.js";
import { latestUserText } from "./execution-stall-continue.js";
import {
  applyUserVisibleOutputGate,
  PROTOCOL_FAILURE_USER_TEXT,
  stripProtocolTextFromAssistantContent,
} from "./model-output-boundary.js";
import {
  isMessagingToolDuplicateNormalized,
  normalizeTextForComparison,
} from "./pi-embedded-helpers.js";
import type { EmbeddedPiSubscribeContext } from "./pi-embedded-subscribe.handlers.types.js";
import { appendRawStream } from "./pi-embedded-subscribe.raw-stream.js";
import {
  extractAssistantText,
  extractAssistantThinking,
  extractThinkingFromTaggedStream,
  extractThinkingFromTaggedText,
  formatReasoningMessage,
  promoteThinkingTagsToBlocks,
} from "./pi-embedded-utils.js";

const stripTrailingDirective = (text: string): string => {
  const openIndex = text.lastIndexOf("[[");
  if (openIndex < 0) {
    if (text.endsWith("[")) {
      return text.slice(0, -1);
    }
    return text;
  }
  const closeIndex = text.indexOf("]]", openIndex + 2);
  if (closeIndex >= 0) {
    return text;
  }
  return text.slice(0, openIndex);
};

function emitReasoningEnd(ctx: EmbeddedPiSubscribeContext) {
  if (!ctx.state.reasoningStreamOpen) {
    return;
  }
  ctx.state.reasoningStreamOpen = false;
  void ctx.params.onReasoningEnd?.();
}

export function resolveSilentReplyFallbackText(params: {
  text: string;
  messagingToolSentTexts: string[];
}): string {
  const trimmed = params.text.trim();
  if (trimmed !== SILENT_REPLY_TOKEN) {
    return params.text;
  }
  const fallback = params.messagingToolSentTexts.at(-1)?.trim();
  if (!fallback) {
    return params.text;
  }
  return fallback;
}

export function handleMessageStart(
  ctx: EmbeddedPiSubscribeContext,
  evt: AgentEvent & { message: AgentMessage },
) {
  const msg = evt.message;
  if (msg?.role !== "assistant") {
    return;
  }

  // KNOWN: Resetting at `text_end` is unsafe (late/duplicate end events).
  // ASSUME: `message_start` is the only reliable boundary for “new assistant message begins”.
  // Start-of-message is a safer reset point than message_end: some providers
  // may deliver late text_end updates after message_end, which would otherwise
  // re-trigger block replies.
  ctx.resetAssistantMessageState(ctx.state.assistantTexts.length);
  // Use assistant message_start as the earliest "writing" signal for typing.
  void ctx.params.onAssistantMessageStart?.();
}

export function handleMessageUpdate(
  ctx: EmbeddedPiSubscribeContext,
  evt: AgentEvent & { message: AgentMessage; assistantMessageEvent?: unknown },
) {
  const msg = evt.message;
  if (msg?.role !== "assistant") {
    return;
  }

  ctx.noteLastAssistant(msg);
  if (ctx.state.deterministicApprovalPromptSent) {
    return;
  }

  const assistantEvent = evt.assistantMessageEvent;
  const assistantRecord =
    assistantEvent && typeof assistantEvent === "object"
      ? (assistantEvent as Record<string, unknown>)
      : undefined;
  const evtType = typeof assistantRecord?.type === "string" ? assistantRecord.type : "";

  if (evtType === "thinking_start" || evtType === "thinking_delta" || evtType === "thinking_end") {
    if (evtType === "thinking_start" || evtType === "thinking_delta") {
      ctx.state.reasoningStreamOpen = true;
    }
    const thinkingDelta = typeof assistantRecord?.delta === "string" ? assistantRecord.delta : "";
    const thinkingContent =
      typeof assistantRecord?.content === "string" ? assistantRecord.content : "";
    appendRawStream({
      ts: Date.now(),
      event: "assistant_thinking_stream",
      runId: ctx.params.runId,
      sessionId: (ctx.params.session as { id?: string }).id,
      evtType,
      delta: thinkingDelta,
      content: thinkingContent,
    });
    if (ctx.state.streamReasoning) {
      // Prefer full partial-message thinking when available; fall back to event payloads.
      const partialThinking = extractAssistantThinking(msg);
      ctx.emitReasoningStream(partialThinking || thinkingContent || thinkingDelta);
    }
    if (evtType === "thinking_end") {
      if (!ctx.state.reasoningStreamOpen) {
        ctx.state.reasoningStreamOpen = true;
      }
      emitReasoningEnd(ctx);
    }
    return;
  }

  if (evtType !== "text_delta" && evtType !== "text_start" && evtType !== "text_end") {
    return;
  }

  const delta = typeof assistantRecord?.delta === "string" ? assistantRecord.delta : "";
  const content = typeof assistantRecord?.content === "string" ? assistantRecord.content : "";

  appendRawStream({
    ts: Date.now(),
    event: "assistant_text_stream",
    runId: ctx.params.runId,
    sessionId: (ctx.params.session as { id?: string }).id,
    evtType,
    delta,
    content,
  });

  let chunk = "";
  if (evtType === "text_delta") {
    chunk = delta;
  } else if (evtType === "text_start" || evtType === "text_end") {
    if (delta) {
      chunk = delta;
    } else if (content) {
      // KNOWN: Some providers resend full content on `text_end`.
      // We only append a suffix (or nothing) to keep output monotonic.
      if (content.startsWith(ctx.state.deltaBuffer)) {
        chunk = content.slice(ctx.state.deltaBuffer.length);
      } else if (ctx.state.deltaBuffer.startsWith(content)) {
        chunk = "";
      } else if (!ctx.state.deltaBuffer.includes(content)) {
        chunk = content;
      }
    }
  }

  if (chunk) {
    ctx.state.deltaBuffer += chunk;
    if (ctx.blockChunker) {
      ctx.blockChunker.append(chunk);
    } else {
      ctx.state.blockBuffer += chunk;
    }
  }

  if (ctx.state.streamReasoning) {
    // Handle partial <think> tags: stream whatever reasoning is visible so far.
    ctx.emitReasoningStream(extractThinkingFromTaggedStream(ctx.state.deltaBuffer));
  }

  const gated = applyUserVisibleOutputGate(
    ctx.stripBlockTags(ctx.state.deltaBuffer, {
      thinking: false,
      final: false,
      inlineCode: createInlineCodeState(),
    }),
    { streaming: true },
  );
  ctx.state.protocolHold = gated.incomplete;
  const next = gated.visibleText.trim();
  if (next) {
    const wasThinking = ctx.state.partialBlockState.thinking;
    const visibleDelta = chunk ? ctx.stripBlockTags(chunk, ctx.state.partialBlockState) : "";
    if (!wasThinking && ctx.state.partialBlockState.thinking) {
      ctx.state.reasoningStreamOpen = true;
    }
    // Detect when thinking block ends (</think> tag processed)
    if (wasThinking && !ctx.state.partialBlockState.thinking) {
      emitReasoningEnd(ctx);
    }
    const parsedDelta = visibleDelta ? ctx.consumePartialReplyDirectives(visibleDelta) : null;
    const parsedFull = parseReplyDirectives(stripTrailingDirective(next), {
      expectedLanguage: getRunReplyLanguage(ctx.params.runId),
      planSpeakContext: latestUserText(ctx.params.session.messages),
    });
    const cleanedText = parsedFull.text;
    const mediaUrls = parsedDelta?.mediaUrls;
    const hasMedia = Boolean(mediaUrls && mediaUrls.length > 0);
    const hasAudio = Boolean(parsedDelta?.audioAsVoice);
    const previousCleaned = ctx.state.lastStreamedAssistantCleaned ?? "";

    let shouldEmit = false;
    let deltaText = "";
    let emitText = cleanedText;
    if (!cleanedText && !hasMedia && !hasAudio) {
      // Retract a partial bubble once the snapshot is only scratchpad.
      shouldEmit = Boolean(previousCleaned);
      deltaText = "";
      emitText = next;
    } else if (previousCleaned && !cleanedText.startsWith(previousCleaned)) {
      // Preamble drop or protocol strip can shrink the snapshot. Emit the
      // shorter text so the live bubble replaces instead of concatenating.
      shouldEmit = true;
      deltaText = "";
    } else {
      deltaText = cleanedText.slice(previousCleaned.length);
      shouldEmit = Boolean(deltaText || hasMedia || hasAudio);
    }

    ctx.state.lastStreamedAssistant = next;
    ctx.state.lastStreamedAssistantCleaned = cleanedText;

    if (shouldEmit) {
      emitAgentEvent({
        runId: ctx.params.runId,
        stream: "assistant",
        data: {
          text: emitText,
          delta: deltaText,
          mediaUrls: hasMedia ? mediaUrls : undefined,
        },
      });
      void ctx.params.onAgentEvent?.({
        stream: "assistant",
        data: {
          text: emitText,
          delta: deltaText,
          mediaUrls: hasMedia ? mediaUrls : undefined,
        },
      });
      ctx.state.emittedAssistantUpdate = true;
      if (ctx.params.onPartialReply && ctx.state.shouldEmitPartialReplies && cleanedText) {
        void ctx.params.onPartialReply({
          text: cleanedText,
          mediaUrls: hasMedia ? mediaUrls : undefined,
        });
      }
    }
  }

  if (ctx.params.onBlockReply && ctx.blockChunking && ctx.state.blockReplyBreak === "text_end") {
    ctx.blockChunker?.drain({ force: false, emit: ctx.emitBlockChunk });
  }

  if (evtType === "text_end" && ctx.state.blockReplyBreak === "text_end") {
    ctx.flushBlockReplyBuffer();
  }
}

export function handleMessageEnd(
  ctx: EmbeddedPiSubscribeContext,
  evt: AgentEvent & { message: AgentMessage },
) {
  const msg = evt.message;
  if (msg?.role !== "assistant") {
    return;
  }

  const assistantMessage = msg;
  ctx.noteLastAssistant(assistantMessage);
  ctx.recordAssistantUsage((assistantMessage as { usage?: unknown }).usage);
  if (ctx.state.deterministicApprovalPromptSent) {
    return;
  }
  promoteThinkingTagsToBlocks(assistantMessage);

  const originalTextBlocks = Array.isArray(assistantMessage.content)
    ? assistantMessage.content
        .map((block) => {
          if (!block || typeof block !== "object") {
            return "";
          }
          const rec = block as { type?: unknown; text?: unknown };
          return rec.type === "text" && typeof rec.text === "string" ? rec.text : "";
        })
        .filter(Boolean)
        .join("\n")
    : "";
  const protocolGate = applyUserVisibleOutputGate(originalTextBlocks);
  if (protocolGate.detected) {
    const nextContent = stripProtocolTextFromAssistantContent(assistantMessage.content);
    if (Array.isArray(nextContent)) {
      const blocks = nextContent as typeof assistantMessage.content;
      const hasVisibleText = blocks.some((block) => {
        if (!block || typeof block !== "object") {
          return false;
        }
        const rec = block as { type?: unknown; text?: unknown };
        return rec.type === "text" && typeof rec.text === "string" && rec.text.trim().length > 0;
      });
      if (!hasVisibleText) {
        assistantMessage.content = [
          { type: "text", text: PROTOCOL_FAILURE_USER_TEXT },
        ] as typeof assistantMessage.content;
      } else {
        assistantMessage.content = blocks;
      }
    }
    emitAgentEvent({
      runId: ctx.params.runId,
      stream: "lifecycle",
      data: {
        event: "protocol_text_detected",
        protocol: protocolGate.protocol,
        hiddenFromUser: true,
        recoveredCallCount: protocolGate.recoveredCalls.length,
        incomplete: protocolGate.incomplete,
      },
    });
    void ctx.params.onAgentEvent?.({
      stream: "lifecycle",
      data: {
        event: "protocol_text_detected",
        protocol: protocolGate.protocol,
        hiddenFromUser: true,
        recoveredCallCount: protocolGate.recoveredCalls.length,
        incomplete: protocolGate.incomplete,
      },
    });
  }

  // Persist-path choke: strip CoT/scratchpad from content before transcript/history.
  const replyLanguage = getRunReplyLanguage(ctx.params.runId);
  const scratchpadCleaned = stripAssistantScratchpadFromContent(
    assistantMessage.content,
    replyLanguage,
  );
  if (scratchpadCleaned !== assistantMessage.content) {
    assistantMessage.content = scratchpadCleaned as typeof assistantMessage.content;
  }

  const rawText = extractAssistantText(assistantMessage);
  appendRawStream({
    ts: Date.now(),
    event: "assistant_message_end",
    runId: ctx.params.runId,
    sessionId: (ctx.params.session as { id?: string }).id,
    rawText,
    rawThinking: extractAssistantThinking(assistantMessage),
  });

  const text = resolveSilentReplyFallbackText({
    text: ctx.stripBlockTags(rawText, { thinking: false, final: false }),
    messagingToolSentTexts: ctx.state.messagingToolSentTexts,
  });
  const rawThinking =
    ctx.state.includeReasoning || ctx.state.streamReasoning
      ? extractAssistantThinking(assistantMessage) || extractThinkingFromTaggedText(rawText)
      : "";
  const formattedReasoning = rawThinking ? formatReasoningMessage(rawThinking) : "";
  const trimmedText = text.trim();
  const parsedText = trimmedText
    ? parseReplyDirectives(stripTrailingDirective(trimmedText), {
        expectedLanguage: getRunReplyLanguage(ctx.params.runId),
        planSpeakContext: latestUserText(ctx.params.session.messages),
      })
    : null;
  let cleanedText = parsedText?.text ?? "";
  let mediaUrls = parsedText?.mediaUrls;
  let hasMedia = Boolean(mediaUrls && mediaUrls.length > 0);

  if (!cleanedText && protocolGate.detected) {
    cleanedText = PROTOCOL_FAILURE_USER_TEXT;
  }

  if (!cleanedText && !hasMedia && !ctx.params.enforceFinalTag && !protocolGate.detected) {
    const rawTrimmed = rawText.trim();
    const rawStrippedFinal = rawTrimmed.replace(/<\s*\/?\s*final\s*>/gi, "").trim();
    const rawCandidate = rawStrippedFinal || rawTrimmed;
    if (rawCandidate) {
      const parsedFallback = parseReplyDirectives(stripTrailingDirective(rawCandidate), {
        expectedLanguage: getRunReplyLanguage(ctx.params.runId),
        planSpeakContext: latestUserText(ctx.params.session.messages),
      });
      cleanedText = parsedFallback.text ?? rawCandidate;
      mediaUrls = parsedFallback.mediaUrls;
      hasMedia = Boolean(mediaUrls && mediaUrls.length > 0);
    }
  }

  if (!ctx.state.emittedAssistantUpdate && (cleanedText || hasMedia)) {
    emitAgentEvent({
      runId: ctx.params.runId,
      stream: "assistant",
      data: {
        text: cleanedText,
        delta: cleanedText,
        mediaUrls: hasMedia ? mediaUrls : undefined,
      },
    });
    void ctx.params.onAgentEvent?.({
      stream: "assistant",
      data: {
        text: cleanedText,
        delta: cleanedText,
        mediaUrls: hasMedia ? mediaUrls : undefined,
      },
    });
    ctx.state.emittedAssistantUpdate = true;
  }

  const addedDuringMessage = ctx.state.assistantTexts.length > ctx.state.assistantTextBaseline;
  const chunkerHasBuffered = ctx.blockChunker?.hasBuffered() ?? false;
  const assistantTextBaselineBefore = ctx.state.assistantTextBaseline;
  ctx.finalizeAssistantTexts({ text, addedDuringMessage, chunkerHasBuffered });

  const stopReason =
    typeof (assistantMessage as { stopReason?: unknown }).stopReason === "string"
      ? (assistantMessage as { stopReason: string }).stopReason
      : "";
  const toolUseProgress = stopReason === "toolUse";
  if (toolUseProgress && ctx.state.assistantTexts.length > assistantTextBaselineBefore) {
    ctx.state.assistantTexts.splice(assistantTextBaselineBefore);
    ctx.state.assistantTextBaseline = ctx.state.assistantTexts.length;
  }
  const suppressLowCjkBlock =
    !toolUseProgress &&
    getRunReplyLanguage(ctx.params.runId) === "zh" &&
    visibleReplyNeedsChineseRewrite(text || cleanedText, "zh");
  const suppressChannelBlock = toolUseProgress || suppressLowCjkBlock;
  if (suppressChannelBlock) {
    ctx.discardBlockReplyBuffer?.();
    // text_end already queued onBlockReply. Set the flag before that microtask
    // runs, then drop anything the pipeline accepted.
    ctx.suppressScheduledBlockReplies?.();
    void Promise.resolve().then(() => ctx.params.onBlockReplyDiscard?.());
  }

  const onBlockReply = ctx.params.onBlockReply;
  const emitBlockReplySafely = (payload: Parameters<NonNullable<typeof onBlockReply>>[0]) => {
    if (!onBlockReply) {
      return;
    }
    void Promise.resolve()
      .then(() => onBlockReply(payload))
      .catch((err) => {
        ctx.log.warn(`block reply callback failed: ${String(err)}`);
      });
  };
  const shouldEmitReasoning = Boolean(
    ctx.state.includeReasoning &&
    formattedReasoning &&
    onBlockReply &&
    formattedReasoning !== ctx.state.lastReasoningSent,
  );
  const shouldEmitReasoningBeforeAnswer =
    shouldEmitReasoning && ctx.state.blockReplyBreak === "message_end" && !addedDuringMessage;
  const maybeEmitReasoning = () => {
    if (!shouldEmitReasoning || !formattedReasoning) {
      return;
    }
    ctx.state.lastReasoningSent = formattedReasoning;
    emitBlockReplySafely({ text: formattedReasoning, isReasoning: true });
  };

  if (shouldEmitReasoningBeforeAnswer) {
    maybeEmitReasoning();
  }

  const emitSplitResultAsBlockReply = (
    splitResult: ReturnType<typeof ctx.consumeReplyDirectives> | null | undefined,
  ) => {
    if (!splitResult || !onBlockReply) {
      return;
    }
    const {
      text: cleanedText,
      mediaUrls,
      audioAsVoice,
      replyToId,
      replyToTag,
      replyToCurrent,
    } = splitResult;
    // Emit if there's content OR audioAsVoice flag (to propagate the flag).
    if (cleanedText || (mediaUrls && mediaUrls.length > 0) || audioAsVoice) {
      emitBlockReplySafely({
        text: cleanedText,
        mediaUrls: mediaUrls?.length ? mediaUrls : undefined,
        audioAsVoice,
        replyToId,
        replyToTag,
        replyToCurrent,
      });
    }
  };

  if (
    !suppressChannelBlock &&
    (ctx.state.blockReplyBreak === "message_end" ||
      (ctx.blockChunker ? ctx.blockChunker.hasBuffered() : ctx.state.blockBuffer.length > 0)) &&
    text &&
    onBlockReply
  ) {
    if (ctx.blockChunker?.hasBuffered()) {
      ctx.blockChunker.drain({ force: true, emit: ctx.emitBlockChunk });
      ctx.blockChunker.reset();
    } else if (text !== ctx.state.lastBlockReplyText) {
      // Check for duplicates before emitting (same logic as emitBlockChunk).
      const normalizedText = normalizeTextForComparison(text);
      if (
        isMessagingToolDuplicateNormalized(
          normalizedText,
          ctx.state.messagingToolSentTextsNormalized,
        )
      ) {
        ctx.log.debug(
          `Skipping message_end block reply - already sent via messaging tool: ${text.slice(0, 50)}...`,
        );
      } else {
        ctx.state.lastBlockReplyText = text;
        emitSplitResultAsBlockReply(ctx.consumeReplyDirectives(text, { final: true }));
      }
    }
  }

  if (!shouldEmitReasoningBeforeAnswer) {
    maybeEmitReasoning();
  }
  if (ctx.state.streamReasoning && rawThinking) {
    ctx.emitReasoningStream(rawThinking);
  }

  if (!suppressChannelBlock && ctx.state.blockReplyBreak === "text_end" && onBlockReply) {
    emitSplitResultAsBlockReply(ctx.consumeReplyDirectives("", { final: true }));
  }

  ctx.state.deltaBuffer = "";
  ctx.state.blockBuffer = "";
  ctx.state.protocolHold = false;
  ctx.blockChunker?.reset();
  ctx.state.blockState.thinking = false;
  ctx.state.blockState.final = false;
  ctx.state.blockState.inlineCode = createInlineCodeState();
  ctx.state.lastStreamedAssistant = undefined;
  ctx.state.lastStreamedAssistantCleaned = undefined;
  ctx.state.reasoningStreamOpen = false;
}
