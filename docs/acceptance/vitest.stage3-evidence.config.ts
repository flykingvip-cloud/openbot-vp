import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: [
        "docs/acceptance/stage3-api-evidence.test.ts",
        "docs/acceptance/stage3-api03-policy-evidence.test.ts",
        "docs/acceptance/stage3-ws-events-evidence.test.ts",
        "docs/acceptance/stage3-cli-versioning-evidence.test.ts",
        "docs/acceptance/stage3-cli-backward-evidence.test.ts",
        "docs/acceptance/stage3-cli-idempotency-evidence.test.ts",
        "docs/acceptance/stage3-cli-authz-evidence.test.ts",
        "docs/acceptance/stage3-cli-errors-evidence.test.ts",
        "docs/acceptance/stage3-ws-request-backward-evidence.test.ts",
        "docs/acceptance/stage3-ws-request-authz-evidence.test.ts",
        "docs/acceptance/stage3-plugin-authz-evidence.test.ts",
        "docs/acceptance/stage3-plugin-schema-evidence.test.ts",
        "docs/acceptance/stage3-plugin-idempotency-evidence.test.ts",
        "docs/acceptance/stage3-plugin-errors-evidence.test.ts",
        "docs/acceptance/stage3-plugin-backward-evidence.test.ts",
      ],
      hookTimeout: 60_000,
      testTimeout: 60_000,
    },
  }),
);
