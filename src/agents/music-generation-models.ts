/**
 * Music *generation* model id recognition (Suno / soundtrack backends).
 *
 * Distinct from TTS (`agents` tts tool) and audio understanding.
 */

export const SUNO_MUSIC_MODEL_ID = "suno-v3";

const KNOWN_MUSIC_GENERATION_MODEL_IDS = new Set([
  SUNO_MUSIC_MODEL_ID,
  "suno",
  "suno-v3.5",
  "suno-v4",
  "chirp-v3",
  "chirp-auk",
]);

const MUSIC_TOKEN_RE = /\bsuno\b|\bchirp\b|music-?gen|text2music|text-to-music|\bt2m\b|soundtrack/i;

export function musicGenerationModelId(modelRefOrId: string): string {
  const trimmed = modelRefOrId.trim();
  if (!trimmed) {
    return "";
  }
  const slash = trimmed.indexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(slash + 1).trim();
}

export function isMusicGenerationModelId(modelRefOrId: string): boolean {
  const modelId = musicGenerationModelId(modelRefOrId).toLowerCase();
  if (!modelId) {
    return false;
  }
  if (KNOWN_MUSIC_GENERATION_MODEL_IDS.has(modelId)) {
    return true;
  }
  return MUSIC_TOKEN_RE.test(modelId);
}

export function isSunoMusicApiBaseUrl(baseUrl: string): boolean {
  const normalized = baseUrl.trim().toLowerCase();
  return (
    normalized.includes("suno") || normalized.includes("sunoapi") || normalized.includes("/music")
  );
}

export function isAcceptableMusicGenerationEndpoint(params: {
  model: string;
  baseUrl: string;
}): boolean {
  if (!isMusicGenerationModelId(params.model)) {
    return false;
  }
  // Any configured provider with a music-generation model id is acceptable;
  // base URL shape is validated at call time.
  return Boolean(params.baseUrl.trim());
}

export function formatSunoMusicApiError(params: {
  status: number;
  body: string;
  model: string;
  url: string;
}): string {
  const body = params.body.trim();
  const detail = body ? body.slice(0, 500) : "empty response.";
  return `Suno music generation failed (${params.status}) model=${params.model} url=${params.url}: ${detail}`;
}
