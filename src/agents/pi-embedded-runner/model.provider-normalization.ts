import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { normalizeModelCompat } from "../model-compat.js";
import { normalizeProviderId } from "../model-selection.js";

const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

/** Official DeepSeek API hosts (legacy chat/reasoner aliases retired after 2026-07-24). */
export function isOfficialDeepSeekApiBaseUrl(baseUrl?: string): boolean {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    return host === "api.deepseek.com" || host.endsWith(".deepseek.com");
  } catch {
    return /^https?:\/\/(?:[\w-]+\.)?deepseek\.com(?:\/|$)/i.test(trimmed);
  }
}

/**
 * Official DeepSeek Chat Completions IDs that accept native image input.
 * V4.1-Flash launched with multimodal support on 2026-09-10; legacy V4 Flash
 * and V4 Pro IDs currently route to that vision-capable endpoint.
 * Inference is host-scoped — custom OpenAI-compatible proxies stay text-only
 * unless the operator sets `input: ["text", "image"]` explicitly.
 */
const OFFICIAL_DEEPSEEK_VISION_MODEL_IDS = new Set([
  "deepseek-flash",
  "deepseek-v4-flash",
  "deepseek-v4-flash-vision-exp",
  "deepseek-v4-pro",
]);

export function isOfficialDeepSeekVisionModel(params: { id?: string; baseUrl?: string }): boolean {
  if (!isOfficialDeepSeekApiBaseUrl(params.baseUrl)) {
    return false;
  }
  return OFFICIAL_DEEPSEEK_VISION_MODEL_IDS.has(String(params.id ?? "").trim());
}

function ensureOfficialDeepSeekVisionInput(model: Model<Api>): Model<Api> {
  if (!isOfficialDeepSeekVisionModel({ id: model.id, baseUrl: model.baseUrl })) {
    return model;
  }
  if (model.input?.includes("image")) {
    return model;
  }
  const input = [...(model.input ?? ["text"])];
  if (!input.includes("text")) {
    input.unshift("text");
  }
  input.push("image");
  return { ...model, input } as Model<Api>;
}

/**
 * Map retired DeepSeek aliases to current V4 model IDs.
 * - deepseek-chat → deepseek-v4-flash (non-thinking chat parity)
 * - deepseek-reasoner → deepseek-v4-flash (thinking parity; callers set thinking mode)
 */
function normalizeDeepSeekLegacyModelIds(params: {
  provider: string;
  model: Model<Api>;
}): Model<Api> {
  if (!isOfficialDeepSeekApiBaseUrl(params.model.baseUrl)) {
    // Also accept provider ids that clearly target DeepSeek even if baseUrl is omitted
    // after registry merge (some paths only set provider).
    const providerId = normalizeProviderId(params.provider);
    const modelProvider = normalizeProviderId(params.model.provider ?? "");
    const looksLikeDeepSeek = providerId.includes("deepseek") || modelProvider.includes("deepseek");
    if (!looksLikeDeepSeek || params.model.baseUrl) {
      return params.model;
    }
  }

  const id = String(params.model.id ?? "").trim();
  if (id === "deepseek-chat") {
    return {
      ...params.model,
      id: "deepseek-v4-flash",
      reasoning: false,
    } as Model<Api>;
  }
  if (id === "deepseek-reasoner") {
    return {
      ...params.model,
      id: "deepseek-v4-flash",
      reasoning: true,
    } as Model<Api>;
  }
  return params.model;
}

function isOpenAIApiBaseUrl(baseUrl?: string): boolean {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return false;
  }
  return /^https?:\/\/api\.openai\.com(?:\/v1)?\/?$/i.test(trimmed);
}

function isOpenAICodexBaseUrl(baseUrl?: string): boolean {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return false;
  }
  return /^https?:\/\/chatgpt\.com\/backend-api\/?$/i.test(trimmed);
}

function normalizeOpenAICodexTransport(params: {
  provider: string;
  model: Model<Api>;
}): Model<Api> {
  if (normalizeProviderId(params.provider) !== "openai-codex") {
    return params.model;
  }

  const useCodexTransport =
    !params.model.baseUrl ||
    isOpenAIApiBaseUrl(params.model.baseUrl) ||
    isOpenAICodexBaseUrl(params.model.baseUrl);

  const nextApi =
    useCodexTransport && params.model.api === "openai-responses"
      ? ("openai-codex-responses" as const)
      : params.model.api;
  const nextBaseUrl =
    nextApi === "openai-codex-responses" &&
    (!params.model.baseUrl || isOpenAIApiBaseUrl(params.model.baseUrl))
      ? OPENAI_CODEX_BASE_URL
      : params.model.baseUrl;

  if (nextApi === params.model.api && nextBaseUrl === params.model.baseUrl) {
    return params.model;
  }

  return {
    ...params.model,
    api: nextApi,
    baseUrl: nextBaseUrl,
  } as Model<Api>;
}

function normalizeOpenAITransport(params: { provider: string; model: Model<Api> }): Model<Api> {
  if (normalizeProviderId(params.provider) !== "openai") {
    return params.model;
  }

  const useResponsesTransport =
    params.model.api === "openai-completions" &&
    (!params.model.baseUrl || isOpenAIApiBaseUrl(params.model.baseUrl));

  if (!useResponsesTransport) {
    return params.model;
  }

  return {
    ...params.model,
    api: "openai-responses",
  } as Model<Api>;
}

export function normalizeResolvedProviderModel(params: {
  provider: string;
  model: Model<Api>;
}): Model<Api> {
  const normalizedDeepSeek = normalizeDeepSeekLegacyModelIds(params);
  const normalizedOpenAI = normalizeOpenAITransport({
    provider: params.provider,
    model: normalizedDeepSeek,
  });
  const normalizedCodex = normalizeOpenAICodexTransport({
    provider: params.provider,
    model: normalizedOpenAI,
  });
  return normalizeModelCompat(ensureOfficialDeepSeekVisionInput(normalizedCodex));
}
