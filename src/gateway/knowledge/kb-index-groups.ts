import { resolveKnowledgeIndexDbPath } from "./kb-index.js";
import type { KnowledgeBase } from "./knowledge-base-store.js";

export type KnowledgeIndexDbGroup = {
  dbPath: string;
  kbIds: string[];
  kbTitles: Map<string, string>;
};

/** Group knowledge bases that share the same physical sqlite index file. */
export function groupKnowledgeBasesByIndexDb(
  bases: KnowledgeBase[],
  indexRoot?: string,
): Map<string, KnowledgeIndexDbGroup> {
  const groups = new Map<string, KnowledgeIndexDbGroup>();
  for (const base of bases) {
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: base.ownerId,
      tenantId: base.tenantId,
      indexRoot,
    });
    const existing = groups.get(dbPath);
    if (existing) {
      existing.kbIds.push(base.id);
      existing.kbTitles.set(base.id, base.title);
      continue;
    }
    groups.set(dbPath, {
      dbPath,
      kbIds: [base.id],
      kbTitles: new Map([[base.id, base.title]]),
    });
  }
  return groups;
}
