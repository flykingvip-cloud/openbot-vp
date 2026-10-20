import { loadConfig } from "../config/config.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "./platform-auth.js";
import {
  findUniqueMembershipByUserId,
  listMembershipsByUserId,
} from "./platform-auth/memberships.js";
import { resolveTenantForSeatId } from "./seat-tenant-index.js";
import { canonicalizeTenantId } from "./tenant-canonicalization.js";

/**
 * Resolve the owning tenant for an agent (ops-decommission task 2.8a).
 *
 * Source of truth: `cfg.agents.list[]`. Resolution order:
 * 1. explicit `tenantId` on the agent entry (forward-compat; not yet in schema), else
 * 2. seat ownership (`ownerType: "position"`): `ownerId` is a seat id, and the seat
 *    record carries its own `tenantId`. This is how most production agents are
 *    owned; without this branch they resolved to `null` and every tenant-scoped
 *    operator action on them failed with "agent has no tenant ownership proof".
 * 3. `ownerId` → platform-auth membership → `enterpriseId`. A unique membership
 *    resolves directly; several memberships resolve only when they all point at
 *    the SAME enterprise (no tenant to leak between), mirroring #748. Memberships
 *    spanning different enterprises stay ambiguous and fail closed to `null`.
 *
 * Returns the canonicalized tenant id, or `null` when the agent is unowned /
 * not tied to an enterprise (platform-global — visible to platform only, never
 * surfaced to a tenant scope; consistent with `scope-attribution`).
 */
export async function resolveAgentTenant(agentId: string): Promise<string | null> {
  const normalizedAgentId = agentId?.trim();
  if (!normalizedAgentId) {
    return null;
  }
  const cfg = loadConfig();
  const entry = cfg.agents?.list?.find(
    (candidate) => (candidate.id ?? "").trim() === normalizedAgentId,
  );
  if (!entry) {
    return null;
  }

  // 1. Explicit tenantId on the agent entry (forward-compatible read).
  const explicit = (entry as { tenantId?: unknown }).tenantId;
  if (typeof explicit === "string" && explicit.trim()) {
    return canonicalizeTenantId(explicit) ?? explicit.trim();
  }

  const ownerId = typeof entry.ownerId === "string" ? entry.ownerId.trim() : "";
  if (!ownerId) {
    return null;
  }

  // 2. Seat ownership: ownerId names a seat, and the seat knows its tenant.
  //    Checked before the membership path because a seat id is never a user id,
  //    so the membership lookup below could only ever fail for these agents.
  const ownerType = (entry as { ownerType?: unknown }).ownerType;
  if (typeof ownerType === "string" && ownerType.trim() === "position") {
    const seatTenant = await resolveTenantForSeatId(ownerId);
    return seatTenant ?? null;
  }

  // 3. ownerId → membership → enterpriseId.
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return null;
  }
  try {
    const store = await loadPlatformAuthStore(authConfig);
    // No session exists here (this attributes a stored entry). An owner with
    // several memberships spanning DIFFERENT enterprises stays ambiguous and must
    // not be resolved by store order. But when every membership resolves to the
    // SAME enterprise there is no tenant to leak between, so the enterprise is
    // unambiguous — resolve it instead of failing closed. This mirrors
    // resolveAuthoritativeEnterpriseScope (#748): pick the least-privileged
    // ("member") membership as the representative so attribution never inherits
    // enterprise-admin scope.
    let membership = findUniqueMembershipByUserId(store, ownerId);
    if (!membership) {
      const all = listMembershipsByUserId(store, ownerId);
      if (all.length === 0) {
        return null;
      }
      const distinctEnterpriseIds = new Set(
        all.map((record) => canonicalizeTenantId(record.enterpriseId) ?? record.enterpriseId),
      );
      if (distinctEnterpriseIds.size !== 1) {
        return null;
      }
      membership =
        all.find((record) => record.membershipRole === "member") ??
        [...all].toSorted((left, right) =>
          (left.createdAt ?? "").localeCompare(right.createdAt ?? ""),
        )[0];
    }
    if (!membership?.enterpriseId) {
      return null;
    }
    return canonicalizeTenantId(membership.enterpriseId) ?? membership.enterpriseId;
  } catch {
    return null;
  }
}
