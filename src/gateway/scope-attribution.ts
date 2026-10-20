import { loadConfig } from "../config/config.js";
import { resolveBillingScope } from "./billing/scope.js";
import {
  isPersonalWorkbenchClient,
  resolveEmployeeWorkbenchActor,
} from "./employee-workbench-scope.js";
import { resolvePlatformAuthConfig } from "./platform-auth/config.js";
import type { GatewayClient } from "./server-methods/types.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";

/**
 * Tenant/owner attribution for record-type data (sessions / cron / devices / exec).
 * Phase 2, decision B (see `.kiro/specs/ops-decommission/design.md` → 归属模型).
 *
 * Attribution is resolved from the authenticated session ONLY — client-supplied
 * tenantId/ownerId is never trusted as an authority source. Records carry an
 * `ownership` stamp written at creation; management surfaces filter by the
 * caller's resolved scope. Unattributed records are platform-global (visible to
 * platform only; never returned to a tenant/self query) to avoid false isolation.
 */

export type RecordOwnership = {
  tenantId?: string;
  ownerId?: string;
};

/** Trusted attribution derived from the session, used to stamp new records. */
export type TrustedAttribution = {
  tenantId?: string;
  ownerId?: string;
};

/** The scope a list/read query runs under (resolved server-side, never from raw params). */
export type QueryScope =
  | { kind: "platform" }
  | { kind: "tenant"; tenantId: string }
  | { kind: "self"; ownerId: string }
  // Fail-closed: a personal-workbench session whose identity could not be
  // resolved under platform auth. Sees NOTHING (never widened to platform).
  | { kind: "none" };

/**
 * Resolve the trusted attribution to stamp onto a record created by this session.
 * `tenantId` = resolved enterprise; `ownerId` = platform-auth user id (when present).
 */
export async function resolveTrustedAttribution(
  client: GatewayClient | null,
): Promise<TrustedAttribution> {
  const scope = await resolveBillingScope(client);
  const attribution: TrustedAttribution = {};
  if (scope.enterpriseId) {
    attribution.tenantId = scope.enterpriseId;
  }
  const ownerId = scope.user?.id?.trim();
  if (ownerId) {
    attribution.ownerId = ownerId;
  }
  // Billing scope only yields a user when enterprise membership resolves, so a
  // membership-less employee gets no ownerId and would fall through to an
  // over-broad scope (cross-user record leak). Fall back to the workbench actor
  // (email → platform user id, membership-independent) so personal-workbench
  // records still resolve a stable owner for stamping and self-scoped queries.
  // This keeps the two identity-resolution paths (billing vs workbench) aligned.
  if (!attribution.ownerId && isPersonalWorkbenchClient(client)) {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (actor?.userId) {
      attribution.ownerId = actor.userId;
      if (!attribution.tenantId && actor.tenantId) {
        attribution.tenantId = actor.tenantId;
      }
    }
  }
  return attribution;
}

/**
 * Decide whether a record is visible to a given query scope.
 *
 * - platform: sees everything (including unattributed records)
 * - tenant=T: only records whose ownership.tenantId === T
 * - self=U: only records whose ownership.ownerId === U
 *
 * Unattributed records are platform-global: never returned to tenant/self scopes.
 */
export function isRecordVisibleToScope(
  ownership: RecordOwnership | undefined,
  scope: QueryScope,
): boolean {
  if (scope.kind === "platform") {
    return true;
  }
  if (scope.kind === "none") {
    // Fail-closed: unidentified personal-workbench session sees no records.
    return false;
  }
  if (scope.kind === "tenant") {
    const recordTenant = canonicalizeTenantId(ownership?.tenantId ?? null);
    return recordTenant !== null && recordTenant === scope.tenantId;
  }
  // self
  const recordOwner = ownership?.ownerId?.trim();
  return Boolean(recordOwner) && recordOwner === scope.ownerId;
}

/** Filter a list of records by visibility under the given query scope. */
export function filterRecordsByScope<T>(
  records: readonly T[],
  getOwnership: (record: T) => RecordOwnership | undefined,
  scope: QueryScope,
): T[] {
  if (scope.kind === "platform") {
    return [...records];
  }
  if (scope.kind === "none") {
    return [];
  }
  return records.filter((record) => isRecordVisibleToScope(getOwnership(record), scope));
}

function resolveRequestedTenantIdFromClient(client: GatewayClient | null): string | null {
  const hinted = client?.sessionTenantId?.trim();
  return hinted ? hinted : null;
}

/**
 * Resolve tenant scope for enterprise-domain sessions. Never widens to platform.
 * Falls back to `resolveBillingScope(client, { requestedTenantId })` for local
 * operator mode when membership is absent but the URL/header names a tenant.
 */
async function resolveEnterpriseQueryTenantId(
  client: GatewayClient | null,
  attribution: TrustedAttribution,
): Promise<string | null> {
  if (attribution.tenantId) {
    return attribution.tenantId;
  }
  const requestedTenantId = resolveRequestedTenantIdFromClient(client);
  if (!requestedTenantId) {
    return null;
  }
  const fallbackScope = await resolveBillingScope(client, { requestedTenantId });
  if (fallbackScope.enterpriseId) {
    return fallbackScope.enterpriseId;
  }
  const canonical = canonicalizeTenantId(requestedTenantId);
  return canonical ?? requestedTenantId;
}

/** Whether the gateway runs in platform (multi-tenant) auth mode. */
function isPlatformAuthEnabled(): boolean {
  try {
    return resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy) !== null;
  } catch {
    return false;
  }
}

/**
 * Resolve the query scope for a management/list call from the authenticated
 * session. Uses `client.sessionDomain` (which port) plus trusted attribution:
 * - enterprise port → tenant scope (resolved tenant, or `__unresolved__` = sees nothing)
 * - employee port + resolved owner → self scope
 * - employee port without a resolvable owner:
 *     - platform mode  → `none` (fail closed: sees nothing, never leaks others)
 *     - local operator → platform (a lone operator keeps seeing everything)
 * - other / no domain → platform
 *
 * Failing closed for personal-workbench sessions is deliberate: widening an
 * unidentifiable employee session to platform scope surfaced every other user's
 * records in their "my ..." lists (observed cross-user cron leak).
 */
export async function resolveQueryScope(client: GatewayClient | null): Promise<QueryScope> {
  const domain = client?.sessionDomain;
  const attribution = await resolveTrustedAttribution(client);
  if (domain === "enterprise") {
    const tenantId = await resolveEnterpriseQueryTenantId(client, attribution);
    if (tenantId) {
      return { kind: "tenant", tenantId };
    }
    // Enterprise port must never see platform-global operational data.
    return { kind: "tenant", tenantId: "__unresolved__" };
  }
  if (domain === "employee") {
    if (attribution.ownerId) {
      return { kind: "self", ownerId: attribution.ownerId };
    }
    // Platform mode: cannot identify the employee → fail closed (see nothing)
    // instead of widening to platform and leaking other users' records.
    if (isPlatformAuthEnabled()) {
      return { kind: "none" };
    }
  }
  return { kind: "platform" };
}
