import {
  flattenKnowledgeImportBasename,
  isImportableKnowledgeFilename,
  uniquifyKnowledgeImportBasename,
} from "../importable-filename.js";

export {
  flattenKnowledgeImportBasename,
  isImportableKnowledgeFilename,
  uniquifyKnowledgeImportBasename,
};

/** Managed folder import keeps files only — no nested prefixes or empty folder shells. */
export function flattenManagedPushInventory<T extends { relativePath: string; fileName?: string }>(
  items: T[],
): T[] {
  const used = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const rawName = (
      item.fileName?.trim() || flattenKnowledgeImportBasename(item.relativePath)
    ).trim();
    if (!isImportableKnowledgeFilename(rawName)) {
      continue;
    }
    const unique = uniquifyKnowledgeImportBasename(flattenKnowledgeImportBasename(rawName), used);
    used.add(unique);
    out.push({
      ...item,
      relativePath: unique,
      ...(item.fileName !== undefined ? { fileName: unique } : {}),
    });
  }
  return out;
}
