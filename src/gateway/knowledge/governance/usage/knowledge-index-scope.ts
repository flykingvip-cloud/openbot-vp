import path from "node:path";

export type KnowledgeIndexDbScope = {
  enterpriseId: string | null;
  userId: string | null;
};

/** Derive billing attribution scope from a knowledge index SQLite path. */
export function parseKnowledgeIndexDbScope(dbPath: string): KnowledgeIndexDbScope {
  const normalized = path.normalize(dbPath).replace(/\\/g, "/");
  const tenantMatch = normalized.match(/\/index\/tenant\/([^/]+)\.db$/i);
  if (tenantMatch?.[1]) {
    return { enterpriseId: tenantMatch[1], userId: null };
  }
  const personalMatch = normalized.match(/\/index\/personal\/([^/]+)\.db$/i);
  if (personalMatch?.[1]) {
    return { enterpriseId: null, userId: personalMatch[1] };
  }
  return { enterpriseId: null, userId: null };
}
