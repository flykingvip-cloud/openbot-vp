import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["docs/acceptance/stage7-mobile-device-evidence.test.ts"],
      hookTimeout: 30_000,
      testTimeout: 30_000,
    },
  }),
);
