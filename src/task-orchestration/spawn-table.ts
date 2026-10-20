/**
 * Whether this turn's tool table lists sessions_spawn.
 * Leaf sub-agents keep the existing deny list. This module does not widen it.
 */
import { resolveSubagentToolPolicy } from "../agents/pi-tools.policy.js";
import type { OpenBotConfig } from "../config/config.js";
import { getSubagentDepth, isSubagentSessionKey } from "../sessions/session-key-utils.js";

const SPAWN_TOOL = "sessions_spawn";

export function orchestrationToolNames(params: {
  cfg?: OpenBotConfig;
  sessionKey?: string;
  disableTools?: boolean;
  toolNames?: readonly string[] | null;
}): string[] {
  if (params.toolNames) {
    return [...params.toolNames];
  }
  if (params.disableTools || !params.cfg) {
    return [];
  }
  const denied = new Set((params.cfg.tools?.deny ?? []).map((name) => name.trim()));
  if (isSubagentSessionKey(params.sessionKey)) {
    const depth = Math.max(1, getSubagentDepth(params.sessionKey));
    for (const name of resolveSubagentToolPolicy(params.cfg, depth).deny ?? []) {
      denied.add(name.trim());
    }
  }
  if (denied.has(SPAWN_TOOL)) {
    return [];
  }
  const allow = params.cfg.tools?.allow;
  if (Array.isArray(allow) && allow.length > 0) {
    return allow.includes(SPAWN_TOOL) ? [SPAWN_TOOL] : [];
  }
  if (isSubagentSessionKey(params.sessionKey)) {
    return [];
  }
  return [SPAWN_TOOL];
}

export function sessionsSpawnListed(toolNames: readonly string[] | null | undefined): boolean {
  return (toolNames ?? []).some((name) => name.trim() === SPAWN_TOOL);
}
