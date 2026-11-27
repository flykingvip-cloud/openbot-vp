/**
 * Visibility Resolver — permission gate for retrieval.
 *
 * Physical database isolation (per-user / per-tenant db files) is NOT a substitute
 * for permission checks: the calling layer can still over-reach. This helper
 * is the tenant/owner visibility primitive used as a fallback inside
 * {@link canReadKnowledgeBase}. It is not the authoritative read gate;
 * product read paths must go through canReadKnowledgeBase.
 */
import type { RetrievalContext } from "./types.js";

/** Minimal KB descriptor needed for visibility resolution (keeps the platform domain-agnostic). */
export type VisibilityKnowledgeBase = {
  id: string;
  visibility: "private" | "team" | "enterprise";
  ownerId: string | null;
  tenantId: string | null;
  // Reserved: departmentId / roleCodes for finer enterprise scoping.
};

/**
 * Visibility primitive (not the authoritative read gate).
 * - private: owner only
 * - team / enterprise: same tenant (department/role scoping reserved)
 * - tenant-less team/enterprise: falls back to owner check
 *
 * Active private-KB members are intentionally not included here; they are
 * granted by canReadKnowledgeBase's membership check.
 *
 * Tenant ids are compared after trimming so incidental whitespace drift never
 * hides a legitimately shared team/enterprise base from a same-tenant member.
 * (Alias canonicalization happens at the gateway boundary before values reach
 * here, keeping this resolver domain-agnostic.)
 */
export function isKnowledgeBaseVisible(
  ctx: RetrievalContext,
  kb: VisibilityKnowledgeBase,
): boolean {
  if (kb.visibility === "private") {
    return Boolean(ctx.userId) && ctx.userId === kb.ownerId;
  }
  const kbTenant = kb.tenantId?.trim();
  if (kbTenant) {
    const ctxTenant = ctx.tenantId?.trim();
    return Boolean(ctxTenant) && ctxTenant === kbTenant;
  }
  return Boolean(ctx.userId) && ctx.userId === kb.ownerId;
}

/** Visibility-only id filter. Not the authoritative read gate. */
export function resolveAccessibleKnowledgeBases(
  ctx: RetrievalContext,
  candidates: VisibilityKnowledgeBase[],
): string[] {
  return candidates.filter((kb) => isKnowledgeBaseVisible(ctx, kb)).map((kb) => kb.id);
}
