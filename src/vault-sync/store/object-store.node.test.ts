import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VaultSyncControlPlane } from "./control-plane.js";
import { MemoryVaultSyncObjectStore } from "./memory-object-store.js";
import {
  ensureVaultSyncSchema,
  loadVaultSyncSchemaSql,
  VaultSyncPostgresMetadataMirror,
  type VaultSyncSqlClient,
} from "./postgres-metadata.js";
import { S3VaultSyncObjectStore } from "./s3-object-store.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-obj-"));
  tmpDirs.push(dir);
  return dir;
}

describe("VaultSync object store (Wave E)", () => {
  it("stores ciphertext bytes in injected memory object store", () => {
    const root = tmpRoot();
    const objects = new MemoryVaultSyncObjectStore();
    const plane = new VaultSyncControlPlane(root, { objectStore: objects });
    const vault = plane.createVault({
      ownerAccountId: "acct-1",
      saltB64: Buffer.from("0123456789abcdef").toString("base64"),
    });
    plane.registerDevice({
      vaultId: vault.vaultId,
      deviceId: "dev-a",
      platform: "test",
    });
    const ciphertext = Buffer.from("cipher-bytes-not-plaintext");
    const hash = createHash("sha256").update(ciphertext).digest("hex");
    const blob = plane.putBlob({
      vaultId: vault.vaultId,
      deviceId: "dev-a",
      ciphertext,
      ciphertextHash: hash,
    });
    expect(blob.storageKey).toBe(`vaults/${vault.vaultId}/blobs/${blob.blobId}.bin`);
    expect(objects.keys()).toEqual([blob.storageKey]);
    expect(plane.getBlob(vault.vaultId, blob.blobId)?.equals(ciphertext)).toBe(true);
    // File plane must not keep a parallel plaintext-named blob under legacy path only.
    expect(fs.existsSync(path.join(root, blob.storageKey))).toBe(false);
  });

  it("issues S3 path-style presigned PUT URLs", () => {
    const store = new S3VaultSyncObjectStore({
      endpoint: "http://127.0.0.1:9000",
      region: "us-east-1",
      bucket: "openbot-vault",
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
      forcePathStyle: true,
      fetchImpl: (async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
    });
    const put = store.createPresignedPut({
      vaultId: "vault-1",
      blobId: "blob-1",
      contentLength: 128,
      expiresSeconds: 600,
    });
    expect(put.url).toContain(
      "http://127.0.0.1:9000/openbot-vault/vaults/vault-1/blobs/blob-1.bin",
    );
    expect(put.url).toContain("X-Amz-Signature=");
    expect(put.method).toBe("PUT");
    expect(put.storageKey).toBe("vaults/vault-1/blobs/blob-1.bin");
  });

  it("putAsync/getAsync round-trip via injected fetch", async () => {
    const objects = new Map<string, Uint8Array>();
    const store = new S3VaultSyncObjectStore({
      endpoint: "http://s3.test",
      region: "us-east-1",
      bucket: "b",
      accessKeyId: "ak",
      secretAccessKey: "sk",
      forcePathStyle: true,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const key = decodeURIComponent(url.split("/b/")[1]?.split("?")[0] ?? "");
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
      }) as unknown as typeof fetch,
    });
    const ciphertext = Buffer.from("hello-s3");
    const put = await store.putAsync({
      vaultId: "v1",
      blobId: "b1",
      ciphertext,
    });
    const got = await store.getAsync({ vaultId: "v1", storageKey: put.storageKey });
    expect(got?.equals(ciphertext)).toBe(true);
  });
});

describe("VaultSync Postgres metadata mirror", () => {
  it("ships DDL without plaintext path/content columns", () => {
    const ddl = loadVaultSyncSchemaSql();
    expect(ddl).toContain("vault_sync_vaults");
    expect(ddl).toContain("vault_sync_file_revisions");
    expect(ddl).toContain("vault_sync_blobs");
    expect(ddl.toLowerCase()).not.toContain("relative_path");
    expect(ddl.toLowerCase()).not.toContain("plaintext_content");
  });

  it("mirrors vault + blob + revision into injectable SQL client", async () => {
    const tables = new Map<string, Record<string, unknown>[]>();
    const sql: VaultSyncSqlClient = {
      async query(sqlText, params = []) {
        const text = sqlText.replace(/\s+/g, " ").trim();
        if (
          text.startsWith("CREATE TABLE") ||
          text.startsWith("CREATE UNIQUE") ||
          text.startsWith("CREATE INDEX")
        ) {
          return { rows: [], rowCount: 0 };
        }
        if (text.startsWith("INSERT INTO vault_sync_vaults")) {
          const rows = tables.get("vaults") ?? [];
          rows.push({
            vault_id: params[0],
            owner_account_id: params[1],
            salt_b64: params[5],
          });
          tables.set("vaults", rows);
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith("INSERT INTO vault_sync_blobs")) {
          const rows = tables.get("blobs") ?? [];
          rows.push({ blob_id: params[0], storage_key: params[4] });
          tables.set("blobs", rows);
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith("INSERT INTO vault_sync_file_revisions")) {
          const rows = tables.get("revisions") ?? [];
          rows.push({ revision_id: params[1], opaque_path_id: params[2] });
          tables.set("revisions", rows);
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith("DELETE FROM vault_sync_path_heads")) {
          tables.set("heads", []);
          return { rows: [], rowCount: 0 };
        }
        if (text.startsWith("INSERT INTO vault_sync_path_heads")) {
          const rows = tables.get("heads") ?? [];
          rows.push({ revision_id: params[2] });
          tables.set("heads", rows);
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
      },
    };

    await ensureVaultSyncSchema(sql);
    const mirror = new VaultSyncPostgresMetadataMirror(sql);
    await mirror.upsertVault({
      vaultId: "11111111-1111-1111-1111-111111111111",
      ownerAccountId: "acct",
      mode: "e2ee_private",
      protocolVersion: 1,
      encryptionVersion: 1,
      saltB64: "c2FsdA==",
      kdfParams: { alg: "scrypt", N: 16384, r: 8, p: 1, dkLen: 32 },
      quotaBytes: 1000,
      usageBytes: 0,
      createdAt: new Date().toISOString(),
      deletedAt: null,
      teamEnabled: false,
    });
    await mirror.insertBlob({
      blobId: randomUUID(),
      vaultId: "11111111-1111-1111-1111-111111111111",
      sizeBytes: 4,
      ciphertextHash: "abcd",
      storageKey: "vaults/v/blobs/b.bin",
      createdAt: new Date().toISOString(),
    });
    expect(tables.get("vaults")?.length).toBe(1);
    expect(tables.get("blobs")?.length).toBe(1);
  });
});
