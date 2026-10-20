import {
  buildEmployeeBuiltinStewardSessionKey,
  EMPLOYEE_GLOBAL_STEWARD_HISTORY_DENIED,
  isEmployeeBuiltinStewardSessionAlias,
  isEmployeeGlobalStewardHistoryDenied,
  isGlobalBuiltinStewardSessionKey,
  resolveEmployeeBuiltinStewardSessionKey,
} from "../agents/builtin-steward/employee-isolation.js";
import { BUILTIN_STEWARD_AGENT_ID } from "../agents/builtin-steward/identity.js";
import { loadConfig } from "../config/config.js";
import { canonicalizeWorkbenchChatSessionKey } from "../sessions/session-key-utils.js";
import {
  requiresEmployeeAssetScope,
  resolveEmployeeWorkbenchActor,
  type EmployeeWorkbenchActor,
} from "./employee-workbench-scope.js";
import { resolvePlatformAuthConfig } from "./platform-auth/config.js";
import { findUserByEmail } from "./platform-auth/memberships.js";
import { normalizeEmail } from "./platform-auth/request-helpers.js";
import { loadStore } from "./platform-auth/store.js";
import type { GatewayClient } from "./server-methods/types.js";

function clientMustIsolateGlobalSteward(client: GatewayClient | null | undefined): boolean {
  if (!client || client.sessionDomain === "platform") {
    return false;
  }
  if (client.sessionDomain === "employee" || client.sessionDomain === "enterprise") {
    return true;
  }
  // Device-token and cookie-owner connects often carry a platform user id
  // before sessionDomain or email are stamped. That is still an employee shell.
  if (client.platformUserId?.trim()) {
    return true;
  }
  return requiresEmployeeAssetScope(client);
}

async function resolveFailSoftStewardPlatformUserId(
  client: GatewayClient | null | undefined,
): Promise<string | null> {
  const raw = client?.user?.trim();
  if (!raw) {
    return null;
  }
  const config = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
  if (!config) {
    return raw;
  }
  try {
    const store = await loadStore(config);
    const user = findUserByEmail(store, normalizeEmail(raw));
    return user?.id ?? raw;
  } catch {
    return raw;
  }
}

async function resolveStewardPlatformUserId(
  client: GatewayClient | null | undefined,
): Promise<string | null> {
  const direct = client?.platformUserId?.trim();
  if (direct) {
    return direct;
  }
  return resolveFailSoftStewardPlatformUserId(client);
}

export async function resolveEmployeeWorkbenchActorForClient(
  client: GatewayClient | null | undefined,
): Promise<EmployeeWorkbenchActor | null> {
  return resolveEmployeeWorkbenchActor(client);
}

export async function resolveEmployeeScopedChatSessionKey(
  client: GatewayClient | null | undefined,
  rawSessionKey: string,
): Promise<string> {
  const raw = rawSessionKey.trim();
  const cfg = loadConfig();
  const actor = await resolveEmployeeWorkbenchActor(client);
  if (actor) {
    return resolveEmployeeBuiltinStewardSessionKey({
      rawSessionKey: canonicalizeWorkbenchChatSessionKey(raw),
      platformUserId: actor.userId,
      cfg,
    });
  }
  // Employee sessions still remap steward aliases from platform user id
  // (device/cookie owner or email) before actor resolution is ready.
  const platformUserId = await resolveStewardPlatformUserId(client);
  const isolate = clientMustIsolateGlobalSteward(client);
  if (
    platformUserId &&
    (isolate || requiresEmployeeAssetScope(client)) &&
    isEmployeeBuiltinStewardSessionAlias(raw, cfg)
  ) {
    return resolveEmployeeBuiltinStewardSessionKey({
      rawSessionKey: canonicalizeWorkbenchChatSessionKey(raw),
      platformUserId,
      cfg,
    });
  }
  // Non-employee chat.send / abort paths: collapse space aliases only. Keep
  // channel-scoped and configured-main keys intact so delivery routing works.
  const lower = raw.toLowerCase();
  if (lower.startsWith("space:") || lower.includes(":space:")) {
    return canonicalizeWorkbenchChatSessionKey(raw);
  }
  // Fail closed. An employee/enterprise client must not receive the global
  // steward key when remap cannot finish. Transcript loaders treat the
  // sentinel as empty history or an explicit deny.
  if (isolate && isGlobalBuiltinStewardSessionKey(raw, cfg)) {
    if (platformUserId) {
      return buildEmployeeBuiltinStewardSessionKey(platformUserId);
    }
    return EMPLOYEE_GLOBAL_STEWARD_HISTORY_DENIED;
  }
  return raw;
}

/** True when this client must not read or write the global steward transcript. */
export function employeeGlobalStewardTranscriptBlocked(
  client: GatewayClient | null | undefined,
  sessionKey: string,
): boolean {
  if (isEmployeeGlobalStewardHistoryDenied(sessionKey)) {
    return true;
  }
  if (!clientMustIsolateGlobalSteward(client)) {
    return false;
  }
  return isGlobalBuiltinStewardSessionKey(sessionKey, loadConfig());
}

export function applyEmployeeStewardSessionDefaults(params: {
  sessionDefaults: {
    defaultAgentId: string;
    mainKey: string;
    mainSessionKey: string;
    scope?: string;
  };
  platformUserId: string;
}): void {
  const employeeMainKey = buildEmployeeBuiltinStewardSessionKey(params.platformUserId);
  const ownerSegment = employeeMainKey.split(":").at(-1) ?? "main";
  params.sessionDefaults.defaultAgentId = BUILTIN_STEWARD_AGENT_ID;
  params.sessionDefaults.mainSessionKey = employeeMainKey;
  params.sessionDefaults.mainKey = ownerSegment;
}

/**
 * Hello snapshot: once a platform user id is known (email, cookie owner, or
 * paired-device owner), advertise that employee's steward key. Leaving
 * `mainSessionKey` as `agent:main:main` makes the workbench open the global
 * transcript. Explicit platform control-plane sessions stay on the operator key.
 */
export function applyResolvedEmployeeStewardHelloDefaults(params: {
  sessionDefaults?: {
    defaultAgentId: string;
    mainKey: string;
    mainSessionKey: string;
    scope?: string;
  } | null;
  platformUserId?: string | null;
  sessionDomain?: string | null;
}): boolean {
  const platformUserId = params.platformUserId?.trim() ?? "";
  if (!platformUserId || !params.sessionDefaults) {
    return false;
  }
  if (params.sessionDomain === "platform") {
    return false;
  }
  applyEmployeeStewardSessionDefaults({
    sessionDefaults: params.sessionDefaults,
    platformUserId,
  });
  return true;
}
