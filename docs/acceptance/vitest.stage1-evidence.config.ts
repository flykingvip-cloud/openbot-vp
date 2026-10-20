import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["docs/acceptance/stage1-auth-plugin-evidence.test.ts"],
    },
  }),
);
