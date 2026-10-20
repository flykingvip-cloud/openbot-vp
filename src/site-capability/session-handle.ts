/**
 * Opaque SessionHandle seam.
 *
 * The server resolves tenant + user + account binding onto the existing
 * account-browser scope key. Adapters receive only a token. They cannot
 * supply cdpUrl, user-data-dir, a profile path, or an arbitrary host target.
 */

import { resolveAccountBrowserScopeKeyFromSandboxKey } from "../browser/account-browser-namespace.js";
import { SAR_DENIAL_CODE, sarDeny, type SarDenial } from "./codes.js";

/** Keys that would open a raw browser/CDP/profile bypass. */
export const SAR_FORBIDDEN_TARGET_KEYS = [
  "cdpUrl",
  "cdp_url",
  "wsUrl",
  "websocketUrl",
  "webSocketDebuggerUrl",
  "userDataDir",
  "user_data_dir",
  "user-data-dir",
  "profilePath",
  "profile",
  "host",
  "browserHost",
  "targetHost",
  "hostname",
  "cookie",
  "cookies",
] as const;

const FORBIDDEN = new Set<string>(SAR_FORBIDDEN_TARGET_KEYS);

const BINDING_KEYS = new Set(["bindingId", "tenantId", "userId"]);

const OPAQUE_PAGE_TARGET = /^[A-Za-z0-9_-]{1,64}$/;

export type ServerPrincipal = {
  tenantId: string;
  userId: string;
};

/** Account binding. Not an OI grant and not a site capability. */
export type AccountBinding = {
  bindingId: string;
  tenantId: string;
  userId: string;
};

export type SessionHandle = {
  readonly token: string;
};

export type ResolvedSessionRecord = {
  handle: SessionHandle;
  binding: AccountBinding;
  principal: ServerPrincipal;
  /** Existing account-browser scope. Never a CDP url. */
  scopeKey: string;
  pageTargetId: string;
};

export function deriveAccountBrowserScopeKey(tenantId: string, userId: string): string | undefined {
  return resolveAccountBrowserScopeKeyFromSandboxKey(`account:${tenantId}:${userId}:browser`);
}

export function findForbiddenTargetKey(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 4) {
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN.has(key)) {
      return key;
    }
    const nested = findForbiddenTargetKey(child, depth + 1);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export function denialForForbiddenTarget(key: string): SarDenial {
  if (
    key === "cdpUrl" ||
    key === "cdp_url" ||
    key === "wsUrl" ||
    key === "websocketUrl" ||
    key === "webSocketDebuggerUrl"
  ) {
    return sarDeny(SAR_DENIAL_CODE.cdpBypass, `adapters cannot set ${key}`);
  }
  if (key === "host" || key === "browserHost" || key === "targetHost" || key === "hostname") {
    return sarDeny(SAR_DENIAL_CODE.hostTarget, `adapters cannot set ${key}`);
  }
  return sarDeny(SAR_DENIAL_CODE.profileOverride, `adapters cannot set ${key}`);
}

export function parseAccountBinding(
  raw: unknown,
): { ok: true; binding: AccountBinding } | SarDenial {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return sarDeny(SAR_DENIAL_CODE.bindingNotFound, "account binding must be an object");
  }
  const forbidden = findForbiddenTargetKey(raw);
  if (forbidden) {
    return denialForForbiddenTarget(forbidden);
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!BINDING_KEYS.has(key)) {
      return sarDeny(SAR_DENIAL_CODE.profileOverride, `account binding rejects field ${key}`);
    }
  }
  const bindingId = typeof record.bindingId === "string" ? record.bindingId.trim() : "";
  const tenantId = typeof record.tenantId === "string" ? record.tenantId.trim() : "";
  const userId = typeof record.userId === "string" ? record.userId.trim() : "";
  if (!bindingId || !tenantId || !userId) {
    return sarDeny(SAR_DENIAL_CODE.bindingNotFound, "bindingId, tenantId, and userId are required");
  }
  if (
    tenantId.includes("/") ||
    userId.includes("/") ||
    tenantId.includes(":") ||
    userId.includes(":")
  ) {
    return sarDeny(
      SAR_DENIAL_CODE.bindingNotFound,
      "tenantId and userId cannot contain path separators",
    );
  }
  return { ok: true, binding: { bindingId, tenantId, userId } };
}

export function assertOpaquePageTarget(pageTargetId: string): SarDenial | null {
  if (!OPAQUE_PAGE_TARGET.test(pageTargetId)) {
    return sarDeny(
      SAR_DENIAL_CODE.hostTarget,
      "page target must be a server-issued opaque id, not a host or url",
    );
  }
  return null;
}

export function sessionHandleExposesOnlyToken(handle: SessionHandle): boolean {
  return (
    Object.keys(handle).length === 1 && typeof handle.token === "string" && handle.token.length > 0
  );
}
