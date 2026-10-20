import os from "node:os";
import path from "node:path";
import { VaultSyncControlPlane, type VaultSyncControlPlaneOptions } from "./control-plane.js";
import { FileVaultSyncObjectStore } from "./file-object-store.js";
import type { VaultSyncObjectStore } from "./object-store.js";
import { createVaultSyncPgClientFromEnv } from "./postgres-client.js";
import {
  resolveVaultSyncMetadataPrimary,
  type VaultSyncMetadataPrimary,
  type VaultSyncSqlClient,
} from "./postgres-metadata.js";
import {
  resolveS3VaultSyncObjectStoreConfigFromEnv,
  S3VaultSyncObjectStore,
} from "./s3-object-store.js";

export function resolveVaultSyncControlPlaneRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENBOT_VAULT_SYNC_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), ".openbot", "vault-sync", "control-plane");
}

export function resolveVaultSyncObjectStore(
  rootDir: string,
  env: NodeJS.ProcessEnv = process.env,
  override?: VaultSyncObjectStore,
): VaultSyncObjectStore {
  if (override) {
    return override;
  }
  const backend = (env.OPENBOT_VAULT_SYNC_BLOB_BACKEND ?? "file").trim().toLowerCase();
  if (backend === "s3") {
    const cfg = resolveS3VaultSyncObjectStoreConfigFromEnv(env);
    if (!cfg) {
      throw new Error(
        "OPENBOT_VAULT_SYNC_BLOB_BACKEND=s3 requires OPENBOT_VAULT_SYNC_S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY",
      );
    }
    return new S3VaultSyncObjectStore(cfg);
  }
  return new FileVaultSyncObjectStore(rootDir);
}

export type CreateVaultSyncControlPlaneParams = {
  rootDir?: string;
  objectStore?: VaultSyncObjectStore;
  sql?: VaultSyncSqlClient | null;
  metadataPrimary?: VaultSyncMetadataPrimary;
  env?: NodeJS.ProcessEnv;
  options?: VaultSyncControlPlaneOptions;
};

/**
 * Factory: file cache + file|s3 ciphertext store.
 * Optional Postgres: best-effort mirror (default) or primary durable metadata
 * when OPENBOT_VAULT_SYNC_METADATA_PRIMARY=postgres.
 */
export function createVaultSyncControlPlane(
  params: CreateVaultSyncControlPlaneParams = {},
): VaultSyncControlPlane {
  const env = params.env ?? process.env;
  const rootDir = params.rootDir ?? resolveVaultSyncControlPlaneRoot(env);
  const objectStore = resolveVaultSyncObjectStore(rootDir, env, params.objectStore);
  const sql = params.sql === undefined ? createVaultSyncPgClientFromEnv(env) : params.sql;
  const metadataPrimary =
    params.metadataPrimary ??
    params.options?.metadataPrimary ??
    resolveVaultSyncMetadataPrimary(env);
  return new VaultSyncControlPlane(rootDir, {
    ...params.options,
    objectStore,
    sql: sql ?? undefined,
    metadataPrimary,
  });
}
