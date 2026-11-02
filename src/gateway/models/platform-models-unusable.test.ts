import { describe, expect, it } from "vitest";
import { listUnusablePlatformModels } from "./platform-models-unusable.js";

describe("listUnusablePlatformModels", () => {
  it("reports configured models whose latest probe failed and ignores success and unknown models", () => {
    expect(
      listUnusablePlatformModels({
        probes: [
          {
            provider: "api-proxy-deepseek",
            model: "deepseek-v4-flash",
            status: "auth",
            error: "401",
            label: "DeepSeek",
          },
          {
            provider: "api-proxy-deepseek",
            model: "deepseek-chat",
            status: "ok",
            label: "chat",
          },
          { provider: "other", model: "ghost", status: "timeout", label: "ghost" },
        ],
        configuredModelIds: [
          "api-proxy-deepseek/deepseek-v4-flash",
          "api-proxy-deepseek/deepseek-chat",
        ],
      }),
    ).toEqual([
      {
        modelId: "api-proxy-deepseek/deepseek-v4-flash",
        status: "auth",
        label: "DeepSeek",
        error: "401",
      },
    ]);
  });
});
