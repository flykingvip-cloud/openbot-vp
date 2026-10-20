// Provider registrar — model/auth provider plugins (`api.registerProvider(...)`).
// Provider IDs must be globally unique across plugins; conflicts surface as
// errors rather than silent overrides.

import type { PluginRecord, RegistrarContext } from "../registry-types.js";
import type { ProviderPlugin } from "../types.js";

export function registerProvider(
  ctx: RegistrarContext,
  record: PluginRecord,
  provider: ProviderPlugin,
): void {
  const id = typeof provider?.id === "string" ? provider.id.trim() : "";
  if (!id) {
    ctx.pushDiagnostic({
      level: "error",
      pluginId: record.id,
      source: record.source,
      message: "provider registration missing id",
    });
    return;
  }
  const existing = ctx.registry.providers.find((entry) => entry.provider.id === id);
  if (existing) {
    ctx.pushDiagnostic({
      level: "error",
      pluginId: record.id,
      source: record.source,
      message: `provider already registered: ${id} (${existing.pluginId})`,
    });
    return;
  }
  record.providerIds.push(id);
  ctx.registry.providers.push({
    pluginId: record.id,
    provider,
    source: record.source,
  });
}
