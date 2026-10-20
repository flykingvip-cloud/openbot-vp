import type { OpenBotConfig } from "./config.js";
import type { PluginAllowEntry } from "./types.plugins.js";

/** Extract the plugin id from an allow entry (plain string or `{ id, integrity? }`). */
export function pluginAllowEntryId(entry: PluginAllowEntry): string {
  if (typeof entry === "string") {
    return entry.trim();
  }
  if (entry && typeof entry === "object" && typeof entry.id === "string") {
    return entry.id.trim();
  }
  return "";
}

/** True when the allowlist contains the given plugin id (either entry form). */
export function pluginAllowlistIncludes(
  allow: PluginAllowEntry[] | undefined,
  pluginId: string,
): boolean {
  return (allow ?? []).some((entry) => pluginAllowEntryId(entry) === pluginId);
}

export function ensurePluginAllowlisted(cfg: OpenBotConfig, pluginId: string): OpenBotConfig {
  const allow = cfg.plugins?.allow;
  if (!Array.isArray(allow) || pluginAllowlistIncludes(allow, pluginId)) {
    return cfg;
  }
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      allow: [...allow, pluginId],
    },
  };
}
