// Channel-plugin registrar — `api.registerChannel(channel)` /
// `api.registerChannel({ plugin, dock })`.

import type { ChannelPlugin } from "../../channels/plugins/types.js";
import type { PluginRecord, RegistrarContext } from "../registry-types.js";
import type { OpenClawPluginChannelRegistration } from "../types.js";

export function registerChannel(
  ctx: RegistrarContext,
  record: PluginRecord,
  registration: OpenClawPluginChannelRegistration | ChannelPlugin,
): void {
  const normalized =
    typeof (registration as OpenClawPluginChannelRegistration).plugin === "object"
      ? (registration as OpenClawPluginChannelRegistration)
      : { plugin: registration as ChannelPlugin };
  const plugin = normalized.plugin;
  const id = typeof plugin?.id === "string" ? plugin.id.trim() : String(plugin?.id ?? "").trim();
  if (!id) {
    ctx.pushDiagnostic({
      level: "error",
      pluginId: record.id,
      source: record.source,
      message: "channel registration missing id",
    });
    return;
  }
  record.channelIds.push(id);
  ctx.registry.channels.push({
    pluginId: record.id,
    plugin,
    dock: normalized.dock,
    source: record.source,
  });
}
