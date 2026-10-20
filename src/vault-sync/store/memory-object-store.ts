import {
  vaultSyncObjectStorageKey,
  type VaultSyncObjectPutResult,
  type VaultSyncObjectStore,
} from "./object-store.js";

/** In-memory object store for unit tests. */
export class MemoryVaultSyncObjectStore implements VaultSyncObjectStore {
  readonly kind = "memory" as const;
  private readonly objects = new Map<string, Buffer>();

  buildStorageKey(vaultId: string, blobId: string): string {
    return vaultSyncObjectStorageKey(vaultId, blobId);
  }

  put(params: { vaultId: string; blobId: string; ciphertext: Buffer }): VaultSyncObjectPutResult {
    const storageKey = this.buildStorageKey(params.vaultId, params.blobId);
    this.objects.set(storageKey, Buffer.from(params.ciphertext));
    return { storageKey, sizeBytes: params.ciphertext.length };
  }

  get(params: { vaultId: string; storageKey: string }): Buffer | null {
    void params.vaultId;
    const buf = this.objects.get(params.storageKey);
    return buf ? Buffer.from(buf) : null;
  }

  delete(params: { vaultId: string; storageKey: string }): void {
    void params.vaultId;
    this.objects.delete(params.storageKey);
  }

  /** Test helper */
  keys(): string[] {
    return [...this.objects.keys()].toSorted();
  }
}
