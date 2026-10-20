// Public entry for the plugin registry subsystem.
//
// History: this file used to be ~620 lines holding both the type
// definitions, the diagnostic sink, and a closure-based registrar for every
// plugin resource (tools, hooks, channels, providers, http routes, ...).
//
// It has been split into focused units:
//   - registry-types.ts: PluginRegistry / PluginRecord / Registration shapes
//   - registry-registrars/*: one file per resource kind, all expressed as
//     `(ctx, record, args) => void` so they're directly testable
//
// This file is now the API facade. It re-exports the types (so existing
// imports like `import { PluginRegistry } from "../plugins/registry.js"`
// keep working unchanged) and assembles the registrars into the public
// `OpenClawPluginApi` factory used during plugin load.

import { registerContextEngine } from "../context-engine/registry.js";
import type { GatewayRequestHandlers } from "../gateway/server-methods/types.js";
import { resolveUserPath } from "../utils.js";
import {
  registerChannel,
  registerCli,
  registerCommand,
  registerGatewayMethod,
  registerHook,
  registerHttpRoute,
  registerProvider,
  registerService,
  registerTool,
  registerTypedHook,
} from "./registry-registrars/index.js";
import {
  createEmptyPluginRegistry,
  type PluginChannelRegistration,
  type PluginCliRegistration,
  type PluginCommandRegistration,
  type PluginHookRegistration,
  type PluginHttpRouteRegistration,
  type PluginProviderRegistration,
  type PluginRecord,
  type PluginRegistry,
  type PluginRegistryParams,
  type PluginServiceRegistration,
  type PluginToolRegistration,
  type PluginTypedHookPolicy,
  type RegistrarContext,
} from "./registry-types.js";
import type { OpenClawPluginApi, PluginDiagnostic, PluginLogger } from "./types.js";

// Re-export the public type/value surface so consumers continue to import
// from `./registry.js` without churn.
export type {
  PluginChannelRegistration,
  PluginCliRegistration,
  PluginCommandRegistration,
  PluginHookRegistration,
  PluginHttpRouteRegistration,
  PluginProviderRegistration,
  PluginRecord,
  PluginRegistry,
  PluginRegistryParams,
  PluginServiceRegistration,
  PluginToolRegistration,
};
export { createEmptyPluginRegistry };

const normalizeLogger = (logger: PluginLogger): PluginLogger => ({
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  debug: logger.debug,
});

function buildRegistrarContext(
  registry: PluginRegistry,
  coreGatewayHandlers: GatewayRequestHandlers | undefined,
): RegistrarContext {
  return {
    registry,
    coreGatewayMethods: new Set(Object.keys(coreGatewayHandlers ?? {})),
    pushDiagnostic(diag: PluginDiagnostic) {
      registry.diagnostics.push(diag);
    },
  };
}

export function createPluginRegistry(registryParams: PluginRegistryParams) {
  const registry = createEmptyPluginRegistry();
  const ctx = buildRegistrarContext(registry, registryParams.coreGatewayHandlers);

  const createApi = (
    record: PluginRecord,
    params: {
      config: OpenClawPluginApi["config"];
      pluginConfig?: Record<string, unknown>;
      hookPolicy?: PluginTypedHookPolicy;
    },
  ): OpenClawPluginApi => {
    return {
      id: record.id,
      name: record.name,
      version: record.version,
      description: record.description,
      source: record.source,
      config: params.config,
      pluginConfig: params.pluginConfig,
      runtime: registryParams.runtime,
      logger: normalizeLogger(registryParams.logger),
      registerTool: (tool, opts) => registerTool(ctx, record, tool, opts),
      registerHook: (events, handler, opts) =>
        registerHook(ctx, record, events, handler, opts, params.config),
      registerHttpRoute: (httpParams) => registerHttpRoute(ctx, record, httpParams),
      registerChannel: (registration) => registerChannel(ctx, record, registration),
      registerProvider: (provider) => registerProvider(ctx, record, provider),
      registerGatewayMethod: (method, handler) =>
        registerGatewayMethod(ctx, record, method, handler),
      registerCli: (registrar, opts) => registerCli(ctx, record, registrar, opts),
      registerService: (service) => registerService(ctx, record, service),
      registerCommand: (command) => registerCommand(ctx, record, command),
      registerContextEngine: (id, factory) => registerContextEngine(id, factory),
      resolvePath: (input: string) => resolveUserPath(input),
      on: (hookName, handler, opts) =>
        registerTypedHook(ctx, record, hookName, handler, opts, params.hookPolicy),
    };
  };

  return {
    registry,
    createApi,
    pushDiagnostic: ctx.pushDiagnostic,
  };
}
