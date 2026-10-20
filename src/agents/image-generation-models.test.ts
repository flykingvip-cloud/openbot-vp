import { describe, expect, it } from "vitest";
import {
  STEPFUN_IMAGE_MODEL_ID,
  formatStepfunImageApiError,
  isAcceptableImageGenerationEndpoint,
  isImageGenerationModelId,
  isStepfunImageApiBaseUrl,
  isStepfunImageGenerationModelId,
} from "./image-generation-models.js";

describe("isImageGenerationModelId", () => {
  it("accepts known generation models", () => {
    expect(isImageGenerationModelId("step-image-edit-2")).toBe(true);
    expect(isImageGenerationModelId("阶跃星辰/step-image-edit-2")).toBe(true);
    expect(isImageGenerationModelId("openai/gpt-image-1")).toBe(true);
    expect(isImageGenerationModelId("dall-e-3")).toBe(true);
  });

  it("rejects chat and vision models that were previously sent to Stepfun", () => {
    expect(isImageGenerationModelId("google/gemini-2.0-flash")).toBe(false);
    expect(isImageGenerationModelId("gemini-2.0-flash")).toBe(false);
    expect(isImageGenerationModelId("阶跃星辰/gemini-2.0-flash")).toBe(false);
    expect(isImageGenerationModelId("openai/gpt-4.1-mini")).toBe(false);
    expect(isImageGenerationModelId("minimax/MiniMax-VL-01")).toBe(false);
  });
});

describe("Stepfun image endpoint guards", () => {
  it("detects Stepfun image API base URLs", () => {
    expect(isStepfunImageApiBaseUrl("https://api.stepfun.com/step_plan/v1")).toBe(true);
    expect(isStepfunImageApiBaseUrl("https://api.openai.com/v1")).toBe(false);
  });

  it("only allows step-image* models on Stepfun image endpoints", () => {
    expect(isStepfunImageGenerationModelId(STEPFUN_IMAGE_MODEL_ID)).toBe(true);
    expect(
      isAcceptableImageGenerationEndpoint({
        model: "gpt-image-1",
        baseUrl: "https://api.stepfun.com/step_plan/v1",
      }),
    ).toBe(false);
    expect(
      isAcceptableImageGenerationEndpoint({
        model: STEPFUN_IMAGE_MODEL_ID,
        baseUrl: "https://api.stepfun.com/step_plan/v1",
      }),
    ).toBe(true);
    expect(
      isAcceptableImageGenerationEndpoint({
        model: "gpt-image-1",
        baseUrl: "https://api.openai.com/v1",
      }),
    ).toBe(true);
    expect(
      isAcceptableImageGenerationEndpoint({
        model: "gemini-2.0-flash",
        baseUrl: "https://api.stepfun.com/step_plan/v1",
      }),
    ).toBe(false);
  });
});

describe("formatStepfunImageApiError", () => {
  it("explains empty 404 bodies caused by a chat model name", () => {
    const message = formatStepfunImageApiError({
      action: "generation",
      status: 404,
      body: "",
      model: "gemini-2.0-flash",
      url: "https://api.stepfun.com/step_plan/v1/images/generations",
    });
    expect(message).toContain("404");
    expect(message).toContain("empty response");
    expect(message).toContain("gemini-2.0-flash");
    expect(message).toContain(STEPFUN_IMAGE_MODEL_ID);
  });
});
