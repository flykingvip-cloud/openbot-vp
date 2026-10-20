import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultSyncControlPlane } from "./control-plane.js";
import { S3VaultSyncObjectStore } from "./s3-object-store.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("S3 presigned objectUpload complete (Wave N)", () => {
  it("completes without gateway chunk files when client PUTs to presigned URL", async () => {
    const objects = new Map<string, Uint8Array>();
    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const key = decodeURIComponent(url.split("/openbot-vault/")[1]?.split("?")[0] ?? "");
      if (init?.method === "PUT") {
        const body = init.body;
        const bytes =
          body instanceof Uint8Array
            ? body
            : body instanceof ArrayBuffer
              ? new Uint8Array(body)
              : new Uint8Array(0);
        objects.set(key, bytes);
        return new Response(null, { status: 200 });
      }
      const data = objects.get(key);
      if (!data) {
        return new Response(null, { status: 404 });
      }
      return new Response(Buffer.from(data), { status: 200 });
    }) as unknown as typeof fetch;
    const store = new S3VaultSyncObjectStore({
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      bucket: "openbot-vault",
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
      forcePathStyle: true,
      fetchImpl: mockFetch,
    });

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-s3-object-upload-"));
    tmpDirs.push(root);
    const plane = new VaultSyncControlPlane(root, { objectStore: store });
    const vault = plane.createVault({
      ownerAccountId: "owner@test",
      saltB64: Buffer.from("0123456789abcdef").toString("base64"),
    });
    plane.registerDevice({ vaultId: vault.vaultId, deviceId: "device-a", platform: "test" });

    const ciphertext = randomBytes(2 * 1024 * 1024 + 512);
    const hash = createHash("sha256").update(ciphertext).digest("hex");
    const session = plane.createUploadSession({
      vaultId: vault.vaultId,
      deviceId: "device-a",
      ciphertextHash: hash,
      totalSizeBytes: ciphertext.length,
    });
    expect(session.objectUploadBlobId).toBe(session.uploadId);

    const presign = store.createPresignedPut({
      vaultId: vault.vaultId,
      blobId: session.uploadId,
      contentLength: ciphertext.length,
    });
    const putRes = await mockFetch(presign.url, {
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
    expect(blob.sizeBytes).toBe(ciphertext.length);
    expect(blob.ciphertextHash).toBe(hash);
    const got = await store.getAsync({ vaultId: vault.vaultId, storageKey: blob.storageKey });
    expect(got?.equals(ciphertext)).toBe(true);
  });
});
