/**
 * Image *generation* (text-to-image / image-edit) vs image *understanding* (vision).
 *
 * `agents.defaults.imageModel` is the vision slot. Sending a chat/vision id such as
 * `google/gemini-2.0-flash` to Stepfun `/images/generations` returns 404 with an empty
 * body, which looks like "the API is down".
 */

export const STEPFUN_IMAGE_MODEL_ID = "step-image-edit-2";

const KNOWN_IMAGE_GENERATION_MODEL_IDS = new Set([
  STEPFUN_IMAGE_MODEL_ID,
  "gpt-image-1",
  "dall-e-2",
  "dall-e-3",
]);

const GENERATION_TOKEN_RE =
  /image-edit|image-gen|image_gen|text2image|text-to-image|\bt2i\b|dall-e|dalle|gpt-image|imagen|\bflux\b|stable-diffusion|sdxl/i;

const VISION_UNDERSTANDING_RE =
  /vision|\bvlm\b|(^|[/\-_])vl([/\-_]|$)|gemini|gpt-4o|claude|kimi|qwen[-_]?vl/i;

export function imageGenerationModelId(modelRefOrId: string): string {
  const trimmed = modelRefOrId.trim();
  if (!trimmed) {
    return "";
  }
  const slash = trimmed.indexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(slash + 1).trim();
}

export function isImageGenerationModelId(modelRefOrId: string): boolean {
  const modelId = imageGenerationModelId(modelRefOrId).toLowerCase();
  if (!modelId) {
    return false;
  }
  if (KNOWN_IMAGE_GENERATION_MODEL_IDS.has(modelId)) {
    return true;
  }
  if (GENERATION_TOKEN_RE.test(modelId)) {
    return true;
  }
  return modelId.includes("image") && !VISION_UNDERSTANDING_RE.test(modelId);
}

export function isStepfunImageApiBaseUrl(baseUrl: string): boolean {
  const normalized = baseUrl.trim().toLowerCase();
  return normalized.includes("stepfun.com") || normalized.includes("/step_plan");
}

export function isStepfunImageGenerationModelId(modelRefOrId: string): boolean {
  const modelId = imageGenerationModelId(modelRefOrId).toLowerCase();
  return modelId === STEPFUN_IMAGE_MODEL_ID || modelId.startsWith("step-image");
}

export function isAcceptableImageGenerationEndpoint(params: {
  model: string;
  baseUrl: string;
}): boolean {
  if (!isImageGenerationModelId(params.model)) {
    return false;
  }
  if (isStepfunImageApiBaseUrl(params.baseUrl)) {
    return isStepfunImageGenerationModelId(params.model);
  }
  return true;
}

export function formatStepfunImageApiError(params: {
  action: "generation" | "edit";
  status: number;
  body: string;
  model: string;
  url: string;
}): string {
  const body = params.body.trim();
  const empty404Hint =
    !body && params.status === 404 && !isStepfunImageGenerationModelId(params.model)
      ? ` Empty 404 usually means model "${params.model}" is not a Stepfun image-generation model. Use ${STEPFUN_IMAGE_MODEL_ID} against /step_plan/v1/images/generations.`
      : "";
  const detail = body ? body.slice(0, 500) : "empty response.";
  return `Stepfun image ${params.action} failed (${params.status}): ${detail}${empty404Hint}`;
}
