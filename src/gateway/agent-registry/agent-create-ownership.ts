// Feature: shared-agent-identity-access-control-plane

import { loadConfig } from "../../config/config.js";
import {
  assignSeatToEmployee,
  buildEmployeeAccessSnapshot,
  ensureSeatForProvision,
  type EnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "../platform-auth.js";
import {
  type AuthoritativeEnterpriseScope,
  type AuthoritativeEnterpriseScopeDenyReason,
  type AuthoritativeScopeClient,
  resolveAuthoritativeEnterpriseScopeForClient,
} from "../platform-auth/active-membership-scope.js";
import {
  loadSeatAssetsStoreForTenantId,
  saveSeatAssetsStoreForTenantId,
} from "../platform-auth/seat-store-loader.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";

/**
 * Server-resolved tenant and owner for an agent create request.
 *
 * Authority path (single, top-down):
 *  1. session → authoritative enterprise scope
 *  2. seat store → `buildEmployeeAccessSnapshot` (same source as UI employeeAccess)
 *  3. ownership rules → accept/reject
 *
 * The request body may express intent (tenant/seat/user) but never selects the
 * enterprise or invents a seat the caller does not hold.
 */
export type ResolvedAgentCreateOwnership =
  | {
      kind: "enterprise";
      tenantId: string;
      /** Caller's platform user id, used as the audit actor and current manager. */
      actorUserId: string;
      actorMembershipId: string;
      /** Seat the asset is owned by; a client selection constrained to the tenant. */
      ownerPositionId: string;
    }
  | { kind: "local" }
  | {
      kind: "reject";
      code: AgentCreateOwnershipRejection;
      message: string;
      /** Present on `NO_AUTHORITATIVE_TENANT` so clients can guide a re-login. */
      scopeKind?: Exclude<AuthoritativeEnterpriseScope["kind"], "authoritative">;
      denyReason?: AuthoritativeEnterpriseScopeDenyReason;
    };

export type AgentCreateOwnershipRejection =
  | "TENANT_MISMATCH"
  | "OWNER_ACTOR_MISMATCH"
  | "POSITION_REQUIRED"
  | "POSITION_NOT_IN_TENANT"
  | "NO_AUTHORITATIVE_TENANT";

export type ResolveAgentCreateOwnershipParams = {
  /** Authoritative scope already resolved from the connected client. */
  scope: AuthoritativeEnterpriseScope;
  client: AuthoritativeScopeClient | null | undefined;
  /** Client-declared intent, all optional. */
  requestedTenantId?: string | null;
  requestedOwnerUserId?: string | null;
  requestedOwnerPositionId?: string | null;
  canonicalize: (value: string | null | undefined) => string | null;
  /**
   * Verifies the seat exists inside the authoritative enterprise.
   *
   * Required rather than optional on purpose: a client-selected seat id is intent, and
   * accepting it unverified writes ownership pointing at a seat that may not exist or may
   * belong to another tenant. An optional check would let a caller forget it and fail open.
   */
  isSeatInTenant: (params: { tenantId: string; seatId: string }) => boolean;
};

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Enterprise create without an authoritative membership pair.
 *
 * The message names `scope.kind` and, when the identity was recognized but
 * could not be bound, the deny reason. Callers surface this instead of a bare
 * English gateway error so the employee UI can ask for a fresh login.
 */
function rejectNoAuthoritativeTenant(
  scope: Exclude<AuthoritativeEnterpriseScope, { kind: "authoritative" }>,
): ResolvedAgentCreateOwnership {
  const denyReason = scope.kind === "deny" ? scope.reason : undefined;
  const detail = denyReason ? `${scope.kind}/${denyReason}` : scope.kind;
  return {
    kind: "reject",
    code: "NO_AUTHORITATIVE_TENANT",
    scopeKind: scope.kind,
    ...(denyReason ? { denyReason } : {}),
    message: `无法创建企业数字员工：当前连接没有唯一的企业成员身份（${detail}）。请退出后重新登录企业账号后再试。`,
  };
}

/**
 * Resolves the caller's active seat via the same snapshot path as employeeAccess.
 *
 * One function, one ordering (newest active binding → seat record). Do not add a
 * parallel occupancy/heuristic path here — that would diverge from what the UI
 * shows as `currentSeat` and recreate multi-path ownership bugs.
 */
export function resolveCallerEnterpriseSeatId(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  employeeId: string;
}): string | null {
  const snapshot = buildEmployeeAccessSnapshot({
    store: params.store,
    tenantId: params.tenantId,
    employeeId: params.employeeId,
  });
  return trimmedOrNull(snapshot.currentSeat?.seatId);
}

/**
 * Picks the owner seat for an enterprise create.
 *
 * Server-resolved caller seat wins. Client seat is only a fallback when the
 * server could not resolve one (still verified later by `isSeatInTenant`).
 */
export function resolveEnterpriseCreateOwnerPositionId(params: {
  callerSeatId: string | null;
  requestedOwnerPositionId?: string | null;
}): string | null {
  const requested = trimmedOrNull(params.requestedOwnerPositionId);
  if (params.callerSeatId) {
    return params.callerSeatId;
  }
  return requested;
}

/**
 * Ensures the caller has exactly one active personal seat in the enterprise.
 *
 * Identity model: platform user → enterprise membership → employee seat.
 * Agent ownership is bound to that seat so peers in the same tenant do not see
 * the bot, while enterprise admin surfaces can still govern by tenant.
 *
 * Does not reuse another employee's seat by title. Missing binding after a store
 * wipe / incomplete provision is healed here rather than failing create.
 */
export function ensurePersonalEmployeeSeat(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  employeeId: string;
  seatTitle?: string | null;
  nowIso: string;
}): string {
  const existing = resolveCallerEnterpriseSeatId({
    store: params.store,
    tenantId: params.tenantId,
    employeeId: params.employeeId,
  });
  if (existing) {
    return existing;
  }

  const requestedTitle = trimmedOrNull(params.seatTitle);
  const titleBase =
    requestedTitle && !requestedTitle.includes("@")
      ? requestedTitle
      : `员工席位 ${params.employeeId.slice(0, 8)}`;
  // Unique per employee so reuseByTitle cannot collapse two identities onto one seat.
  const seat = ensureSeatForProvision({
    store: params.store,
    tenantId: params.tenantId,
    seatTitle: `${titleBase} · ${params.employeeId.slice(0, 8)}`,
    reuseByTitle: false,
    nowIso: params.nowIso,
    actorEmployeeId: params.employeeId,
  });
  assignSeatToEmployee({
    store: params.store,
    tenantId: params.tenantId,
    seatId: seat.seatId,
    employeeId: params.employeeId,
    nowIso: params.nowIso,
    actorEmployeeId: params.employeeId,
  });
  return seat.seatId;
}

/**
 * Normalizes a client-declared owner user to the authenticated actor id.
 *
 * Accepts the login email as an alias for the platform user id so older UI
 * payloads that still send hello.auth.user do not fail closed.
 */
export function normalizeRequestedOwnerUserId(params: {
  requestedOwnerUserId?: string | null;
  actorUserId: string;
  actorEmail?: string | null;
}): { ownerUserId: string | null; mismatch: boolean } {
  const requested = trimmedOrNull(params.requestedOwnerUserId);
  if (!requested) {
    return { ownerUserId: null, mismatch: false };
  }
  if (requested === params.actorUserId) {
    return { ownerUserId: params.actorUserId, mismatch: false };
  }
  const actorEmail = trimmedOrNull(params.actorEmail)?.toLowerCase() ?? null;
  if (actorEmail && requested.toLowerCase() === actorEmail) {
    return { ownerUserId: params.actorUserId, mismatch: false };
  }
  return { ownerUserId: requested, mismatch: true };
}

/**
 * Resolves who owns a new agent without letting the request body pick a tenant.
 *
 * Rules:
 *  - an authoritative session enterprise wins; a requested tenant must equal it;
 *  - a requested owner user must equal the caller (no acting as someone else);
 *  - an enterprise agent must name the owning seat;
 *  - a caller with no authoritative enterprise may only create a local agent, and
 *    is rejected outright if it asked for a tenant.
 */
export function resolveAgentCreateOwnership(
  params: ResolveAgentCreateOwnershipParams,
): ResolvedAgentCreateOwnership {
  const requestedTenantId = trimmedOrNull(params.requestedTenantId);
  const requestedOwnerUserId = trimmedOrNull(params.requestedOwnerUserId);
  const requestedOwnerPositionId = trimmedOrNull(params.requestedOwnerPositionId);

  if (params.scope.kind !== "authoritative") {
    if (requestedTenantId) {
      return rejectNoAuthoritativeTenant(params.scope);
    }
    return { kind: "local" };
  }

  const tenantId = params.scope.enterpriseId;
  if (requestedTenantId) {
    const requested = params.canonicalize(requestedTenantId) ?? requestedTenantId;
    if (requested !== tenantId) {
      return {
        kind: "reject",
        code: "TENANT_MISMATCH",
        message: "tenantId must match the authenticated enterprise scope.",
      };
    }
  }

  const actorUserId = params.scope.user.id;
  const ownerNormalization = normalizeRequestedOwnerUserId({
    requestedOwnerUserId,
    actorUserId,
    actorEmail: params.scope.user.normalizedEmail || params.scope.user.email,
  });
  if (ownerNormalization.mismatch) {
    return {
      kind: "reject",
      code: "OWNER_ACTOR_MISMATCH",
      message: "ownerUserId must be the authenticated caller.",
    };
  }

  // Only treat this as an enterprise create when the caller actually asked for one
  // (a tenant or a seat). A bare create from an enterprise member stays local.
  if (!requestedTenantId && !requestedOwnerPositionId) {
    return { kind: "local" };
  }
  if (!requestedOwnerPositionId) {
    return {
      kind: "reject",
      code: "POSITION_REQUIRED",
      message: "enterprise agents must be owned by a position seat; provide ownerPositionId.",
    };
  }
  if (!params.isSeatInTenant({ tenantId, seatId: requestedOwnerPositionId })) {
    return {
      kind: "reject",
      code: "POSITION_NOT_IN_TENANT",
      message: "ownerPositionId must be an existing position seat in the authenticated enterprise.",
    };
  }

  return {
    kind: "enterprise",
    tenantId,
    actorUserId,
    actorMembershipId: params.scope.membership.id,
    ownerPositionId: requestedOwnerPositionId,
  };
}

/**
 * Convenience wrapper for RPC handlers: loads the platform store, resolves the
 * caller's authoritative scope, and applies the ownership rules above.
 *
 * Kept here so handlers do not each re-implement the "client tenant is intent
 * only" rule. When platform auth is disabled there is no authority source, so a
 * local create is allowed and a requested tenant is refused.
 */
export async function resolveAgentCreateOwnershipForClient(params: {
  client: AuthoritativeScopeClient | null | undefined;
  requestedTenantId?: string | null;
  requestedOwnerUserId?: string | null;
  requestedOwnerPositionId?: string | null;
}): Promise<ResolvedAgentCreateOwnership> {
  const authConfig = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
  const scope: AuthoritativeEnterpriseScope = authConfig?.enabled
    ? resolveAuthoritativeEnterpriseScopeForClient({
        store: await loadPlatformAuthStore(authConfig),
        client: params.client,
        canonicalize: canonicalizeTenantId,
      })
    : { kind: "no-platform-identity", claimedIdentity: Boolean(params.client?.user?.trim()) };

  const requestedTenantId = trimmedOrNull(params.requestedTenantId);
  const requestedOwnerPositionId = trimmedOrNull(params.requestedOwnerPositionId);
  // Seat store is loaded only for enterprise create intent.
  const wantsEnterpriseLookup =
    scope.kind === "authoritative" && Boolean(requestedTenantId || requestedOwnerPositionId);
  // Read/write the tenant-scoped seat-assets store (never bare global when MULTITENANT on).
  const seatStore = wantsEnterpriseLookup
    ? await loadSeatAssetsStoreForTenantId(
        scope.kind === "authoritative" ? scope.enterpriseId : null,
      )
    : null;

  let effectiveOwnerPositionId = requestedOwnerPositionId;
  let effectiveOwnerUserId = trimmedOrNull(params.requestedOwnerUserId);

  // Owner normalization is independent of seat-store I/O. Older clients may still
  // send hello.auth.user (email); that must map to the actor UUID even when the
  // tenant seat store failed to load. Seat heal remains gated on seatStore below.
  if (scope.kind === "authoritative") {
    const ownerNormalization = normalizeRequestedOwnerUserId({
      requestedOwnerUserId: effectiveOwnerUserId,
      actorUserId: scope.user.id,
      actorEmail: scope.user.normalizedEmail || scope.user.email,
    });
    if (ownerNormalization.mismatch) {
      console.warn(
        `[agents.create] OWNER_ACTOR_MISMATCH actorUserId=${scope.user.id} actorEmail=${scope.user.normalizedEmail || scope.user.email || ""} requestedOwnerUserId=${effectiveOwnerUserId ?? ""} tenantId=${scope.enterpriseId}`,
      );
      return {
        kind: "reject",
        code: "OWNER_ACTOR_MISMATCH",
        message: "ownerUserId must be the authenticated caller.",
      };
    }
    // Prefer the authenticated actor id. Client ownerUserId is intent/compat only.
    effectiveOwnerUserId = ownerNormalization.ownerUserId ?? scope.user.id;
  }

  if (scope.kind === "authoritative" && wantsEnterpriseLookup && seatStore) {
    // Single seat path: same snapshot as platformAuth.employeeAccess.currentSeat.
    // Prefer (1) active binding, (2) client seat the caller already occupies
    // (repair binding), (3) personal heal only when the client asked for a seat
    // we cannot resolve — never invent a seat for tenant-only creates (those
    // still fail POSITION_REQUIRED), and never overwrite a valid occupied seat.
    let callerSeatId = resolveCallerEnterpriseSeatId({
      store: seatStore,
      tenantId: scope.enterpriseId,
      employeeId: scope.user.id,
    });
    if (!callerSeatId && requestedOwnerPositionId) {
      const requestedSeat =
        seatStore.seats[requestedOwnerPositionId] ??
        Object.values(seatStore.seats).find((entry) => entry.seatId === requestedOwnerPositionId) ??
        null;
      const seatTenant = requestedSeat
        ? (canonicalizeTenantId(requestedSeat.tenantId) ?? requestedSeat.tenantId)
        : null;
      const occupiesRequested =
        requestedSeat &&
        seatTenant === scope.enterpriseId &&
        trimmedOrNull(requestedSeat.currentEmployeeId) === scope.user.id;
      const nowIso = new Date().toISOString();
      if (occupiesRequested) {
        assignSeatToEmployee({
          store: seatStore,
          tenantId: scope.enterpriseId,
          seatId: requestedSeat.seatId,
          employeeId: scope.user.id,
          nowIso,
          actorEmployeeId: scope.user.id,
        });
        callerSeatId = requestedSeat.seatId;
        await saveSeatAssetsStoreForTenantId(scope.enterpriseId, seatStore);
      } else {
        callerSeatId = ensurePersonalEmployeeSeat({
          store: seatStore,
          tenantId: scope.enterpriseId,
          employeeId: scope.user.id,
          seatTitle: scope.user.displayName || scope.user.email || null,
          nowIso,
        });
        await saveSeatAssetsStoreForTenantId(scope.enterpriseId, seatStore);
      }
    }
    effectiveOwnerPositionId = resolveEnterpriseCreateOwnerPositionId({
      callerSeatId,
      requestedOwnerPositionId,
    });
  }

  return resolveAgentCreateOwnership({
    scope,
    client: params.client,
    requestedTenantId,
    requestedOwnerUserId: effectiveOwnerUserId,
    requestedOwnerPositionId: effectiveOwnerPositionId,
    canonicalize: canonicalizeTenantId,
    isSeatInTenant: ({ tenantId, seatId }) => {
      const seat =
        seatStore?.seats[seatId] ??
        Object.values(seatStore?.seats ?? {}).find((entry) => entry.seatId === seatId) ??
        null;
      if (!seat) {
        return false;
      }
      const seatTenant = canonicalizeTenantId(seat.tenantId) ?? seat.tenantId;
      return seatTenant === tenantId;
    },
  });
}
