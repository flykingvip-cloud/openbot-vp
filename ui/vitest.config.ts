import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

// The chromium browser runner is reserved for tests that genuinely need a real browser
// (layout/geometry, pixel snapshots, real DOM rendering) — i.e. `*.browser.test.ts`.
//
// Pure logic / controller tests (`*.test.ts`, `*.node.test.ts`) run under the canonical
// root `pnpm test` (node/jsdom), where `vi.mock` module mocking works. Vitest browser mode
// does not intercept relative-module `vi.mock` here, so running those suites in chromium
// produced false failures. Scoping the browser runner to `*.browser.test.ts` keeps each
// suite in the environment it was written for. The root node config includes other
// ui tests and excludes `*.browser.test.ts`; this browser config is what runs them.
export default defineConfig({
  // Transform cache — not the config-bundle .vite-temp path (see scripts/vitest-runner.mjs).
  cacheDir: join(tmpdir(), "openbot-ui-vitest-cache"),
  // Same alias as ui/vite.config.ts. Without it Vite externalizes `node:crypto`
  // for the browser, and a test file fails to import when its module graph
  // imports `createHash` from it (for example through the policy compiler).
  resolve: {
    alias: {
      "node:crypto": join(here, "src/shims/node-crypto.ts"),
    },
  },
  // Avoid Vite/Vitest default `::1` listen (operator EPERM on ::1:63315).
  server: {
    host: "127.0.0.1",
    strictPort: false,
  },
  preview: {
    host: "127.0.0.1",
    strictPort: false,
  },
  test: {
    include: ["src/**/*.browser.test.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium", name: "chromium" }],
      headless: true,
      ui: false,
      api: {
        host: "127.0.0.1",
      },
    },
  },
});
