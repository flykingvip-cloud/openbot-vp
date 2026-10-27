import { resolveEmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveTenantContext } from "../tenant-context.js";

/**
 * Trust levels for "tenant id" surfaces (Mode A / Track D).
 *
 * - membership: gateway `resolveTenantContext` / platform-auth membership only (ACL-safe).
 * - service_execution: durable background/service principal tenant, minted only at a
 *   controlled composition root after re-verifying persistent tenant ownership /
 *   executing bot / authorization basis. ACL-safe for managed team writes; NOT a
 *   renamed actor_fallback and NOT a fake interactive employee session.
 * - actor_fallback: employee workbench actor hint — collaboration I/O only, NEVER ACL SoT.
 * - none: unresolved; fail closed for authorization paths.
 *
 * Diagnosis uses a separate protocol type `TrustedTenantContext` /
 * `DiagnosisTrustedTenantContext` in `src/diagnosis/types.ts` — do not conflate.
 */
export type CollaborationTenantTrustLevel =
  | "membership"
  | "service_execution"
  | "actor_fallback"
  | "none";

export type CollaborationTenantResolution = {
  tenantId: string | null;
  trust: CollaborationTenantTrustLevel;
};

/**
 * Membership-only tenant id for authorization / managed ACL.
 * Fail closed: no actor fallback, never client-supplied tenant params.
 */
export async function resolveMembershipTenantIdForAcl(
  client: GatewayClient | null | undefined,
): Promise<string | null> {
  try {
    const ctx = await resolveTenantContext(client ?? null);
    const tenantId = ctx?.tenantId?.trim() || null;
    return tenantId;
  } catch {
    return null;
  }
}

/**
 * Collaboration C5 I/O tenant resolution with explicit trust level.
 * Prefer membership; actor fallback is labeled and must not be treated as ACL.
 * Never accepts a client-supplied tenant param.
 */
export async function resolveCollaborationTenantResolution(
  client: GatewayClient | null | undefined,
): Promise<CollaborationTenantResolution> {
  try {
    const ctx = await resolveTenantContext(client ?? null);
    if (ctx?.tenantId?.trim()) {
      return { tenantId: ctx.tenantId.trim(), trust: "membership" };
    }
  } catch {
    // membership miss — fall through to actor for non-ACL collaboration I/O only
  }
  try {
    const actor = await resolveEmployeeWorkbenchActor(client);
    const tenantId = actor?.tenantId?.trim() || null;
    if (tenantId) {
      return { tenantId, trust: "actor_fallback" };
    }
  } catch {
    // ignore
  }
  return { tenantId: null, trust: "none" };
}

/**
 * @deprecated Prefer {@link resolveMembershipTenantIdForAcl} for ACL, or
 * {@link resolveCollaborationTenantResolution} when trust level matters.
 * Returns tenant id from membership first, then actor fallback (non-ACL hint).
 * Never accepts a client-supplied tenant param.
 */
export async function resolveTrustedCollaborationTenantId(
  client: GatewayClient | null | undefined,
): Promise<string | null> {
  const resolved = await resolveCollaborationTenantResolution(client);
  return resolved.tenantId;
}

/**
 * Label a non-membership tenant id for collaboration I/O / runtime namespace only.
 * Never returns trust `"membership"` or `"service_execution"` — ACL SoT must call
 * {@link resolveMembershipTenantIdForAcl} or mint {@link labelServiceExecutionTenant}
 * at a controlled composition root.
 */
export function labelCollaborationIoTenant(
  tenantId: string | null | undefined,
): CollaborationTenantResolution {
  const id = tenantId?.trim() || null;
  return { tenantId: id, trust: id ? "actor_fallback" : "none" };
}

/**
 * Label a verified background/service-execution tenant for managed ACL.
 * Call only from gateway composition roots that already re-checked durable
 * tenant+group ownership and the executing bot — never from client-supplied
 * tenant params alone, and never as a rename of actor_fallback → membership.
 */
export function labelServiceExecutionTenant(
  tenantId: string | null | undefined,
): CollaborationTenantResolution {
  const id = tenantId?.trim() || null;
  return { tenantId: id, trust: id ? "service_execution" : "none" };
}

/**
 * Entry composition roots (handoff/claim/self-advance/wake/board): prefer the
 * caller-supplied {@link resolveCollaborationTenantResolution} result; otherwise
 * fall back to group-ownership tenant id for namespace scoping, labeled as I/O
 * (`actor_fallback`), never as membership ACL.
 */
export function resolveAuthorityTenantForEntry(params: {
  preferred?: CollaborationTenantResolution | null;
  groupTenantId?: string | null;
}): CollaborationTenantResolution {
  const preferredId = params.preferred?.tenantId?.trim() || null;
  if (preferredId) {
    const trust = params.preferred?.trust ?? "actor_fallback";
    // Do not upgrade a weaker label to membership inside the entry adapter.
    if (trust === "membership") {
      return { tenantId: preferredId, trust: "membership" };
    }
    if (trust === "service_execution") {
      return { tenantId: preferredId, trust: "service_execution" };
    }
    if (trust === "none") {
      return { tenantId: preferredId, trust: "actor_fallback" };
    }
    return { tenantId: preferredId, trust: "actor_fallback" };
  }
  return labelCollaborationIoTenant(params.groupTenantId);
}

/**
 * ACL-safe trust levels: interactive membership sessions and verified
 * background service_execution. `actor_fallback` / `none` must not authorize
 * managed ACL.
 */
export function isAclSafeTenantTrust(trust: CollaborationTenantTrustLevel): boolean {
  return trust === "membership" || trust === "service_execution";
}
