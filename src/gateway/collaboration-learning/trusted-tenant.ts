import { resolveEmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveTenantContext } from "../tenant-context.js";

/**
 * Trust levels for "tenant id" surfaces (Mode A / Track D).
 *
 * - membership: gateway `resolveTenantContext` / platform-auth membership only (ACL-safe).
 * - actor_fallback: employee workbench actor hint — collaboration I/O only, NEVER ACL SoT.
 * - none: unresolved; fail closed for authorization paths.
 *
 * Diagnosis uses a separate protocol type `TrustedTenantContext` /
 * `DiagnosisTrustedTenantContext` in `src/diagnosis/types.ts` — do not conflate.
 */
export type CollaborationTenantTrustLevel = "membership" | "actor_fallback" | "none";

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
