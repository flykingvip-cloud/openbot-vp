export type PluginEntryConfig = {
  enabled?: boolean;
  hooks?: {
    /** Controls prompt mutation via before_prompt_build and prompt fields from legacy before_agent_start. */
    allowPromptInjection?: boolean;
  };
  config?: Record<string, unknown>;
};

export type PluginSlotsConfig = {
  /** Select which plugin owns the memory slot ("none" disables memory plugins). */
  memory?: string;
  /** Select which plugin owns the context-engine slot. */
  contextEngine?: string;
};

export type PluginsLoadConfig = {
  /** Additional plugin/extension paths to load. */
  paths?: string[];
};

export type PluginInstallRecord = InstallRecordBase;

/**
 * Allowlist entry: a plain plugin id (back-compat) or an object that pins
 * the plugin entry file to a `sha256:<hex>` digest. When `integrity` is set,
 * a digest mismatch refuses the load (fail-closed).
 */
export type PluginAllowEntry =
  | string
  | {
      id: string;
      /** Optional integrity pin over the plugin entry file: "sha256:<hex>". */
      integrity?: string;
    };

export type PluginsConfig = {
  /** Enable or disable plugin loading. */
  enabled?: boolean;
  /** Optional plugin allowlist (plugin ids, optionally with integrity pins). */
  allow?: PluginAllowEntry[];
  /** Optional plugin denylist (plugin ids). */
  deny?: string[];
  load?: PluginsLoadConfig;
  slots?: PluginSlotsConfig;
  entries?: Record<string, PluginEntryConfig>;
  installs?: Record<string, PluginInstallRecord>;
};
import type { InstallRecordBase } from "./types.installs.js";
