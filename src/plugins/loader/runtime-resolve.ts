/**
 * Plugin loader runtime-resolve helpers.
 *
 * Owns the plugin-sdk alias map and the lazy jiti factory. Extracted from
 * `src/plugins/loader.ts` per the gateway-plugins-monolith-decomposition spec
 * (Task 3.2). The facade at `src/plugins/loader.ts` re-exports the
 * `__testing` shape verbatim from this module so external consumers and the
 * existing alias-machinery tests continue to resolve identically.
 *
 * Behavior contract (Req 3.4): alias path lookup, candidate order, and the
 * jiti option set are byte-for-byte equivalent to the pre-refactor
 * implementation. `scripts/copy-plugin-sdk-root-alias.mjs` is NOT edited; the
 * `dist/plugin-sdk/root-alias.cjs` and `src/plugin-sdk/root-alias.cjs` paths
 * it writes are still searched here in the same order.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { resolveOpenClawPackageRootSync } from "../../infra/openclaw-root.js";

export type PluginSdkAliasCandidateKind = "dist" | "src";

export function resolvePluginSdkAliasCandidateOrder(params: {
  modulePath: string;
  isProduction: boolean;
}): PluginSdkAliasCandidateKind[] {
  const normalizedModulePath = params.modulePath.replace(/\\/g, "/");
  const isDistRuntime = normalizedModulePath.includes("/dist/");
  return isDistRuntime || params.isProduction ? ["dist", "src"] : ["src", "dist"];
}

export function listPluginSdkAliasCandidates(params: {
  srcFile: string;
  distFile: string;
  modulePath: string;
}): string[] {
  const orderedKinds = resolvePluginSdkAliasCandidateOrder({
    modulePath: params.modulePath,
    isProduction: process.env.NODE_ENV === "production",
  });
  let cursor = path.dirname(params.modulePath);
  const candidates: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const candidateMap = {
      src: path.join(cursor, "src", "plugin-sdk", params.srcFile),
      dist: path.join(cursor, "dist", "plugin-sdk", params.distFile),
    } as const;
    for (const kind of orderedKinds) {
      candidates.push(candidateMap[kind]);
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return candidates;
}

export const resolvePluginSdkAliasFile = (params: {
  srcFile: string;
  distFile: string;
  modulePath?: string;
}): string | null => {
  try {
    const modulePath = params.modulePath ?? fileURLToPath(import.meta.url);
    for (const candidate of listPluginSdkAliasCandidates({
      srcFile: params.srcFile,
      distFile: params.distFile,
      modulePath,
    })) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    // ignore
  }
  return null;
};

export const resolvePluginSdkAlias = (): string | null =>
  resolvePluginSdkAliasFile({ srcFile: "root-alias.cjs", distFile: "root-alias.cjs" });

const cachedPluginSdkExportedSubpaths = new Map<string, string[]>();

export function listPluginSdkExportedSubpaths(params: { modulePath?: string } = {}): string[] {
  const modulePath = params.modulePath ?? fileURLToPath(import.meta.url);
  const packageRoot = resolveOpenClawPackageRootSync({
    cwd: path.dirname(modulePath),
  });
  if (!packageRoot) {
    return [];
  }
  const cached = cachedPluginSdkExportedSubpaths.get(packageRoot);
  if (cached) {
    return cached;
  }
  try {
    const pkgRaw = fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgRaw) as {
      exports?: Record<string, unknown>;
    };
    const subpaths = Object.keys(pkg.exports ?? {})
      .filter((key) => key.startsWith("./plugin-sdk/"))
      .map((key) => key.slice("./plugin-sdk/".length))
      .filter((subpath) => Boolean(subpath) && !subpath.includes("/"))
      .toSorted();
    cachedPluginSdkExportedSubpaths.set(packageRoot, subpaths);
    return subpaths;
  } catch {
    return [];
  }
}

export const resolvePluginSdkScopedAliasMap = (): Record<string, string> => {
  const aliasMap: Record<string, string> = {};
  for (const subpath of listPluginSdkExportedSubpaths()) {
    const resolved = resolvePluginSdkAliasFile({
      srcFile: `${subpath}.ts`,
      distFile: `${subpath}.js`,
    });
    if (resolved) {
      aliasMap[`openclaw/plugin-sdk/${subpath}`] = resolved;
    }
  }
  return aliasMap;
};

/**
 * Builds the jiti option bag the loader has historically passed to
 * `createJiti`: `interopDefault: true`, the same `extensions` array, and the
 * combined plugin-sdk alias map (root alias + scoped subpaths). Extracted so
 * the lazy factory below and any future call sites stay in sync.
 */
function buildJitiOptions(): Parameters<typeof createJiti>[1] {
  const pluginSdkAlias = resolvePluginSdkAlias();
  const aliasMap = {
    ...(pluginSdkAlias ? { "openclaw/plugin-sdk": pluginSdkAlias } : {}),
    ...resolvePluginSdkScopedAliasMap(),
  };
  return {
    interopDefault: true,
    extensions: [".ts", ".tsx", ".mts", ".cts", ".mtsx", ".ctsx", ".js", ".mjs", ".cjs", ".json"],
    ...(Object.keys(aliasMap).length > 0
      ? {
          alias: aliasMap,
        }
      : {}),
  };
}

export type LazyJitiLoader = () => ReturnType<typeof createJiti>;

/**
 * Creates a per-call lazy jiti loader. Mirrors the closure-scoped `getJiti`
 * the pre-refactor `loadOpenBotPlugins` carried: the underlying jiti
 * instance is constructed at most once per call to `loadOpenBotPlugins`,
 * and not at all when every plugin is disabled.
 *
 * `moduleUrl` is the parent URL passed to `createJiti` and SHOULD be
 * `import.meta.url` of the caller so that jiti resolves relative paths
 * exactly the way the pre-refactor loader did (`src/plugins/loader.ts`).
 */
export function createLazyJitiLoader(moduleUrl: string): LazyJitiLoader {
  let jitiLoader: ReturnType<typeof createJiti> | null = null;
  return () => {
    if (jitiLoader) {
      return jitiLoader;
    }
    jitiLoader = createJiti(moduleUrl, buildJitiOptions());
    return jitiLoader;
  };
}

/**
 * Public testing surface re-exported by the `loader.ts` facade as
 * `__testing`. The shape is locked by `baseline/loader.md` (Req 2.1) and
 * MUST NOT change without a coordinated baseline refresh.
 */
export const __testing = {
  listPluginSdkAliasCandidates,
  listPluginSdkExportedSubpaths,
  resolvePluginSdkAliasCandidateOrder,
  resolvePluginSdkAliasFile,
};
