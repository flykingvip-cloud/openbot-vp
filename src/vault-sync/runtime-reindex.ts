/**
 * After vault sync applies remote files, trigger local Knowledge Runtime reindex.
 * Sync never uploads SQLite/embeddings — Runtime is rebuilt on the trusted device only.
 */
export type RuntimeReindexHook = (params: {
  rootPath: string;
  touchedRelativePaths: string[];
  knowledgeBaseId?: string | null;
  vaultId?: string | null;
}) => Promise<void> | void;

let hook: RuntimeReindexHook | null = null;

export function setVaultSyncRuntimeReindexHook(next: RuntimeReindexHook | null): void {
  hook = next;
}

export async function notifyVaultSyncRuntimeReindex(params: {
  rootPath: string;
  touchedRelativePaths: string[];
  knowledgeBaseId?: string | null;
  vaultId?: string | null;
}): Promise<void> {
  if (!hook || params.touchedRelativePaths.length === 0) {
    return;
  }
  await hook(params);
}
