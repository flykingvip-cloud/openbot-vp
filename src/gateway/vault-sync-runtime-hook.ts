import fs from "node:fs";
import path from "node:path";
/**
 * Registers the Vault Sync → Knowledge Runtime reindex hook at gateway startup.
 * Matches local-folder bindings by knowledgeBaseId and/or rootPath, then runs
 * a full local-folder scan (ingest / tombstone propagation) into that KB.
 */
import { setVaultSyncRuntimeReindexHook } from "../vault-sync/runtime-reindex.js";
import { getVaultKnowledgeBaseBinding } from "../vault-sync/vault-kb-binding.js";

let registered = false;

function normalizeRoot(rootPath: string): string {
  try {
    return path.resolve(rootPath);
  } catch {
    return rootPath.trim();
  }
}

export async function runVaultSyncRuntimeReindex(params: {
  rootPath?: string | null;
  touchedRelativePaths: string[];
  knowledgeBaseId?: string | null;
  vaultId?: string | null;
  log: { info: (msg: string) => void; warn: (msg: string) => void };
}): Promise<{
  matchedBindings: number;
  ingested: number;
  tombstoned: number;
  knowledgeBaseId: string | null;
  rootAccessible: boolean;
  errors: string[];
}> {
  const summary = {
    matchedBindings: 0,
    ingested: 0,
    tombstoned: 0,
    knowledgeBaseId: null as string | null,
    rootAccessible: false,
    errors: [] as string[],
  };

  const boundKb =
    params.knowledgeBaseId?.trim() ||
    (params.vaultId?.trim()
      ? (getVaultKnowledgeBaseBinding(params.vaultId.trim())?.knowledgeBaseId ?? null)
      : null);
  summary.knowledgeBaseId = boundKb;

  const rootRaw = params.rootPath?.trim() || "";
  const root = rootRaw ? normalizeRoot(rootRaw) : "";
  summary.rootAccessible = Boolean(root && fs.existsSync(root));

  const { listLocalFolderBindings } =
    await import("./knowledge/sources/local-folder-binding-store.js");
  const { getKnowledgeBase } = await import("./knowledge/knowledge-base-store.js");
  const { scanLocalFolderBinding } = await import("./knowledge/sources/local-folder-runtime.js");

  let bindings = listLocalFolderBindings(boundKb ? { knowledgeBaseId: boundKb } : {});
  if (summary.rootAccessible) {
    const byRoot = bindings.filter((binding) => normalizeRoot(binding.rootPath) === root);
    if (byRoot.length > 0) {
      bindings = byRoot;
    } else if (!boundKb) {
      bindings = listLocalFolderBindings({}).filter(
        (binding) => normalizeRoot(binding.rootPath) === root,
      );
    }
  } else if (!boundKb) {
    params.log.info(
      `vault-sync runtime reindex: no accessible root and no knowledgeBaseId (${params.touchedRelativePaths.length} touched path(s)); bind vault→KB or use a gateway-visible rootPath`,
    );
    return summary;
  }

  summary.matchedBindings = bindings.length;
  if (bindings.length === 0) {
    params.log.info(
      `vault-sync runtime reindex: no local-folder binding for kb=${boundKb ?? "none"} root=${root || "n/a"} (${params.touchedRelativePaths.length} touched path(s))`,
    );
    return summary;
  }

  for (const binding of bindings) {
    if (!fs.existsSync(binding.rootPath)) {
      summary.errors.push(`binding root missing: ${binding.bindingId}`);
      continue;
    }
    const knowledgeBase = getKnowledgeBase(binding.knowledgeBaseId);
    if (!knowledgeBase) {
      summary.errors.push(`knowledge base missing: ${binding.knowledgeBaseId}`);
      continue;
    }
    try {
      const scan = await scanLocalFolderBinding({
        binding,
        knowledgeBase,
        ownerId: knowledgeBase.ownerId,
      });
      summary.ingested += scan.ingested;
      summary.tombstoned += scan.tombstoned;
      if (scan.errors.length > 0) {
        summary.errors.push(...scan.errors.slice(0, 5));
      }
      params.log.info(
        `vault-sync runtime reindex: binding=${binding.bindingId} kb=${binding.knowledgeBaseId} scanned=${scan.scanned} ingested=${scan.ingested} tombstoned=${scan.tombstoned}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "scan failed";
      summary.errors.push(message);
      params.log.warn(`vault-sync runtime reindex failed for ${binding.bindingId}: ${message}`);
    }
  }
  return summary;
}

export function registerVaultSyncRuntimeReindexHook(log: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}): void {
  if (registered) {
    return;
  }
  registered = true;
  setVaultSyncRuntimeReindexHook(
    async ({ rootPath, touchedRelativePaths, knowledgeBaseId, vaultId }) => {
      await runVaultSyncRuntimeReindex({
        rootPath,
        touchedRelativePaths,
        knowledgeBaseId,
        vaultId,
        log,
      });
    },
  );
}
