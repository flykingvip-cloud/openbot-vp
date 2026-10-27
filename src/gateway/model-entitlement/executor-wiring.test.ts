// @vitest-environment node
import { describe, expect, it } from "vitest";
import { STEPFUN_IMAGE_MODEL_ID } from "../../agents/image-generation-models.js";
import { SUNO_MUSIC_MODEL_ID } from "../../agents/music-generation-models.js";
import type { OpenBotConfig } from "../../config/config.js";
import {
  DEFAULT_MODALITY_EXECUTOR_WIRING,
  resolveModalityExecutorWiring,
} from "./executor-wiring.js";

function cfgWithImageAndMusic(): OpenBotConfig {
  return {
    models: {
      providers: {
        stepfun: {
          baseUrl: "https://api.stepfun.com/v1",
          apiKey: "test-key",
          models: [{ id: STEPFUN_IMAGE_MODEL_ID }],
        },
        suno: {
          baseUrl: "https://api.sunoapi.org/api/v1",
          apiKey: "test-key",
          models: [{ id: SUNO_MUSIC_MODEL_ID }],
        },
      },
    },
    agents: {
      defaults: {
        imageGenerationModel: { primary: `stepfun/${STEPFUN_IMAGE_MODEL_ID}` },
        musicGenerationModel: { primary: `suno/${SUNO_MUSIC_MODEL_ID}` },
      },
    },
  } as unknown as OpenBotConfig;
}

describe("resolveModalityExecutorWiring", () => {
  it("defaults image/music unwired without config", () => {
    const wiring = resolveModalityExecutorWiring(undefined);
    expect(wiring).toEqual(DEFAULT_MODALITY_EXECUTOR_WIRING);
  });

  it("wires image and music when generation models are configured", () => {
    const wiring = resolveModalityExecutorWiring(cfgWithImageAndMusic());
    expect(wiring.imageGeneration).toBe(true);
    expect(wiring.audioMusicGeneration).toBe(true);
    expect(wiring.audioTts).toBe(false);
    expect(wiring.audioUnderstanding).toBe(false);
  });
});
