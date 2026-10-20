/**
 * Turn-time bindings for composer MCP/plugin @ mentions.
 *
 * Connector mentions (`plugin:connector:…`) prefer the existing
 * `user_operational_identity` tool (already on the core tool list).
 * Extension plugin mentions (`plugin:ext:…`) merge into the optional
 * plugin-tool allowlist so `resolvePluginTools` attaches that plugin's tools.
 */

import { resolveMentionTarget } from "../../organization/mention-target.js";
import type { MentionMetadata } from "../../organization/mention-types.js";

export type ComposerPluginMentionConnector = {
  provider?: string;
  identityId?: string;
  displayName?: string;
  /** Raw mention pluginId (e.g. plugin:connector:github-personal:id-github). */
  pluginId: string;
};

export type ComposerPluginMentionPlugin = {
  /** OpenBot plugin id used by resolvePluginTools / allowlist (e.g. origin). */
  openBotPluginId: string;
  displayName?: string;
  pluginId: string;
};

export type ComposerPluginMentionBindings = {
  connectors: ComposerPluginMentionConnector[];
  plugins: ComposerPluginMentionPlugin[];
  /** Entries merged into createOpenClawCodingTools pluginToolAllowlist. */
  pluginToolAllowlist: string[];
  /** System-prompt fragment directing this turn at mentioned tools. */
  turnPrompt?: string;
};

const PLUGIN_PREFIX = "plugin:";
const CONNECTOR_PREFIX = "connector:";
const EXT_PREFIX = "ext:";

export function stripComposerPluginMentionPrefix(pluginId: string): string {
  const trimmed = pluginId.trim();
  if (trimmed.toLowerCase().startsWith(PLUGIN_PREFIX)) {
    return trimmed.slice(PLUGIN_PREFIX.length);
  }
  return trimmed;
}

/**
 * Parse a composer plugin mention id into connector vs OpenBot-plugin binding.
 * Connector ids prefer `connector:<provider>:<identityId>` (provider required for
 * user_operational_identity). Legacy `connector:<id>` is still accepted.
 */
export function parseComposerPluginMentionId(pluginId: string): {
  kind: "connector" | "plugin";
  provider?: string;
  identityId?: string;
  openBotPluginId?: string;
} | null {
  const raw = stripComposerPluginMentionPrefix(pluginId).trim();
  if (!raw) {
    return null;
  }
  const lower = raw.toLowerCase();
  if (lower.startsWith(CONNECTOR_PREFIX)) {
    const rest = raw.slice(CONNECTOR_PREFIX.length);
    const parts = rest
      .split(":")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      return {
        kind: "connector",
        provider: parts[0],
        identityId: parts.slice(1).join(":"),
      };
    }
    if (parts.length === 1) {
      // Legacy: single segment may be provider or identityId.
      return { kind: "connector", identityId: parts[0], provider: parts[0] };
    }
    return null;
  }
  if (lower.startsWith(EXT_PREFIX)) {
    const openBotPluginId = raw.slice(EXT_PREFIX.length).trim();
    return openBotPluginId ? { kind: "plugin", openBotPluginId } : null;
  }
  return { kind: "plugin", openBotPluginId: raw };
}

function mentionPluginId(mention: MentionMetadata): string | undefined {
  const target = resolveMentionTarget(mention);
  if (target?.kind === "plugin") {
    return target.pluginId.trim() || undefined;
  }
  if (mention.targetKind === "plugin" && mention.targetId?.trim()) {
    return mention.targetId.trim();
  }
  return undefined;
}

export function resolveComposerPluginMentionBindings(
  mentions: readonly MentionMetadata[] | null | undefined,
): ComposerPluginMentionBindings {
  const connectors: ComposerPluginMentionConnector[] = [];
  const plugins: ComposerPluginMentionPlugin[] = [];
  const allowSeen = new Set<string>();
  const connectorSeen = new Set<string>();
  const pluginSeen = new Set<string>();

  for (const mention of mentions ?? []) {
    const pluginId = mentionPluginId(mention);
    if (!pluginId) {
      continue;
    }
    const parsed = parseComposerPluginMentionId(pluginId);
    if (!parsed) {
      continue;
    }
    const displayName = mention.displayName?.trim() || undefined;
    if (parsed.kind === "connector") {
      const key = `${parsed.provider ?? ""}:${parsed.identityId ?? ""}`.toLowerCase();
      if (connectorSeen.has(key)) {
        continue;
      }
      connectorSeen.add(key);
      connectors.push({
        provider: parsed.provider,
        identityId: parsed.identityId,
        displayName,
        pluginId,
      });
      continue;
    }
    const openBotPluginId = parsed.openBotPluginId?.trim();
    if (!openBotPluginId) {
      continue;
    }
    const key = openBotPluginId.toLowerCase();
    if (pluginSeen.has(key)) {
      continue;
    }
    pluginSeen.add(key);
    plugins.push({ openBotPluginId, displayName, pluginId });
    if (!allowSeen.has(key)) {
      allowSeen.add(key);
    }
  }

  const pluginToolAllowlist = plugins.map((entry) => entry.openBotPluginId);
  const turnPrompt = formatComposerPluginMentionTurnPrompt({ connectors, plugins });
  return {
    connectors,
    plugins,
    pluginToolAllowlist,
    ...(turnPrompt ? { turnPrompt } : {}),
  };
}

export function formatComposerPluginMentionTurnPrompt(params: {
  connectors: readonly ComposerPluginMentionConnector[];
  plugins: readonly ComposerPluginMentionPlugin[];
}): string | undefined {
  const parts: string[] = [];
  if (params.connectors.length > 0) {
    const lines = params.connectors.map((entry) => {
      const label = entry.displayName || entry.provider || entry.identityId || entry.pluginId;
      const bits = [
        entry.provider ? `provider=${entry.provider}` : null,
        entry.identityId ? `identityId=${entry.identityId}` : null,
      ].filter(Boolean);
      return `- ${label}${bits.length ? ` (${bits.join(", ")})` : ""}`;
    });
    parts.push(
      [
        "User @mentioned these MCP connectors for this turn. Prefer the user_operational_identity tool with the listed provider(s) when the request matches:",
        ...lines,
        "Call user_operational_identity with action=resolve before execute. Do not ignore a mentioned connector in favor of unrelated tools.",
      ].join("\n"),
    );
  }
  if (params.plugins.length > 0) {
    const lines = params.plugins.map((entry) => {
      const label = entry.displayName || entry.openBotPluginId;
      return `- ${label} (pluginId=${entry.openBotPluginId})`;
    });
    parts.push(
      [
        "User @mentioned these plugins for this turn. Their optional plugin tools are allowlisted and available — use them when the request matches:",
        ...lines,
      ].join("\n"),
    );
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export { mergeMentionedPluginToolAllowlist } from "../../agents/tool-policy.js";
