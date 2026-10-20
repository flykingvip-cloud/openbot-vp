import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: [
        "docs/acceptance/stage6-sbom-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-filetype-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-markdown-it-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-fast-xml-parser-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-fast-xml-parser-gh4j-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-hono-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-hono-8j4g-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-hono-gqvv-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-hono-hxh3-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-hono-node-server-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-dompurify-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-dompurify-hpcv-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-dompurify-rp9w-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-dompurify-cmwh-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-dompurify-55q2-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-mysql2-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-qs-q8mj-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-qs-4mjr-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-music-metadata-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-ip-address-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-ip-address-j6r3-evidence.test.ts",
        "docs/acceptance/stage6-audit-moderate-morgan-evidence.test.ts",
      ],
      hookTimeout: 60_000,
      testTimeout: 120_000,
    },
  }),
);
