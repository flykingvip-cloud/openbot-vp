import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from "../../config/model-input.js";
import type { AgentModelConfig } from "../../config/types.agents-shared.js";
import type { ModelProviderConfig } from "../../config/types.js";
import { parseModelRef } from "../model-selection.js";
import {
  SUNO_MUSIC_MODEL_ID,
  formatSunoMusicApiError,
  isAcceptableMusicGenerationEndpoint,
  isMusicGenerationModelId,
} from "../music-generation-models.js";

export { SUNO_MUSIC_MODEL_ID };

export type SunoMusicEndpointConfig = {
  provider: string;
  model: string;
  baseUrl: string;
};

type SunoMusicApiResponse = {
  data?: Array<{ url?: string; b64_json?: string; audio_url?: string }>;
  audio_url?: string;
  url?: string;
};

function resolveProviderConfig(
  cfg: OpenBotConfig | undefined,
  provider: string,
): ModelProviderConfig | undefined {
  const providers = cfg?.models?.providers ?? {};
  const direct = providers[provider] as ModelProviderConfig | undefined;
  if (direct) {
    return direct;
  }
  return Object.entries(providers).find(([key]) => key === provider)?.[1];
}

function providerHasModel(providerCfg: ModelProviderConfig, modelId: string): boolean {
  return (providerCfg.models ?? []).some((entry) => (entry.id ?? "").trim() === modelId);
}

function buildEndpointConfig(
  provider: string,
  model: string,
  providerCfg: ModelProviderConfig,
): SunoMusicEndpointConfig | null {
  const baseUrl = (providerCfg.baseUrl ?? "").trim().replace(/\/+$/u, "");
  if (!baseUrl) {
    return null;
  }
  return { provider, model, baseUrl };
}

function resolveFromModelRef(
  cfg: OpenBotConfig | undefined,
  modelRef: string,
): SunoMusicEndpointConfig | null {
  const parsed = parseModelRef(modelRef.trim(), "");
  if (!parsed?.provider || !parsed.model) {
    return null;
  }
  const providerCfg = resolveProviderConfig(cfg, parsed.provider);
  if (!providerCfg || !providerHasModel(providerCfg, parsed.model)) {
    return null;
  }
  const resolved = buildEndpointConfig(parsed.provider, parsed.model, providerCfg);
  if (!resolved || !isAcceptableMusicGenerationEndpoint(resolved)) {
    return null;
  }
  return resolved;
}

function resolveFromAgentModelConfig(
  cfg: OpenBotConfig | undefined,
  modelConfig: AgentModelConfig | undefined,
): SunoMusicEndpointConfig | null {
  const primary = resolveAgentModelPrimaryValue(modelConfig);
  if (primary) {
    const resolved = resolveFromModelRef(cfg, primary);
    if (resolved) {
      return resolved;
    }
  }
  for (const fallback of resolveAgentModelFallbackValues(modelConfig)) {
    const resolved = resolveFromModelRef(cfg, fallback);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function discoverSunoMusicEndpoint(cfg: OpenBotConfig | undefined): SunoMusicEndpointConfig | null {
  for (const [provider, providerCfg] of Object.entries(cfg?.models?.providers ?? {})) {
    for (const entry of providerCfg.models ?? []) {
      const modelId = (entry.id ?? "").trim();
      if (!modelId || !isMusicGenerationModelId(modelId)) {
        continue;
      }
      const resolved = buildEndpointConfig(provider, modelId, providerCfg);
      if (resolved && isAcceptableMusicGenerationEndpoint(resolved)) {
        return resolved;
      }
    }
    if (providerHasModel(providerCfg, SUNO_MUSIC_MODEL_ID)) {
      const resolved = buildEndpointConfig(provider, SUNO_MUSIC_MODEL_ID, providerCfg);
      if (resolved && isAcceptableMusicGenerationEndpoint(resolved)) {
        return resolved;
      }
    }
  }
  return null;
}

/**
 * Resolve music_gen endpoint from agents.defaults.musicGenerationModel or
 * by discovering a configured Suno / music-generation model in providers.
 */
export function resolveSunoMusicEndpointConfig(
  cfg?: OpenBotConfig,
): SunoMusicEndpointConfig | null {
  const defaults = cfg?.agents?.defaults;
  const fromGenerationConfig = resolveFromAgentModelConfig(cfg, defaults?.musicGenerationModel);
  if (fromGenerationConfig) {
    return fromGenerationConfig;
  }
  return discoverSunoMusicEndpoint(cfg);
}

export function resolveSunoMusicApiUrl(providerBaseUrl: string): string {
  const trimmed = providerBaseUrl.trim().replace(/\/+$/u, "");
  if (!trimmed) {
    return "https://api.sunoapi.org/api/v1/music/generations";
  }
  if (/\/music(\/generations)?$/i.test(trimmed)) {
    return trimmed.endsWith("/generations") ? trimmed : `${trimmed}/generations`;
  }
  return `${trimmed}/music/generations`;
}

async function downloadAudioUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to download generated audio (${res.status}): ${text.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function extractAudioBuffer(payload: SunoMusicApiResponse): Promise<Buffer> {
  const item = payload.data?.[0];
  const directUrl =
    item?.url?.trim() ||
    item?.audio_url?.trim() ||
    payload.audio_url?.trim() ||
    payload.url?.trim();
  if (item?.b64_json?.trim()) {
    return Buffer.from(item.b64_json, "base64");
  }
  if (directUrl) {
    return await downloadAudioUrl(directUrl);
  }
  throw new Error("Suno music API returned no url, audio_url, or b64_json.");
}

export async function callSunoMusicGeneration(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  durationSeconds?: number;
  fetchImpl?: typeof fetch;
}): Promise<Buffer> {
  const url = resolveSunoMusicApiUrl(params.baseUrl);
  const fetchFn = params.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
  };
  if (typeof params.durationSeconds === "number" && params.durationSeconds > 0) {
    body.duration_seconds = Math.floor(params.durationSeconds);
  }
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      formatSunoMusicApiError({
        status: res.status,
        body: text,
        model: params.model,
        url,
      }),
    );
  }
  return await extractAudioBuffer((await res.json()) as SunoMusicApiResponse);
}

export async function saveGeneratedAudioBuffer(params: {
  buffer: Buffer;
  workspaceDir?: string;
  prefix?: string;
  extension?: string;
}): Promise<string> {
  const dir = params.workspaceDir?.trim()
    ? path.join(params.workspaceDir.trim(), ".openbot", "generated-audio")
    : path.join(os.tmpdir(), "openbot-generated-audio");
  await fs.mkdir(dir, { recursive: true });
  const ext = (params.extension ?? "mp3").replace(/^\./u, "");
  const filePath = path.join(dir, `${params.prefix ?? "suno"}-${Date.now()}.${ext}`);
  await fs.writeFile(filePath, params.buffer);
  return filePath;
}

export function toWorkspaceRelativeAudioPath(absolutePath: string, workspaceDir?: string): string {
  const normalizedFile = absolutePath.trim().replace(/\\/g, "/");
  const ws = workspaceDir?.trim();
  if (ws) {
    const absWs = path.resolve(ws);
    const absFile = path.resolve(absolutePath);
    if (absFile === absWs || absFile.startsWith(`${absWs}${path.sep}`)) {
      return path.relative(absWs, absFile).split(path.sep).join("/");
    }
  }
  const marker = ".openbot/generated-audio/";
  const idx = normalizedFile.lastIndexOf(marker);
  if (idx >= 0) {
    return normalizedFile.slice(idx);
  }
  return path.basename(normalizedFile);
}
