/**
 * Ciphertext object store for Vault Sync.
 * File (default) or S3/MinIO — metadata remains in the control-plane store.
 */

export type VaultSyncObjectStoreKind = "file" | "s3" | "memory";

export type VaultSyncObjectPutResult = {
  storageKey: string;
  sizeBytes: number;
};

export type VaultSyncPresignedPut = {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
  storageKey: string;
};

export type VaultSyncPresignedGet = {
  url: string;
  method: "GET";
  expiresAt: string;
  storageKey: string;
};

export interface VaultSyncObjectStore {
  readonly kind: VaultSyncObjectStoreKind;
  /** Absolute or logical key for vault ciphertext: vaults/{vaultId}/blobs/{blobId}.bin */
  buildStorageKey(vaultId: string, blobId: string): string;
  put(params: {
    vaultId: string;
    blobId: string;
    ciphertext: Buffer;
  }): Promise<VaultSyncObjectPutResult> | VaultSyncObjectPutResult;
  get(params: { vaultId: string; storageKey: string }): Promise<Buffer | null> | Buffer | null;
  /** Async get for stores that need custom fetch (S3 tests / MinIO). */
  getAsync?(params: { vaultId: string; storageKey: string }): Promise<Buffer | null>;
  delete?(params: { vaultId: string; storageKey: string }): Promise<void> | void;
  /** Optional direct-to-object-store upload (S3/MinIO). */
  createPresignedPut?(params: {
    vaultId: string;
    blobId: string;
    contentLength: number;
    expiresSeconds?: number;
  }): Promise<VaultSyncPresignedPut> | VaultSyncPresignedPut;
  createPresignedGet?(params: {
    vaultId: string;
    storageKey: string;
    expiresSeconds?: number;
  }): Promise<VaultSyncPresignedGet | null> | VaultSyncPresignedGet | null;
}

export function vaultSyncObjectStorageKey(vaultId: string, blobId: string): string {
  return `vaults/${vaultId}/blobs/${blobId}.bin`;
}
