/**
 * Visibility Resolver — permission gate for retrieval.
 *
 * Physical database isolation (per-user / per-tenant db files) is NOT a substitute
 * for permission checks: the calling layer can still over-reach. Every retrieval
 * entry point must resolve the caller's accessible knowledge bases through this
 * resolver before issuing any `WHERE kb_id IN (...)` query.
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
 * Decide whether a caller may read a single knowledge base.
 * - private: owner only
 * - team / enterprise: same tenant (department/role scoping reserved)
 * - tenant-less team/enterprise: falls back to owner check
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

/** Resolve the set of knowledge base ids the caller may read. */
export function resolveAccessibleKnowledgeBases(
  ctx: RetrievalContext,
  candidates: VisibilityKnowledgeBase[],
): string[] {
  return candidates.filter((kb) => isKnowledgeBaseVisible(ctx, kb)).map((kb) => kb.id);
}
