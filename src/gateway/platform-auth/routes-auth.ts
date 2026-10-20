/**
 * Authentication / session route handlers for platform auth.
 *
 * Handles session GET, logout, trial-applications listing, and retired routes.
 * Login + password + bootstrap live in ./routes-login-password.ts. Extracted
 * from the platform-auth monolith (decomposition Task 5.13). Behavior preserved
 * verbatim.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayTrustedProxyConfig } from "../../config/types.gateway.js";
import { buildEmployeeAccessSnapshot } from "../enterprise-seat-assets-store.js";
import { sendJson, sendMethodNotAllowed } from "../http-common.js";
import { ADMIN_SCOPE } from "../method-scopes.js";
import { exactMember, stringValue } from "../records.js";
import {
  buildClearedCookieHeader,
  establishPlatformSessionCookie,
  resolvePlatformRole,
  resolveSessionContext,
  sendPlatformAuthSuccess,
} from "./auth-helpers.js";
import type { ResolvedPlatformAuthConfig } from "./config.js";
import { emitPlatformLoginAuditEvent, generateRequestId } from "./login-audit.js";
import {
  loadSeatAssetsStoreForContext,
  loadSeatAssetsStoreForTenantId,
} from "./seat-store-loader.js";
import {
  buildPlatformAuthState,
  parseValidPlatformAuthCookie,
  readPlatformAuthSessionContextFromRequest,
  resolveStoredPlatformAuthSessionContext,
} from "./session-context.js";
import { deriveSessionDomain } from "./session-domain.js";
import type { PlatformAuthMembership, PlatformMembershipRole } from "./store-types.js";
import { loadStore, saveStore } from "./store.js";
import {
  employeePositionLoginBlock,
  evaluateEmployeePosition,
  hintFromIncomingMessage,
  LOGIN_PATH_BY_SURFACE,
  resolveRequestSessionSurface,
  selectSurfaceMembership,
  type TargetSurface,
} from "./target-surface.js";
import { buildPlatformTrialApplicationsView } from "./trial-policy.js";

const SWITCHABLE_SESSION_KINDS = [
  "platform-super-admin",
  "platform-admin",
  "enterprise-admin",
  "member",
] as const;

type SwitchableSessionKind = (typeof SWITCHABLE_SESSION_KINDS)[number] | PlatformMembershipRole;

function resolveSwitchSessionIntent(
  targetSessionKind: SwitchableSessionKind,
): "default" | "enterprise-admin" | "employee" {
  if (targetSessionKind === "enterprise-admin") {
    return "enterprise-admin";
  }
  if (targetSessionKind === "member") {
    return "employee";
  }
  return "default";
}

export async function handleSessionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
  trustedProxy: GatewayTrustedProxyConfig | undefined,
  localDirect: boolean | undefined,
): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendMethodNotAllowed(res, "GET, HEAD");
    return true;
  }
  const store = await loadStore(config);
  const context = await readPlatformAuthSessionContextFromRequest({
    req,
    trustedProxy,
    localDirect,
  });
  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.end();
    return true;
  }
  const seatStore = await loadSeatAssetsStoreForContext(context);
  sendJson(
    res,
    200,
    await buildPlatformAuthState({
      config,
      store,
      seatStore,
      context: context ?? undefined,
    }),
  );
  return true;
}

export async function handleSessionSwitchRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
  trustedProxy: GatewayTrustedProxyConfig | undefined,
  localDirect: boolean | undefined,
  body: Record<string, unknown>,
): Promise<boolean> {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return true;
  }
  const store = await loadStore(config);
  const cookie = parseValidPlatformAuthCookie(req, config, store);
  if (!cookie) {
    sendJson(res, 401, {
      ok: false,
      code: "PLATFORM_AUTH_UNAUTHORIZED",
      error: "Sign in to continue.",
    });
    return true;
  }
  const [sessionId] = cookie.value.split(".", 2);
  const session = sessionId ? store.sessions[sessionId] : undefined;
  if (!sessionId || !session) {
    sendJson(res, 401, {
      ok: false,
      code: "PLATFORM_AUTH_UNAUTHORIZED",
      error: "Sign in to continue.",
    });
    return true;
  }
  const currentContext = resolveStoredPlatformAuthSessionContext({ store, session });
  if (!currentContext) {
    sendJson(res, 401, {
      ok: false,
      code: "PLATFORM_AUTH_UNAUTHORIZED",
      error: "Sign in to continue.",
    });
    return true;
  }
  const user = currentContext.user;
  const membershipId = stringValue(body.membershipId) ?? undefined;
  const tenantId = stringValue(body.tenantId) ?? undefined;
  const targetSessionKind = exactMember(body.targetSessionKind, SWITCHABLE_SESSION_KINDS);
  if (!targetSessionKind) {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_REQUEST",
      error: "targetSessionKind is required.",
    });
    return true;
  }
  const targetSurface: TargetSurface =
    targetSessionKind === "member"
      ? "employee"
      : targetSessionKind === "enterprise-admin"
        ? "enterprise"
        : "platform";
  let targetMembership: PlatformAuthMembership | null = null;
  if (targetSurface !== "platform") {
    const selected = selectSurfaceMembership({
      store,
      userId: user.id,
      surface: targetSurface,
      membershipId,
      enterpriseId: tenantId,
    });
    if (!selected.ok) {
      sendJson(res, selected.status, {
        ok: false,
        code: selected.code,
        error: selected.error,
        ...(selected.membershipChoices ? { membershipChoices: selected.membershipChoices } : {}),
      });
      return true;
    }
    targetMembership = selected.membership;
    if (targetSurface === "employee") {
      try {
        const seatStore = await loadSeatAssetsStoreForTenantId(selected.membership.enterpriseId);
        const tenantSeatCount = Object.values(seatStore.seats).filter(
          (seat) => seat.tenantId === selected.membership.enterpriseId,
        ).length;
        const hasCurrentSeat = Boolean(
          buildEmployeeAccessSnapshot({
            store: seatStore,
            tenantId: selected.membership.enterpriseId,
            employeeId: user.id,
          }).currentSeat,
        );
        const positionBlock = employeePositionLoginBlock(
          evaluateEmployeePosition({ tenantSeatCount, hasCurrentSeat }),
        );
        if (positionBlock) {
          sendJson(res, positionBlock.status, {
            ok: false,
            code: positionBlock.code,
            error: positionBlock.error,
          });
          return true;
        }
      } catch {
        sendJson(res, 409, {
          ok: false,
          code: "PLATFORM_AUTH_POSITION_UNVERIFIED",
          error: "Employee position could not be verified.",
        });
        return true;
      }
    }
  }
  const platformRole = resolvePlatformRole(user);
  const canAssumeSessionKind =
    targetSessionKind === "platform-super-admin"
      ? platformRole === "super-admin"
      : targetSessionKind === "platform-admin"
        ? platformRole === "admin" || platformRole === "super-admin"
        : targetMembership?.membershipRole === targetSessionKind;
  if (!canAssumeSessionKind) {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_ROLE_MISMATCH",
      error: "This account cannot assume the requested session role.",
    });
    return true;
  }
  const context = resolveSessionContext(
    store,
    user,
    resolveSwitchSessionIntent(targetSessionKind),
    targetMembership,
  );
  if (!context) {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_ROLE_MISMATCH",
      error: "This account cannot assume the requested session role.",
    });
    return true;
  }
  // A super-admin may intentionally downgrade to a platform-admin session.
  context.sessionKind = targetSessionKind;
  const nowIso = new Date().toISOString();
  const sourceDomain = session.domain ?? deriveSessionDomain(currentContext);
  const targetDomain = deriveSessionDomain(context);
  // Employee and enterprise sessions must not mint a platform cookie. The
  // platform login is the only issuance path that can record authenticator
  // verification. Same-surface role changes stay on the current host.
  if (targetDomain === "platform" && sourceDomain !== "platform") {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_PLATFORM_ENTRY_REQUIRED",
      error: "Platform access requires the platform login and authenticator verification.",
      loginPath: LOGIN_PATH_BY_SURFACE.platform,
    });
    return true;
  }
  const requestSurface = resolveRequestSessionSurface(hintFromIncomingMessage(req));
  if (requestSurface.kind === "authoritative" && requestSurface.surface !== targetDomain) {
    sendJson(res, 409, {
      ok: false,
      code: "PLATFORM_AUTH_SURFACE_ENTRY_REQUIRED",
      error: "Open the target login entry to continue.",
      loginPath: LOGIN_PATH_BY_SURFACE[targetDomain],
    });
    return true;
  }
  if (sourceDomain === targetDomain) {
    delete store.sessions[sessionId];
  }
  await establishPlatformSessionCookie({
    req,
    res,
    config,
    store,
    context,
    ...(targetDomain === "platform" && session.mfaVerified === true ? { mfaVerified: true } : {}),
  });
  await emitPlatformLoginAuditEvent({
    ts: nowIso,
    requestId: generateRequestId(),
    email: user.email,
    outcome: "success",
    sessionKind: targetSessionKind,
    domain: deriveSessionDomain(context),
  });
  const seatStore = await loadSeatAssetsStoreForContext(context);
  sendJson(res, 200, {
    ok: true,
    session: context.session,
    platformAuth: await buildPlatformAuthState({
      config,
      store,
      seatStore,
      context,
    }),
  });
  return true;
}

export async function handleLogoutRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
): Promise<boolean> {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return true;
  }
  const store = await loadStore(config);
  const cookie = parseValidPlatformAuthCookie(req, config, store);
  if (cookie) {
    const sessionId = cookie.value.split(".", 1)[0];
    if (sessionId && store.sessions[sessionId]) {
      delete store.sessions[sessionId];
      await saveStore(config, store);
    }
    // Clear only the cookie for this surface. Sibling surface cookies stay.
    const cleared = [buildClearedCookieHeader(req, cookie.cookieName, undefined)];
    if (config.cookieDomain) {
      cleared.push(buildClearedCookieHeader(req, cookie.cookieName, config.cookieDomain));
    }
    res.setHeader("Set-Cookie", cleared);
  }
  await sendPlatformAuthSuccess({
    res,
    config,
    store,
  });
  return true;
}

export async function handleTrialApplicationsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
  trustedProxy: GatewayTrustedProxyConfig | undefined,
  localDirect: boolean | undefined,
): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendMethodNotAllowed(res, "GET, HEAD");
    return true;
  }
  const store = await loadStore(config);
  const context = await readPlatformAuthSessionContextFromRequest({
    req,
    trustedProxy,
    localDirect,
  });
  // Check if user can manage platform (super-admin, admin, or has operator.admin scope)
  const platformRole = context?.user?.platformRole;
  const isPlatformAdmin = platformRole === "super-admin" || platformRole === "admin";
  const hasAdminScope = context?.user?.scopes.includes(ADMIN_SCOPE) === true;
  if (!context?.user || (!isPlatformAdmin && !hasAdminScope)) {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_PLATFORM_ADMIN_REQUIRED",
      error: "Only platform administrators can review trial applications.",
    });
    return true;
  }
  if (req.method === "HEAD") {
    res.statusCode = 200;
    res.end();
    return true;
  }
  sendJson(res, 200, {
    ok: true,
    trialApplications: buildPlatformTrialApplicationsView(store),
  });
  return true;
}

/**
 * GET/POST platform MFA policy. Super-admin only. POST persists a runtime
 * override into the platform-auth store (no gateway restart) and audits the
 * change. The effective value is also surfaced via buildPlatformAuthState.
 */
export async function handleMfaPolicyRoute(
  req: IncomingMessage,
  res: ServerResponse,
  config: ResolvedPlatformAuthConfig,
  trustedProxy: GatewayTrustedProxyConfig | undefined,
  localDirect: boolean | undefined,
  body: Record<string, unknown>,
): Promise<boolean> {
  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return true;
  }
  const context = await readPlatformAuthSessionContextFromRequest({
    req,
    trustedProxy,
    localDirect,
  });
  // Only platform super-admins may change the MFA policy.
  if (!context?.user || context.user.platformRole !== "super-admin") {
    sendJson(res, 403, {
      ok: false,
      code: "PLATFORM_AUTH_SUPER_ADMIN_REQUIRED",
      error: "Only platform super-administrators can change the MFA policy.",
    });
    return true;
  }
  if (typeof body.requireMfaForPlatformAdmins !== "boolean") {
    sendJson(res, 400, {
      ok: false,
      code: "PLATFORM_AUTH_INVALID_REQUEST",
      error: "requireMfaForPlatformAdmins (boolean) is required.",
    });
    return true;
  }
  const store = await loadStore(config);
  const previous =
    store.securityPolicy?.requireMfaForPlatformAdmins ?? config.requireMfaForPlatformAdmins;
  const next = body.requireMfaForPlatformAdmins;
  store.securityPolicy = {
    ...store.securityPolicy,
    requireMfaForPlatformAdmins: next,
    updatedAt: new Date().toISOString(),
    updatedByUserId: context.user.id,
  };
  await saveStore(config, store);
  // Configuration audit event capturing previous and new value (Requirement 3.8).
  await emitPlatformLoginAuditEvent({
    ts: new Date().toISOString(),
    requestId: generateRequestId(),
    email: context.user.email,
    outcome: "success",
    // Encode the policy change in expectedRole-agnostic fields; the audit line
    // records who changed what via email + the prev/next embedded in the message.
    mfaUsed: next,
  });
  const seatStore = await loadSeatAssetsStoreForContext(context);
  sendJson(res, 200, {
    ok: true,
    previous,
    requireMfaForPlatformAdmins: next,
    platformAuth: await buildPlatformAuthState({ config, store, seatStore, context }),
  });
  return true;
}

/** Handle retired routes that return 410 Gone. */
export function handleRetiredRoutes(
  pathname: string,
  res: ServerResponse,
  routeBase: string,
): boolean {
  if (pathname === `${routeBase}/register`) {
    sendJson(res, 410, {
      ok: false,
      code: "PLATFORM_AUTH_REGISTER_RETIRED",
      error: "Use enterprise creation and enterprise administrator activation instead.",
    });
    return true;
  }

  if (pathname === `${routeBase}/invite` || pathname === `${routeBase}/invite/revoke`) {
    sendJson(res, 410, {
      ok: false,
      code: "PLATFORM_AUTH_INVITE_RETIRED",
      error: "Tenant-wide invite codes were removed from this flow.",
    });
    return true;
  }

  return false;
}
