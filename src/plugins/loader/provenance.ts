/**
 * Plugin loader provenance helpers.
 *
 * Owns the install/load-path provenance tracker previously inlined in
 * `src/plugins/loader.ts`. Extracted per the
 * `gateway-plugins-monolith-decomposition` spec (Task 3.4).
 *
 * Behavior contract (Req 4.5, 4.7, 4.8): `buildProvenanceIndex` produces an
 * index whose membership tests are byte-for-byte equivalent to the
 * pre-refactor inline implementation. Path matchers normalize via
 * `resolveUserPath`, dedupe across `exact`/`dirs`, and only treat a path as a
 * directory when `safeStatSync(...)` confirms `isDirectory()`. The
 * allowlist-open and untracked-load warnings still fire with the same
 * messages and cap-at-six preview.
 *
 * `PathMatcher`, `InstallTrackingRule`, and `PluginProvenanceIndex` are kept
 * module-local for now: the loader passes the index through opaquely, no
 * sibling Sub_Module references the inner shape, and exporting them would
 * widen the surface area unnecessarily.
 */

import type { OpenBotConfig } from "../../config/config.js";
import { resolveUserPath } from "../../utils.js";
import { isPathInside, safeStatSync } from "../path-safety.js";
import type { PluginRecord, PluginRegistry } from "../registry.js";
import type { PluginLogger } from "../types.js";

type PathMatcher = {
  exact: Set<string>;
  dirs: string[];
};

type InstallTrackingRule = {
  trackedWithoutPaths: boolean;
  matcher: PathMatcher;
};

export type PluginProvenanceIndex = {
  loadPathMatcher: PathMatcher;
  installRules: Map<string, InstallTrackingRule>;
};

export function createPathMatcher(): PathMatcher {
  return { exact: new Set<string>(), dirs: [] };
}

export function addPathToMatcher(matcher: PathMatcher, rawPath: string): void {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return;
  }
  const resolved = resolveUserPath(trimmed);
  if (!resolved) {
    return;
  }
  if (matcher.exact.has(resolved) || matcher.dirs.includes(resolved)) {
    return;
  }
  const stat = safeStatSync(resolved);
  if (stat?.isDirectory()) {
    matcher.dirs.push(resolved);
    return;
  }
  matcher.exact.add(resolved);
}

export function matchesPathMatcher(matcher: PathMatcher, sourcePath: string): boolean {
  if (matcher.exact.has(sourcePath)) {
    return true;
  }
  return matcher.dirs.some((dirPath) => isPathInside(dirPath, sourcePath));
}

/**
 * Build a provenance index from the workspace's load paths plus every
 * `plugins.installs[<id>]` entry. Installs without `installPath`/`sourcePath`
 * are flagged as `trackedWithoutPaths` so they still satisfy the provenance
 * check by id alone.
 */
export function buildProvenanceIndex(params: {
  config: OpenBotConfig;
  normalizedLoadPaths: string[];
}): PluginProvenanceIndex {
  const loadPathMatcher = createPathMatcher();
  for (const loadPath of params.normalizedLoadPaths) {
    addPathToMatcher(loadPathMatcher, loadPath);
  }

  const installRules = new Map<string, InstallTrackingRule>();
  const installs = params.config.plugins?.installs ?? {};
  for (const [pluginId, install] of Object.entries(installs)) {
    const rule: InstallTrackingRule = {
      trackedWithoutPaths: false,
      matcher: createPathMatcher(),
    };
    const trackedPaths = [install.installPath, install.sourcePath]
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
    if (trackedPaths.length === 0) {
      rule.trackedWithoutPaths = true;
    } else {
      for (const trackedPath of trackedPaths) {
        addPathToMatcher(rule.matcher, trackedPath);
      }
    }
    installRules.set(pluginId, rule);
  }

  return { loadPathMatcher, installRules };
}

/**
 * True when the given plugin's source path is covered either by an explicit
 * install record or by a configured load path. Installs flagged
 * `trackedWithoutPaths` always pass once their id matches.
 */
export function isTrackedByProvenance(params: {
  pluginId: string;
  source: string;
  index: PluginProvenanceIndex;
}): boolean {
  const sourcePath = resolveUserPath(params.source);
  const installRule = params.index.installRules.get(params.pluginId);
  if (installRule) {
    if (installRule.trackedWithoutPaths) {
      return true;
    }
    if (matchesPathMatcher(installRule.matcher, sourcePath)) {
      return true;
    }
  }
  return matchesPathMatcher(params.index.loadPathMatcher, sourcePath);
}

/**
 * Emit a warning when `plugins.allow` is empty but non-bundled candidates
 * exist on disk. Caps the preview at six ids and appends a `(+N more)`
 * marker so log lines stay bounded.
 */
export function warnWhenAllowlistIsOpen(params: {
  logger: PluginLogger;
  pluginsEnabled: boolean;
  allow: string[];
  discoverablePlugins: Array<{ id: string; source: string; origin: PluginRecord["origin"] }>;
}) {
  if (!params.pluginsEnabled) {
    return;
  }
  if (params.allow.length > 0) {
    return;
  }
  const nonBundled = params.discoverablePlugins.filter((entry) => entry.origin !== "bundled");
  if (nonBundled.length === 0) {
    return;
  }
  const preview = nonBundled
    .slice(0, 6)
    .map((entry) => `${entry.id} (${entry.source})`)
    .join(", ");
  const extra = nonBundled.length > 6 ? ` (+${nonBundled.length - 6} more)` : "";
  params.logger.warn(
    `[plugins] plugins.allow is empty; discovered non-bundled plugins may auto-load: ${preview}${extra}. Set plugins.allow to explicit trusted ids.`,
  );
}

/**
 * For each successfully loaded non-bundled plugin, push a warn diagnostic
 * (and matching log line) when neither install nor load-path provenance
 * covers it. Bundled plugins and non-loaded statuses are skipped.
 */
export function warnAboutUntrackedLoadedPlugins(params: {
  registry: PluginRegistry;
  provenance: PluginProvenanceIndex;
  logger: PluginLogger;
}) {
  for (const plugin of params.registry.plugins) {
    if (plugin.status !== "loaded" || plugin.origin === "bundled") {
      continue;
    }
    if (
      isTrackedByProvenance({
        pluginId: plugin.id,
        source: plugin.source,
        index: params.provenance,
      })
    ) {
      continue;
    }
    const message =
      "loaded without install/load-path provenance; treat as untracked local code and pin trust via plugins.allow or install records";
    params.registry.diagnostics.push({
      level: "warn",
      pluginId: plugin.id,
      source: plugin.source,
      message,
    });
    params.logger.warn(`[plugins] ${plugin.id}: ${message} (${plugin.source})`);
  }
}
