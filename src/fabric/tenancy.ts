/**
 * tenancy.ts — multi-tenant isolation for policy / execution / audit spaces (R10).
 *
 * Reuses AOR's `tenantSessionKey` for session-key prefixing (no parallel
 * mechanism). The default isolation is strict:
 *  - a request's effective session key is tenant-prefixed when a tenant is set;
 *  - cross-tenant resource access is denied (R10.2);
 *  - an untenanted (local single-user) requester degrades to seeing only
 *    untenanted resources — preserving existing single-tenant behavior (R10.3).
 *
 * Platform/admin cross-tenant access is NOT granted here; that is a session
 * domain + scope concern resolved upstream in the Policy Runtime.
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.10.
 */

import { tenantSessionKey } from "@openbot/aor-core";
import type { ToolRequest } from "./contract.js";

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}

/** Normalized tenant id (trimmed) or undefined for single-tenant/local. */
export function tenantOf(source: ToolRequest["source"]): string | undefined {
  const id = source.tenantId?.trim();
  return id ? id : undefined;
}

/**
 * The effective, tenant-isolated session key. With a tenant, returns a
 * `tenantId:base` prefixed key (idempotent); without, returns the base
 * unchanged (single-tenant degrade).
 */
export function scopedSessionKey(source: ToolRequest["source"], baseSessionKey: string): string {
  return tenantSessionKey(tenantOf(source), baseSessionKey);
}

/**
 * Whether a requester tenant may access a resource owned by a (possibly absent)
 * resource tenant. Strict: equal tenants only; an untenanted requester may see
 * only untenanted resources.
 */
export function canAccessTenantResource(
  requesterTenant: string | undefined,
  resourceTenant: string | undefined,
): boolean {
  const requester = requesterTenant?.trim() || undefined;
  const resource = resourceTenant?.trim() || undefined;
  if (!requester) {
    return !resource; // single-tenant/local: only untenanted resources
  }
  return requester === resource;
}

/** Throw if the requester may not access the resource's tenant. */
export function assertTenantAccess(
  requesterTenant: string | undefined,
  resourceTenant: string | undefined,
): void {
  if (!canAccessTenantResource(requesterTenant, resourceTenant)) {
    throw new TenantIsolationError(
      `cross-tenant access denied: requester=${requesterTenant ?? "<none>"} resource=${resourceTenant ?? "<none>"}`,
    );
  }
}

/** Filter a list of tenant-tagged items to those visible to the requester. */
export function filterByTenant<T extends { tenantId?: string }>(
  items: readonly T[],
  requesterTenant: string | undefined,
): T[] {
  return items.filter((item) => canAccessTenantResource(requesterTenant, item.tenantId));
}
