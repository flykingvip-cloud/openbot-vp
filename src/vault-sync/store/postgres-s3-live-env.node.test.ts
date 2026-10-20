import { describe, expect, it } from "vitest";
import {
  isVaultSyncLiveSmokeEnabled,
  resolveVaultSyncLiveSmokeEnv,
} from "./postgres-s3-live-env.js";

describe("VaultSync live smoke env gate (Wave J)", () => {
  it("is disabled by default", () => {
    expect(isVaultSyncLiveSmokeEnabled({})).toBe(false);
    expect(resolveVaultSyncLiveSmokeEnv({})).toBeNull();
  });

  it("requires LIVE flag plus DATABASE_URL and S3 credentials", () => {
    expect(
      resolveVaultSyncLiveSmokeEnv({
        OPENBOT_VAULT_SYNC_LIVE: "1",
        OPENBOT_VAULT_SYNC_DATABASE_URL: "postgres://u:p@localhost:5432/vault",
      }),
    ).toBeNull();

    const env = resolveVaultSyncLiveSmokeEnv({
      OPENBOT_VAULT_SYNC_LIVE: "1",
      OPENBOT_VAULT_SYNC_DATABASE_URL: "postgres://u:p@localhost:5432/vault",
      OPENBOT_VAULT_SYNC_S3_ENDPOINT: "http://127.0.0.1:9000",
      OPENBOT_VAULT_SYNC_S3_BUCKET: "openbot-vault",
      OPENBOT_VAULT_SYNC_S3_ACCESS_KEY: "minioadmin",
      OPENBOT_VAULT_SYNC_S3_SECRET_KEY: "minioadmin",
    });
    expect(env?.s3.bucket).toBe("openbot-vault");
    expect(env?.s3.forcePathStyle).toBe(true);
  });
});
