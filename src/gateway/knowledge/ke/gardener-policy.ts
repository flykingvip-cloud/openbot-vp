/**
 * Gardener write allow/deny table. Extra policy on top of authorizedKnowledgeBase.
 * Not wired into the Gateway dispatcher in Phase A (default remains off).
 */

export const GARDENER_ALLOWED_WRITES = [
  "knowledge.governance.tasks.update",
  "knowledge.base.documents.restore",
  "knowledge.personal.updateTags",
  "knowledge.deliverables.attach",
  "knowledge.web.setRefreshPolicy",
] as const;

export const GARDENER_FORBIDDEN_WRITES = [
  "knowledge.base.delete",
  "knowledge.base.documents.delete",
  "knowledge.base.documents.detach",
  "knowledge.source.unbind",
  "knowledge.local-folder.unbind",
  "knowledge.connector.unbind",
  "knowledge.governance.expert.upsert",
] as const;

export type GardenerDecision = "allow" | "forbid" | "unknown";

const ALLOWED = new Set<string>(GARDENER_ALLOWED_WRITES);
const FORBIDDEN = new Set<string>(GARDENER_FORBIDDEN_WRITES);

export function assertGardenerRpc(method: string): GardenerDecision {
  const key = method.trim();
  if (!key) {
    return "unknown";
  }
  if (FORBIDDEN.has(key)) {
    return "forbid";
  }
  if (ALLOWED.has(key)) {
    return "allow";
  }
  return "unknown";
}

/** Re-upload that overwrites an existing raw_hash is never a gardener write. */
export function isGardenerRawHashOverwriteForbidden(): true {
  return true;
}
