/**
 * One-shot provider completion for catalog and connection probes (`models.probe`,
 * `openbot models status --probe`).
 *
 * This path reaches the configured provider over HTTP and does not enter the
 * account sandbox. Agent chats, cron, and other embedded runs still resolve a
 * server-derived tenant account and fail closed when it is missing. Do not call
 * this from a user turn, and do not accept a client flag that selects it.
 */
import { complete, type Api, type Context, type Model } from "@earendil-works/pi-ai/compat";
import {
  getApiKeyForModel,
  requireApiKey,
  type ResolvedProviderAuth,
} from "../../agents/model-auth.js";
import { ensureOpenClawModelsJson } from "../../agents/models-config.js";
import { resolveModel } from "../../agents/pi-embedded-runner/model.js";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveCopilotApiToken } from "../../providers/github-copilot-token.js";
import { withTimeout } from "../../utils/with-timeout.js";

const CATALOG_HEALTH_PROMPT = "Reply with OK. Do not use tools.";

export type CatalogHealthCompletionParams = {
  cfg: OpenBotConfig;
  agentDir: string;
  provider: string;
  modelId: string;
  authProfileId?: string;
  timeoutMs: number;
  maxTokens: number;
};

function assistantFailure(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const record = message as { stopReason?: unknown; errorMessage?: unknown };
  const errorMessage = typeof record.errorMessage === "string" ? record.errorMessage.trim() : "";
  const stopReason = typeof record.stopReason === "string" ? record.stopReason : "";
  if (stopReason === "error" || stopReason === "aborted" || errorMessage) {
    return errorMessage || `Catalog probe stopped (${stopReason || "error"}).`;
  }
  return null;
}

async function resolveCatalogProbeApiKey(
  provider: string,
  auth: ResolvedProviderAuth,
): Promise<string | undefined> {
  if (provider === "github-copilot") {
    const githubToken = requireApiKey(auth, provider);
    const copilot = await resolveCopilotApiToken({ githubToken });
    return copilot.token;
  }
  if (!auth.apiKey) {
    if (auth.mode === "aws-sdk") {
      return undefined;
    }
    throw new Error(`No API key resolved for provider "${provider}" (auth mode: ${auth.mode}).`);
  }
  return auth.apiKey;
}

/** Direct provider completion used by catalog health probes. Not an agent run. */
export async function invokeCatalogHealthCompletion(params: {
  model: Model<Api>;
  apiKey?: string;
  maxTokens: number;
  timeoutMs: number;
}): Promise<void> {
  const context: Context = {
    messages: [
      {
        role: "user",
        content: CATALOG_HEALTH_PROMPT,
        timestamp: Date.now(),
      },
    ],
  };
  const timeoutMs = Math.max(1, params.timeoutMs);
  const message = await withTimeout(
    complete(params.model, context, {
      ...(params.apiKey ? { apiKey: params.apiKey } : {}),
      maxTokens: Math.max(1, params.maxTokens),
      temperature: 0,
      timeoutMs,
      signal: AbortSignal.timeout(timeoutMs),
    }),
    timeoutMs,
  );
  const failure = assistantFailure(message);
  if (failure) {
    throw new Error(failure);
  }
}

export async function runCatalogHealthCompletion(
  params: CatalogHealthCompletionParams,
): Promise<void> {
  await ensureOpenClawModelsJson(params.cfg, params.agentDir);
  const resolved = await resolveModel(params.provider, params.modelId, params.agentDir, params.cfg);
  if (!resolved.model) {
    throw new Error(resolved.error ?? `Unknown model: ${params.provider}/${params.modelId}`);
  }
  const auth = await getApiKeyForModel({
    model: resolved.model,
    cfg: params.cfg,
    profileId: params.authProfileId,
    agentDir: params.agentDir,
  });
  const apiKey = await resolveCatalogProbeApiKey(resolved.model.provider, auth);
  await invokeCatalogHealthCompletion({
    model: resolved.model,
    ...(apiKey ? { apiKey } : {}),
    maxTokens: params.maxTokens,
    timeoutMs: params.timeoutMs,
  });
}
