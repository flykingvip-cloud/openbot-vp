import type { EmbeddedPiRunResult } from "../../agent-runtime/execution/index.js";
import { setCliSessionId } from "../../agents/cli-session.js";
import { resolveContextTokensForModel } from "../../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
import { isCliProvider, modelKey } from "../../agents/model-selection.js";
import { deriveSessionTotalTokens, hasNonzeroUsage } from "../../agents/usage.js";
import type { OpenBotConfig } from "../../config/config.js";
import {
  mergeSessionEntry,
  setSessionRuntimeModel,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import { isEnterpriseRuntimeModelId } from "../../gateway/enterprise-model/ids.js";

type RunResult = EmbeddedPiRunResult;

export async function updateSessionStoreAfterAgentRun(params: {
  cfg: OpenBotConfig;
  contextTokensOverride?: number;
  sessionId: string;
  sessionKey: string;
  storePath: string;
  sessionStore: Record<string, SessionEntry>;
  defaultProvider: string;
  defaultModel: string;
  fallbackProvider?: string;
  fallbackModel?: string;
  result: RunResult;
}) {
  const {
    cfg,
    sessionId,
    sessionKey,
    storePath,
    sessionStore,
    defaultProvider,
    defaultModel,
    fallbackProvider,
    fallbackModel,
    result,
  } = params;

  const usage = result.meta.agentMeta?.usage;
  const promptTokens = result.meta.agentMeta?.promptTokens;
  const compactionsThisRun = Math.max(0, result.meta.agentMeta?.compactionCount ?? 0);
  // BYOK runs remap ent/* → upstream openai/… inside the attempt. Persist the
  // enterprise runtime id so the next agent/chat turn still hits budget/grants.
  const fallbackProviderUsed = fallbackProvider ?? defaultProvider;
  const fallbackModelUsed = fallbackModel ?? defaultModel;
  const fallbackRuntimeKey = modelKey(fallbackProviderUsed, fallbackModelUsed);
  const preferEnterpriseFallback = isEnterpriseRuntimeModelId(fallbackRuntimeKey);
  const modelUsed = preferEnterpriseFallback
    ? fallbackModelUsed
    : (result.meta.agentMeta?.model ?? fallbackModelUsed);
  const providerUsed = preferEnterpriseFallback
    ? fallbackProviderUsed
    : (result.meta.agentMeta?.provider ?? fallbackProviderUsed);
  const contextTokens =
    resolveContextTokensForModel({
      cfg,
      provider: providerUsed,
      model: modelUsed,
      contextTokensOverride: params.contextTokensOverride,
      fallbackContextTokens: DEFAULT_CONTEXT_TOKENS,
    }) ?? DEFAULT_CONTEXT_TOKENS;

  const entry = sessionStore[sessionKey] ?? {
    sessionId,
    updatedAt: Date.now(),
  };
  const next: SessionEntry = {
    ...entry,
    sessionId,
    updatedAt: Date.now(),
    contextTokens,
  };
  setSessionRuntimeModel(next, {
    provider: providerUsed,
    model: modelUsed,
  });
  if (isCliProvider(providerUsed, cfg)) {
    const cliSessionId = result.meta.agentMeta?.sessionId?.trim();
    if (cliSessionId) {
      setCliSessionId(next, providerUsed, cliSessionId);
    }
  }
  next.abortedLastRun = result.meta.aborted ?? false;
  if (result.meta.systemPromptReport) {
    next.systemPromptReport = result.meta.systemPromptReport;
  }
  if (hasNonzeroUsage(usage)) {
    const input = usage.input ?? 0;
    const output = usage.output ?? 0;
    const totalTokens = deriveSessionTotalTokens({
      usage,
      contextTokens,
      promptTokens,
    });
    next.inputTokens = input;
    next.outputTokens = output;
    if (typeof totalTokens === "number" && Number.isFinite(totalTokens) && totalTokens > 0) {
      next.totalTokens = totalTokens;
      next.totalTokensFresh = true;
    } else {
      next.totalTokens = undefined;
      next.totalTokensFresh = false;
    }
    next.cacheRead = usage.cacheRead ?? 0;
    next.cacheWrite = usage.cacheWrite ?? 0;
  }
  if (compactionsThisRun > 0) {
    next.compactionCount = (entry.compactionCount ?? 0) + compactionsThisRun;
  }
  const persisted = await updateSessionStore(storePath, (store) => {
    const merged = mergeSessionEntry(store[sessionKey], next);
    store[sessionKey] = merged;
    return merged;
  });
  sessionStore[sessionKey] = persisted;
}
