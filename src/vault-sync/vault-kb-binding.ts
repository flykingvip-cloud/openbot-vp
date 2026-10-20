/**
 * Optional vault → knowledge-base projection binding.
 * Lets post-sync Runtime reindex target the correct space without embedding
 * knowledgeBaseId into the E2EE vault record itself.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type VaultKnowledgeBaseBinding = {
  vaultId: string;
  knowledgeBaseId: string;
  updatedAt: string;
};

type BindingStoreFile = {
  bindings: Record<string, VaultKnowledgeBaseBinding>;
};

function resolveStorePath(rootDir?: string): string {
  const root =
    rootDir?.trim() ||
    process.env.OPENBOT_VAULT_SYNC_DIR?.trim() ||
    path.join(os.homedir(), ".openbot", "vault-sync", "control-plane");
  return path.join(path.resolve(root), "kb-bindings.json");
}

function readStore(storePath: string): BindingStoreFile {
  try {
    if (!fs.existsSync(storePath)) {
      return { bindings: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { bindings: {} };
    }
    const bindings = (parsed as { bindings?: unknown }).bindings;
    if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) {
      return { bindings: {} };
    }
    return { bindings: bindings as Record<string, VaultKnowledgeBaseBinding> };
  } catch {
    return { bindings: {} };
  }
}

function writeStore(store: BindingStoreFile, storePath: string): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function getVaultKnowledgeBaseBinding(
  vaultId: string,
  rootDir?: string,
): VaultKnowledgeBaseBinding | null {
  const id = vaultId.trim();
  if (!id) {
    return null;
  }
  return readStore(resolveStorePath(rootDir)).bindings[id] ?? null;
}

export function setVaultKnowledgeBaseBinding(params: {
  vaultId: string;
  knowledgeBaseId: string;
  rootDir?: string;
}): VaultKnowledgeBaseBinding {
  const vaultId = params.vaultId.trim();
  const knowledgeBaseId = params.knowledgeBaseId.trim();
  if (!vaultId || !knowledgeBaseId) {
    throw new Error("vaultId and knowledgeBaseId required");
  }
  const storePath = resolveStorePath(params.rootDir);
  const store = readStore(storePath);
  const next: VaultKnowledgeBaseBinding = {
    vaultId,
    knowledgeBaseId,
    updatedAt: new Date().toISOString(),
  };
  store.bindings[vaultId] = next;
  writeStore(store, storePath);
  return next;
}
