import { vi } from "vitest";
import type { PluginRegistry } from "../plugins/registry.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";

export const registryState: { registry: PluginRegistry } = {
  registry: {
    plugins: [],
    tools: [],
    hooks: [],
    typedHooks: [],
    channels: [],
    providers: [],
    gatewayHandlers: {},
    httpHandlers: [],
    httpRoutes: [],
    cliRegistrars: [],
    services: [],
    commands: [],
    diagnostics: [],
  } as PluginRegistry,
};

export function setRegistry(registry: PluginRegistry) {
  registryState.registry = registry;
  setActivePluginRegistry(registry);
}

vi.mock("./server-plugins.js", async () => {
  const { setActivePluginRegistry } = await import("../plugins/runtime.js");
  const createFallbackGatewayContextHolder = () => {
    let context: unknown;
    return {
      set: (ctx: unknown) => {
        context = ctx;
      },
      clear: () => {
        context = undefined;
      },
      get: () => context,
    };
  };
  return {
    loadGatewayPlugins: (params: {
      baseMethods: string[];
      fallbackContextHolder?: ReturnType<typeof createFallbackGatewayContextHolder>;
    }) => {
      setActivePluginRegistry(registryState.registry);
      return {
        pluginRegistry: registryState.registry,
        gatewayMethods: params.baseMethods ?? [],
        fallbackContextHolder: params.fallbackContextHolder ?? createFallbackGatewayContextHolder(),
      };
    },
    createFallbackGatewayContextHolder,
    // Legacy: server.impl.ts no longer calls this, but kept for any callers that
    // still use the module-level setter during the deprecation window.
    setFallbackGatewayContext: vi.fn(),
  };
});
