/**
 * 前端大白入口判定 — 收敛 nav/shell/stage/controller 的 "main" 硬编码（Phase 8.0）。
 */

import {
  BUILTIN_STEWARD_AGENT_ID,
  BUILTIN_STEWARD_NAME,
  isBuiltinStewardAgent,
} from "../../../src/agents/builtin-steward/identity.ts";

export { BUILTIN_STEWARD_AGENT_ID, BUILTIN_STEWARD_NAME, isBuiltinStewardAgent };

const EMPLOYEE_STEWARD_SESSION_SEGMENT = "employee";

function extractEmployeeStewardUserIdFromSessionKey(sessionKey: string): string | null {
  const raw = sessionKey.trim();
  const prefix = `agent:${BUILTIN_STEWARD_AGENT_ID}:${EMPLOYEE_STEWARD_SESSION_SEGMENT}:`;
  if (!raw.startsWith(prefix)) {
    return null;
  }
  const owner = raw.slice(prefix.length).trim();
  return owner || null;
}

function isGlobalBuiltinStewardSessionKey(sessionKey: string): boolean {
  const raw = sessionKey.trim();
  if (!raw) {
    return false;
  }
  const lower = raw.toLowerCase();
  if (raw === "main" || lower === "global" || lower === "agent:main") {
    return true;
  }
  const agentPrefix = `agent:${BUILTIN_STEWARD_AGENT_ID}:`;
  if (!raw.startsWith(agentPrefix)) {
    return false;
  }
  const rest = raw.slice(agentPrefix.length);
  if (rest.startsWith(`${EMPLOYEE_STEWARD_SESSION_SEGMENT}:`)) {
    return false;
  }
  return rest === "main";
}

/** Employee-domain steward aliases: global main + per-user employee:* sessions. */
export function isEmployeeBuiltinStewardSessionAlias(sessionKey: string): boolean {
  const raw = sessionKey.trim();
  if (!raw) {
    return true;
  }
  if (extractEmployeeStewardUserIdFromSessionKey(raw)) {
    return true;
  }
  return isGlobalBuiltinStewardSessionKey(raw);
}

export type StewardSessionDefaults = {
  defaultAgentId?: string;
  mainKey?: string;
  mainSessionKey?: string;
};

export function resolveStewardSessionDefaultsFromHello(
  hello: { snapshot?: unknown } | null | undefined,
): StewardSessionDefaults {
  const snapshot = hello?.snapshot as { sessionDefaults?: StewardSessionDefaults } | undefined;
  return snapshot?.sessionDefaults ?? {};
}

export function resolveBuiltinStewardSessionKey(defaults: StewardSessionDefaults = {}): string {
  return defaults.mainSessionKey?.trim() || defaults.mainKey?.trim() || "main";
}

/** 判定 sessionKey 是否命中大白入口 alias（含裸 main / canonical mainSessionKey）。 */
export function sessionKeyMatchesBuiltinSteward(
  sessionKey: string,
  defaults: StewardSessionDefaults = {},
): boolean {
  const raw = sessionKey.trim();
  if (!raw) {
    return false;
  }
  const mainSessionKey = defaults.mainSessionKey?.trim();
  const mainKey = defaults.mainKey?.trim() || "main";
  const defaultAgentId = defaults.defaultAgentId?.trim();
  if (mainSessionKey && raw === mainSessionKey) {
    return true;
  }
  if (raw === "main" || raw === "agent:main" || raw === mainKey) {
    return true;
  }
  if (
    defaultAgentId &&
    (raw === `agent:${defaultAgentId}:main` || raw === `agent:${defaultAgentId}:${mainKey}`)
  ) {
    return true;
  }
  const stewardId = BUILTIN_STEWARD_AGENT_ID;
  if (raw === `agent:${stewardId}:main` || raw === `agent:${stewardId}:${mainKey}`) {
    return true;
  }
  return false;
}

export function isBuiltinStewardSelection(params: {
  sessionKey: string;
  workbenchTeamSelectedKey?: string | null;
  sessionDefaults?: StewardSessionDefaults | null;
}): boolean {
  const defaults = params.sessionDefaults ?? {};
  const keys = [params.sessionKey, params.workbenchTeamSelectedKey ?? ""];
  return keys.some((key) => {
    const trimmed = key.trim();
    if (!trimmed) {
      return false;
    }
    return (
      sessionKeyMatchesBuiltinSteward(trimmed, defaults) ||
      isEmployeeBuiltinStewardSessionAlias(trimmed)
    );
  });
}

export function isBuiltinStewardEntry(
  entry: { key: string; id?: string; sessionKeys: readonly string[] },
  defaults: StewardSessionDefaults = {},
): boolean {
  if (sessionKeyMatchesBuiltinSteward(entry.key, defaults)) {
    return true;
  }
  if (entry.id === "daibai" || isBuiltinStewardAgent(entry.id)) {
    return true;
  }
  return entry.sessionKeys.some((key) => sessionKeyMatchesBuiltinSteward(key, defaults));
}
