import {
  CapabilityRegistry,
  LobsterPipelineSkill,
  PluginToolSkill,
  createBuiltinCapabilityRegistry,
  createBuiltinTaskTypeRegistry,
  type TaskTypeRegistry,
  type ToolInvoker,
} from "@openbot/aor-core";

/**
 * Capability registry with OpenBot Lobster + plugin tool skills wired to a
 * {@link ToolInvoker} (`POST /tools/invoke`).
 */
export function createOpenBotCapabilityRegistry(toolInvoker: ToolInvoker): CapabilityRegistry {
  const registry = createBuiltinCapabilityRegistry();
  registry.register(new LobsterPipelineSkill());
  registry.register(new PluginToolSkill());
  return registry;
}

/** Task types including `lobster.pipeline` and `plugin.tool`. */
export function createOpenBotTaskTypeRegistry(): TaskTypeRegistry {
  return createBuiltinTaskTypeRegistry();
}
