/**
 * Plugin loader record/diagnostic helpers.
 *
 * Owns the `PluginRecord` factory and the diagnostic-pushing helpers
 * previously inlined in `src/plugins/loader.ts`. Extracted per the
 * `gateway-plugins-monolith-decomposition` spec (Task 3.4). Behavior is
 * byte-for-byte equivalent to the pre-refactor implementation: the deprecated
 * `api.registerHttpHandler` hint is still surfaced verbatim, and diagnostics
 * are still appended in the same order with the same prefixes (Req 4.5,
 * 4.7, 4.8).
 */

import type { PluginRecord, PluginRegistry } from "../registry.js";
import type { PluginDiagnostic, PluginLogger } from "../types.js";

/**
 * Build a fresh `PluginRecord` with empty resource-count fields. The caller
 * is expected to mutate `kind`, `configUiHints`, and `configJsonSchema`
 * after manifest data is resolved.
 */
export function createPluginRecord(params: {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  source: string;
  origin: PluginRecord["origin"];
  workspaceDir?: string;
  enabled: boolean;
  configSchema: boolean;
}): PluginRecord {
  return {
    id: params.id,
    name: params.name ?? params.id,
    description: params.description,
    version: params.version,
    source: params.source,
    origin: params.origin,
    workspaceDir: params.workspaceDir,
    enabled: params.enabled,
    status: params.enabled ? "loaded" : "disabled",
    toolNames: [],
    hookNames: [],
    channelIds: [],
    providerIds: [],
    gatewayMethods: [],
    cliCommands: [],
    services: [],
    commands: [],
    httpRoutes: 0,
    hookCount: 0,
    configSchema: params.configSchema,
    configUiHints: undefined,
    configJsonSchema: undefined,
  };
}

/**
 * Record a plugin load/register failure: logs the error, marks the record as
 * `error`, appends it to the registry, and pushes a matching error
 * diagnostic. Adds a hint when the failure looks like the removed
 * `api.registerHttpHandler` deprecation surface so plugin authors get a
 * pointer to the new API.
 */
export function recordPluginError(params: {
  logger: PluginLogger;
  registry: PluginRegistry;
  record: PluginRecord;
  seenIds: Map<string, PluginRecord["origin"]>;
  pluginId: string;
  origin: PluginRecord["origin"];
  error: unknown;
  logPrefix: string;
  diagnosticMessagePrefix: string;
}) {
  const errorText = String(params.error);
  const deprecatedApiHint =
    errorText.includes("api.registerHttpHandler") && errorText.includes("is not a function")
      ? "deprecated api.registerHttpHandler(...) was removed; use api.registerHttpRoute(...) for plugin-owned routes or registerPluginHttpRoute(...) for dynamic lifecycle routes"
      : null;
  const displayError = deprecatedApiHint ? `${deprecatedApiHint} (${errorText})` : errorText;
  params.logger.error(`${params.logPrefix}${displayError}`);
  params.record.status = "error";
  params.record.error = displayError;
  params.registry.plugins.push(params.record);
  params.seenIds.set(params.pluginId, params.origin);
  params.registry.diagnostics.push({
    level: "error",
    pluginId: params.record.id,
    source: params.record.source,
    message: `${params.diagnosticMessagePrefix}${displayError}`,
  });
}

/**
 * Append a batch of diagnostics to the registry. Thin wrapper that exists to
 * keep the loader's "merge upstream diagnostics" call sites self-documenting.
 */
export function pushDiagnostics(diagnostics: PluginDiagnostic[], append: PluginDiagnostic[]) {
  diagnostics.push(...append);
}
