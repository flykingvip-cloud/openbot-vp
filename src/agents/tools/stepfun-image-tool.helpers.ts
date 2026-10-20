import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import {
  resolveAgentModelPrimaryValue,
  resolveAgentModelFallbackValues,
} from "../../config/model-input.js";
import type { AgentModelConfig } from "../../config/types.agents-shared.js";
import type { ModelProviderConfig } from "../../config/types.js";
import {
  STEPFUN_IMAGE_MODEL_ID,
  formatStepfunImageApiError,
  isAcceptableImageGenerationEndpoint,
} from "../image-generation-models.js";
import { parseModelRef } from "../model-selection.js";

export { STEPFUN_IMAGE_MODEL_ID };

export const STEPFUN_IMAGE_SIZES = [
  "1024x1024",
  "768x1360",
  "896x1184",
  "1360x768",
  "1184x896",
] as const;

export type StepfunImageSize = (typeof STEPFUN_IMAGE_SIZES)[number];

export type StepfunImageEndpointConfig = {
  provider: string;
  model: string;
  baseUrl: string;
};

/** Stepfun chat models use `/step_plan/v1`; image API lives under `/v1`. */
export function resolveStepfunImageApiBaseUrl(providerBaseUrl: string): string {
  const trimmed = providerBaseUrl.trim().replace(/\/+$/u, "");
  if (!trimmed) {
    return "https://api.stepfun.com/v1";
  }
  if (trimmed.endsWith("/step_plan/v1")) {
    return trimmed.replace(/\/step_plan\/v1$/u, "/v1");
  }
  return trimmed;
}

type StepfunImageApiResponse = {
  data?: Array<{ url?: string; b64_json?: string }>;
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
): StepfunImageEndpointConfig | null {
  const baseUrl = (providerCfg.baseUrl ?? "").trim().replace(/\/+$/u, "");
  if (!baseUrl) {
    return null;
  }
  return { provider, model, baseUrl };
}

function resolveFromModelRef(
  cfg: OpenBotConfig | undefined,
  modelRef: string,
): StepfunImageEndpointConfig | null {
  const parsed = parseModelRef(modelRef.trim(), "");
  if (!parsed?.provider || !parsed.model) {
    return null;
  }
  const providerCfg = resolveProviderConfig(cfg, parsed.provider);
  if (!providerCfg || !providerHasModel(providerCfg, parsed.model)) {
    return null;
  }
  const resolved = buildEndpointConfig(parsed.provider, parsed.model, providerCfg);
  if (!resolved || !isAcceptableImageGenerationEndpoint(resolved)) {
    return null;
  }
  return resolved;
}

function resolveFromAgentModelConfig(
  cfg: OpenBotConfig | undefined,
  modelConfig: AgentModelConfig | undefined,
): StepfunImageEndpointConfig | null {
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

function discoverStepfunImageEndpoint(
  cfg: OpenBotConfig | undefined,
): StepfunImageEndpointConfig | null {
  for (const [provider, providerCfg] of Object.entries(cfg?.models?.providers ?? {})) {
    if (providerHasModel(providerCfg, STEPFUN_IMAGE_MODEL_ID)) {
      const resolved = buildEndpointConfig(provider, STEPFUN_IMAGE_MODEL_ID, providerCfg);
      if (resolved && isAcceptableImageGenerationEndpoint(resolved)) {
        return resolved;
      }
    }
  }
  return null;
}

/**
 * Resolve the image_gen endpoint without treating vision `imageModel` as a
 * generation model. Chat ids such as `google/gemini-2.0-flash` are skipped so
 * Stepfun `/images/generations` is never called with a non-image model name.
 */
export function resolveStepfunImageEndpointConfig(
  cfg?: OpenBotConfig,
): StepfunImageEndpointConfig | null {
  const defaults = cfg?.agents?.defaults;
  const fromGenerationConfig = resolveFromAgentModelConfig(cfg, defaults?.imageGenerationModel);
  if (fromGenerationConfig) {
    return fromGenerationConfig;
  }
  const fromVisionSlotIfGeneration = resolveFromAgentModelConfig(cfg, defaults?.imageModel);
  if (fromVisionSlotIfGeneration) {
    return fromVisionSlotIfGeneration;
  }
  return discoverStepfunImageEndpoint(cfg);
}

export function normalizeStepfunImageSize(raw?: string): StepfunImageSize {
  const size = (raw ?? "1024x1024").trim();
  if (!STEPFUN_IMAGE_SIZES.includes(size as StepfunImageSize)) {
    throw new Error(`Invalid size '${size}'. Allowed values: ${STEPFUN_IMAGE_SIZES.join(", ")}.`);
  }
  return size as StepfunImageSize;
}

function mimeTypeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  return "image/png";
}

async function downloadImageUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to download generated image (${res.status}): ${text.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function extractImageBuffer(payload: StepfunImageApiResponse): Promise<Buffer> {
  const item = payload.data?.[0];
  if (!item) {
    throw new Error("Stepfun image API returned empty data.");
  }
  if (item.b64_json?.trim()) {
    return Buffer.from(item.b64_json, "base64");
  }
  if (item.url?.trim()) {
    return await downloadImageUrl(item.url.trim());
  }
  throw new Error("Stepfun image API returned no url or b64_json.");
}

export async function callStepfunImageGeneration(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  size: StepfunImageSize;
}): Promise<Buffer> {
  const url = `${resolveStepfunImageApiBaseUrl(params.baseUrl)}/images/generations`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      prompt: params.prompt,
      size: params.size,
      n: 1,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      formatStepfunImageApiError({
        action: "generation",
        status: res.status,
        body: text,
        model: params.model,
        url,
      }),
    );
  }
  return await extractImageBuffer((await res.json()) as StepfunImageApiResponse);
}

export async function callStepfunImageEdit(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  size: StepfunImageSize;
  imageBuffer: Buffer;
  filename: string;
}): Promise<Buffer> {
  const url = `${resolveStepfunImageApiBaseUrl(params.baseUrl)}/images/edits`;
  const form = new FormData();
  form.append("model", params.model);
  form.append("prompt", params.prompt);
  form.append("size", params.size);
  const mimeType = mimeTypeFromFilename(params.filename);
  form.append(
    "image",
    new Blob([new Uint8Array(params.imageBuffer)], { type: mimeType }),
    params.filename,
  );

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      formatStepfunImageApiError({
        action: "edit",
        status: res.status,
        body: text,
        model: params.model,
        url,
      }),
    );
  }
  return await extractImageBuffer((await res.json()) as StepfunImageApiResponse);
}

export async function saveGeneratedImageBuffer(params: {
  buffer: Buffer;
  workspaceDir?: string;
  prefix?: string;
}): Promise<string> {
  const dir = params.workspaceDir?.trim()
    ? path.join(params.workspaceDir.trim(), ".openbot", "generated-images")
    : path.join(os.tmpdir(), "openbot-generated-images");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${params.prefix ?? "stepfun"}-${Date.now()}.png`);
  await fs.writeFile(filePath, params.buffer);
  return filePath;
}

/** Prefer workspace-relative POSIX path so chat/UI can open the real file. */
export function toWorkspaceRelativeImagePath(absolutePath: string, workspaceDir?: string): string {
  const normalizedFile = absolutePath.trim().replace(/\\/g, "/");
  const ws = workspaceDir?.trim();
  if (ws) {
    const absWs = path.resolve(ws);
    const absFile = path.resolve(absolutePath);
    if (absFile === absWs || absFile.startsWith(`${absWs}${path.sep}`)) {
      return path.relative(absWs, absFile).split(path.sep).join("/");
    }
  }
  const marker = ".openbot/generated-images/";
  const idx = normalizedFile.lastIndexOf(marker);
  if (idx >= 0) {
    return normalizedFile.slice(idx);
  }
  return path.basename(normalizedFile);
}
