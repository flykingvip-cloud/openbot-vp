import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: [
        "docs/acceptance/stage4-store-evidence.test.ts",
        "docs/acceptance/stage4-doctor-migration-evidence.test.ts",
        "docs/acceptance/stage4-tenant-store-shard-evidence.test.ts",
        "docs/acceptance/stage4-pin-single-shot-evidence.test.ts",
        "docs/acceptance/stage4-knowledge-archive-restore-evidence.test.ts",
      ],
      hookTimeout: 60_000,
      testTimeout: 60_000,
    },
  }),
);
