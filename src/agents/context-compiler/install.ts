import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import {
  compileModelContext,
  normalizeCompiledMessages,
} from "../../agent-runtime/context/index.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type {
  CollabCompileStrategyParams,
  ContextCandidates,
  ContextCompileTelemetry,
  ContextLane,
} from "./types.js";

const log = createSubsystemLogger("context-compiler");

type TransformContext = (
  messages: AgentMessage[],
  signal?: AbortSignal,
) => AgentMessage[] | Promise<AgentMessage[]>;

type GuardableAgent = {
  transformContext?: TransformContext;
  streamFn?: StreamFn;
};

export type ContextCompileState = {
  lastTelemetry?: ContextCompileTelemetry;
  lastCompiledCount: number;
};

export function createContextCompileState(): ContextCompileState {
  return { lastCompiledCount: 0 };
}

export function installContextCompilerTransform(params: {
  agent: object;
  state: ContextCompileState;
  lane: ContextLane;
  candidates: ContextCandidates;
  contextWindowTokens?: number;
  runId?: string;
  collabCompileStrategy?: CollabCompileStrategyParams;
  onCompiled?: (telemetry: ContextCompileTelemetry) => void;
}): () => void {
  const mutableAgent = params.agent as GuardableAgent;
  const original = mutableAgent.transformContext;

  mutableAgent.transformContext = async (messages: AgentMessage[], signal?: AbortSignal) => {
    const incoming = original ? await original.call(mutableAgent, messages, signal) : messages;
    const source = Array.isArray(incoming) ? incoming : Array.isArray(messages) ? messages : [];
    const compiled = compileModelContext({
      messages: source,
      lane: params.lane,
      candidates: params.candidates,
      contextWindowTokens: params.contextWindowTokens,
      runId: params.runId,
      ...(params.collabCompileStrategy
        ? { collabCompileStrategy: params.collabCompileStrategy }
        : {}),
    });
    if (!compiled.telemetry.recallSafety.currentTurnPreserved) {
      log.error("context compiler dropped current turn; refusing to emit truncated context", {
        runId: params.runId,
        lane: params.lane,
      });
      const safeSource = normalizeCompiledMessages(source);
      params.state.lastTelemetry = {
        ...compiled.telemetry,
        postCompileMessageCount: safeSource.length,
      };
      params.state.lastCompiledCount = safeSource.length;
      return safeSource;
    }
    params.state.lastTelemetry = compiled.telemetry;
    params.state.lastCompiledCount = compiled.telemetry.postCompileMessageCount;
    params.onCompiled?.(compiled.telemetry);
    const dropCount = Array.isArray(compiled.telemetry.contextDropReasons)
      ? compiled.telemetry.contextDropReasons.length
      : 0;
    log.debug(
      `compiled context lane=${params.lane} messages=${compiled.telemetry.preCompileMessageCount}->${compiled.telemetry.postCompileMessageCount} tokens~${compiled.telemetry.preCompileEstimatedTokens}->${compiled.telemetry.postCompileEstimatedTokens} drops=${dropCount}`,
    );
    return compiled.messages;
  };

  return () => {
    mutableAgent.transformContext = original;
  };
}

/**
 * P0-0 / production invariant: the object passed to streamFn is the provider request.
 * If Pi later reassembles transcript after transformContext, this wrap fail-closes by
 * slicing the outbound payload to the compiled count.
 */
export function wrapContextCompilerModelBoundary(params: {
  streamFn: StreamFn;
  state: ContextCompileState;
  runId?: string;
  onProviderBoundary?: (telemetry: ContextCompileTelemetry) => void;
}): StreamFn {
  return (model, context, options) => {
    const ctx = context as { messages?: unknown };
    const messages = Array.isArray(ctx.messages) ? ctx.messages : null;
    const telemetry = params.state.lastTelemetry;
    if (telemetry && messages) {
      telemetry.providerMessageCount = messages.length;
      const leaked =
        messages.length > telemetry.postCompileMessageCount + 2 &&
        messages.length >= Math.max(20, telemetry.preCompileMessageCount * 0.5);
      telemetry.providerBoundaryMatch = !leaked;
      if (leaked) {
        log.error("model-boundary leak: provider request still carries pre-compile transcript", {
          runId: params.runId,
          compiled: telemetry.postCompileMessageCount,
          provider: messages.length,
          preCompile: telemetry.preCompileMessageCount,
        });
        const sliced = messages.slice(-Math.max(1, telemetry.postCompileMessageCount));
        telemetry.providerMessageCount = sliced.length;
        params.onProviderBoundary?.(telemetry);
        const nextContext = {
          ...(context as unknown as Record<string, unknown>),
          messages: sliced,
        };
        return params.streamFn(model, nextContext as typeof context, options);
      }
      params.onProviderBoundary?.(telemetry);
    }
    return params.streamFn(model, context, options);
  };
}

/**
 * pi-ai estimates tokens inside streamSimple, before its own try/catch.
 * Run this wrapper outermost so assistant string content and nameless blocks
 * are rewritten even when the context compiler is off.
 */
export function wrapOutboundMessageEstimateGuard(streamFn: StreamFn): StreamFn {
  return (model, context, options) => {
    const messages = (context as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) {
      return streamFn(model, context, options);
    }
    const sanitized = normalizeCompiledMessages(messages as AgentMessage[]);
    if (sanitized === messages) {
      return streamFn(model, context, options);
    }
    const nextContext = {
      ...(context as unknown as Record<string, unknown>),
      messages: sanitized,
    };
    return streamFn(model, nextContext as typeof context, options);
  };
}

/**
 * Test helper that mirrors pi-agent-core agent-loop.js streamAssistantResponse:
 * transformContext → convertToLlm → streamFn(llmContext).
 */
export async function simulatePiModelBoundary(params: {
  messages: AgentMessage[];
  transformContext?: TransformContext;
  convertToLlm?: (messages: AgentMessage[]) => AgentMessage[] | Promise<AgentMessage[]>;
}): Promise<{
  transformed: AgentMessage[];
  providerMessages: AgentMessage[];
}> {
  const transformed = params.transformContext
    ? await params.transformContext(params.messages)
    : params.messages;
  const convert = params.convertToLlm ?? ((msgs: AgentMessage[]) => msgs);
  const llmMessages = await convert(transformed);
  let providerMessages: AgentMessage[] = llmMessages;
  const streamFn: StreamFn = (_model, context) => {
    const ctx = context as { messages?: AgentMessage[] };
    providerMessages = Array.isArray(ctx.messages) ? ctx.messages : [];
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "done" };
      },
      result: async () => ({ role: "assistant", content: [], timestamp: Date.now() }),
    } as unknown as ReturnType<StreamFn>;
  };
  await streamFn({} as never, { systemPrompt: "", messages: llmMessages, tools: [] } as never, {});
  return { transformed, providerMessages };
}
