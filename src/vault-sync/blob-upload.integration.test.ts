import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultSyncControlPlane } from "./store/control-plane.js";
import { createVaultWithLocalDevice, DeviceSyncEngine } from "./sync/engine.js";
import { VAULT_SYNC_DIRECT_PUT_MAX_BYTES } from "./types.js";

const tmpDirs: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-blob-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("vault-sync blob upload sessions / quota / rate limit", () => {
  it("supports chunked upload with resume and idempotent chunk rewrite", () => {
    const root = tmp();
    const plane = new VaultSyncControlPlane(path.join(root, "plane"));
    const created = createVaultWithLocalDevice({
      controlPlane: plane,
      ownerAccountId: "user-1",
      password: "pw-blob-upload",
      deviceId: "device-a",
    });

    const plaintext = randomBytes(600_000);
    const hash = createHash("sha256").update(plaintext).digest("hex");
    const session = plane.createUploadSession({
      vaultId: created.vaultId,
      deviceId: "device-a",
      ciphertextHash: hash,
      totalSizeBytes: plaintext.length,
      chunkSize: 200_000,
    });
    expect(session.chunkCount).toBe(3);
    expect(plane.getQuotaStatus(created.vaultId).pendingUploadBytes).toBe(plaintext.length);

    plane.putUploadChunk({
      vaultId: created.vaultId,
      uploadId: session.uploadId,
      chunkIndex: 0,
      data: plaintext.subarray(0, 200_000),
    });
    plane.putUploadChunk({
      vaultId: created.vaultId,
      uploadId: session.uploadId,
      chunkIndex: 2,
      data: plaintext.subarray(400_000),
    });
    // Resume: rewrite chunk 0, then fill gap.
    plane.putUploadChunk({
      vaultId: created.vaultId,
      uploadId: session.uploadId,
      chunkIndex: 0,
      data: plaintext.subarray(0, 200_000),
    });
    const mid = plane.putUploadChunk({
      vaultId: created.vaultId,
      uploadId: session.uploadId,
      chunkIndex: 1,
      data: plaintext.subarray(200_000, 400_000),
    });
    expect(mid.receivedChunkIndexes).toEqual([0, 1, 2]);

    const blob = plane.completeUploadSession({
      vaultId: created.vaultId,
      uploadId: session.uploadId,
    });
    expect(blob.sizeBytes).toBe(plaintext.length);
    expect(plane.getBlob(created.vaultId, blob.blobId)?.equals(plaintext)).toBe(true);
    expect(plane.getQuotaStatus(created.vaultId).pendingUploadBytes).toBe(0);
    expect(plane.getQuotaStatus(created.vaultId).usageBytes).toBe(plaintext.length);

    // Idempotent complete
    const again = plane.completeUploadSession({
      vaultId: created.vaultId,
      uploadId: session.uploadId,
    });
    expect(again.blobId).toBe(blob.blobId);
  });

  it("enforces quota on upload session create and releases on abort", () => {
    const root = tmp();
    const plane = new VaultSyncControlPlane(path.join(root, "plane"));
    const created = createVaultWithLocalDevice({
      controlPlane: plane,
      ownerAccountId: "user-1",
      password: "pw-quota",
      deviceId: "device-a",
    });
    plane.setQuota(created.vaultId, 1000);
    const hash = createHash("sha256").update("x").digest("hex");
    expect(() =>
      plane.createUploadSession({
        vaultId: created.vaultId,
        deviceId: "device-a",
        ciphertextHash: hash,
        totalSizeBytes: 1001,
      }),
    ).toThrow(/quota exceeded/);

    const session = plane.createUploadSession({
      vaultId: created.vaultId,
      deviceId: "device-a",
      ciphertextHash: createHash("sha256").update(Buffer.alloc(500)).digest("hex"),
      totalSizeBytes: 500,
      chunkSize: 500,
    });
    expect(plane.getQuotaStatus(created.vaultId).availableBytes).toBe(500);
    expect(() =>
      plane.createUploadSession({
        vaultId: created.vaultId,
        deviceId: "device-a",
        ciphertextHash: createHash("sha256").update(Buffer.alloc(501)).digest("hex"),
        totalSizeBytes: 501,
      }),
    ).toThrow(/quota exceeded/);

    plane.abortUploadSession({ vaultId: created.vaultId, uploadId: session.uploadId });
    expect(plane.getQuotaStatus(created.vaultId).pendingUploadBytes).toBe(0);
    expect(plane.getQuotaStatus(created.vaultId).availableBytes).toBe(1000);
  });

  it("rate-limits upload session creation", () => {
    const root = tmp();
    const plane = new VaultSyncControlPlane(path.join(root, "plane"), {
      rateLimits: { uploadSessionPerWindow: 1, windowMs: 60_000 },
    });
    const created = createVaultWithLocalDevice({
      controlPlane: plane,
      ownerAccountId: "user-1",
      password: "pw-rate",
      deviceId: "device-a",
    });
    const hash = createHash("sha256").update("a").digest("hex");
    plane.createUploadSession({
      vaultId: created.vaultId,
      deviceId: "device-a",
      ciphertextHash: hash,
      totalSizeBytes: 10,
      chunkSize: 10,
    });
    expect(() =>
      plane.createUploadSession({
        vaultId: created.vaultId,
        deviceId: "device-a",
        ciphertextHash: createHash("sha256").update("b").digest("hex"),
        totalSizeBytes: 10,
        chunkSize: 10,
      }),
    ).toThrow(/rate limited/);
  });

  it("rejects oversized direct putBlob and uses chunked path from engine", () => {
    const root = tmp();
    const plane = new VaultSyncControlPlane(path.join(root, "plane"), {
      rateLimits: {
        putBlobPerWindow: 10_000,
        uploadSessionPerWindow: 10_000,
        putChunkPerWindow: 10_000,
        commitRevisionPerWindow: 10_000,
      },
    });
    const created = createVaultWithLocalDevice({
      controlPlane: plane,
      ownerAccountId: "user-1",
      password: "pw-large",
      deviceId: "device-a",
    });
    const big = Buffer.alloc(VAULT_SYNC_DIRECT_PUT_MAX_BYTES + 1, 7);
    expect(() =>
      plane.putBlob({
        vaultId: created.vaultId,
        deviceId: "device-a",
        ciphertext: big,
        ciphertextHash: createHash("sha256").update(big).digest("hex"),
      }),
    ).toThrow(/upload session/);

    const vaultRoot = path.join(root, "a");
    fs.mkdirSync(vaultRoot, { recursive: true });
    // Plaintext slightly over threshold → ciphertext also over direct-put max.
    fs.writeFileSync(
      path.join(vaultRoot, "big.bin"),
      Buffer.alloc(VAULT_SYNC_DIRECT_PUT_MAX_BYTES, 9),
    );
    const engine = new DeviceSyncEngine({
      controlPlane: plane,
      vaultId: created.vaultId,
      deviceId: "device-a",
      rootPath: vaultRoot,
      localStoreDir: path.join(root, "store-a"),
    });
    engine.unlockAndVerify("pw-large");
    const push = engine.pushLocalChanges();
    expect(push.errors).toEqual([]);
    expect(push.uploaded).toBe(1);
    expect(plane.getQuotaStatus(created.vaultId).usageBytes).toBeGreaterThan(
      VAULT_SYNC_DIRECT_PUT_MAX_BYTES,
    );
  });
});
