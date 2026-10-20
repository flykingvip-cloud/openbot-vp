import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import {
  assertP1BundlesFullPorts,
  resolveOpenBotSurface,
  selectPortsForSurface,
} from "../scripts/openbot-surface.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function normalizeBase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "/";
  }
  if (trimmed === "./") {
    return "./";
  }
  if (trimmed.endsWith("/")) {
    return trimmed;
  }
  return `${trimmed}/`;
}

export default defineConfig(() => {
  // SaaS full is the only shipping surface. Any other value fails the build
  // before Vite plans chunks, so platform stays in the bundle.
  const surface = resolveOpenBotSurface(process.env.OPENBOT_SURFACE);
  assertP1BundlesFullPorts(surface, selectPortsForSurface(surface));

  const envBase = process.env.OPENBOT_CONTROL_UI_BASE_PATH?.trim();
  const base = envBase ? normalizeBase(envBase) : "./";
  return {
    base,
    publicDir: path.resolve(here, "public"),
    resolve: {
      alias: {
        "node:crypto": path.resolve(here, "src/shims/node-crypto.ts"),
      },
    },
    optimizeDeps: {
      include: ["lit/directives/repeat.js"],
    },
    build: {
      outDir: path.resolve(here, "../dist/control-ui"),
      emptyOutDir: true,
      sourcemap: true,
      // Keep CI/onboard logs clean; current control UI chunking is intentionally above 500 kB.
      chunkSizeWarningLimit: 1024,
      // Do not modulepreload enterprise/vendor-jszip chunks from the entry HTML —
      // they must stay on-demand via dynamic import() (cold employee/enterprise boot).
      modulePreload: {
        resolveDependencies(_filename, deps) {
          return deps.filter(
            (dep) =>
              !dep.includes("enterprise-") &&
              !dep.includes("workbench") &&
              !dep.includes("platform-") &&
              !dep.includes("cost-budget") &&
              !dep.includes("pricing-v3") &&
              !dep.includes("vendor-jszip") &&
              !dep.includes("vendor-noble"),
          );
        },
      },
      rollupOptions: {
        output: {
          // Do NOT force enterprise surface files into manualChunks.
          // That pattern made Rollup place shared boot modules (gateway /
          // navigation / i18n / icons) into those named chunks, so the entry
          // gained static `import "./enterprise-*.js"` edges and cold
          // enterprise boot downloaded every surface chunk before paint.
          // Heavy surfaces already split via dynamic import() in
          // enterprise-surface-lazy.ts — keep that as the only boundary.
          // Vendor crypto/zip stay named so they never merge into the entry
          // when a surface pulls them through the dynamic import graph.
          manualChunks(id) {
            if (id.includes("node_modules/jszip")) {
              return "vendor-jszip";
            }
            if (id.includes("node_modules/@noble/")) {
              return "vendor-noble";
            }
            return undefined;
          },
        },
      },
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
    },
  };
});
