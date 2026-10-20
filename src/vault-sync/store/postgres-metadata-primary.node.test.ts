import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeRevisionId } from "../revision-id.js";
import { VaultSyncControlPlane } from "./control-plane.js";
import {
  ensureVaultSyncSchema,
  resolveVaultSyncMetadataPrimary,
  type VaultSyncSqlClient,
  VaultSyncPostgresMetadataMirror,
} from "./postgres-metadata.js";

type Row = Record<string, unknown>;

function createMemorySql(): VaultSyncSqlClient & { dump(table: string): Row[] } {
  const tables = new Map<string, Row[]>();

  const get = (name: string) => {
    if (!tables.has(name)) {
      tables.set(name, []);
    }
    return tables.get(name)!;
  };

  return {
    dump(table: string) {
      return [...get(table)];
    },
    async query<Row = Record<string, unknown>>(sqlText: string, params: readonly unknown[] = []) {
      const text = sqlText.replace(/\s+/g, " ").trim();
      if (
        text.startsWith("CREATE TABLE") ||
        text.startsWith("CREATE UNIQUE") ||
        text.startsWith("CREATE INDEX")
      ) {
        return { rows: [] as Row[], rowCount: 0 };
      }
      if (text.startsWith("INSERT INTO vault_sync_vaults")) {
        const rows = get("vaults");
        const vaultId = String(params[0]);
        const next: Record<string, unknown> = {
          vault_id: vaultId,
          owner_account_id: params[1],
          mode: params[2],
          protocol_version: params[3],
          encryption_version: params[4],
          salt_b64: params[5],
          kdf_params_json: typeof params[6] === "string" ? JSON.parse(params[6]) : params[6],
          quota_bytes: params[7],
          usage_bytes: params[8],
          team_enabled: params[9],
          created_at: params[10],
          deleted_at: params[11],
        };
        const idx = rows.findIndex((r) => r.vault_id === vaultId);
        if (idx >= 0) {
          rows[idx] = next;
        } else {
          rows.push(next);
        }
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (text.startsWith("SELECT") && text.includes("FROM vault_sync_vaults WHERE vault_id")) {
        const row = get("vaults").find((r) => r.vault_id === params[0]);
        return { rows: (row ? [row] : []) as Row[], rowCount: row ? 1 : 0 };
      }
      if (text.startsWith("SELECT vault_id FROM vault_sync_vaults")) {
        const rows = get("vaults").filter(
          (r) => r.owner_account_id === params[0] && r.deleted_at == null,
        );
        return {
          rows: rows.map((r) => ({ vault_id: r.vault_id })) as Row[],
          rowCount: rows.length,
        };
      }
      if (text.startsWith("INSERT INTO vault_sync_blobs")) {
        const rows = get("blobs");
        if (!rows.some((r) => r.blob_id === params[0])) {
          rows.push({
            blob_id: params[0],
            vault_id: params[1],
            size_bytes: params[2],
            ciphertext_hash: params[3],
            storage_key: params[4],
            created_at: params[5],
          });
        }
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (text.startsWith("SELECT") && text.includes("FROM vault_sync_blobs")) {
        const rows = get("blobs").filter((r) => r.vault_id === params[0]);
        return { rows: rows as Row[], rowCount: rows.length };
      }
      if (text.startsWith("INSERT INTO vault_sync_file_revisions")) {
        const rows = get("revisions");
        const key = String(params[0]) + ":" + String(params[1]);
        if (!rows.some((r) => String(r.vault_id) + ":" + String(r.revision_id) === key)) {
          rows.push({
            vault_id: params[0],
            revision_id: params[1],
            opaque_path_id: params[2],
            parent_revision_ids: params[3],
            device_id: params[4],
            device_sequence: params[5],
            encrypted_metadata_b64: params[6],
            ciphertext_blob_id: params[7],
            plaintext_size: params[8],
            ciphertext_hash: params[9],
            tombstone: params[10],
            protocol_version: params[11],
            encryption_version: params[12],
            conflict_group_id: params[13],
            created_at: params[14],
            server_received_at: params[15],
            idempotency_key: params[16],
          });
        }
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (text.startsWith("SELECT") && text.includes("FROM vault_sync_file_revisions")) {
        const rows = get("revisions").filter((r) => r.vault_id === params[0]);
        return { rows: rows as Row[], rowCount: rows.length };
      }
      if (text.startsWith("DELETE FROM vault_sync_path_heads")) {
        const heads = get("heads").filter(
          (r) => !(r.vault_id === params[0] && r.opaque_path_id === params[1]),
        );
        tables.set("heads", heads);
        return { rows: [] as Row[], rowCount: 0 };
      }
      if (text.startsWith("INSERT INTO vault_sync_path_heads")) {
        const rows = get("heads");
        rows.push({
          vault_id: params[0],
          opaque_path_id: params[1],
          revision_id: params[2],
        });
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (text.startsWith("SELECT") && text.includes("FROM vault_sync_path_heads")) {
        const rows = get("heads")
          .filter((r) => r.vault_id === params[0])
          .map((r) => ({ opaque_path_id: r.opaque_path_id, revision_id: r.revision_id }));
        return { rows: rows as Row[], rowCount: rows.length };
      }
      if (text.startsWith("INSERT INTO vault_sync_devices")) {
        const rows = get("devices");
        const key = String(params[0]) + ":" + String(params[1]);
        const next: Record<string, unknown> = {
          vault_id: params[0],
          device_id: params[1],
          platform: params[2],
          last_sequence: params[3],
          status: params[4],
          registered_at: params[5],
          revoked_at: params[6],
        };
        const idx = rows.findIndex((r) => String(r.vault_id) + ":" + String(r.device_id) === key);
        if (idx >= 0) {
          rows[idx] = next;
        } else {
          rows.push(next);
        }
        return { rows: [] as Row[], rowCount: 1 };
      }
      if (text.startsWith("SELECT") && text.includes("FROM vault_sync_devices")) {
        const rows = get("devices").filter((r) => r.vault_id === params[0]);
        return { rows: rows as Row[], rowCount: rows.length };
      }
      throw new Error(`unexpected sql: ${text.slice(0, 120)}`);
    },
  };
}

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("VaultSync Postgres metadata primary (Wave G)", () => {
  it("resolveVaultSyncMetadataPrimary defaults to file", () => {
    expect(resolveVaultSyncMetadataPrimary({})).toBe("file");
    expect(
      resolveVaultSyncMetadataPrimary({ OPENBOT_VAULT_SYNC_METADATA_PRIMARY: "postgres" }),
    ).toBe("postgres");
  });

  it("requires sql when metadataPrimary=postgres", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-pg-primary-"));
    tmpDirs.push(root);
    expect(() => new VaultSyncControlPlane(root, { metadataPrimary: "postgres" })).toThrow(
      /DATABASE_URL|sql option/,
    );
  });

  it("durably writes core metadata to PG and hydrates after file wipe", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-pg-primary-"));
    tmpDirs.push(root);
    const sql = createMemorySql();
    const plane = new VaultSyncControlPlane(root, {
      sql,
      metadataPrimary: "postgres",
    });

    const vault = plane.createVault({
      ownerAccountId: "acct-a",
      saltB64: Buffer.from("salt-primary").toString("base64"),
    });
    const device = plane.registerDevice({
      vaultId: vault.vaultId,
      deviceId: "device-a",
      platform: "desktop",
    });
    const ciphertext = Buffer.from("ciphertext-primary-payload");
    const ciphertextHash = createHash("sha256").update(ciphertext).digest("hex");
    const blob = plane.putBlob({
      vaultId: vault.vaultId,
      deviceId: device.deviceId,
      ciphertext,
      ciphertextHash,
    });
    const opaquePathId = createHash("sha256").update("notes/a.md").digest("hex");
    const revisionId = computeRevisionId({
      vaultId: vault.vaultId,
      opaquePathId,
      deviceId: device.deviceId,
      deviceSequence: 1,
      ciphertextHash,
      parentRevisionIds: [],
      protocolVersion: 1,
    });
    const result = plane.commitRevision({
      revision: {
        vaultId: vault.vaultId,
        opaquePathId,
        revisionId,
        parentRevisionIds: [],
        deviceId: device.deviceId,
        deviceSequence: 1,
        encryptedMetadataB64: Buffer.from("meta").toString("base64"),
        ciphertextBlobId: blob.blobId,
        plaintextSize: 12,
        ciphertextHash,
        tombstone: false,
        createdAt: new Date().toISOString(),
        protocolVersion: 1,
        encryptionVersion: 1,
      },
    });
    expect(result.status).toBe("accepted");
    await plane.flushMetadataPrimary();

    expect(sql.dump("vaults")).toHaveLength(1);
    expect(sql.dump("blobs")).toHaveLength(1);
    expect(sql.dump("revisions")).toHaveLength(1);
    expect(sql.dump("devices")).toHaveLength(1);
    expect(sql.dump("heads").length).toBeGreaterThan(0);

    // Wipe file-plane vault metadata; ciphertext remains in object store under root.
    fs.rmSync(path.join(root, "vaults", vault.vaultId), { recursive: true, force: true });
    expect(plane.getVault(vault.vaultId)).toBeNull();

    const restored = await plane.hydrateVaultMetadataFromPostgres(vault.vaultId);
    expect(restored.vaultId).toBe(vault.vaultId);
    expect(plane.getVault(vault.vaultId)?.saltB64).toBe(vault.saltB64);
    expect(plane.listDevices(vault.vaultId)).toHaveLength(1);
    expect(plane.listRevisionsSince(vault.vaultId, null, 10).revisions).toHaveLength(1);
    expect(plane.getInventoryPage(vault.vaultId, null, 10).items.length).toBeGreaterThan(0);
  });

  it("flushMetadataPrimary fails hard when primary PG write rejects", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vault-pg-fail-"));
    tmpDirs.push(root);
    const sql: VaultSyncSqlClient = {
      async query(sqlText) {
        const text = sqlText.replace(/\s+/g, " ").trim();
        if (text.startsWith("CREATE")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error("simulated pg outage");
      },
    };
    const plane = new VaultSyncControlPlane(root, { sql, metadataPrimary: "postgres" });
    plane.createVault({
      ownerAccountId: "acct",
      saltB64: Buffer.from("x").toString("base64"),
    });
    await expect(plane.flushMetadataPrimary()).rejects.toThrow(/simulated pg outage/);
  });

  it("mirror read helpers round-trip via injectable SQL", async () => {
    const sql = createMemorySql();
    await ensureVaultSyncSchema(sql);
    const mirror = new VaultSyncPostgresMetadataMirror(sql);
    const vaultId = randomUUID();
    await mirror.upsertVault({
      vaultId,
      ownerAccountId: "owner",
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
    await mirror.upsertDevice({
      vaultId,
      deviceId: "d1",
      platform: "ios",
      lastSequence: 2,
      status: "active",
      registeredAt: new Date().toISOString(),
      revokedAt: null,
    });
    const got = await mirror.getVault(vaultId);
    expect(got?.ownerAccountId).toBe("owner");
    expect((await mirror.listDevices(vaultId))[0]?.deviceId).toBe("d1");
  });
});
