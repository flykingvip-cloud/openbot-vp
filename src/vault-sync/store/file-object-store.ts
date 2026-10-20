import fs from "node:fs";
import path from "node:path";
import {
  vaultSyncObjectStorageKey,
  type VaultSyncObjectPutResult,
  type VaultSyncObjectStore,
} from "./object-store.js";

/** Local filesystem ciphertext store (P1 default). */
export class FileVaultSyncObjectStore implements VaultSyncObjectStore {
  readonly kind = "file" as const;

  constructor(private readonly rootDir: string) {
    fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
  }

  buildStorageKey(vaultId: string, blobId: string): string {
    return vaultSyncObjectStorageKey(vaultId, blobId);
  }

  put(params: { vaultId: string; blobId: string; ciphertext: Buffer }): VaultSyncObjectPutResult {
    const storageKey = this.buildStorageKey(params.vaultId, params.blobId);
    const abs = path.join(this.rootDir, storageKey);
    fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
    fs.writeFileSync(abs, params.ciphertext, { mode: 0o600 });
    return { storageKey, sizeBytes: params.ciphertext.length };
  }

  get(params: { vaultId: string; storageKey: string }): Buffer | null {
    const abs = path.join(this.rootDir, params.storageKey);
    if (!fs.existsSync(abs)) {
      // Back-compat: older plane stored blobs under vaults/{id}/blobs/{id}.bin relative to vault dir
      // with storageKey "blobs/{id}.bin".
      const legacy = path.join(this.rootDir, "vaults", params.vaultId, params.storageKey);
      if (fs.existsSync(legacy)) {
        return fs.readFileSync(legacy);
      }
      return null;
    }
    return fs.readFileSync(abs);
  }

  delete(params: { vaultId: string; storageKey: string }): void {
    const abs = path.join(this.rootDir, params.storageKey);
    try {
      fs.unlinkSync(abs);
    } catch {
      const legacy = path.join(this.rootDir, "vaults", params.vaultId, params.storageKey);
      try {
        fs.unlinkSync(legacy);
      } catch {
        // ignore
      }
    }
  }
}
