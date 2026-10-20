/**
 * Env gate for Vault Sync Postgres + S3/MinIO live smoke (Wave J).
 * Default unit tests never require live services.
 */
export type VaultSyncLiveSmokeEnv = {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
};

export function isVaultSyncLiveSmokeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (
    env.OPENBOT_VAULT_SYNC_LIVE ??
    env.OPENCLAW_LIVE_TEST ??
    env.CLAWDBOT_LIVE_TEST ??
    env.LIVE ??
    ""
  )
    .trim()
    .toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

export function resolveVaultSyncLiveSmokeEnv(
  env: NodeJS.ProcessEnv = process.env,
): VaultSyncLiveSmokeEnv | null {
  if (!isVaultSyncLiveSmokeEnabled(env)) {
    return null;
  }
  const databaseUrl = env.OPENBOT_VAULT_SYNC_DATABASE_URL?.trim() ?? "";
  const endpoint = env.OPENBOT_VAULT_SYNC_S3_ENDPOINT?.trim() ?? "";
  const bucket = env.OPENBOT_VAULT_SYNC_S3_BUCKET?.trim() ?? "";
  const accessKeyId = env.OPENBOT_VAULT_SYNC_S3_ACCESS_KEY?.trim() ?? "";
  const secretAccessKey = env.OPENBOT_VAULT_SYNC_S3_SECRET_KEY?.trim() ?? "";
  if (!databaseUrl || !endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return {
    databaseUrl,
    s3: {
      endpoint,
      region: env.OPENBOT_VAULT_SYNC_S3_REGION?.trim() || "us-east-1",
      bucket,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: env.OPENBOT_VAULT_SYNC_S3_FORCE_PATH_STYLE !== "0",
    },
  };
}
