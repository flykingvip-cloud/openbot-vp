/**
 * Authentication / session helpers for platform auth HTTP handlers.
 *
 * Owns password hashing + lockout, platform-role resolution, session-context
 * derivation, cookie building, the session-reply senders, and pending-provision
 * helpers. Extracted from the platform-auth monolith (decomposition Task 5.13).
 *
 * Behavior is preserved verbatim from the monolith (same scrypt params, same
 * lockout thresholds, same cookie attributes, same response shapes).
 */

import { createHmac, randomBytes, randomUUID, scryptSync } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { safeEqualSecret } from "../../security/secret-equal.js";
import type {
  ControlUiEmailDeliveryResult,
  ControlUiEmailDeliverySummary,
  ControlUiPlatformAuthSuccess,
  ControlUiPlatformPendingCode,
} from "../control-ui-contract.js";
import { normalizeEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-backend.js";
import { appendEnterpriseAuditEvent } from "../enterprise-security/audit-log.js";
import { resolveClientIpFromRequest } from "../enterprise-security/client-ip.js";
import { isEnterpriseCallerIpAllowed } from "../enterprise-security/session-enforcement.js";
import { sendJson } from "../http-common.js";
import {
  ADMIN_SCOPE,
  APPROVALS_SCOPE,
  PAIRING_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
} from "../method-scopes.js";
import type { ResolvedPlatformAuthConfig } from "./config.js";
import { enqueuePlatformAuthNotification } from "./email-helpers.js";
import { findMembershipByIdForUser, findUniqueMembershipByUserId } from "./memberships.js";
import { loadSeatAssetsStoreForContext } from "./seat-store-loader.js";
import { buildPlatformAuthState } from "./session-context.js";
import { deriveSessionDomain } from "./session-domain.js";
import type {
  PlatformAuthEmployeeProvision,
  PlatformAuthLeadNotificationType,
  PlatformAuthMembership,
  PlatformAuthPlatformRole,
  PlatformAuthSessionContext,
  PlatformAuthStore,
  PlatformAuthTrustedProxySession,
  PlatformAuthUser,
} from "./store-types.js";
import { saveStore } from "./store.js";
import { surfaceCookieName } from "./target-surface.js";

const DEFAULT_PASSWORD_LOCK_ATTEMPTS = 5;
const DEFAULT_PASSWORD_LOCK_MS = 15 * 60 * 1000;

export const DEFAULT_PLATFORM_AUTH_SCOPES = [
  "operator.admin",
  "operator.approvals",
  "operator.pairing",
] as const;

// ── Password / lockout ─────────────────────────────────────────────────────

export function isUserLocked(user: PlatformAuthUser, now = Date.now()): boolean {
  if (!user.lockedUntil) {
    return false;
  }
  const lockedUntilMs = Number(new Date(user.lockedUntil));
  return Number.isFinite(lockedUntilMs) && lockedUntilMs > now;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [scheme, salt, hash] = encoded.split(":");
  if (scheme !== "scrypt" || !salt || !hash) {
    return false;
  }
  const actual = scryptSync(password, salt, 64).toString("base64url");
  return safeEqualSecret(actual, hash);
}

export function recordFailedLogin(user: PlatformAuthUser, now = Date.now()): void {
  user.loginFailedCount += 1;
  user.updatedAt = new Date(now).toISOString();
  if (user.loginFailedCount >= DEFAULT_PASSWORD_LOCK_ATTEMPTS) {
    user.lockedUntil = new Date(now + DEFAULT_PASSWORD_LOCK_MS).toISOString();
  }
}

export function clearFailedLoginState(
  user: PlatformAuthUser,
  nowIso = new Date().toISOString(),
): void {
  user.loginFailedCount = 0;
  delete user.lockedUntil;
  user.lastLoginAt = nowIso;
  user.updatedAt = nowIso;
}

// ── Platform role ──────────────────────────────────────────────────────────

export function resolvePlatformRole(
  user: PlatformAuthUser | null | undefined,
): PlatformAuthPlatformRole | null {
  if (!user) {
    return null;
  }
  if (user.platformRole === "super-admin" || user.platformRole === "admin") {
    return user.platformRole;
  }
  return user.platformAdmin ? "super-admin" : null;
}

export function isPlatformUser(user: PlatformAuthUser | null | undefined): boolean {
  return resolvePlatformRole(user) !== null;
}

export function isPlatformSuperAdmin(user: PlatformAuthUser | null | undefined): boolean {
  return resolvePlatformRole(user) === "super-admin";
}

export const PLATFORM_ADMIN_SCOPES = [
  READ_SCOPE,
  WRITE_SCOPE,
  ADMIN_SCOPE,
  APPROVALS_SCOPE,
  PAIRING_SCOPE,
] as const;

export function canManagePlatformAdmins(user: PlatformAuthUser | null | undefined): boolean {
  return isPlatformSuperAdmin(user);
}

export function canManagePlatform(user: PlatformAuthUser | null | undefined): boolean {
  const role = resolvePlatformRole(user);
  // platformRole admin/super-admin always grants; otherwise require operator.admin.
  // Keep in sync with session-context.ts (legacy bug checked bare "admin" and
  // returned early when role was null — making the scope fallback dead).
  if (role === "super-admin" || role === "admin") {
    return true;
  }
  return user?.scopes.includes(ADMIN_SCOPE) === true;
}

export function normalizePlatformAdminScopes(value: unknown): string[] {
  const scopes = Array.isArray(value) ? value : [];
  const allowed = new Set<string>(PLATFORM_ADMIN_SCOPES);
  const normalized = new Set<string>();
  for (const scope of scopes) {
    const next = typeof scope === "string" ? scope.trim() : "";
    if (allowed.has(next)) {
      normalized.add(next);
    }
  }
  if (normalized.size === 0) {
    normalized.add(READ_SCOPE);
  }
  return [...normalized];
}

export function platformRoleSatisfiesExpected(
  actual: PlatformAuthPlatformRole | null,
  expected: PlatformAuthPlatformRole,
): boolean {
  if (!actual) {
    return false;
  }
  return actual === expected || (expected === "admin" && actual === "super-admin");
}

// ── Session context ────────────────────────────────────────────────────────

export function toTrustedProxySession(params: {
  user: PlatformAuthUser;
  membership?: PlatformAuthMembership | null;
}): PlatformAuthTrustedProxySession {
  return {
    provider: "trusted-proxy",
    user: params.user.email,
    displayName: params.user.displayName,
    ...(params.membership
      ? {
          membershipId: params.membership.id,
          enterpriseId: params.membership.enterpriseId,
          tenantId: params.membership.enterpriseId,
        }
      : {}),
    role: params.user.role,
    scopes: [...params.user.scopes],
  };
}

type PlatformAuthSessionIntent = "default" | "enterprise-admin" | "employee";

/**
 * Builds a session context only from an explicit verified membership or the
 * narrow unique-membership legacy compatibility path. Platform sessions stay
 * deliberately unbound even when their user belongs to enterprises.
 */
export function resolveSessionContext(
  store: PlatformAuthStore,
  user: PlatformAuthUser,
  intent: PlatformAuthSessionIntent = "default",
  selectedMembership?: PlatformAuthMembership | null,
): PlatformAuthSessionContext | null {
  if (user.status !== "active") {
    return null;
  }
  const platformRole = resolvePlatformRole(user);
  if (intent === "default" && platformRole !== null) {
    return {
      user,
      membership: null,
      enterprise: null,
      session: toTrustedProxySession({ user }),
      sessionKind: platformRole === "super-admin" ? "platform-super-admin" : "platform-admin",
    };
  }

  const membership =
    selectedMembership === undefined
      ? findUniqueMembershipByUserId(store, user.id)
      : selectedMembership;
  if (!membership) {
    if (intent === "employee") {
      return resolveUnboundEmployeeSession(user);
    }
    return null;
  }
  const verifiedMembership = findMembershipByIdForUser(store, membership.id, user.id);
  if (!verifiedMembership) {
    return null;
  }
  const enterprise = store.enterprises[verifiedMembership.enterpriseId];
  if (!enterprise || enterprise.status === "suspended" || enterprise.status === "expired") {
    return null;
  }
  if (intent === "enterprise-admin" && verifiedMembership.membershipRole !== "enterprise-admin") {
    return null;
  }
  return {
    user,
    membership: verifiedMembership,
    enterprise,
    session: toTrustedProxySession({ user, membership: verifiedMembership }),
    // "employee" intent never elevates to platform administration. The current
    // membership role remains the scoped session kind for domain isolation.
    sessionKind:
      intent === "enterprise-admin" ? "enterprise-admin" : verifiedMembership.membershipRole,
  };
}

function resolveUnboundEmployeeSession(user: PlatformAuthUser): PlatformAuthSessionContext {
  return {
    user,
    membership: null,
    enterprise: null,
    session: toTrustedProxySession({ user }),
    sessionKind: "member",
  };
}

// Trial-expiry transitions live in a shared leaf module (enterprise-lifecycle.ts)
// so the store loader and these auth helpers apply one identical policy. Re-exported
// here to preserve the historical platform-auth public surface.
export { refreshEnterpriseStatuses } from "./enterprise-lifecycle.js";

export function hasPendingAdminProvision(
  store: PlatformAuthStore,
  normalizedEmail: string,
  enterpriseId?: string,
): boolean {
  return Object.values(store.adminProvisions).some(
    (provision) =>
      provision.normalizedAdminEmail === normalizedEmail &&
      (!enterpriseId || provision.enterpriseId === enterpriseId) &&
      provision.status === "pending_activation",
  );
}

export function hasAnyPlatformAdmins(store: PlatformAuthStore): boolean {
  return Object.values(store.users).some((user) => isPlatformUser(user));
}

/**
 * Effective MFA policy for platform admins: a runtime store override (set by a
 * super-admin without restart) takes precedence over the resolved config default.
 */
export function resolveEffectiveMfaPolicy(
  config: ResolvedPlatformAuthConfig,
  store: PlatformAuthStore,
): boolean {
  return store.securityPolicy?.requireMfaForPlatformAdmins ?? config.requireMfaForPlatformAdmins;
}

// ── Cookie helpers ─────────────────────────────────────────────────────────

function isSecureRequest(req: IncomingMessage): boolean {
  const forwardedProto = Array.isArray(req.headers["x-forwarded-proto"])
    ? req.headers["x-forwarded-proto"][0]
    : req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.trim().toLowerCase() === "https") {
    return true;
  }
  return Boolean((req.socket as { encrypted?: boolean } | undefined)?.encrypted);
}

function signSessionToken(secret: string, sessionId: string): string {
  return createHmac("sha256", secret).update(sessionId).digest("base64url");
}

function buildSessionCookieValue(secret: string, sessionId: string): string {
  return `${sessionId}.${signSessionToken(secret, sessionId)}`;
}

function assertCookieDomainMatchesRequest(req: IncomingMessage, cookieDomain: string): void {
  const rawHost = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
  const hostname = rawHost?.trim().toLowerCase().replace(/:\d+$/, "") ?? "";
  if (hostname !== cookieDomain && !hostname.endsWith(`.${cookieDomain}`)) {
    throw new Error("platform auth cookieDomain does not match the request host");
  }
}

export function buildCookieHeader(
  req: IncomingMessage,
  cookieName: string,
  value: string,
  maxAgeSeconds: number,
  cookieDomain?: string,
): string {
  const attributes = [
    `${cookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (cookieDomain) {
    assertCookieDomainMatchesRequest(req, cookieDomain);
    attributes.push(`Domain=${cookieDomain}`);
  }
  if (isSecureRequest(req)) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function buildClearedCookieHeader(
  req: IncomingMessage,
  cookieName: string,
  cookieDomain?: string,
): string {
  const attributes = [`${cookieName}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (cookieDomain) {
    assertCookieDomainMatchesRequest(req, cookieDomain);
    attributes.push(`Domain=${cookieDomain}`);
  }
  if (isSecureRequest(req)) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

// ── Session response senders ───────────────────────────────────────────────

/**
 * Create a platform-auth session record and set the signed HttpOnly session
 * cookie on the response. Single source of truth for session issuance so every
 * caller shares identical cookie flags + HMAC signing. Callers that need a JSON
 * body use createSessionAndReply; callers that redirect (native bootstrap) set
 * the cookie via this and then write their own response.
 */
export async function establishPlatformSessionCookie(params: {
  req: IncomingMessage;
  res: ServerResponse;
  config: ResolvedPlatformAuthConfig;
  store: PlatformAuthStore;
  context: PlatformAuthSessionContext;
  /** Recorded on platform sessions only. Employee and enterprise sessions omit it. */
  mfaVerified?: boolean;
}): Promise<{ sessionId: string }> {
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + params.config.sessionTtlHours * 60 * 60 * 1000,
  ).toISOString();
  const sessionId = randomUUID();
  const domain = deriveSessionDomain(params.context);
  const cookieName = surfaceCookieName(params.config.cookieName, domain);
  const membership = params.context.membership;
  const enterprise = params.context.enterprise;
  const binding =
    domain === "platform" || !membership
      ? null
      : membership &&
          enterprise &&
          membership.userId === params.context.user.id &&
          membership.enterpriseId === enterprise.id
        ? { membershipId: membership.id, enterpriseId: enterprise.id }
        : null;
  if (domain === "platform" && membership) {
    throw new Error("platform sessions must not carry an enterprise membership binding");
  }
  if (membership && !binding) {
    throw new Error("scoped sessions require a verified membership and enterprise binding");
  }
  params.store.sessions[sessionId] = {
    id: sessionId,
    userId: params.context.user.id,
    createdAt: nowIso,
    updatedAt: nowIso,
    sessionIssuedAt: nowIso,
    lastActivityAt: nowIso,
    expiresAt,
    // Pin the effective kind/domain decided by the login entry so later cookie
    // reads honor it instead of re-deriving (and re-elevating) from the user's
    // intrinsic role.
    sessionKind: params.context.sessionKind,
    domain,
    ...binding,
    ...(domain === "platform" && params.mfaVerified !== undefined
      ? { mfaVerified: params.mfaVerified }
      : {}),
  };
  await saveStore(params.config, params.store);
  // When cookieDomain is set, also clear any legacy host-only cookie of the same
  // name. After Domain= migrations, browsers may send both; the host-only value
  // often appears first and previously poisoned session reads.
  const setCookies: string[] = [];
  // Clear only this surface's host-only duplicate. Other surface cookies stay
  // so three tabs can keep three identities.
  if (params.config.cookieDomain) {
    setCookies.push(buildClearedCookieHeader(params.req, cookieName, undefined));
  }
  setCookies.push(
    buildCookieHeader(
      params.req,
      cookieName,
      buildSessionCookieValue(params.store.secret, sessionId),
      params.config.sessionTtlHours * 60 * 60,
      params.config.cookieDomain,
    ),
  );
  params.res.setHeader("Set-Cookie", setCookies);
  return { sessionId };
}

export async function createSessionAndReply(params: {
  req: IncomingMessage;
  res: ServerResponse;
  config: ResolvedPlatformAuthConfig;
  store: PlatformAuthStore;
  context: PlatformAuthSessionContext;
  status?: number;
  pendingActivation?: ControlUiPlatformPendingCode;
  pendingPasswordReset?: ControlUiPlatformPendingCode;
  mfaVerified?: boolean;
}): Promise<void> {
  const enterpriseId = params.context.enterprise?.id?.trim();
  if (enterpriseId) {
    const clientIp = resolveClientIpFromRequest(params.req);
    let allowed = false;
    try {
      allowed = await isEnterpriseCallerIpAllowed(enterpriseId, clientIp);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      try {
        await appendEnterpriseAuditEvent({
          ts: new Date().toISOString(),
          tenantId: enterpriseId,
          kind: "login_ip_denied",
          actorUserId: params.context.user.id,
          summary: "login refused by ip allowlist",
        });
      } catch {
        // Refusal still stands when the tenant audit file cannot be written.
      }
      sendJson(params.res, 403, {
        ok: false,
        code: "PLATFORM_AUTH_IP_NOT_ALLOWED",
        error: "This network is not on the enterprise allowlist.",
      });
      return;
    }
  }
  await establishPlatformSessionCookie({
    req: params.req,
    res: params.res,
    config: params.config,
    store: params.store,
    context: params.context,
    ...(params.mfaVerified !== undefined ? { mfaVerified: params.mfaVerified } : {}),
  });
  const seatStore = await loadSeatAssetsStoreForContext(params.context);
  sendJson(params.res, params.status ?? 200, {
    ok: true,
    session: params.context.session,
    platformAuth: await buildPlatformAuthState({
      config: params.config,
      store: params.store,
      seatStore,
      context: params.context,
      pendingActivation: params.pendingActivation,
      pendingPasswordReset: params.pendingPasswordReset,
    }),
  } satisfies ControlUiPlatformAuthSuccess);
}

export async function sendPlatformAuthSuccess(params: {
  res: ServerResponse;
  status?: number;
  config: ResolvedPlatformAuthConfig;
  store: PlatformAuthStore;
  context?: PlatformAuthSessionContext | null;
  pendingActivation?: ControlUiPlatformPendingCode;
  pendingPasswordReset?: ControlUiPlatformPendingCode;
  session?: PlatformAuthTrustedProxySession | null;
  emailDelivery?: ControlUiEmailDeliveryResult;
  activationDelivery?: ControlUiEmailDeliverySummary;
  passwordReset?: {
    sessionIssued: false;
    returnSurface: "employee" | "enterprise" | "platform" | null;
    loginPath: "/" | "/enterprise/login" | "/platform/login";
  };
  /**
   * Fast-ack path for mutations that already persisted. Skips seat-assets disk
   * load + subscription enrichment so operators are not stuck on「保存中…」.
   */
  lean?: boolean;
}): Promise<void> {
  const seatStore = params.lean
    ? normalizeEnterpriseSeatAssetsStore(null, 4)
    : await loadSeatAssetsStoreForContext(params.context);
  sendJson(params.res, params.status ?? 200, {
    ok: true,
    ...(params.session ? { session: params.session } : {}),
    ...(params.emailDelivery ? { emailDelivery: params.emailDelivery } : {}),
    ...(params.activationDelivery ? { activationDelivery: params.activationDelivery } : {}),
    ...(params.passwordReset ? { passwordReset: params.passwordReset } : {}),
    platformAuth: await buildPlatformAuthState({
      config: params.config,
      store: params.store,
      seatStore,
      context: params.context ?? undefined,
      pendingActivation: params.pendingActivation,
      pendingPasswordReset: params.pendingPasswordReset,
      ...(params.lean ? { skipSubscriptionContracts: true } : {}),
    }),
  } satisfies ControlUiPlatformAuthSuccess);
}

// ── Pending provision helpers ──────────────────────────────────────────────

export function revokeStalePendingAdminProvisions(
  store: PlatformAuthStore,
  normalizedEmail: string,
): number {
  let revoked = 0;
  const nowIso = new Date().toISOString();
  for (const provision of Object.values(store.adminProvisions)) {
    if (
      provision.normalizedAdminEmail !== normalizedEmail ||
      provision.status !== "pending_activation"
    ) {
      continue;
    }
    const enterprise = store.enterprises[provision.enterpriseId];
    const enterpriseInactive =
      !enterprise || enterprise.status === "expired" || enterprise.status === "suspended";
    if (!enterpriseInactive) {
      continue;
    }
    provision.status = "revoked";
    provision.revokedReason = "enterprise_inactive";
    provision.updatedAt = nowIso;
    for (const activation of Object.values(store.activationCodes)) {
      if (
        activation.provisionId === provision.id &&
        activation.codeType === "enterpriseAdminActivation" &&
        activation.status === "active"
      ) {
        activation.status = "expired";
        activation.updatedAt = nowIso;
      }
    }
    revoked += 1;
  }
  return revoked;
}

export function findPendingEmployeeProvisionByEmail(
  store: PlatformAuthStore,
  normalizedEmail: string,
  enterpriseId?: string,
): PlatformAuthEmployeeProvision | undefined {
  return Object.values(store.employeeProvisions).find(
    (provision) =>
      provision.normalizedEmployeeEmail === normalizedEmail &&
      (!enterpriseId || provision.enterpriseId === enterpriseId) &&
      provision.status === "pending_activation",
  );
}

export function hasPendingEmployeeProvision(
  store: PlatformAuthStore,
  normalizedEmail: string,
  enterpriseId?: string,
): boolean {
  return Boolean(findPendingEmployeeProvisionByEmail(store, normalizedEmail, enterpriseId));
}

function countMembershipsForUser(store: PlatformAuthStore, userId: string): number {
  return Object.values(store.memberships).filter((membership) => membership.userId === userId)
    .length;
}

/**
 * Hard-delete a user account when it no longer has any enterprise membership.
 * Prevents offboarded emails from blocking later invite / register flows.
 */
export function purgeOrphanedUserAccount(params: {
  store: PlatformAuthStore;
  userId: string;
}): boolean {
  if (countMembershipsForUser(params.store, params.userId) > 0) {
    return false;
  }
  if (!params.store.users[params.userId]) {
    return false;
  }
  for (const [sessionId, session] of Object.entries(params.store.sessions)) {
    if (session.userId === params.userId) {
      delete params.store.sessions[sessionId];
    }
  }
  delete params.store.users[params.userId];
  return true;
}

/**
 * Recycle a suspended user with no memberships so the email can be invited again.
 * Active users (or suspended users still in another enterprise) are left untouched.
 */
export function recycleSuspendedOrphanUserByEmail(
  store: PlatformAuthStore,
  normalizedEmail: string,
): boolean {
  const user = Object.values(store.users).find(
    (entry) => entry.normalizedEmail === normalizedEmail,
  );
  if (!user || user.status !== "suspended") {
    return false;
  }
  return purgeOrphanedUserAccount({ store, userId: user.id });
}

/**
 * Revoke pending employee activations for a seat so unregistered positions
 * can be deleted via the vacant-shell delete path.
 */
export function revokePendingEmployeeProvisionsForSeat(params: {
  store: PlatformAuthStore;
  enterpriseId: string;
  seatId: string;
  nowIso: string;
  reason?: string;
}): number {
  let revoked = 0;
  const reason = params.reason?.trim() || "seat_deleted";
  for (const provision of Object.values(params.store.employeeProvisions)) {
    if (
      provision.enterpriseId !== params.enterpriseId ||
      provision.seatId !== params.seatId ||
      provision.status !== "pending_activation"
    ) {
      continue;
    }
    provision.status = "revoked";
    provision.revokedReason = reason;
    provision.updatedAt = params.nowIso;
    for (const activation of Object.values(params.store.activationCodes)) {
      if (
        activation.provisionId === provision.id &&
        activation.codeType === "employeeActivation" &&
        activation.status === "active"
      ) {
        activation.status = "revoked";
        activation.updatedAt = params.nowIso;
      }
    }
    revoked += 1;
  }
  return revoked;
}

export function enqueueLeadNotification(params: {
  store: PlatformAuthStore;
  type: PlatformAuthLeadNotificationType;
  trialApplicationId: string;
  email?: string;
  enterpriseId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}): void {
  enqueuePlatformAuthNotification(params);
}
