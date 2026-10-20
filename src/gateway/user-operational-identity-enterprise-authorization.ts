/**
 * Enterprise authorization gate for user-owned operational identities (P3, Task 3.1).
 *
 * "企业决定谁可用" — until now `tenantId`/`seatId` on grants/usage were only
 * *recorded*, never an authorization input (see design §2.6). This resolver makes
 * the enterprise decision a real allow/deny gate, anchored on AUTHORITATIVE
 * signals resolved from the owner's platform identity — never from request params:
 *
 *   - tenant: `PlatformAuthMembership` (owner user.id → enterpriseId)
 *   - seat:   `EnterpriseSeatBinding` (employeeId↔seat↔tenant, the authoritative map)
 *
 * Non-regression (R4.4 / 增量不误拒): the gate denies ONLY on a positive
 * withdrawal signal — an enterprise-affiliated employee whose seat binding(s)
 * exist but are all non-active (revoked / suspended / completed). Employees with
 * no membership (local single-operator / unaffiliated) or with no seat binding at
 * all (enterprise never seat-gated them) are left to the existing owner+grant
 * behavior. This avoids breaking enterprises that do not use seat bindings.
 */

import { loadConfig } from "../config/config.js";
import {
  loadEnterpriseSeatAssetsStore,
  type EnterpriseSeatAssetsStore,
  type EnterpriseSeatBinding,
} from "./enterprise-seat-assets-store.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "./platform-auth.js";
import { findUniqueMembershipByUserId } from "./platform-auth/memberships.js";
import type { PlatformAuthStore } from "./platform-auth/store-types.js";
import type { GatewayClient } from "./server-methods/types.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";
import { resolveControlPlaneStorePathForClient } from "./tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "./tenant-store-paths.js";

export const ENTERPRISE_SEAT_REVOKED_DENIAL_CODE = "USER_IDENTITY_ENTERPRISE_SEAT_REVOKED";

/**
 * Result of the enterprise authorization gate. `tenantId`/`seatId` are the
 * AUTHORITATIVE values resolved here; callers should prefer them over any
 * request-supplied tenantId/seatId for audit attribution and enforcement.
 */
export type EmployeeOperationalAuthorization = {
  /** Whether the owner is governed by an enterprise (has platform membership). */
  governed: boolean;
  decision: "allow" | "deny";
  /** Authoritative tenant resolved from membership (canonicalized), if any. */
  tenantId?: string;
  /** Authoritative active seat resolved from seat bindings, if any. */
  seatId?: string;
  denialCode?: string;
  reason?: string;
};

function activeSeatBindingFor(
  seatStore: EnterpriseSeatAssetsStore,
  tenantId: string,
  ownerId: string,
): EnterpriseSeatBinding | null {
  const bindings = Object.values(seatStore.bindings).filter(
    (binding) => binding.tenantId === tenantId && binding.employeeId === ownerId,
  );
  if (bindings.length === 0) {
    return null;
  }
  const active = bindings
    .filter((binding) => binding.bindingStatus === "active")
    .toSorted((left, right) => right.effectiveAt.localeCompare(left.effectiveAt));
  return active[0] ?? null;
}

function hasAnySeatBinding(
  seatStore: EnterpriseSeatAssetsStore,
  tenantId: string,
  ownerId: string,
): boolean {
  return Object.values(seatStore.bindings).some(
    (binding) => binding.tenantId === tenantId && binding.employeeId === ownerId,
  );
}

/**
 * Resolve the enterprise authorization decision for an owner. Pure over the
 * already-loaded stores so it can be unit-tested and composed by the async
 * enforcement layer. Stores may be null (platform auth disabled / no seat store)
 * which resolves to an ungoverned allow.
 */
export function resolveEmployeeOperationalAuthorization(params: {
  ownerId: string;
  platformStore: PlatformAuthStore | null;
  seatStore: EnterpriseSeatAssetsStore | null;
}): EmployeeOperationalAuthorization {
  const ownerId = params.ownerId.trim();
  if (!ownerId || !params.platformStore) {
    return { governed: false, decision: "allow" };
  }
  // No session here either: an ambiguous owner must not pick an enterprise by order.
  const membership = findUniqueMembershipByUserId(params.platformStore, ownerId);
  const tenantId = canonicalizeTenantId(membership?.enterpriseId ?? null);
  if (!tenantId) {
    // No enterprise affiliation → local/unaffiliated → existing behavior.
    return { governed: false, decision: "allow" };
  }
  if (!params.seatStore || !hasAnySeatBinding(params.seatStore, tenantId, ownerId)) {
    // Enterprise-affiliated but never seat-gated → do not false-deny (R4.4).
    return { governed: true, decision: "allow", tenantId };
  }
  const activeBinding = activeSeatBindingFor(params.seatStore, tenantId, ownerId);
  if (activeBinding) {
    return { governed: true, decision: "allow", tenantId, seatId: activeBinding.seatId };
  }
  // Has seat binding(s) but none active → enterprise has withdrawn authorization.
  return {
    governed: true,
    decision: "deny",
    tenantId,
    denialCode: ENTERPRISE_SEAT_REVOKED_DENIAL_CODE,
    reason:
      "Enterprise seat authorization for this employee is not active; operational identity use is denied.",
  };
}

/**
 * Async convenience used by the runtime enforcement layer (Task 3.2): loads the
 * platform-auth + seat-assets stores best-effort and resolves the authorization
 * decision. Stores are optional — when platform auth is disabled (local mode) the
 * decision is an ungoverned allow, preserving single-operator behavior.
 */
export async function loadEmployeeOperationalAuthorization(
  ownerId: string,
  client: GatewayClient | null = null,
): Promise<EmployeeOperationalAuthorization> {
  const [platformStore, seatStore] = await Promise.all([
    loadPlatformAuthStoreBestEffort(),
    loadSeatAssetsStoreBestEffort(client),
  ]);
  return resolveEmployeeOperationalAuthorization({ ownerId, platformStore, seatStore });
}

async function loadPlatformAuthStoreBestEffort(): Promise<PlatformAuthStore | null> {
  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return null;
  }
  return loadPlatformAuthStore(authConfig);
}

async function loadSeatAssetsStoreBestEffort(
  client: GatewayClient | null,
): Promise<EnterpriseSeatAssetsStore | null> {
  try {
    const storePath = await resolveControlPlaneStorePathForClient(client, TENANT_SEAT_ASSETS_FILE);
    return await loadEnterpriseSeatAssetsStore(storePath);
  } catch {
    return null;
  }
}
