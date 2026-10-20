/**
 * Enterprise co-admin invite core (store-level, no HTTP).
 *
 * An enterprise admin invites an existing tenant `member` to ALSO hold
 * `enterprise-admin`. Accepting adds the second membership and never touches
 * the password, so the same email keeps dual identity: the login channel picks
 * the role (see `listEligibleMembershipsForUser` in ./memberships.ts).
 *
 * Distinct from the platform-console `admin-activation-email` /
 * `createPendingAdminActivationForEnterprise` flow (brand-new admin that sets a
 * password).
 */

import { randomUUID } from "node:crypto";
import { listMembershipsByUserId } from "./memberships.js";
import type {
  PlatformAuthActivationCode,
  PlatformAuthEnterprise,
  PlatformAuthMembership,
  PlatformAuthStore,
  PlatformAuthUser,
} from "./store-types.js";
import { normalizeActivationStatus, verifyOpaqueCode } from "./token-operations.js";

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export const ENTERPRISE_CO_ADMIN_INVITE_CODE_TYPE = "enterpriseCoAdminInvite" as const;

/** Query param carried by the invite deep link into the enterprise login form. */
export const ENTERPRISE_CO_ADMIN_INVITE_QUERY_PARAM = "adminInvite";

/** Latest still-active co-admin invite for a user in an enterprise. */
export function findActiveEnterpriseCoAdminInvite(params: {
  store: PlatformAuthStore;
  enterpriseId: string;
  userId?: string;
  email?: string;
  now?: number;
}): PlatformAuthActivationCode | undefined {
  const email = params.email ? normalizeEmail(params.email) : "";
  return Object.values(params.store.activationCodes)
    .filter(
      (activation) =>
        activation.codeType === ENTERPRISE_CO_ADMIN_INVITE_CODE_TYPE &&
        activation.enterpriseId === params.enterpriseId &&
        (!params.userId || activation.userId === params.userId) &&
        (!email || activation.normalizedEmail === email) &&
        normalizeActivationStatus(activation, params.now) === "active",
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

/** userId → invite expiry for every pending co-admin invite in an enterprise. */
export function listPendingEnterpriseCoAdminInvites(
  store: PlatformAuthStore,
  enterpriseId: string,
  now = Date.now(),
): Map<string, string> {
  const pending = new Map<string, string>();
  for (const activation of Object.values(store.activationCodes)) {
    if (
      activation.codeType !== ENTERPRISE_CO_ADMIN_INVITE_CODE_TYPE ||
      activation.enterpriseId !== enterpriseId ||
      !activation.userId ||
      normalizeActivationStatus(activation, now) !== "active"
    ) {
      continue;
    }
    const previous = pending.get(activation.userId);
    if (!previous || previous.localeCompare(activation.expiresAt) < 0) {
      pending.set(activation.userId, activation.expiresAt);
    }
  }
  return pending;
}

function isEnterpriseAvailable(enterprise: PlatformAuthEnterprise | undefined): boolean {
  return Boolean(
    enterprise && enterprise.status !== "suspended" && enterprise.status !== "expired",
  );
}

export function findEnterpriseMembershipForRole(
  store: PlatformAuthStore,
  userId: string,
  enterpriseId: string,
  role: PlatformAuthMembership["membershipRole"],
): PlatformAuthMembership | undefined {
  return listMembershipsByUserId(store, userId).find(
    (membership) => membership.enterpriseId === enterpriseId && membership.membershipRole === role,
  );
}

export type EnterpriseCoAdminInviteAcceptResult =
  | {
      ok: true;
      membership: PlatformAuthMembership;
      enterprise: PlatformAuthEnterprise;
      created: boolean;
    }
  | { ok: false; status: number; code: string; error: string };

/**
 * Grants `enterprise-admin` alongside the user's existing `member` membership.
 * Caller must already have authenticated `user` (password login or a live
 * session). Never touches credentials. Mutates `store`; caller persists.
 */
export function acceptEnterpriseCoAdminInvite(params: {
  store: PlatformAuthStore;
  user: PlatformAuthUser;
  code: string;
  nowIso?: string;
}): EnterpriseCoAdminInviteAcceptResult {
  const code = params.code.trim();
  const nowIso = params.nowIso ?? new Date().toISOString();
  const now = Date.parse(nowIso);
  if (!code) {
    return {
      ok: false,
      status: 400,
      code: "PLATFORM_AUTH_ADMIN_INVITE_CODE_REQUIRED",
      error: "Admin invite code is required.",
    };
  }
  const activation = Object.values(params.store.activationCodes).find(
    (entry) =>
      entry.codeType === ENTERPRISE_CO_ADMIN_INVITE_CODE_TYPE &&
      entry.normalizedEmail === params.user.normalizedEmail &&
      verifyOpaqueCode(code, entry.codeHash),
  );
  if (
    !activation ||
    !activation.enterpriseId ||
    (activation.userId && activation.userId !== params.user.id)
  ) {
    return {
      ok: false,
      status: 404,
      code: "PLATFORM_AUTH_ADMIN_INVITE_INVALID",
      error: "The admin invite is invalid or was sent to a different account.",
    };
  }
  const status = normalizeActivationStatus(activation, Number.isFinite(now) ? now : Date.now());
  const enterprise = params.store.enterprises[activation.enterpriseId];
  const existingAdmin = findEnterpriseMembershipForRole(
    params.store,
    params.user.id,
    activation.enterpriseId,
    "enterprise-admin",
  );
  // Idempotent replay: the invite was already claimed by this user and the admin
  // membership exists — let the login continue as admin.
  if (status === "claimed" && activation.claimedByUserId === params.user.id && existingAdmin) {
    if (!enterprise || !isEnterpriseAvailable(enterprise)) {
      return {
        ok: false,
        status: 403,
        code: "PLATFORM_AUTH_ENTERPRISE_UNAVAILABLE",
        error: "This enterprise is not available right now.",
      };
    }
    return { ok: true, membership: existingAdmin, enterprise, created: false };
  }
  if (status !== "active") {
    return {
      ok: false,
      status: 410,
      code: "PLATFORM_AUTH_ADMIN_INVITE_EXPIRED",
      error: "This admin invite has expired or was revoked. Ask an administrator to resend it.",
    };
  }
  if (!enterprise || !isEnterpriseAvailable(enterprise)) {
    return {
      ok: false,
      status: 403,
      code: "PLATFORM_AUTH_ENTERPRISE_UNAVAILABLE",
      error: "This enterprise is not available right now.",
    };
  }
  if (params.user.status !== "active") {
    return {
      ok: false,
      status: 403,
      code: "PLATFORM_AUTH_USER_SUSPENDED",
      error: "This account is not active.",
    };
  }
  const memberMembership = findEnterpriseMembershipForRole(
    params.store,
    params.user.id,
    enterprise.id,
    "member",
  );
  if (!memberMembership && !existingAdmin) {
    return {
      ok: false,
      status: 410,
      code: "PLATFORM_AUTH_ADMIN_INVITE_STALE",
      error: "You are no longer an employee of this enterprise.",
    };
  }
  let membership = existingAdmin;
  let created = false;
  if (!membership) {
    membership = {
      id: randomUUID(),
      userId: params.user.id,
      enterpriseId: enterprise.id,
      membershipRole: "enterprise-admin",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    params.store.memberships[membership.id] = membership;
    created = true;
  }
  activation.status = "claimed";
  activation.claimedAt = nowIso;
  activation.claimedByUserId = params.user.id;
  activation.updatedAt = nowIso;
  return { ok: true, membership, enterprise, created };
}
