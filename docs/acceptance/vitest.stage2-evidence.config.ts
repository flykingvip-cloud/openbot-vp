import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["docs/acceptance/stage2-transcript-evidence.test.ts"],
      hookTimeout: 60_000,
      testTimeout: 60_000,
    },
  }),
);
