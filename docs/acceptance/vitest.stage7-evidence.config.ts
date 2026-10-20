import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "../../vitest.config.ts";

// Vitest's dev server selects Lit's `development` export, which false-positives
// on this template under linkedom. Pin the production node builds.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const litDir = path.dirname(fs.realpathSync(path.join(repoRoot, "node_modules/lit")));
const litHtmlRoot = path.join(litDir, "lit-html");
const reactiveRoot = path.join(litDir, "@lit/reactive-element");

export default mergeConfig(
  baseConfig,
  defineConfig({
    mode: "production",
    resolve: {
      alias: [
        { find: /^lit-html$/, replacement: path.join(litHtmlRoot, "lit-html.js") },
        {
          find: /^@lit\/reactive-element$/,
          replacement: path.join(reactiveRoot, "reactive-element.js"),
        },
      ],
    },
    test: {
      include: [
        "docs/acceptance/stage7-surface-evidence.test.ts",
        "docs/acceptance/stage7-channel-doctor-evidence.test.ts",
        "docs/acceptance/stage7-channel-happy-evidence.test.ts",
      ],
      hookTimeout: 120_000,
      testTimeout: 120_000,
    },
  }),
);
