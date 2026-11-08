import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { completeSimple, streamSimple } from "@earendil-works/pi-ai/compat";
import { createAgentSession } from "@earendil-works/pi-coding-agent";
import { createAnthropicPayloadLogger } from "../../../agents/anthropic-payload-log.js";
import { createCacheTrace } from "../../../agents/cache-trace.js";
import { loadContextCandidates } from "../../../agents/context-compiler/candidates.js";
import { shouldApplyCollabCompileStrategy } from "../../../agents/context-compiler/collab-compile-strategy.js";
import { isContextCompilerEnabled } from "../../../agents/context-compiler/flag.js";
import { resolveContextLane } from "../../../agents/context-compiler/lane-budget.js";
import { contextCompileTelemetryExtra } from "../../../agents/context-compiler/telemetry.js";
import { ensureCustomApiRegistered } from "../../../agents/custom-api-registry.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../../agents/defaults.js";
import { createConfiguredOllamaStreamFn } from "../../../agents/ollama-stream.js";
import { createOpenAIWebSocketStreamFn } from "../../../agents/openai-ws-stream.js";
import { applyExtraParamsToAgent } from "../../../agents/pi-embedded-runner/extra-params.js";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import { installReplyLanguageReminder } from "../../../agents/pi-embedded-runner/reply-language-reminder.js";
import type { EmbeddedRunAttemptParams } from "../../../agents/pi-embedded-runner/run/types.js";
import {
  resolveStreamApiKey,
  wrapStreamFnWithResolvedApiKey,
} from "../../../agents/pi-embedded-runner/stream-api-key.js";
import { applySystemPromptOverrideToSession } from "../../../agents/pi-embedded-runner/system-prompt.js";
import { dropThinkingBlocks } from "../../../agents/pi-embedded-runner/thinking.js";
import { installToolResultContextGuard } from "../../../agents/pi-embedded-runner/tool-result-context-guard.js";
import { mapThinkingLevel } from "../../../agents/pi-embedded-runner/utils.js";
import { createPiModelRuntime } from "../../../agents/pi-sdk/model-runtime.js";
import { wrapStreamFnSanitizeProviderToolNames } from "../../../agents/provider-tool-name-stream.js";
import { emitChatInboundStage } from "../../../gateway/chat-inbound-stage-events.js";
import {
  compilerTelemetryToFaultRoundSnapshot,
  recordCollabFaultRoundPartial,
} from "../../../gateway/collaboration-dispatch/fault-round-diagnostic.js";
import {
  registerVisibleReplyRewriter,
  visibleReplyRewritePrompt,
} from "../../../shared/text/visible-reply-language.js";
import {
  createContextCompileState,
  installContextCompilerTransform,
} from "../../capabilities/index.js";
import { shouldInjectOllamaCompatNumCtx, wrapOllamaCompatNumCtx } from "../../model/index.js";
import type { EmbeddedAttemptState } from "./embedded-attempt-preflight.js";

/** Session create and outer streamFn wraps through thinking-block drop. */
export async function runEmbeddedAttemptStream(
  params: EmbeddedRunAttemptParams,
  s: EmbeddedAttemptState,
): Promise<void> {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- phase bag temp */
  let __d: any;

  const { runtime } = await createPiModelRuntime({
    authStorage: params.authStorage,
    agentDir: s.agentDir,
  });
  s.session = (
    await createAgentSession({
      cwd: s.resolvedWorkspace,
      agentDir: s.agentDir,
      modelRuntime: runtime,
      noTools: "all",
      tools: s.customToolAllowlist,
      model: params.model,
      thinkingLevel: mapThinkingLevel(params.thinkLevel),
      customTools: s.filteredCustomTools,
      sessionManager: s.sessionManager,
      settingsManager: s.settingsManager,
      resourceLoader: s.resourceLoader,
    })
  ).session;
  applySystemPromptOverrideToSession(s.session, s.systemPromptText);
  if (!s.session) {
    throw new Error("Embedded agent session missing");
  }
  s.activeSession = s.session;
  s.contextCompileState = createContextCompileState();
  if (isContextCompilerEnabled()) {
    const candidates = await loadContextCandidates({
      cfg: params.config,
      workspaceDir: params.workspaceDir,
      agentId: s.sessionAgentId,
      sessionKey: params.sessionKey,
      sessionEntry: params.sessionEntry,
      userUtterance: params.prompt,
      injectionSource: /heartbeat/iu.test(params.prompt ?? "") ? "heartbeat" : "ledger",
    });
    const collabCompileStrategy = shouldApplyCollabCompileStrategy({
      cfg: params.config,
      sessionKey: params.sessionKey,
    })
      ? { enabled: true as const, retainMemberConclusions: true as const }
      : undefined;
    s.removeContextCompiler = installContextCompilerTransform({
      agent: s.activeSession.agent,
      state: s.contextCompileState,
      lane: resolveContextLane({ depth: params.contextLane }),
      candidates,
      contextWindowTokens: Math.max(
        1,
        Math.floor(params.model.contextWindow ?? params.model.maxTokens ?? DEFAULT_CONTEXT_TOKENS),
      ),
      runId: params.runId,
      ...(collabCompileStrategy ? { collabCompileStrategy } : {}),
      onCompiled: (telemetry) => {
        emitChatInboundStage({
          runId: params.runId,
          stage: "context_compiled",
          sessionKey: params.sessionKey,
          extra: {
            ...contextCompileTelemetryExtra(telemetry),
            taskSummaryPresent: Boolean(candidates.task?.trim()),
          },
        });
        recordCollabFaultRoundPartial(
          {
            runId: params.runId,
            sessionKey: params.sessionKey,
            agentId: s.sessionAgentId,
            compiler: compilerTelemetryToFaultRoundSnapshot(telemetry),
            taskSummaryPresent: Boolean(candidates.task?.trim()),
          },
          params.config,
        );
      },
    });
  }
  s.removeToolResultContextGuard = installToolResultContextGuard({
    agent: s.activeSession.agent,
    contextWindowTokens: Math.max(
      1,
      Math.floor(params.model.contextWindow ?? params.model.maxTokens ?? DEFAULT_CONTEXT_TOKENS),
    ),
  });
  s.removeReplyLanguageReminder = installReplyLanguageReminder({
    agent: s.activeSession.agent,
    runId: params.runId,
  });
  s.cacheTrace = createCacheTrace({
    cfg: params.config,
    env: process.env,
    runId: params.runId,
    sessionId: s.activeSession.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    modelId: params.modelId,
    modelApi: params.model.api,
    workspaceDir: params.workspaceDir,
  });
  s.anthropicPayloadLogger = createAnthropicPayloadLogger({
    env: process.env,
    runId: params.runId,
    sessionId: s.activeSession.sessionId,
    sessionKey: params.sessionKey,
    provider: params.provider,
    modelId: params.modelId,
    modelApi: params.model.api,
    workspaceDir: params.workspaceDir,
  });

  // Ollama native API: bypass SDK's streamSimple and use direct /api/chat calls
  // for reliable streaming + tool calling support (#11828).
  if (params.model.api === "ollama") {
    // Prioritize configured provider baseUrl so Docker/remote Ollama hosts work reliably.
    const providerConfig = params.config?.models?.providers?.[params.model.provider];
    const providerBaseUrl =
      typeof providerConfig?.baseUrl === "string" ? providerConfig.baseUrl : undefined;
    const ollamaStreamFn = createConfiguredOllamaStreamFn({
      model: params.model,
      providerBaseUrl,
    });
    s.activeSession.agent.streamFunction = ollamaStreamFn;
    ensureCustomApiRegistered(params.model.api, ollamaStreamFn);
  } else if (params.model.api === "openai-responses" && params.provider === "openai") {
    const wsApiKey = await params.authStorage.getApiKey(params.provider);
    if (wsApiKey) {
      s.activeSession.agent.streamFunction = createOpenAIWebSocketStreamFn(
        wsApiKey,
        params.sessionId,
        {
          signal: s.runAbortController.signal,
        },
      );
    } else {
      log.warn(`[ws-stream] no API key for provider=${params.provider}; using HTTP transport`);
      s.activeSession.agent.streamFunction = streamSimple;
    }
  } else {
    // Force a stable streamFn reference so vitest can reliably mock @earendil-works/pi-ai.
    s.activeSession.agent.streamFunction = streamSimple;
  }

  // Raw `streamSimple` reads the key only from `options.apiKey`; it does not
  // consult OpenBotAuthStorage. run.ts has already resolved+stored the key
  // (setRuntimeApiKey), so bridge it onto the active stream fn — otherwise
  // custom providers (api-proxy-*) throw "No API key for provider" and the
  // assistant turn returns empty even though chat.send succeeded.
  s.resolvedStreamApiKey = await resolveStreamApiKey({
    getApiKey: (provider) => params.authStorage.getApiKey(provider),
    modelProvider: params.model.provider,
    provider: params.provider,
  });
  s.removeVisibleReplyRewriter = registerVisibleReplyRewriter(params.runId, async (text) => {
    const response = await completeSimple(
      params.model,
      {
        messages: [
          {
            role: "user",
            content: visibleReplyRewritePrompt(text),
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: s.resolvedStreamApiKey,
        maxTokens: 800,
        temperature: 0,
      },
    );
    const rewritten = (Array.isArray(response.content) ? response.content : [])
      .map((block) => {
        if (!block || typeof block !== "object") {
          return "";
        }
        const entry = block as { type?: unknown; text?: unknown };
        return entry.type === "text" && typeof entry.text === "string" ? entry.text : "";
      })
      .join("")
      .trim();
    return rewritten || text;
  });
  // Last choke point before the provider HTTP/SDK call. Later wrappers are
  // outside this one, so they cannot put an illegal function.name back on
  // the wire. Response tool-call names are mapped back to the registered tool.
  s.activeSession.agent.streamFunction = wrapStreamFnSanitizeProviderToolNames(
    s.activeSession.agent.streamFunction ?? streamSimple,
  );
  s.activeSession.agent.streamFunction = wrapStreamFnWithResolvedApiKey(
    s.activeSession.agent.streamFunction ?? streamSimple,
    s.resolvedStreamApiKey,
  );

  // Ollama with OpenAI-compatible API needs num_ctx in payload.options.
  // Otherwise Ollama defaults to a 4096 context window.
  const providerIdForNumCtx =
    typeof params.model.provider === "string" && params.model.provider.trim().length > 0
      ? params.model.provider
      : params.provider;
  const shouldInjectNumCtx = shouldInjectOllamaCompatNumCtx({
    model: params.model,
    config: params.config,
    providerId: providerIdForNumCtx,
  });
  if (shouldInjectNumCtx) {
    const numCtx = Math.max(
      1,
      Math.floor(params.model.contextWindow ?? params.model.maxTokens ?? DEFAULT_CONTEXT_TOKENS),
    );
    s.activeSession.agent.streamFunction = wrapOllamaCompatNumCtx(
      s.activeSession.agent.streamFunction,
      numCtx,
    );
  }

  applyExtraParamsToAgent(
    s.activeSession.agent,
    params.config,
    params.provider,
    params.modelId,
    params.streamParams,
    params.thinkLevel,
    s.sessionAgentId,
  );

  if (s.cacheTrace) {
    s.cacheTrace.recordStage("session:loaded", {
      messages: s.activeSession.messages,
      system: s.systemPromptText,
      note: "after session create",
    });
    s.activeSession.agent.streamFunction = s.cacheTrace.wrapStreamFn(
      s.activeSession.agent.streamFunction,
    );
  }

  // Copilot/Claude can reject persisted `thinking` blocks (e.g. thinkingSignature:"reasoning_text")
  // on *any* follow-up provider call (including tool continuations). Wrap the stream function
  // so every outbound request sees sanitized messages.
  if (s.transcriptPolicy.dropThinkingBlocks) {
    const inner = s.activeSession.agent.streamFunction;
    s.activeSession.agent.streamFunction = (model, context, options) => {
      const ctx = context as unknown as { messages?: unknown };
      const messages = ctx?.messages;
      if (!Array.isArray(messages)) {
        return inner(model, context, options);
      }
      const sanitized = dropThinkingBlocks(messages as unknown as AgentMessage[]) as unknown;
      if (sanitized === messages) {
        return inner(model, context, options);
      }
      const nextContext = {
        ...(context as unknown as Record<string, unknown>),
        messages: sanitized,
      } as unknown;
      return inner(model, nextContext as typeof context, options);
    };
  }
}
