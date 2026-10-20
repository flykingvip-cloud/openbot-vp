/**
 * Operational Identity Governance — read-only scoped aggregator (P2 Task 2.1).
 *
 * Builds the platform/enterprise/employee monitoring overview for **user-owned**
 * operational identities. This is one of the two governance aggregation streams
 * (the other being the enterprise tenant-owned stream); per R5.5 / D2 the two
 * streams are NOT merged into a shared store/resolver — they are only unified at
 * the read/visibility layer. This file deliberately operates solely on the
 * user-owned store.
 *
 * Authorization is enforced by the caller resolving a {@link QueryScope} from the
 * trusted session (never from request params). Records are then filtered with
 * {@link isRecordVisibleToScope}. Tenant attribution for records that predate or
 * omit `tenantId` is backfilled read-side from platform-auth membership
 * (owner → enterpriseId), satisfying the legacy-record fallback (Task 2.0 / D4).
 *
 * The overview is desensitized: it never returns credential material or runtime
 * secrets (usage events carry none), only counts and metadata.
 */

import { findUniqueMembershipByUserId } from "./platform-auth/memberships.js";
import type { PlatformAuthStore } from "./platform-auth/store-types.js";
import { isRecordVisibleToScope, type QueryScope } from "./scope-attribution.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";
import type {
  UserOperationalIdentityLifecycleEvent,
  UserOperationalIdentityStore,
  UserOperationalIdentityUsageEvent,
} from "./user-operational-identity-types.js";

/** Desensitized usage/deny event for the governance read model (no secrets). */
export type GovernanceUsageEventView = {
  eventId: string;
  ownerId: string;
  tenantId?: string;
  agentId: string;
  identityId: string;
  provider: string;
  action: string;
  result: UserOperationalIdentityUsageEvent["result"];
  denialCode?: string;
  createdAt: string;
};

/** Desensitized lifecycle (create/reauthorize/revoke) event for the read model. */
export type GovernanceLifecycleEventView = {
  eventId: string;
  ownerId: string;
  tenantId?: string;
  identityId: string;
  provider: string;
  action: UserOperationalIdentityLifecycleEvent["action"];
  createdAt: string;
};

/** Per-tenant rollup, only populated for platform-scope queries. */
export type GovernanceTenantBreakdownEntry = {
  tenantId: string;
  identities: number;
  activeGrants: number;
  denials: number;
};

export type OperationalIdentityGovernanceOverview = {
  scope: QueryScope;
  totals: {
    identities: number;
    active: number;
    expired: number;
    reauthRequired: number;
    revoked: number;
  };
  activeGrants: number;
  pendingBindingRequests: number;
  recentUsage: GovernanceUsageEventView[];
  recentDenials: GovernanceUsageEventView[];
  recentLifecycle: GovernanceLifecycleEventView[];
  /** Platform-scope only: per-tenant rollup (sorted by identity count desc). */
  tenantBreakdown?: GovernanceTenantBreakdownEntry[];
};

const DEFAULT_RECENT_LIMIT = 50;

/**
 * Resolve the authoritative tenant for an owner via platform-auth membership.
 * Returns the canonicalized enterpriseId, or null when the owner has no
 * membership (local single-operator / unaffiliated platform user).
 */
export function resolveOwnerTenantId(
  platformStore: PlatformAuthStore | null,
  ownerId: string,
): string | null {
  if (!platformStore) {
    return null;
  }
  // Attribution of a stored owner, with no session to bind against: an owner with
  // several enterprise memberships is ambiguous and must not be resolved by order.
  const membership = findUniqueMembershipByUserId(platformStore, ownerId);
  return canonicalizeTenantId(membership?.enterpriseId ?? null);
}

function toUsageView(
  event: UserOperationalIdentityUsageEvent,
  tenantId: string | undefined,
): GovernanceUsageEventView {
  return {
    eventId: event.eventId,
    ownerId: event.ownerId,
    tenantId,
    agentId: event.agentId,
    identityId: event.identityId,
    provider: event.provider,
    action: event.action,
    result: event.result,
    denialCode: event.denialCode,
    createdAt: event.createdAt,
  };
}

function toLifecycleView(
  event: UserOperationalIdentityLifecycleEvent,
  tenantId: string | undefined,
): GovernanceLifecycleEventView {
  return {
    eventId: event.eventId,
    ownerId: event.ownerId,
    tenantId,
    identityId: event.identityId,
    provider: event.provider,
    action: event.action,
    createdAt: event.createdAt,
  };
}

/**
 * Build the user-owned operational identity governance overview for a scope.
 *
 * @param store          user-owned operational identity store (never enterprise tenant-owned)
 * @param scope          query scope resolved server-side from the trusted session
 * @param platformStore  platform-auth store for owner→tenant backfill (optional)
 * @param limit          max recent usage/deny events to return
 */
export function listUserOperationalIdentityActivityForScope(params: {
  store: UserOperationalIdentityStore;
  scope: QueryScope;
  platformStore?: PlatformAuthStore | null;
  limit?: number;
}): OperationalIdentityGovernanceOverview {
  const { store, scope } = params;
  const platformStore = params.platformStore ?? null;
  const limit = params.limit ?? DEFAULT_RECENT_LIMIT;

  // Memoize owner→tenant lookups across the pass (membership scan is O(n)).
  const tenantCache = new Map<string, string | undefined>();
  const tenantFor = (ownerId: string, recordTenantId: string | undefined): string | undefined => {
    const explicit = canonicalizeTenantId(recordTenantId ?? null);
    if (explicit) {
      return explicit;
    }
    if (tenantCache.has(ownerId)) {
      return tenantCache.get(ownerId);
    }
    const resolved = resolveOwnerTenantId(platformStore, ownerId) ?? undefined;
    tenantCache.set(ownerId, resolved);
    return resolved;
  };

  const totals = { identities: 0, active: 0, expired: 0, reauthRequired: 0, revoked: 0 };
  const tenantRollup = new Map<string, GovernanceTenantBreakdownEntry>();
  const rollupFor = (tenantId: string | undefined): GovernanceTenantBreakdownEntry | null => {
    if (scope.kind !== "platform" || !tenantId) {
      return null;
    }
    let entry = tenantRollup.get(tenantId);
    if (!entry) {
      entry = { tenantId, identities: 0, activeGrants: 0, denials: 0 };
      tenantRollup.set(tenantId, entry);
    }
    return entry;
  };

  for (const identity of Object.values(store.identities)) {
    const tenantId = tenantFor(identity.ownerId, undefined);
    if (!isRecordVisibleToScope({ ownerId: identity.ownerId, tenantId }, scope)) {
      continue;
    }
    totals.identities += 1;
    switch (identity.status) {
      case "active":
        totals.active += 1;
        break;
      case "expired":
        totals.expired += 1;
        break;
      case "reauth_required":
        totals.reauthRequired += 1;
        break;
      case "revoked":
        totals.revoked += 1;
        break;
    }
    const idRollup = rollupFor(tenantId);
    if (idRollup) {
      idRollup.identities += 1;
    }
  }

  let activeGrants = 0;
  for (const grant of Object.values(store.grants)) {
    if (grant.status !== "active" || grant.revokedAt) {
      continue;
    }
    const tenantId = tenantFor(grant.ownerId, grant.tenantId);
    if (!isRecordVisibleToScope({ ownerId: grant.ownerId, tenantId }, scope)) {
      continue;
    }
    activeGrants += 1;
    const grantRollup = rollupFor(tenantId);
    if (grantRollup) {
      grantRollup.activeGrants += 1;
    }
  }

  let pendingBindingRequests = 0;
  for (const request of Object.values(store.bindingRequests)) {
    if (request.status !== "pending") {
      continue;
    }
    const tenantId = tenantFor(request.ownerId, request.tenantId);
    if (!isRecordVisibleToScope({ ownerId: request.ownerId, tenantId }, scope)) {
      continue;
    }
    pendingBindingRequests += 1;
  }

  const visibleEvents: Array<{ event: UserOperationalIdentityUsageEvent; tenantId?: string }> = [];
  for (const event of Object.values(store.usageEvents)) {
    const tenantId = tenantFor(event.ownerId, event.tenantId);
    if (!isRecordVisibleToScope({ ownerId: event.ownerId, tenantId }, scope)) {
      continue;
    }
    visibleEvents.push({ event, tenantId });
    if (event.result !== "allowed") {
      const denialRollup = rollupFor(tenantId);
      if (denialRollup) {
        denialRollup.denials += 1;
      }
    }
  }
  visibleEvents.sort((left, right) => right.event.createdAt.localeCompare(left.event.createdAt));

  const recentUsage = visibleEvents
    .slice(0, limit)
    .map(({ event, tenantId }) => toUsageView(event, tenantId));
  const recentDenials = visibleEvents
    .filter(({ event }) => event.result !== "allowed")
    .slice(0, limit)
    .map(({ event, tenantId }) => toUsageView(event, tenantId));

  const visibleLifecycle: Array<{
    event: UserOperationalIdentityLifecycleEvent;
    tenantId?: string;
  }> = [];
  for (const event of Object.values(store.lifecycleEvents)) {
    const tenantId = tenantFor(event.ownerId, event.tenantId);
    if (!isRecordVisibleToScope({ ownerId: event.ownerId, tenantId }, scope)) {
      continue;
    }
    visibleLifecycle.push({ event, tenantId });
  }
  visibleLifecycle.sort((left, right) => right.event.createdAt.localeCompare(left.event.createdAt));
  const recentLifecycle = visibleLifecycle
    .slice(0, limit)
    .map(({ event, tenantId }) => toLifecycleView(event, tenantId));

  const overview: OperationalIdentityGovernanceOverview = {
    scope,
    totals,
    activeGrants,
    pendingBindingRequests,
    recentUsage,
    recentDenials,
    recentLifecycle,
  };
  if (scope.kind === "platform") {
    overview.tenantBreakdown = [...tenantRollup.values()].toSorted(
      (left, right) => right.identities - left.identities,
    );
  }
  return overview;
}
