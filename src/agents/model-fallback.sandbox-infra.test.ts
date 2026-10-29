import { describe, expect, it } from "vitest";
import { runWithModelFallback } from "./model-fallback.js";
import { makeModelFallbackCfg } from "./test-helpers/model-fallback-config-fixture.js";

describe("runWithModelFallback sandbox infra", () => {
  it("rethrows 云电脑 / docker create failures without trying the next model", async () => {
    const attempts: string[] = [];
    const infra = new Error(
      "云电脑没有启动：docker create failed: Unable to find image 'openbot-sandbox-browser:trixie' locally",
    );
    const cfg = makeModelFallbackCfg({
      agents: {
        defaults: {
          model: {
            primary: "api-proxy-deepseek/deepseek-v4-flash",
            fallbacks: ["api-proxy-deepseek/deepseek-chat"],
          },
        },
      },
    });
    await expect(
      runWithModelFallback({
        cfg,
        provider: "api-proxy-deepseek",
        model: "deepseek-v4-flash",
        run: async (provider, model) => {
          attempts.push(`${provider}/${model}`);
          throw infra;
        },
      }),
    ).rejects.toBe(infra);
    expect(attempts).toEqual(["api-proxy-deepseek/deepseek-v4-flash"]);
  });
});
