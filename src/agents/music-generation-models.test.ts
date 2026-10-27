// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  SUNO_MUSIC_MODEL_ID,
  isAcceptableMusicGenerationEndpoint,
  isMusicGenerationModelId,
  musicGenerationModelId,
} from "./music-generation-models.js";

describe("music-generation-models", () => {
  it("recognizes suno model ids", () => {
    expect(isMusicGenerationModelId(SUNO_MUSIC_MODEL_ID)).toBe(true);
    expect(isMusicGenerationModelId("suno/suno-v4")).toBe(true);
    expect(musicGenerationModelId("suno/suno-v3")).toBe("suno-v3");
    expect(isMusicGenerationModelId("gpt-4o")).toBe(false);
  });

  it("accepts endpoints with music model + baseUrl", () => {
    expect(
      isAcceptableMusicGenerationEndpoint({
        model: SUNO_MUSIC_MODEL_ID,
        baseUrl: "https://api.sunoapi.org/api/v1",
      }),
    ).toBe(true);
    expect(
      isAcceptableMusicGenerationEndpoint({
        model: "gpt-4o",
        baseUrl: "https://api.sunoapi.org/api/v1",
      }),
    ).toBe(false);
  });
});
