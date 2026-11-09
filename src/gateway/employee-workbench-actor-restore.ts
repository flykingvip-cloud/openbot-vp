import {
  extractEmployeeStewardUserIdFromSessionKey,
  sanitizeEmployeeStewardIdentity,
} from "../agents/builtin-steward/employee-isolation.js";
import { loadConfig } from "../config/config.js";
import {
  resolveEmployeeWorkbenchActor,
  type EmployeeWorkbenchActor,
} from "./employee-workbench-scope.js";
import { resolvePlatformAuthConfig } from "./platform-auth/config.js";
import {
  findUserByEmail,
  findUserById,
  resolvePreferredMembershipForUser,
} from "./platform-auth/memberships.js";
import { normalizeEmail } from "./platform-auth/request-helpers.js";
import { loadStore } from "./platform-auth/store.js";
import type { GatewayClient } from "./server-methods/types.js";

/** Fail-closed copy when a personal workbench session cannot recover its actor. */
export const PERSONAL_WORKBENCH_ACTOR_RESTORE_FAILURE =
  "personal workbench actor could not be restored after reconnect; sign in again";

export type PersonalWorkbenchActorRestore =
  | { ok: true; actor: EmployeeWorkbenchActor }
  | { ok: false; reason: "not_personal" }
  | { ok: false; reason: "unrestorable"; message: string };

type RestoreLookup = {
  userId: string;
  userEmail: string;
  tenantId: string;
  membershipId?: string;
};

function sameActorId(left: string, right: string): boolean {
  const a = sanitizeEmployeeStewardIdentity(left);
  const b = sanitizeEmployeeStewardIdentity(right);
  return Boolean(a && b && a === b);
}

/**
 * A personal workbench turn whose live socket lost email/domain still names
 * the employee via the session key or platform user id. Platform console
 * sessions are left alone.
 */
export function personalWorkbenchSessionNeedsActor(params: {
  client: GatewayClient | null | undefined;
  sessionKey?: string | null;
}): boolean {
  if (params.client?.sessionDomain === "platform") {
    return false;
  }
  if (extractEmployeeStewardUserIdFromSessionKey(params.sessionKey)) {
    return true;
  }
  const domain = params.client?.sessionDomain;
  return domain === "employee" || domain === "enterprise";
}

function restoreCandidate(params: {
  client: GatewayClient | null | undefined;
  sessionKey?: string | null;
}): { userId?: string; email?: string; conflict: boolean } {
  const keyOwner = extractEmployeeStewardUserIdFromSessionKey(params.sessionKey) ?? "";
  const platformUserId = params.client?.platformUserId?.trim() ?? "";
  const email = params.client?.user?.trim() ?? "";
  if (platformUserId && keyOwner && !sameActorId(platformUserId, keyOwner)) {
    return { conflict: true, userId: platformUserId };
  }
  if (platformUserId || keyOwner) {
    return { conflict: false, userId: platformUserId || keyOwner };
  }
  if (email) {
    return { conflict: false, email };
  }
  return { conflict: false };
}

function stampRestoredClient(client: GatewayClient, identity: RestoreLookup): void {
  if (!client.user?.trim()) {
    client.user = identity.userEmail;
  }
  if (!client.platformUserId?.trim()) {
    client.platformUserId = identity.userId;
  }
  if (!client.sessionDomain) {
    client.sessionDomain = "employee";
  }
  if (!client.sessionEnterpriseId?.trim()) {
    client.sessionEnterpriseId = identity.tenantId;
  }
  if (!client.sessionTenantId?.trim()) {
    client.sessionTenantId = identity.tenantId;
  }
  if (!client.sessionMembershipId?.trim() && identity.membershipId) {
    client.sessionMembershipId = identity.membershipId;
  }
}

async function lookupRestoredIdentity(candidate: {
  userId?: string;
  email?: string;
}): Promise<RestoreLookup | null> {
  const config = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
  if (!config) {
    return null;
  }
  const store = await loadStore(config);
  const user = candidate.userId
    ? findUserById(store, candidate.userId)
    : candidate.email
      ? findUserByEmail(store, normalizeEmail(candidate.email))
      : undefined;
  if (!user || user.status !== "active") {
    return null;
  }
  const membership =
    resolvePreferredMembershipForUser({
      store,
      userId: user.id,
      intent: "employee",
      requiredRole: "member",
    }) ?? resolvePreferredMembershipForUser({ store, userId: user.id });
  const tenantId = membership?.enterpriseId?.trim() ?? "";
  if (!tenantId) {
    return null;
  }
  return {
    userId: user.id,
    userEmail: user.email,
    tenantId,
    ...(membership?.id ? { membershipId: membership.id } : {}),
  };
}

/**
 * Reattach the employee actor after a gateway restart.
 * Does not waive locator grants: a restored actor still goes through admission.
 * When the session is personal and identity cannot be rebuilt, fail closed
 * with {@link PERSONAL_WORKBENCH_ACTOR_RESTORE_FAILURE}.
 */
export async function restorePersonalWorkbenchActor(params: {
  client: GatewayClient | null | undefined;
  sessionKey?: string | null;
}): Promise<PersonalWorkbenchActorRestore> {
  const existing = await resolveEmployeeWorkbenchActor(params.client);
  if (existing?.userId) {
    return { ok: true, actor: existing };
  }
  const needsActor = personalWorkbenchSessionNeedsActor(params);
  if (!needsActor) {
    return { ok: false, reason: "not_personal" };
  }
  const candidate = restoreCandidate(params);
  if (candidate.conflict || (!candidate.userId && !candidate.email) || !params.client) {
    return { ok: false, reason: "unrestorable", message: PERSONAL_WORKBENCH_ACTOR_RESTORE_FAILURE };
  }
  let identity: RestoreLookup | null = null;
  try {
    identity = await lookupRestoredIdentity(candidate);
  } catch {
    identity = null;
  }
  if (!identity) {
    return { ok: false, reason: "unrestorable", message: PERSONAL_WORKBENCH_ACTOR_RESTORE_FAILURE };
  }
  stampRestoredClient(params.client, identity);
  const actor = await resolveEmployeeWorkbenchActor(params.client);
  if (!actor?.userId) {
    return { ok: false, reason: "unrestorable", message: PERSONAL_WORKBENCH_ACTOR_RESTORE_FAILURE };
  }
  return { ok: true, actor };
}
