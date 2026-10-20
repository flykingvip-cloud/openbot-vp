/**
 * Plugin loader orchestration driver.
 *
 * Owns the reduced `loadOpenBotPlugins(options)` body extracted from
 * `src/plugins/loader.ts` per the gateway-plugins-monolith-decomposition spec
 * (Task 3.5). All Sub_Module helpers (runtime-resolve, runtime-proxy,
 * candidate-validation, plugin-record, provenance, memory-slot-policy) are
 * imported from sibling files; the body of `loadOpenBotPlugins` is preserved
 * verbatim from the pre-refactor monolith and remains the sole entry point
 * called by external consumers via the `src/plugins/loader.ts` facade.
 *
 * Module-level `registryCache` remains a singleton owned by this module so
 * its caching behavior across calls is identical to the pre-refactor file.
 */

import fs from "node:fs";
import path from "node:path";
import type { GatewayRequestHandler } from "../../gateway/server-methods/types.js";
import { openBoundaryFileSync } from "../../infra/boundary-file-read.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { resolveUserPath } from "../../utils.js";
import { clearPluginCommands } from "../commands.js";
import {
  applyTestPluginDefaults,
  normalizePluginsConfig,
  resolveEffectiveEnableState,
  type NormalizedPluginsConfig,
} from "../config-state.js";
import { discoverOpenClawPlugins } from "../discovery.js";
import { initializeGlobalHookRunner } from "../hook-runner-global.js";
import { verifyPluginEntryIntegrity } from "../integrity.js";
import { loadPluginManifestRegistry } from "../manifest-registry.js";
import { createPluginRegistry, type PluginRecord, type PluginRegistry } from "../registry.js";
import { setActivePluginRegistry } from "../runtime.js";
import type { OpenClawPluginModule } from "../types.js";
import { resolvePluginModuleExport, validatePluginConfig } from "./candidate-validation.js";
import { createMemorySlotTracker } from "./memory-slot-policy.js";
import type { PluginLoadOptions } from "./plugin-load-options.js";
import { createPluginRecord, pushDiagnostics, recordPluginError } from "./plugin-record.js";
import {
  buildProvenanceIndex,
  warnAboutUntrackedLoadedPlugins,
  warnWhenAllowlistIsOpen,
} from "./provenance.js";
import { createPluginRuntimeProxy } from "./runtime-proxy.js";
import { createLazyJitiLoader } from "./runtime-resolve.js";

const registryCache = new Map<string, PluginRegistry>();

const defaultLogger = () => createSubsystemLogger("plugins");

function buildCacheKey(params: {
  workspaceDir?: string;
  plugins: NormalizedPluginsConfig;
}): string {
  const workspaceKey = params.workspaceDir ? resolveUserPath(params.workspaceDir) : "";
  return `${workspaceKey}::${JSON.stringify(params.plugins)}`;
}

function activatePluginRegistry(registry: PluginRegistry, cacheKey: string): void {
  setActivePluginRegistry(registry, cacheKey);
  initializeGlobalHookRunner(registry);
}

export function loadOpenBotPlugins(options: PluginLoadOptions = {}): PluginRegistry {
  // Test env: default-disable plugins unless explicitly configured.
  // This keeps unit/gateway suites fast and avoids loading heavyweight plugin deps by accident.
  const cfg = applyTestPluginDefaults(options.config ?? {}, process.env);
  const logger = options.logger ?? defaultLogger();
  const validateOnly = options.mode === "validate";
  const normalized = normalizePluginsConfig(cfg.plugins);
  const cacheKey = buildCacheKey({
    workspaceDir: options.workspaceDir,
    plugins: normalized,
  });
  const cacheEnabled = options.cache !== false;
  if (cacheEnabled) {
    const cached = registryCache.get(cacheKey);
    if (cached) {
      activatePluginRegistry(cached, cacheKey);
      return cached;
    }
  }

  // Clear previously registered plugin commands before reloading
  clearPluginCommands();

  // Lazily initialize the runtime so startup paths that discover/skip plugins do
  // not eagerly load every channel runtime dependency.
  const runtime = createPluginRuntimeProxy({ runtimeOptions: options.runtimeOptions });
  const { registry, createApi } = createPluginRegistry({
    logger,
    runtime,
    coreGatewayHandlers: options.coreGatewayHandlers as Record<string, GatewayRequestHandler>,
  });

  const discovery = discoverOpenClawPlugins({
    workspaceDir: options.workspaceDir,
    extraPaths: normalized.loadPaths,
    cache: options.cache,
  });
  const manifestRegistry = loadPluginManifestRegistry({
    config: cfg,
    workspaceDir: options.workspaceDir,
    cache: options.cache,
    candidates: discovery.candidates,
    diagnostics: discovery.diagnostics,
  });
  pushDiagnostics(registry.diagnostics, manifestRegistry.diagnostics);
  warnWhenAllowlistIsOpen({
    logger,
    pluginsEnabled: normalized.enabled,
    allow: normalized.allow,
    discoverablePlugins: manifestRegistry.plugins.map((plugin) => ({
      id: plugin.id,
      source: plugin.source,
      origin: plugin.origin,
    })),
  });
  const provenance = buildProvenanceIndex({
    config: cfg,
    normalizedLoadPaths: normalized.loadPaths,
  });

  // Lazy: avoid creating the Jiti loader when all plugins are disabled (common in unit tests).
  const getJiti = createLazyJitiLoader(import.meta.url);

  const manifestByRoot = new Map(
    manifestRegistry.plugins.map((record) => [record.rootDir, record]),
  );

  const seenIds = new Map<string, PluginRecord["origin"]>();
  const memorySlotTracker = createMemorySlotTracker(normalized.slots.memory);

  for (const candidate of discovery.candidates) {
    const manifestRecord = manifestByRoot.get(candidate.rootDir);
    if (!manifestRecord) {
      continue;
    }
    const pluginId = manifestRecord.id;
    const existingOrigin = seenIds.get(pluginId);
    if (existingOrigin) {
      const record = createPluginRecord({
        id: pluginId,
        name: manifestRecord.name ?? pluginId,
        description: manifestRecord.description,
        version: manifestRecord.version,
        source: candidate.source,
        origin: candidate.origin,
        workspaceDir: candidate.workspaceDir,
        enabled: false,
        configSchema: Boolean(manifestRecord.configSchema),
      });
      record.status = "disabled";
      record.error = `overridden by ${existingOrigin} plugin`;
      registry.plugins.push(record);
      continue;
    }

    const enableState = resolveEffectiveEnableState({
      id: pluginId,
      origin: candidate.origin,
      config: normalized,
      rootConfig: cfg,
    });
    const entry = normalized.entries[pluginId];
    const record = createPluginRecord({
      id: pluginId,
      name: manifestRecord.name ?? pluginId,
      description: manifestRecord.description,
      version: manifestRecord.version,
      source: candidate.source,
      origin: candidate.origin,
      workspaceDir: candidate.workspaceDir,
      enabled: enableState.enabled,
      configSchema: Boolean(manifestRecord.configSchema),
    });
    record.kind = manifestRecord.kind;
    record.configUiHints = manifestRecord.configUiHints;
    record.configJsonSchema = manifestRecord.configSchema;
    const pushPluginLoadError = (message: string) => {
      record.status = "error";
      record.error = message;
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      registry.diagnostics.push({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: record.error,
      });
    };

    if (!enableState.enabled) {
      record.status = "disabled";
      record.error = enableState.reason;
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      continue;
    }

    // Fast-path bundled memory plugins that are guaranteed disabled by slot policy.
    // This avoids opening/importing heavy memory plugin modules that will never register.
    if (candidate.origin === "bundled" && manifestRecord.kind === "memory") {
      const earlyMemoryDecision = memorySlotTracker.evaluateForRecord({
        id: record.id,
        kind: "memory",
      });
      if (!earlyMemoryDecision.enabled) {
        record.enabled = false;
        record.status = "disabled";
        record.error = earlyMemoryDecision.reason;
        registry.plugins.push(record);
        seenIds.set(pluginId, candidate.origin);
        continue;
      }
    }

    if (!manifestRecord.configSchema) {
      pushPluginLoadError("missing config schema");
      continue;
    }

    const pluginRoot = safeRealpathOrResolve(candidate.rootDir);
    const opened = openBoundaryFileSync({
      absolutePath: candidate.source,
      rootPath: pluginRoot,
      boundaryLabel: "plugin root",
      rejectHardlinks: candidate.origin !== "bundled",
      skipLexicalRootCheck: true,
    });
    if (!opened.ok) {
      pushPluginLoadError("plugin entry path escapes plugin root or fails alias checks");
      continue;
    }
    const safeSource = opened.path;
    // Integrity pin from plugins.allow: verify through the admitted fd, refuse on mismatch.
    const expectedIntegrity = normalized.allowIntegrity[pluginId];
    if (expectedIntegrity) {
      const integrityCheck = verifyPluginEntryIntegrity({
        fd: opened.fd,
        expected: expectedIntegrity,
      });
      if (!integrityCheck.ok) {
        fs.closeSync(opened.fd);
        pushPluginLoadError(`integrity check failed: ${integrityCheck.error}`);
        continue;
      }
    }
    fs.closeSync(opened.fd);

    let mod: OpenClawPluginModule | null = null;
    try {
      mod = getJiti()(safeSource) as OpenClawPluginModule;
    } catch (err) {
      recordPluginError({
        logger,
        registry,
        record,
        seenIds,
        pluginId,
        origin: candidate.origin,
        error: err,
        logPrefix: `[plugins] ${record.id} failed to load from ${record.source}: `,
        diagnosticMessagePrefix: "failed to load plugin: ",
      });
      continue;
    }

    const resolved = resolvePluginModuleExport(mod);
    const definition = resolved.definition;
    const register = resolved.register;

    if (definition?.id && definition.id !== record.id) {
      registry.diagnostics.push({
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: `plugin id mismatch (config uses "${record.id}", export uses "${definition.id}")`,
      });
    }

    record.name = definition?.name ?? record.name;
    record.description = definition?.description ?? record.description;
    record.version = definition?.version ?? record.version;
    const manifestKind = record.kind as string | undefined;
    const exportKind = definition?.kind as string | undefined;
    if (manifestKind && exportKind && exportKind !== manifestKind) {
      registry.diagnostics.push({
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: `plugin kind mismatch (manifest uses "${manifestKind}", export uses "${exportKind}")`,
      });
    }
    record.kind = definition?.kind ?? record.kind;

    memorySlotTracker.markMatchedFromManifest({ id: record.id, kind: record.kind });

    const memoryDecision = memorySlotTracker.evaluateForRecord({
      id: record.id,
      kind: record.kind,
    });

    if (!memoryDecision.enabled) {
      record.enabled = false;
      record.status = "disabled";
      record.error = memoryDecision.reason;
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      continue;
    }

    memorySlotTracker.commitSelectionIfApplicable(
      { id: record.id, kind: record.kind },
      memoryDecision,
    );

    const validatedConfig = validatePluginConfig({
      schema: manifestRecord.configSchema,
      cacheKey: manifestRecord.schemaCacheKey,
      value: entry?.config,
    });

    if (!validatedConfig.ok) {
      logger.error(`[plugins] ${record.id} invalid config: ${validatedConfig.errors?.join(", ")}`);
      pushPluginLoadError(`invalid config: ${validatedConfig.errors?.join(", ")}`);
      continue;
    }

    if (validateOnly) {
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
      continue;
    }

    if (typeof register !== "function") {
      logger.error(`[plugins] ${record.id} missing register/activate export`);
      pushPluginLoadError("plugin export missing register/activate");
      continue;
    }

    const api = createApi(record, {
      config: cfg,
      pluginConfig: validatedConfig.value,
      hookPolicy: entry?.hooks,
    });

    try {
      const result = register(api);
      if (result && typeof result.then === "function") {
        registry.diagnostics.push({
          level: "warn",
          pluginId: record.id,
          source: record.source,
          message: "plugin register returned a promise; async registration is ignored",
        });
      }
      registry.plugins.push(record);
      seenIds.set(pluginId, candidate.origin);
    } catch (err) {
      recordPluginError({
        logger,
        registry,
        record,
        seenIds,
        pluginId,
        origin: candidate.origin,
        error: err,
        logPrefix: `[plugins] ${record.id} failed during register from ${record.source}: `,
        diagnosticMessagePrefix: "plugin failed during register: ",
      });
    }
  }

  memorySlotTracker.pushUnmatchedSlotDiagnostic(registry);

  warnAboutUntrackedLoadedPlugins({
    registry,
    provenance,
    logger,
  });

  if (cacheEnabled) {
    registryCache.set(cacheKey, registry);
  }
  activatePluginRegistry(registry, cacheKey);
  return registry;
}

function safeRealpathOrResolve(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

/** @deprecated 仅兼容；新代码请使用 loadOpenBotPlugins。 */
export const loadOpenClawPlugins = loadOpenBotPlugins;
