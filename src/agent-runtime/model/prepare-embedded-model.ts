import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
import { FailoverError } from "../../agents/failover-error.js";
import { resolveModel } from "../../agents/pi-embedded-runner/model.js";
import type { OpenBotConfig } from "../../config/config.js";
import {
  CONTEXT_WINDOW_HARD_MIN_TOKENS,
  CONTEXT_WINDOW_WARN_BELOW_TOKENS,
  evaluateContextWindowGuard,
  resolveContextWindowInfo,
} from "../policy/index.js";
/** Resolve a model and its effective context limit before credentials or execution. */
export async function prepareEmbeddedModel(input: {
  config?: OpenBotConfig;
  provider: string;
  modelId: string;
  agentDir: string;
  providerAuthOverride?: { apiKey: string; source?: string; baseUrl?: string; protocol?: string };
  log: { warn: (message: string) => void; error: (message: string) => void };
}) {
  const { provider, modelId, agentDir, log } = input;
  const { model, error, authStorage, modelRegistry } = await resolveModel(
    provider,
    modelId,
    agentDir,
    input.config,
  );
  const authOverride = input.providerAuthOverride;
  let resolvedModel = model;
  if (!resolvedModel && authOverride?.apiKey) {
    // BYOK openai-compatible / custom model not in global registry: synthesize.
    const api = authOverride.protocol?.includes("anthropic")
      ? ("anthropic-messages" as const)
      : ("openai-completions" as const);
    resolvedModel = {
      id: modelId,
      name: modelId,
      api,
      provider,
      baseUrl: authOverride.baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 8192,
    } as typeof model;
  }
  if (!resolvedModel) {
    throw new FailoverError(error ?? `Unknown model: ${provider}/${modelId}`, {
      reason: "model_not_found",
      provider,
      model: modelId,
    });
  }
  if (authOverride?.baseUrl?.trim()) {
    resolvedModel = { ...resolvedModel, baseUrl: authOverride.baseUrl.trim() };
  }
  const modelForRun = resolvedModel;

  const ctxInfo = resolveContextWindowInfo({
    cfg: input.config,
    provider,
    modelId,
    modelContextWindow: modelForRun.contextWindow,
    defaultTokens: DEFAULT_CONTEXT_TOKENS,
  });
  // Apply contextTokens cap to model so pi-coding-agent's auto-compaction
  // threshold uses the effective limit, not the native context window.
  const effectiveModel =
    ctxInfo.tokens < (modelForRun.contextWindow ?? Infinity)
      ? { ...modelForRun, contextWindow: ctxInfo.tokens }
      : modelForRun;
  const ctxGuard = evaluateContextWindowGuard({
    info: ctxInfo,
    warnBelowTokens: CONTEXT_WINDOW_WARN_BELOW_TOKENS,
    hardMinTokens: CONTEXT_WINDOW_HARD_MIN_TOKENS,
  });
  if (ctxGuard.shouldWarn) {
    log.warn(
      `low context window: ${provider}/${modelId} ctx=${ctxGuard.tokens} (warn<${CONTEXT_WINDOW_WARN_BELOW_TOKENS}) source=${ctxGuard.source}`,
    );
  }
  if (ctxGuard.shouldBlock) {
    log.error(
      `blocked model (context window too small): ${provider}/${modelId} ctx=${ctxGuard.tokens} (min=${CONTEXT_WINDOW_HARD_MIN_TOKENS}) source=${ctxGuard.source}`,
    );
    throw new FailoverError(
      `Model context window too small (${ctxGuard.tokens} tokens). Minimum is ${CONTEXT_WINDOW_HARD_MIN_TOKENS}.`,
      { reason: "unknown", provider, model: modelId },
    );
  }

  return { authStorage, modelRegistry, authOverride, ctxInfo, effectiveModel };
}
