/**
 * Enterprise security RPCs that change real login state.
 *
 * `enterprise.security.mfa.enroll` writes the platform-auth TOTP store for the
 * signed-in user. A confirmed enrollment is checked only on platform login.
 * Employee and enterprise password login do not ask for that code. This is
 * not the platform super-admin MFA policy route.
 *
 * `enterprise.security.sessions.list` / `sessions.revoke` use platform-auth
 * login sessions for the membership tenant. They do not call chat `sessions.list`.
 */
import type { IncomingMessage } from "node:http";
import { loadConfig } from "../../config/config.js";
import {
  enrollEnterpriseMfa,
  ENTERPRISE_SECURITY_MFA_ENROLL_METHOD,
  ENTERPRISE_SECURITY_SESSIONS_LIST_METHOD,
  ENTERPRISE_SECURITY_SESSIONS_REVOKE_METHOD,
  listEnterpriseLoginSessions,
  revokeEnterpriseLoginSessions,
  SESSION_LIST_DEFAULT_LIMIT,
  SESSION_LIST_MAX_LIMIT,
  type MfaEnrollResult,
} from "../enterprise-security/controls.js";
import {
  createFileIdempotencyStore,
  type IdempotencyStore,
} from "../enterprise-security/idempotency.js";
import {
  resolvePlatformAuthConfig,
  type ResolvedPlatformAuthConfig,
} from "../platform-auth/config.js";
import {
  activateMfaEnrollment,
  enrollMfa,
  getMfaSecret,
  revokeMfa,
} from "../platform-auth/mfa-store.js";
import {
  isValidPlatformAuthSessionSignature,
  parseCookieHeaderValues,
} from "../platform-auth/session-context.js";
import type { PlatformAuthStore, PlatformAuthUser } from "../platform-auth/store-types.js";
import { loadStore, saveStore, withPlatformAuthStoreWriteLock } from "../platform-auth/store.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { isRecord, stringValue } from "../records.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

type AuthContext = {
  config: ResolvedPlatformAuthConfig;
  store: PlatformAuthStore;
};

type SecurityDeps = {
  now: () => number;
  idempotency: IdempotencyStore;
  /** Runs inside the platform-auth write lock. Return persist=false for reads. */
  withAuth: <T>(
    action: (context: AuthContext) => Promise<{ persist: boolean; value: T }>,
  ) => Promise<T | null>;
  callerSessionId: (client: GatewayClient, context: AuthContext) => string | null;
  mfa: {
    enroll: typeof enrollMfa;
    activate: typeof activateMfaEnrollment;
    secret: typeof getMfaSecret;
    revoke: typeof revokeMfa;
  };
};

let depsOverride: SecurityDeps | null = null;

export function setEnterpriseSecurityControlDepsForTests(deps: SecurityDeps | null): void {
  depsOverride = deps;
}

function productionDeps(): SecurityDeps {
  return {
    now: () => Date.now(),
    idempotency: createFileIdempotencyStore(),
    async withAuth(action) {
      const cfg = loadConfig();
      const config = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
      if (!config?.enabled) {
        return null;
      }
      return withPlatformAuthStoreWriteLock(config, async () => {
        const store = await loadStore(config);
        const outcome = await action({ config, store });
        if (outcome.persist) {
          await saveStore(config, store);
        }
        return outcome.value;
      });
    },
    callerSessionId,
    mfa: {
      enroll: enrollMfa,
      activate: activateMfaEnrollment,
      secret: getMfaSecret,
      revoke: revokeMfa,
    },
  };
}

function deps(): SecurityDeps {
  return depsOverride ?? productionDeps();
}

function scopesOf(client: GatewayClient): string[] {
  const scopes = client.connect.scopes;
  return Array.isArray(scopes) ? scopes.filter((scope) => typeof scope === "string") : [];
}

function rejectTransport(respond: RespondFn, message: string): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

function rejectForbidden(respond: RespondFn, message: string): void {
  respond(false, undefined, errorShape(ErrorCodes.FORBIDDEN, message));
}

function hasOperatorScope(
  client: GatewayClient,
  scope: "operator.read" | "operator.write",
): boolean {
  const scopes = scopesOf(client);
  if (scopes.includes("operator.admin")) {
    return true;
  }
  if (scope === "operator.read") {
    return scopes.includes("operator.read") || scopes.includes("operator.write");
  }
  return scopes.includes("operator.write");
}

function assertEnterpriseAdmin(
  client: GatewayClient | null,
  respond: RespondFn,
  scope: "operator.read" | "operator.write",
): string | null {
  if (!client) {
    rejectForbidden(respond, "enterprise session is required");
    return null;
  }
  if (
    client.sessionDomain === "platform" ||
    client.sessionKind === "platform-admin" ||
    client.sessionKind === "platform-super-admin"
  ) {
    rejectForbidden(respond, "platform session cannot call enterprise security methods");
    return null;
  }
  if (client.sessionDomain === "employee" || client.sessionKind === "member") {
    rejectForbidden(respond, "employee session cannot call enterprise security methods");
    return null;
  }
  if (client.sessionDomain !== "enterprise" || client.sessionKind !== "enterprise-admin") {
    rejectForbidden(respond, "enterprise-admin session is required");
    return null;
  }
  if (!hasOperatorScope(client, scope)) {
    rejectForbidden(respond, `${scope} is required`);
    return null;
  }
  const tenantId = client.sessionEnterpriseId?.trim();
  if (!tenantId) {
    rejectTransport(respond, "tenant membership is required");
    return null;
  }
  return tenantId;
}

function resolveSignedInUser(
  store: PlatformAuthStore,
  client: GatewayClient,
): PlatformAuthUser | null {
  const platformUserId = client.platformUserId?.trim();
  if (platformUserId && store.users[platformUserId]) {
    return store.users[platformUserId];
  }
  const email = client.user?.trim().toLowerCase();
  if (!email) {
    return null;
  }
  return Object.values(store.users).find((user) => user.normalizedEmail === email) ?? null;
}

function callerSessionId(client: GatewayClient, context: AuthContext): string | null {
  const raw = client.upgradeRequestCookie?.trim();
  if (!raw) {
    return null;
  }
  const values = parseCookieHeaderValues(
    { headers: { cookie: raw } } as IncomingMessage,
    context.config.cookieName,
  );
  for (const value of values) {
    const [sessionId, signature, extra] = value.split(".");
    if (!sessionId || !signature || extra) {
      continue;
    }
    if (
      !isValidPlatformAuthSessionSignature({
        secret: context.store.secret,
        sessionId,
        signature,
      })
    ) {
      continue;
    }
    if (!context.store.sessions[sessionId]) {
      continue;
    }
    return sessionId;
  }
  return null;
}

function readIdempotencyKey(params: Record<string, unknown>, respond: RespondFn): string | null {
  const idempotencyKey = stringValue(params.idempotencyKey);
  if (!idempotencyKey || idempotencyKey.length > 200) {
    rejectTransport(respond, "idempotencyKey is required");
    return null;
  }
  return idempotencyKey;
}

function readLimit(value: unknown, respond: RespondFn): number | null {
  if (value === undefined) {
    return SESSION_LIST_DEFAULT_LIMIT;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > SESSION_LIST_MAX_LIMIT
  ) {
    rejectTransport(respond, `limit must be an integer from 1 to ${SESSION_LIST_MAX_LIMIT}`);
    return null;
  }
  return value;
}

function publicMfaResult(result: MfaEnrollResult): MfaEnrollResult {
  if (result.reason || !result.ok) {
    return {
      ok: false,
      enabled: result.enabled,
      reason: result.reason,
    };
  }
  if (result.otpAuthUrl || result.recoveryCodes) {
    return {
      ok: true,
      enabled: result.enabled,
      otpAuthUrl: result.otpAuthUrl,
      recoveryCodes: result.recoveryCodes,
    };
  }
  return { ok: true, enabled: result.enabled };
}

export const enterpriseSecurityControlHandlers: GatewayRequestHandlers = {
  [ENTERPRISE_SECURITY_MFA_ENROLL_METHOD]: async ({ params, respond, client }) => {
    const tenantId = assertEnterpriseAdmin(client, respond, "operator.write");
    if (!tenantId || !client) {
      return;
    }
    if (params.action !== "start" && params.action !== "confirm") {
      rejectTransport(respond, "action must be start or confirm");
      return;
    }
    if (params.action === "confirm" && !stringValue(params.code)) {
      rejectTransport(respond, "code is required");
      return;
    }
    if (params.action === "start" && params.code !== undefined && params.code !== null) {
      rejectTransport(respond, "code is only valid for confirm");
      return;
    }
    const idempotencyKey = readIdempotencyKey(params, respond);
    if (!idempotencyKey) {
      return;
    }
    const current = deps();
    try {
      const result = await current.withAuth(async (auth) => {
        const user = resolveSignedInUser(auth.store, client);
        if (!user) {
          return { persist: false, value: { missingUser: true as const } };
        }
        const enrolled = await enrollEnterpriseMfa({
          tenantId,
          userId: user.id,
          email: user.email,
          action: params.action,
          ...(params.action === "confirm" ? { code: stringValue(params.code) ?? "" } : {}),
          idempotencyKey,
          now: current.now(),
          idempotency: current.idempotency,
          mfa: current.mfa,
        });
        return { persist: false, value: { missingUser: false as const, enrolled } };
      });
      if (!result) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "platform auth is not enabled"),
        );
        return;
      }
      if (result.missingUser) {
        rejectTransport(respond, "signed-in user is required");
        return;
      }
      respond(true, publicMfaResult(result.enrolled));
    } catch (error) {
      const message = error instanceof Error ? error.message : "mfa enrollment failed";
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
    }
  },

  [ENTERPRISE_SECURITY_SESSIONS_LIST_METHOD]: async ({ params, respond, client }) => {
    const tenantId = assertEnterpriseAdmin(client, respond, "operator.read");
    if (!tenantId || !client) {
      return;
    }
    const limit = readLimit(params.limit, respond);
    if (limit === null) {
      return;
    }
    const current = deps();
    try {
      const sessions = await current.withAuth(async (auth) => ({
        persist: false,
        value: listEnterpriseLoginSessions({
          sessions: auth.store.sessions,
          tenantId,
          callerSessionId: current.callerSessionId(client, auth),
          limit,
        }),
      }));
      if (!sessions) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "platform auth is not enabled"),
        );
        return;
      }
      respond(true, { sessions });
    } catch (error) {
      const message = error instanceof Error ? error.message : "session list failed";
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
    }
  },

  [ENTERPRISE_SECURITY_SESSIONS_REVOKE_METHOD]: async ({ params, respond, client }) => {
    const tenantId = assertEnterpriseAdmin(client, respond, "operator.write");
    if (!tenantId || !client) {
      return;
    }
    if (!isRecord(params)) {
      rejectTransport(respond, "request body is required");
      return;
    }
    const hasIds = params.sessionIds !== undefined;
    const hasAll = params.allExceptCurrent !== undefined;
    if (hasIds === hasAll) {
      rejectTransport(respond, "send sessionIds or allExceptCurrent");
      return;
    }
    let sessionIds: string[] | undefined;
    if (hasIds) {
      if (!Array.isArray(params.sessionIds) || params.sessionIds.length === 0) {
        rejectTransport(respond, "sessionIds must be a non-empty string array");
        return;
      }
      if (params.sessionIds.length > 100 || params.sessionIds.some((id) => !stringValue(id))) {
        rejectTransport(respond, "sessionIds must be a non-empty string array");
        return;
      }
      sessionIds = params.sessionIds
        .map((id) => stringValue(id))
        .filter((id): id is string => Boolean(id));
    }
    if (hasAll && params.allExceptCurrent !== true) {
      rejectTransport(respond, "allExceptCurrent must be true");
      return;
    }
    if (params.includeCurrent !== undefined && typeof params.includeCurrent !== "boolean") {
      rejectTransport(respond, "includeCurrent must be a boolean");
      return;
    }
    const idempotencyKey = readIdempotencyKey(params, respond);
    if (!idempotencyKey) {
      return;
    }
    const current = deps();
    try {
      const body = await current.withAuth(async (auth) => {
        const result = await revokeEnterpriseLoginSessions({
          sessions: auth.store.sessions,
          tenantId,
          callerSessionId: current.callerSessionId(client, auth),
          idempotencyKey,
          ...(sessionIds ? { sessionIds } : { allExceptCurrent: true }),
          includeCurrent: params.includeCurrent === true,
          idempotency: current.idempotency,
        });
        return { persist: result.persist, value: result.body };
      });
      if (!body) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "platform auth is not enabled"),
        );
        return;
      }
      respond(true, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "session revoke failed";
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
    }
  },
};
