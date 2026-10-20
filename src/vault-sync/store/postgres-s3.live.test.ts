// Live smoke: Postgres metadata primary + S3/MinIO ciphertext (Wave J).
// Excluded from default pnpm test (vitest live exclude).
// Run: ./src/vault-sync/dev/run-smoke.sh
// Smoke only — not production cutover acceptance.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { computeRevisionId } from "../revision-id.js";
import { VaultSyncControlPlane } from "./control-plane.js";
import { createVaultSyncPgClientFromEnv } from "./postgres-client.js";
import { ensureVaultSyncSchema } from "./postgres-metadata.js";
import { resolveVaultSyncLiveSmokeEnv } from "./postgres-s3-live-env.js";
import { S3VaultSyncObjectStore } from "./s3-object-store.js";

const live = resolveVaultSyncLiveSmokeEnv();

describe.skipIf(!live)("VaultSync Postgres + S3/MinIO live smoke (Wave J)", () => {
  const tmpRoots: string[] = [];
  let pg: ReturnType<typeof createVaultSyncPgClientFromEnv> = null;

  afterAll(async () => {
    for (const root of tmpRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    await pg?.end().catch(() => undefined);
  });

  it("writes vault/blob/revision to PG primary and ciphertext to S3, then hydrates", async () => {
    if (!live) {
      return;
    }
    process.env.OPENBOT_VAULT_SYNC_DATABASE_URL = live.databaseUrl;
    pg = createVaultSyncPgClientFromEnv(process.env);
    expect(pg).not.toBeNull();
    await ensureVaultSyncSchema(pg!);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-live-smoke-"));
    tmpRoots.push(root);
    const objectStore = new S3VaultSyncObjectStore(live.s3);
    const plane = new VaultSyncControlPlane(root, {
      sql: pg!,
      metadataPrimary: "postgres",
      objectStore,
    });
    const vault = plane.createVault({
      ownerAccountId: `live-${randomUUID().slice(0, 8)}`,
      saltB64: Buffer.from("0123456789abcdef").toString("base64"),
    });
    const device = plane.registerDevice({
      vaultId: vault.vaultId,
      deviceId: "live-device",
      platform: "smoke",
    });
    const ciphertext = Buffer.from(`live-cipher-${randomUUID()}`);
    const ciphertextHash = createHash("sha256").update(ciphertext).digest("hex");
    const planeBlob = plane.putBlob({
      vaultId: vault.vaultId,
      deviceId: device.deviceId,
      ciphertext,
      ciphertextHash,
    });
    expect(planeBlob.ciphertextHash).toBe(ciphertextHash);

    const opaquePathId = createHash("sha256").update("notes/live.md").digest("hex");
    const revisionId = computeRevisionId({
      vaultId: vault.vaultId,
      opaquePathId,
      deviceId: device.deviceId,
      deviceSequence: 1,
      ciphertextHash,
      parentRevisionIds: [],
      protocolVersion: 1,
    });
    const commit = plane.commitRevision({
      revision: {
        vaultId: vault.vaultId,
        opaquePathId,
        revisionId,
        parentRevisionIds: [],
        deviceId: device.deviceId,
        deviceSequence: 1,
        encryptedMetadataB64: Buffer.from("meta").toString("base64"),
        ciphertextBlobId: planeBlob.blobId,
        plaintextSize: 8,
        ciphertextHash,
        tombstone: false,
        createdAt: new Date().toISOString(),
        protocolVersion: 1,
        encryptionVersion: 1,
      },
    });
    expect(commit.status).toBe("accepted");
    await plane.flushMetadataPrimary();

    const gotCipher = plane.getBlob(vault.vaultId, planeBlob.blobId);
    expect(gotCipher?.equals(ciphertext)).toBe(true);

    fs.rmSync(path.join(root, "vaults", vault.vaultId), { recursive: true, force: true });
    expect(plane.getVault(vault.vaultId)).toBeNull();

    const restored = await plane.hydrateVaultMetadataFromPostgres(vault.vaultId);
    expect(restored.vaultId).toBe(vault.vaultId);
    expect(plane.listRevisionsSince(vault.vaultId, null, 10).revisions).toHaveLength(1);
    const afterHydrate = plane.getBlob(vault.vaultId, planeBlob.blobId);
    expect(afterHydrate?.equals(ciphertext)).toBe(true);
  });

  it("completes S3 objectUpload session under PG primary without gateway chunk files", async () => {
    if (!live) {
      return;
    }
    process.env.OPENBOT_VAULT_SYNC_DATABASE_URL = live.databaseUrl;
    process.env.OPENBOT_VAULT_SYNC_METADATA_PRIMARY = "postgres";
    pg = createVaultSyncPgClientFromEnv(process.env);
    expect(pg).not.toBeNull();
    await ensureVaultSyncSchema(pg!);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-live-object-upload-"));
    tmpRoots.push(root);
    const objectStore = new S3VaultSyncObjectStore(live.s3);
    const plane = new VaultSyncControlPlane(root, {
      sql: pg!,
      metadataPrimary: "postgres",
      objectStore,
    });
    const vault = plane.createVault({
      ownerAccountId: `live-obj-${randomUUID().slice(0, 8)}`,
      saltB64: Buffer.from("fedcba9876543210").toString("base64"),
    });
    plane.registerDevice({
      vaultId: vault.vaultId,
      deviceId: "live-object-device",
      platform: "smoke",
    });

    const ciphertext = Buffer.from(`object-upload-${randomUUID()}-${"x".repeat(4096)}`);
    const ciphertextHash = createHash("sha256").update(ciphertext).digest("hex");
    const session = plane.createUploadSession({
      vaultId: vault.vaultId,
      deviceId: "live-object-device",
      ciphertextHash,
      totalSizeBytes: ciphertext.length,
    });
    expect(session.objectUploadBlobId).toBe(session.uploadId);

    const presign = objectStore.createPresignedPut({
      vaultId: vault.vaultId,
      blobId: session.uploadId,
      contentLength: ciphertext.length,
    });
    const putRes = await fetch(presign.url, {
      method: "PUT",
      headers: presign.headers,
      body: new Uint8Array(ciphertext),
    });
    expect(putRes.ok).toBe(true);

    const chunkDir = path.join(root, "vaults", vault.vaultId, "uploads", session.uploadId);
    expect(fs.existsSync(path.join(chunkDir, "chunk-0.bin"))).toBe(false);

    const blob = await plane.completeUploadSessionAsync({
      vaultId: vault.vaultId,
      uploadId: session.uploadId,
    });
    expect(blob.blobId).toBe(session.uploadId);
    expect(blob.ciphertextHash).toBe(ciphertextHash);
    await plane.flushMetadataPrimary();

    fs.rmSync(path.join(root, "vaults", vault.vaultId), { recursive: true, force: true });
    expect(plane.getVault(vault.vaultId)).toBeNull();

    await plane.hydrateVaultMetadataFromPostgres(vault.vaultId);
    const restored = plane.getBlob(vault.vaultId, blob.blobId);
    expect(restored?.equals(ciphertext)).toBe(true);
  });
});
