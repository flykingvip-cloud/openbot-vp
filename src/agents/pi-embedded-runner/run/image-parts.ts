import type { ImageContent } from "@earendil-works/pi-ai/compat";

export type OpenAiCompatibleImagePart = {
  type: "image_url";
  image_url: { url: string };
};

export type OpenAiCompatibleTextPart = {
  type: "text";
  text: string;
};

export type OpenAiCompatibleContentPart = OpenAiCompatibleTextPart | OpenAiCompatibleImagePart;

const OBJECT_OBJECT_RE = /\[object Object\]/;

export function isStructuredImagePart(value: unknown): value is ImageContent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const part = value as { type?: unknown; data?: unknown; mimeType?: unknown };
  return (
    part.type === "image" &&
    typeof part.data === "string" &&
    part.data.length > 0 &&
    typeof part.mimeType === "string"
  );
}

/**
 * Convert OpenBot ImageContent blocks into Chat Completions `image_url` parts.
 * Never coerce the array through String() — that produces "[object Object]".
 */
export function toOpenAiCompatibleImageParts(images: ImageContent[]): OpenAiCompatibleImagePart[] {
  return images.filter(isStructuredImagePart).map((image) => ({
    type: "image_url",
    image_url: {
      url: `data:${image.mimeType};base64,${image.data}`,
    },
  }));
}

export function serializeMultimodalContent(params: {
  text?: string;
  images?: ImageContent[];
}): OpenAiCompatibleContentPart[] {
  const parts: OpenAiCompatibleContentPart[] = [];
  if (params.text?.trim()) {
    parts.push({ type: "text", text: params.text });
  }
  if (params.images && params.images.length > 0) {
    parts.push(...toOpenAiCompatibleImageParts(params.images));
  }
  return parts;
}

/** True when a payload was coerced through String(object) instead of structured JSON. */
export function containsObjectObjectToken(value: unknown): boolean {
  const rendered = typeof value === "string" ? value : JSON.stringify(value);
  return OBJECT_OBJECT_RE.test(rendered);
}

export function formatUnsupportedImageInputMessage(params: {
  provider?: string;
  modelId?: string;
  visionModelHint?: string;
}): string {
  const modelLabel =
    [params.provider, params.modelId].filter(Boolean).join("/") || "the current model";
  const hint = params.visionModelHint?.trim()
    ? ` Switch to ${params.visionModelHint.trim()}, or set input: ["text", "image"] on a vision-capable endpoint.`
    : ' Switch to a vision-capable model, or set input: ["text", "image"] on the provider model.';
  return `${modelLabel} does not support image input.${hint}`;
}
