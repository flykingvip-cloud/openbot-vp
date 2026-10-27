/**
 * Config-gated modality executor wiring for TaskCapabilityPlan.
 *
 * Image / music stay unwired until a real generation endpoint is configured.
 * TTS / audio_understanding remain permanently unwired here (out of scope).
 */

import { resolveStepfunImageEndpointConfig } from "../../agents/tools/stepfun-image-tool.helpers.js";
import { resolveSunoMusicEndpointConfig } from "../../agents/tools/suno-music-tool.helpers.js";
import type { OpenBotConfig } from "../../config/types.js";

export type ModalityExecutorWiring = {
  imageGeneration: boolean;
  audioMusicGeneration: boolean;
  audioTts: boolean;
  audioUnderstanding: boolean;
};

export const DEFAULT_MODALITY_EXECUTOR_WIRING: ModalityExecutorWiring = {
  imageGeneration: false,
  audioMusicGeneration: false,
  audioTts: false,
  audioUnderstanding: false,
};

/**
 * Detect whether image / music generation tools can actually be constructed
 * from the current config. Does not check live API keys (auth is runtime).
 */
export function resolveModalityExecutorWiring(cfg?: OpenBotConfig | null): ModalityExecutorWiring {
  const imageGeneration = Boolean(resolveStepfunImageEndpointConfig(cfg ?? undefined));
  const audioMusicGeneration = Boolean(resolveSunoMusicEndpointConfig(cfg ?? undefined));
  return {
    ...DEFAULT_MODALITY_EXECUTOR_WIRING,
    imageGeneration,
    audioMusicGeneration,
  };
}
