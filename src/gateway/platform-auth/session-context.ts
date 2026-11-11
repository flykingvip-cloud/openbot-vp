import { createHmac } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { loadConfig } from "../../config/config.js";
import type { GatewayTrustedProxyConfig } from "../../config/types.gateway.js";
import { safeEqualSecret } from "../../security/secret-equal.js";
import type {
  ControlUiPlatformAuthState,
  ControlUiPlatformMember,
  ControlUiPlatformPendingAdminActivationSummary,
} from "../control-ui-contract.js";
import { type EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { resolveClientIpFromRequest } from "../enterprise-security/client-ip.js";
import { applyStoredSessionControls } from "../enterprise-security/session-enforcement.js";
import { ADMIN_SCOPE, READ_SCOPE } from "../method-scopes.js";
import { resolvePlatformAuthSmtpConfig } from "../platform-auth-email.js";
import { resolvePlatformAuthConfig, type ResolvedPlatformAuthConfig } from "./config.js";
import { listPendingEnterpriseCoAdminInvites } from "./enterprise-co-admin-invite.js";
import {
  buildMemberSeatAssignmentIndex,
  buildPlatformEmployeeAccess,
  buildPlatformOrganizationSnapshot,
  findMembershipByIdForUser,
  findUniqueMembershipByUserId,
  resolvePreferredMembershipForUser,
} from "./memberships.js";
import { isLocalOrConfiguredPublicPlatformAccess } from "./public-request.js";
import { normalizeDisplayName } from "./request-helpers.js";
import { loadSeatAssetsStoreForTenantId } from "./seat-store-loader.js";
import { deriveSessionDomain } from "./session-domain.js";
import type {
  PlatformAuthEnterprise,
  PlatformAuthMembership,
  PlatformAuthMode,
  PlatformAuthSessionContext,
  PlatformAuthSessionRecord,
  PlatformAuthStore,
  PlatformAuthTrustedProxySession,
  PlatformAuthUser,
} from "./store-types.js";
import { loadStore, saveStore } from "./store.js";
import {
  hintFromIncomingMessage,
  resolveRequestSessionSurface,
  selectSurfaceSessionCookie,
  surfaceCookieName,
  TARGET_SURFACES,
  type TargetSurface,
} from "./target-surface.js";
import { buildPlatformTrialApplicationsView, createDefaultPolicy } from "./trial-policy.js";

function signSessionToken(secret: string, sessionId: string): string {
  return createHmac("sha256", secret).update(sessionId).digest("base64url");
}

/**
 * Collect every non-empty value for `cookieName`. Browsers may send both a
 * legacy host-only cookie and a Domain= parent cookie after cookieDomain
 * migrations; callers must not assume a single value.
 */
export function parseCookieHeaderValues(req: IncomingMessage, cookieName: string): string[] {
  const raw = Array.isArray(req.headers.cookie)
    ? req.headers.cookie.join("; ")
    : req.headers.cookie;
  if (!raw) {
    return [];
  }
  const values: string[] = [];
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.split("=");
    if (name?.trim() !== cookieName) {
      continue;
    }
    const value = rest.join("=").trim();
    if (!value) {
      continue;
    }
    try {
      values.push(decodeURIComponent(value));
    } catch {
      // Ignore malformed percent-encoding from stale clients.
    }
  }
  return values;
}

export function parseCookieHeader(req: IncomingMessage, cookieName: string): string | null {
  return parseCookieHeaderValues(req, cookieName)[0] ?? null;
}

/** Prefer a cookie value whose HMAC verifies (and optionally maps to a live session). */
export function pickValidPlatformAuthCookieValue(params: {
  values: string[];
  secret: string;
  sessions?: PlatformAuthStore["sessions"];
}): string | null {
  for (const value of params.values) {
    const [sessionId, signature, extraCookiePart] = value.split(".");
    if (!sessionId || !signature || extraCookiePart) {
      continue;
    }
    if (
      !isValidPlatformAuthSessionSignature({
        secret: params.secret,
        sessionId,
        signature,
      })
    ) {
      continue;
    }
    if (params.sessions && !params.sessions[sessionId]) {
      continue;
    }
    return value;
  }
  return null;
}

function sessionRecordDomain(session: PlatformAuthSessionRecord | undefined): TargetSurface | null {
  if (!session) {
    return null;
  }
  if (
    session.domain === "platform" ||
    session.domain === "enterprise" ||
    session.domain === "employee"
  ) {
    return session.domain;
  }
  if (!session.sessionKind) {
    return null;
  }
  return deriveSessionDomain({ sessionKind: session.sessionKind });
}

/**
 * Picks the cookie for this request's surface. A legacy shared cookie is used
 * only when its stored domain matches that surface. Other surfaces' cookies
 * stay untouched.
 */
export function parseValidPlatformAuthCookie(
  req: IncomingMessage,
  config: ResolvedPlatformAuthConfig,
  store: Pick<PlatformAuthStore, "secret" | "sessions">,
): {
  cookieName: string;
  value: string;
} | null {
  const names = [
    ...TARGET_SURFACES.map((surface) => surfaceCookieName(config.cookieName, surface)),
    config.cookieName,
  ];
  const candidates: Array<{ cookieName: string; value: string; domain: TargetSurface | null }> = [];
  for (const cookieName of names) {
    const value = pickValidPlatformAuthCookieValue({
      values: parseCookieHeaderValues(req, cookieName),
      secret: store.secret,
      sessions: store.sessions,
    });
    if (!value) {
      continue;
    }
    const sessionId = value.split(".", 1)[0] ?? "";
    const domain = sessionRecordDomain(store.sessions?.[sessionId]);
    const namedSurface = TARGET_SURFACES.find(
      (surface) => surfaceCookieName(config.cookieName, surface) === cookieName,
    );
    if (namedSurface && domain !== namedSurface) {
      continue;
    }
    candidates.push({ cookieName, value, domain });
  }
  const selected = selectSurfaceSessionCookie({
    baseName: config.cookieName,
    candidates,
    resolution: resolveRequestSessionSurface(hintFromIncomingMessage(req)),
  });
  if (!selected) {
    return null;
  }
  return { cookieName: selected.cookieName, value: selected.value };
}

function toTrustedProxySession(params: {
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

function resolvePlatformRole(
  user: PlatformAuthUser | null | undefined,
): "super-admin" | "admin" | null {
  if (!user) {
    return null;
  }
  if (user.platformRole === "super-admin" || user.platformRole === "admin") {
    return user.platformRole;
  }
  return user.platformAdmin ? "super-admin" : null;
}

function isSessionDomain(
  value: unknown,
): value is NonNullable<PlatformAuthSessionRecord["domain"]> {
  return value === "platform" || value === "enterprise" || value === "employee";
}

function isSessionKind(value: unknown): value is PlatformAuthSessionContext["sessionKind"] {
  return (
    value === "platform-super-admin" ||
    value === "platform-admin" ||
    value === "enterprise-admin" ||
    value === "member"
  );
}

function isEnterpriseAvailable(enterprise: PlatformAuthEnterprise): boolean {
  return enterprise.status !== "expired" && enterprise.status !== "suspended";
}

/**
 * Resolve an enterprise-admin actor for mutations that issue seats / activations.
 *
 * Platform sessions intentionally omit membership bindings. When the same user
 * also holds an enterprise-admin membership, elevate for these admin actions so
 * UI that already proved `canAssumeEnterpriseAdmin` (or completed session/switch
 * JSON hydration while the cookie lagged) does not 403 on `/employee/provision`.
 */
export function resolveEnterpriseAdminSessionContext(params: {
  store: PlatformAuthStore;
  context: PlatformAuthSessionContext | null | undefined;
  enterpriseId?: string | null;
}): PlatformAuthSessionContext | null {
  const context = params.context;
  if (!context?.user || context.user.status !== "active") {
    return null;
  }
  const requestedEnterpriseId = params.enterpriseId?.trim() || undefined;

  if (context.membership?.membershipRole === "enterprise-admin" && context.enterprise) {
    if (requestedEnterpriseId && context.membership.enterpriseId !== requestedEnterpriseId) {
      return null;
    }
    return {
      user: context.user,
      membership: context.membership,
      enterprise: context.enterprise,
      session: toTrustedProxySession({ user: context.user, membership: context.membership }),
      sessionKind: "enterprise-admin",
    };
  }

  if (context.sessionKind !== "platform-admin" && context.sessionKind !== "platform-super-admin") {
    return null;
  }

  const membership = resolvePreferredMembershipForUser({
    store: params.store,
    userId: context.user.id,
    enterpriseId: requestedEnterpriseId,
    intent: "enterprise-admin",
    requiredRole: "enterprise-admin",
  });
  if (!membership) {
    return null;
  }
  const enterprise = params.store.enterprises[membership.enterpriseId];
  if (!enterprise || !isEnterpriseAvailable(enterprise)) {
    return null;
  }
  return {
    user: context.user,
    membership,
    enterprise,
    session: toTrustedProxySession({ user: context.user, membership }),
    sessionKind: "enterprise-admin",
  };
}

/** Verifies the signed cookie before a route looks up or rotates a session record. */
export function isValidPlatformAuthSessionSignature(params: {
  secret: string;
  sessionId: string;
  signature: string;
}): boolean {
  return safeEqualSecret(params.signature, signSessionToken(params.secret, params.sessionId));
}

/**
 * Reconstructs a trusted context from a persisted session record without ever
 * selecting a different membership. Legacy binding-free sessions are accepted
 * only when the membership is unique; platform sessions remain unbound.
 */
export function resolveStoredPlatformAuthSessionContext(params: {
  store: PlatformAuthStore;
  session: PlatformAuthSessionRecord;
}): PlatformAuthSessionContext | null {
  const user = params.store.users[params.session.userId];
  if (!user || user.status !== "active") {
    return null;
  }

  const { session } = params;
  if (session.sessionKind !== undefined && !isSessionKind(session.sessionKind)) {
    return null;
  }
  if (session.domain !== undefined && !isSessionDomain(session.domain)) {
    return null;
  }
  if (
    session.sessionKind &&
    session.domain &&
    deriveSessionDomain({ sessionKind: session.sessionKind }) !== session.domain
  ) {
    return null;
  }

  const hasMembershipField = session.membershipId !== undefined;
  const hasEnterpriseField = session.enterpriseId !== undefined;
  const membershipId = session.membershipId?.trim();
  const enterpriseId = session.enterpriseId?.trim();
  if (
    hasMembershipField !== hasEnterpriseField ||
    (hasMembershipField && (!membershipId || !enterpriseId))
  ) {
    return null;
  }

  const platformRole = resolvePlatformRole(user);
  const sessionKind = session.sessionKind;
  const domain = session.domain ?? (sessionKind ? deriveSessionDomain({ sessionKind }) : undefined);
  const isPlatformSession =
    domain === "platform" || (!domain && !sessionKind && platformRole !== null);
  if (isPlatformSession) {
    if (hasMembershipField) {
      return null;
    }
    const platformSessionKind =
      sessionKind ?? (platformRole === "super-admin" ? "platform-super-admin" : "platform-admin");
    if (
      deriveSessionDomain({ sessionKind: platformSessionKind }) !== "platform" ||
      (platformSessionKind === "platform-super-admin" && platformRole !== "super-admin") ||
      (platformSessionKind === "platform-admin" && platformRole === null)
    ) {
      return null;
    }
    return {
      user,
      membership: null,
      enterprise: null,
      session: toTrustedProxySession({ user }),
      sessionKind: platformSessionKind,
    };
  }

  let membership: PlatformAuthMembership | undefined;
  if (hasMembershipField && membershipId && enterpriseId) {
    const exactMembership = findMembershipByIdForUser(params.store, membershipId, user.id);
    if (!exactMembership || exactMembership.enterpriseId !== enterpriseId) {
      return null;
    }
    membership = exactMembership;
  } else {
    membership = findUniqueMembershipByUserId(params.store, user.id);
  }
  if (!membership) {
    return null;
  }
  const enterprise = params.store.enterprises[membership.enterpriseId];
  if (!enterprise || !isEnterpriseAvailable(enterprise)) {
    return null;
  }
  const scopedSessionKind = sessionKind ?? membership.membershipRole;
  if (
    scopedSessionKind !== membership.membershipRole ||
    (domain && deriveSessionDomain({ sessionKind: scopedSessionKind }) !== domain)
  ) {
    return null;
  }
  return {
    user,
    membership,
    enterprise,
    session: toTrustedProxySession({ user, membership }),
    sessionKind: scopedSessionKind,
  };
}

function canManagePlatform(user: PlatformAuthUser | null | undefined): boolean {
  const role = resolvePlatformRole(user);
  // platformRole admin/super-admin always grants; otherwise require operator.admin.
  // (Legacy bug checked the bare string "admin", which never matches real scopes,
  // and also returned early when role was null — making the scope fallback dead.)
  if (role === "super-admin" || role === "admin") {
    return true;
  }
  return user?.scopes.includes(ADMIN_SCOPE) === true;
}

function canManagePlatformAdmins(user: PlatformAuthUser | null | undefined): boolean {
  return resolvePlatformRole(user) === "super-admin";
}

/**
 * Observation / directory read uses the existing operator.read scope (and the
 * broader canManagePlatform admin path). This is not a new authority, and it
 * must not grant management capabilities.
 */
function canReadPlatformEnterpriseDirectory(
  user: PlatformAuthUser | null | undefined,
  sessionScopes?: readonly string[] | null,
): boolean {
  if (canManagePlatform(user)) {
    return true;
  }
  const scopes = [...(user?.scopes ?? []), ...(sessionScopes ?? [])];
  return scopes.includes(READ_SCOPE);
}

/**
 * Platform capabilities are reported only when the session is NOT an employee
 * session. A super-admin signed in through the employee entry holds an
 * "employee" session, so platform management is suppressed even though the
 * underlying account could manage the platform from a platform login. Platform
 * and enterprise sessions keep their existing (role/scope-derived) capabilities.
 */
function contextIsEmployeeSession(context: PlatformAuthSessionContext | null | undefined): boolean {
  return Boolean(context && deriveSessionDomain(context) === "employee");
}

function hasAnyPlatformAdmins(store: PlatformAuthStore): boolean {
  return Object.values(store.users).some((user) => resolvePlatformRole(user) !== null);
}

function toEnterpriseSummary(
  enterprise: PlatformAuthEnterprise,
): NonNullable<ControlUiPlatformAuthState["enterprise"]> {
  return {
    id: enterprise.id,
    name: enterprise.name,
    status: enterprise.status,
    plan: enterprise.plan,
    billingStatus: enterprise.billingStatus,
    createdSource: enterprise.createdSource,
    ...(enterprise.creationMode ? { creationMode: enterprise.creationMode } : {}),
    ...(enterprise.lifecycleStage ? { lifecycleStage: enterprise.lifecycleStage } : {}),
    ...(enterprise.approvalStatus ? { approvalStatus: enterprise.approvalStatus } : {}),
    ...(enterprise.defaultPolicyName ? { defaultPolicyName: enterprise.defaultPolicyName } : {}),
    ...(enterprise.trialDaysSnapshot ? { trialDaysSnapshot: enterprise.trialDaysSnapshot } : {}),
    seatQuota: enterprise.seatQuota,
    seatUsed: enterprise.seatUsed,
    seatsRemaining: Math.max(0, enterprise.seatQuota - enterprise.seatUsed),
    ...(enterprise.trialEndsAt ? { trialEndsAt: enterprise.trialEndsAt } : {}),
    ...(enterprise.upgradeUrl ? { upgradeUrl: enterprise.upgradeUrl } : {}),
    ...(enterprise.contactAdvisorUrl ? { contactAdvisorUrl: enterprise.contactAdvisorUrl } : {}),
    ...(enterprise.allowReadOnlyAfterExpiry !== undefined
      ? { allowReadOnlyAfterExpiry: enterprise.allowReadOnlyAfterExpiry }
      : {}),
  };
}

import type { ControlUiPlatformTrialPolicy } from "../control-ui-contract.js";

function toTrialPolicy(
  policy: ReturnType<typeof createDefaultPolicy>,
): ControlUiPlatformTrialPolicy {
  return {
    defaultTrialDays: policy.defaultTrialDays,
    allowedTrialDays: policy.allowedTrialDays,
    defaultTrialSeatCount: policy.defaultTrialSeatCount,
    trialSeatOptions: policy.trialSeatOptions,
    allowCustomTrialSeatCount: policy.allowCustomTrialSeatCount,
    trialExpiryPolicy: policy.trialExpiryPolicy,
    ...(policy.upgradeUrl ? { upgradeUrl: policy.upgradeUrl } : {}),
    ...(policy.contactAdvisorUrl ? { contactAdvisorUrl: policy.contactAdvisorUrl } : {}),
  };
}

function buildPlatformAuthMembers(params: {
  store: PlatformAuthStore;
  seatStore: EnterpriseSeatAssetsStore;
  context?: PlatformAuthSessionContext | null;
}): ControlUiPlatformMember[] | undefined {
  const enterpriseId = params.context?.membership?.enterpriseId;
  if (!enterpriseId) {
    return undefined;
  }
  const seatAssignments = buildMemberSeatAssignmentIndex({
    store: params.store,
    seatStore: params.seatStore,
    enterpriseId,
  });
  // One row per user: a dual-identity account (employee promoted to co-admin)
  // holds both `member` and `enterprise-admin` memberships in the same tenant.
  // The directory shows the highest role and lists every role held.
  const rolesByUserId = new Map<
    string,
    { roles: Set<PlatformAuthMembership["membershipRole"]>; joinedAt: string }
  >();
  for (const membership of Object.values(params.store.memberships)) {
    if (membership.enterpriseId !== enterpriseId) {
      continue;
    }
    const entry = rolesByUserId.get(membership.userId);
    if (entry) {
      entry.roles.add(membership.membershipRole);
      if (membership.createdAt.localeCompare(entry.joinedAt) < 0) {
        entry.joinedAt = membership.createdAt;
      }
    } else {
      rolesByUserId.set(membership.userId, {
        roles: new Set([membership.membershipRole]),
        joinedAt: membership.createdAt,
      });
    }
  }
  const pendingAdminInvites = listPendingEnterpriseCoAdminInvites(params.store, enterpriseId);
  const members = [...rolesByUserId.entries()]
    .flatMap(([userId, entry]) => {
      const user = params.store.users[userId];
      if (!user) {
        return [];
      }
      const membershipRole: PlatformAuthMembership["membershipRole"] = entry.roles.has(
        "enterprise-admin",
      )
        ? "enterprise-admin"
        : "member";
      const membershipRoles = (["enterprise-admin", "member"] as const).filter((role) =>
        entry.roles.has(role),
      );
      const seatAssignment = seatAssignments.get(user.email.trim().toLowerCase());
      const adminInviteExpiresAt =
        membershipRole === "member" ? pendingAdminInvites.get(user.id) : undefined;
      return [
        {
          user: user.email,
          userId: user.id,
          displayName: normalizeDisplayName(user.displayName, user.email),
          membershipRole,
          membershipRoles,
          status: user.status,
          joinedAt: entry.joinedAt,
          ...(seatAssignment?.seatTitle ? { seatTitle: seatAssignment.seatTitle } : {}),
          ...(seatAssignment?.seatStatus ? { seatStatus: seatAssignment.seatStatus } : {}),
          ...(seatAssignment?.teamLabel ? { seatTeamLabel: seatAssignment.teamLabel } : {}),
          ...(params.context?.user.id === user.id ? { isCurrentUser: true } : {}),
          ...(adminInviteExpiresAt ? { adminInvitePendingExpiresAt: adminInviteExpiresAt } : {}),
        } satisfies ControlUiPlatformMember,
      ];
    })
    .toSorted((left, right) => {
      if (left.membershipRole !== right.membershipRole) {
        return left.membershipRole === "enterprise-admin" ? -1 : 1;
      }
      return left.user.localeCompare(right.user);
    });
  return members.length > 0 ? members : undefined;
}

function buildAvailableModes(params: {
  config: ResolvedPlatformAuthConfig;
  store: PlatformAuthStore;
  context?: PlatformAuthSessionContext | null;
}): PlatformAuthMode[] {
  if (
    params.context?.user &&
    !contextIsEmployeeSession(params.context) &&
    canManagePlatform(params.context.user)
  ) {
    return ["platform-enterprise-create"];
  }
  if (!hasAnyPlatformAdmins(params.store)) {
    return ["platform-bootstrap"];
  }
  return [
    "enterprise-create",
    "employee-register",
    "enterprise-activate",
    "platform-super-admin-login",
    "platform-admin-login",
    "login",
    "forgot-password",
    "password-reset",
  ];
}

import type { ControlUiPlatformAdminSummary } from "../control-ui-contract.js";

function buildPlatformAdminDirectory(params: {
  store: PlatformAuthStore;
  context?: PlatformAuthSessionContext | null;
}): ControlUiPlatformAdminSummary[] | undefined {
  const entries = Object.values(params.store.users)
    .filter((user) => resolvePlatformRole(user) !== null)
    .map((user) => ({
      user: user.email,
      displayName: user.displayName,
      platformRole: resolvePlatformRole(user) ?? "admin",
      status: user.status,
      scopes: [...user.scopes],
      joinedAt: user.createdAt,
      ...(params.context?.user.id === user.id ? { isCurrentUser: true } : {}),
    }))
    .toSorted((left, right) => {
      if (left.platformRole !== right.platformRole) {
        return left.platformRole === "super-admin" ? -1 : 1;
      }
      return left.user.localeCompare(right.user);
    });
  return entries.length > 0 ? entries : undefined;
}

import type { ControlUiPlatformEnterpriseSummary } from "../control-ui-contract.js";
import {
  buildEnterpriseContributionSummaries,
  emptyContributionSummary,
} from "./contribution-summary.js";
import { resolveEnterpriseDirectoryContact } from "./enterprise-customer-attributes.js";
import { attachActiveSubscriptionContracts } from "./subscription-contract-enrichment.js";
import { normalizeActivationStatus } from "./token-operations.js";

/** Platform console queue: admin provisions still waiting for activation / expired codes. */
export function buildPlatformPendingAdminActivationsView(
  store: PlatformAuthStore,
  now = Date.now(),
): ControlUiPlatformPendingAdminActivationSummary[] {
  const rows: ControlUiPlatformPendingAdminActivationSummary[] = [];
  for (const provision of Object.values(store.adminProvisions)) {
    if (provision.status !== "pending_activation") {
      continue;
    }
    const enterprise = store.enterprises[provision.enterpriseId];
    if (!enterprise) {
      continue;
    }
    const latestCode = Object.values(store.activationCodes)
      .filter(
        (code) =>
          code.codeType === "enterpriseAdminActivation" &&
          code.provisionId === provision.id &&
          code.normalizedEmail === provision.normalizedAdminEmail,
      )
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const latestCodeStatus = latestCode ? normalizeActivationStatus(latestCode, now) : undefined;
    const needsResend =
      !latestCode ||
      latestCodeStatus === "expired" ||
      latestCodeStatus === "revoked" ||
      (latestCodeStatus === "active" &&
        Number(new Date(latestCode.expiresAt)) - now < 12 * 60 * 60 * 1000);
    rows.push({
      provisionId: provision.id,
      enterpriseId: enterprise.id,
      enterpriseName: enterprise.name,
      enterpriseStatus: enterprise.status,
      adminEmail: provision.adminEmail,
      adminName: provision.adminName,
      provisionCreatedAt: provision.createdAt,
      ...(latestCodeStatus ? { latestCodeStatus } : {}),
      ...(latestCode?.expiresAt ? { latestCodeExpiresAt: latestCode.expiresAt } : {}),
      needsResend,
    });
  }
  return rows.toSorted((left, right) => {
    if (left.needsResend !== right.needsResend) {
      return left.needsResend ? -1 : 1;
    }
    return right.provisionCreatedAt.localeCompare(left.provisionCreatedAt);
  });
}

function buildPlatformEnterpriseDirectory(
  store: PlatformAuthStore,
): ControlUiPlatformEnterpriseSummary[] | undefined {
  const enterprises = Object.values(store.enterprises);
  if (enterprises.length === 0) {
    return undefined;
  }
  const contributionByEnterprise = buildEnterpriseContributionSummaries();
  return enterprises
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((enterprise) => {
      const contact = resolveEnterpriseDirectoryContact(store, enterprise.id);
      return {
        ...toEnterpriseSummary(enterprise),
        // Existing observation-read / platform-admin permission already
        // confirmed this identity may see these enterprises. Stamp an explicit
        // grant so the UI does not infer access from directory presence alone.
        tenantGrant: "granted" as const,
        ...(contact ? { contact } : {}),
        contributionSummary:
          contributionByEnterprise.get(enterprise.id) ?? emptyContributionSummary(),
      };
    });
}

export async function buildPlatformAuthState(params: {
  config: ResolvedPlatformAuthConfig;
  store: PlatformAuthStore;
  seatStore: EnterpriseSeatAssetsStore;
  context?: PlatformAuthSessionContext | null;
  pendingActivation?: ControlUiPlatformAuthState["pendingActivation"];
  pendingPasswordReset?: ControlUiPlatformAuthState["pendingPasswordReset"];
  /**
   * Skip subscription-contract enrichment. Used by fast-ack mutations (e.g. trial
   * instance update) so the HTTP response is not blocked on billing store I/O
   * after the write already succeeded.
   */
  skipSubscriptionContracts?: boolean;
}): Promise<ControlUiPlatformAuthState> {
  const enterprise = params.context?.enterprise ?? null;
  const members = buildPlatformAuthMembers(params);
  const organization =
    params.context?.membership?.membershipRole === "enterprise-admin" && params.context.enterprise
      ? buildPlatformOrganizationSnapshot({
          store: params.store,
          seatStore: params.seatStore,
          enterpriseId: params.context.enterprise.id,
        })
      : undefined;
  const employeeAccess =
    params.context?.membership && params.context.enterprise
      ? buildPlatformEmployeeAccess({
          seatStore: params.seatStore,
          enterpriseId: params.context.enterprise.id,
          employeeId: params.context.user.id,
          employeeEmail: params.context.user.email,
        })
      : undefined;
  const employeeSession = contextIsEmployeeSession(params.context);
  const platformAdmins =
    !employeeSession && canManagePlatformAdmins(params.context?.user)
      ? buildPlatformAdminDirectory(params)
      : undefined;
  const grantsPlatform = !employeeSession && canManagePlatform(params.context?.user);
  // operator.read already authorizes observation display; emit the directory
  // and confirmed grants without promoting the session to canManagePlatform.
  const readsPlatformDirectory =
    !employeeSession &&
    canReadPlatformEnterpriseDirectory(params.context?.user, params.context?.session?.scopes);
  const directory = readsPlatformDirectory
    ? (buildPlatformEnterpriseDirectory(params.store) ?? [])
    : [];
  const platformEnterprises = readsPlatformDirectory
    ? params.skipSubscriptionContracts
      ? directory
      : await attachActiveSubscriptionContracts(directory)
    : undefined;
  const enterpriseSummary = enterprise ? toEnterpriseSummary(enterprise) : undefined;
  const enrichedEnterprise =
    enterpriseSummary == null
      ? undefined
      : params.skipSubscriptionContracts
        ? enterpriseSummary
        : ((await attachActiveSubscriptionContracts([enterpriseSummary]))[0] ?? enterpriseSummary);
  return {
    enabled: params.config.enabled,
    hasUsers: Object.keys(params.store.users).length > 0,
    hasPlatformAdmins: hasAnyPlatformAdmins(params.store),
    requiresPlatformBootstrap: !hasAnyPlatformAdmins(params.store),
    smtpConfigured: Boolean(resolvePlatformAuthSmtpConfig()),
    requireMfaForPlatformAdmins:
      params.store.securityPolicy?.requireMfaForPlatformAdmins ??
      params.config.requireMfaForPlatformAdmins,
    availableModes: buildAvailableModes(params),
    ...(params.context ? { session: params.context.session } : {}),
    ...(params.context ? { sessionDomain: deriveSessionDomain(params.context) } : {}),
    ...(params.context?.sessionKind ? { sessionKind: params.context.sessionKind } : {}),
    ...(!employeeSession && resolvePlatformRole(params.context?.user)
      ? { platformRole: resolvePlatformRole(params.context?.user)! }
      : {}),
    ...(grantsPlatform ? { canManagePlatform: true } : {}),
    ...(!employeeSession && canManagePlatformAdmins(params.context?.user)
      ? { canManagePlatformAdmins: true }
      : {}),
    ...(enrichedEnterprise
      ? { tenantName: enrichedEnterprise.name, enterprise: enrichedEnterprise }
      : {}),
    ...(params.context?.membership
      ? { membershipRole: params.context.membership.membershipRole }
      : {}),
    ...(members ? { members } : {}),
    ...(platformAdmins ? { platformAdmins } : {}),
    ...(organization ? { organization } : {}),
    ...(employeeAccess ? { employeeAccess } : {}),
    ...(grantsPlatform ? { platformPolicy: toTrialPolicy(params.store.policy) } : {}),
    ...(platformEnterprises && platformEnterprises.length > 0 ? { platformEnterprises } : {}),
    ...(grantsPlatform
      ? { trialApplications: buildPlatformTrialApplicationsView(params.store) }
      : {}),
    ...(grantsPlatform
      ? { pendingAdminActivations: buildPlatformPendingAdminActivationsView(params.store) }
      : {}),
    ...(params.pendingActivation ? { pendingActivation: params.pendingActivation } : {}),
    ...(params.pendingPasswordReset ? { pendingPasswordReset: params.pendingPasswordReset } : {}),
  };
}

export async function readPlatformAuthSessionContextFromRequest(params: {
  req: IncomingMessage;
  trustedProxy: GatewayTrustedProxyConfig | undefined;
  localDirect?: boolean;
}): Promise<PlatformAuthSessionContext | null> {
  const config = resolvePlatformAuthConfig(params.trustedProxy);
  if (!config || !isLocalOrConfiguredPublicPlatformAccess(params)) {
    return null;
  }
  const store = await loadStore(config);
  const cookie = parseValidPlatformAuthCookie(params.req, config, store);
  if (!cookie) {
    return null;
  }
  const [sessionId] = cookie.value.split(".", 2);
  if (!sessionId) {
    return null;
  }
  const session = store.sessions[sessionId];
  if (!session) {
    return null;
  }
  const decision = await applyStoredSessionControls({
    session,
    clientIp: resolveClientIpFromRequest(params.req),
    nowMs: Date.now(),
  });
  if (decision.action === "drop") {
    delete store.sessions[sessionId];
    await saveStore(config, store);
    return null;
  }
  if (decision.action === "deny") {
    return null;
  }
  if (decision.touched) {
    await saveStore(config, store);
  }
  return resolveStoredPlatformAuthSessionContext({ store, session });
}

export async function enforceEnterpriseSessionForGatewayClient(
  client: {
    upgradeRequestCookie?: string;
    upgradeRequestLocalDirect?: boolean;
    clientIp?: string;
  } | null,
): Promise<{ denied: false } | { denied: true; message: string }> {
  if (!client?.upgradeRequestCookie?.trim()) {
    return { denied: false };
  }
  const config = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
  if (!config?.enabled) {
    return { denied: false };
  }
  const req = {
    headers: { cookie: client.upgradeRequestCookie },
    socket: {},
  } as IncomingMessage;
  if (
    !isLocalOrConfiguredPublicPlatformAccess({
      req,
      localDirect: client.upgradeRequestLocalDirect,
    })
  ) {
    return { denied: false };
  }
  const store = await loadStore(config);
  const cookie = parseValidPlatformAuthCookie(req, config, store);
  if (!cookie) {
    return { denied: false };
  }
  const sessionId = cookie.value.split(".", 1)[0];
  if (!sessionId) {
    return { denied: false };
  }
  const session = store.sessions[sessionId];
  if (!session?.enterpriseId) {
    return { denied: false };
  }
  const decision = await applyStoredSessionControls({
    session,
    clientIp: client.clientIp,
    nowMs: Date.now(),
  });
  if (decision.action === "drop") {
    delete store.sessions[sessionId];
    await saveStore(config, store);
    return { denied: true, message: "login session idle timeout elapsed" };
  }
  if (decision.action === "deny") {
    const message =
      decision.reason === "ip"
        ? "client IP is not on the enterprise allowlist"
        : "enterprise security policy is unreadable";
    return { denied: true, message };
  }
  if (decision.touched) {
    await saveStore(config, store);
  }
  return { denied: false };
}

export async function readPlatformAuthSessionFromRequest(params: {
  req: IncomingMessage;
  trustedProxy: GatewayTrustedProxyConfig | undefined;
  localDirect?: boolean;
}): Promise<PlatformAuthTrustedProxySession | null> {
  const context = await readPlatformAuthSessionContextFromRequest(params);
  if (!context) {
    return null;
  }
  // Pin the session domain for RPC domain isolation (Requirement 5.1/5.2).
  return {
    ...context.session,
    domain: deriveSessionDomain(context),
    sessionKind: context.sessionKind,
  };
}

export async function resolveControlUiPlatformAuthState(params: {
  req: IncomingMessage;
  trustedProxy: GatewayTrustedProxyConfig | undefined;
  localDirect?: boolean;
}): Promise<ControlUiPlatformAuthState | undefined> {
  const config = resolvePlatformAuthConfig(params.trustedProxy);
  if (!config) {
    return undefined;
  }
  const store = await loadStore(config);
  const context = await readPlatformAuthSessionContextFromRequest(params);
  // Align with gateway agents.list / resolveEmployeeWorkbenchActor: under
  // MULTITENANT, employeeAccess must come from the tenant seat-assets store,
  // not the process-global file (otherwise UI grants and RPC roster diverge).
  const tenantId =
    context?.membership?.enterpriseId?.trim() || context?.enterprise?.id?.trim() || null;
  const seatStore = await loadSeatAssetsStoreForTenantId(tenantId);
  return await buildPlatformAuthState({
    config,
    store,
    seatStore,
    context: context ?? undefined,
  });
}
