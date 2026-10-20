import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BlobRecord,
  FileRevision,
  ScryptKdfParams,
  VaultDeviceRecord,
  VaultRecord,
  VaultSyncMode,
} from "../types.js";

export type VaultSyncSqlQueryResult<Row = Record<string, unknown>> = {
  rows: Row[];
  rowCount: number;
};

export interface VaultSyncSqlClient {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<VaultSyncSqlQueryResult<Row>>;
}

const SCHEMA_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");

export function loadVaultSyncSchemaSql(): string {
  return readFileSync(SCHEMA_PATH, "utf8");
}

export async function ensureVaultSyncSchema(sql: VaultSyncSqlClient): Promise<void> {
  const ddl = loadVaultSyncSchemaSql();
  // Split on blank lines between statements — each CREATE is independent.
  const statements = ddl
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
  for (const statement of statements) {
    await sql.query(`${statement};`);
  }
}

type VaultRow = {
  vault_id: string;
  owner_account_id: string;
  mode: string;
  protocol_version: number;
  encryption_version: number;
  salt_b64: string;
  kdf_params_json: ScryptKdfParams | string;
  quota_bytes: number | string;
  usage_bytes: number | string;
  team_enabled: boolean;
  created_at: string | Date;
  deleted_at: string | Date | null;
};

type BlobRow = {
  blob_id: string;
  vault_id: string;
  size_bytes: number | string;
  ciphertext_hash: string;
  storage_key: string;
  created_at: string | Date;
};

type RevisionRow = {
  vault_id: string;
  revision_id: string;
  opaque_path_id: string;
  parent_revision_ids: string[] | string;
  device_id: string;
  device_sequence: number | string;
  encrypted_metadata_b64: string;
  ciphertext_blob_id: string | null;
  plaintext_size: number | string;
  ciphertext_hash: string;
  tombstone: boolean;
  protocol_version: number | string;
  encryption_version: number | string;
  conflict_group_id: string | null;
  created_at: string | Date;
};

type DeviceRow = {
  vault_id: string;
  device_id: string;
  platform: string;
  last_sequence: number | string;
  status: string;
  registered_at: string | Date;
  revoked_at: string | Date | null;
};

type HeadRow = {
  opaque_path_id: string;
  revision_id: string;
};

function asIso(value: string | Date | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function asNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function asStringArray(value: string[] | string): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    } catch {
      // Postgres array text format may arrive as "{a,b}"
      const trimmed = value.replace(/^\{|\}$/g, "");
      if (!trimmed) {
        return [];
      }
      return trimmed.split(",").map((s) => s.replace(/^"|"$/g, ""));
    }
  }
  return [];
}

function parseKdfParams(value: ScryptKdfParams | string): ScryptKdfParams {
  if (typeof value === "string") {
    return JSON.parse(value) as ScryptKdfParams;
  }
  return value;
}

function mapVault(row: VaultRow): VaultRecord {
  return {
    vaultId: row.vault_id,
    ownerAccountId: row.owner_account_id,
    mode: row.mode as VaultSyncMode,
    protocolVersion: asNumber(row.protocol_version),
    encryptionVersion: asNumber(row.encryption_version),
    saltB64: row.salt_b64,
    kdfParams: parseKdfParams(row.kdf_params_json),
    quotaBytes: asNumber(row.quota_bytes),
    usageBytes: asNumber(row.usage_bytes),
    createdAt: asIso(row.created_at)!,
    deletedAt: asIso(row.deleted_at),
    teamEnabled: Boolean(row.team_enabled),
  };
}

function mapBlob(row: BlobRow): BlobRecord {
  return {
    blobId: row.blob_id,
    vaultId: row.vault_id,
    sizeBytes: asNumber(row.size_bytes),
    ciphertextHash: row.ciphertext_hash,
    storageKey: row.storage_key,
    createdAt: asIso(row.created_at)!,
  };
}

function mapRevision(row: RevisionRow): FileRevision {
  return {
    vaultId: row.vault_id,
    revisionId: row.revision_id,
    opaquePathId: row.opaque_path_id,
    parentRevisionIds: asStringArray(row.parent_revision_ids),
    deviceId: row.device_id,
    deviceSequence: asNumber(row.device_sequence),
    encryptedMetadataB64: row.encrypted_metadata_b64,
    ciphertextBlobId: row.ciphertext_blob_id,
    plaintextSize: asNumber(row.plaintext_size),
    ciphertextHash: row.ciphertext_hash,
    tombstone: Boolean(row.tombstone),
    protocolVersion: asNumber(row.protocol_version),
    encryptionVersion: asNumber(row.encryption_version),
    conflictGroupId: row.conflict_group_id,
    createdAt: asIso(row.created_at)!,
  };
}

function mapDevice(row: DeviceRow): VaultDeviceRecord {
  return {
    vaultId: row.vault_id,
    deviceId: row.device_id,
    platform: row.platform,
    lastSequence: asNumber(row.last_sequence),
    status: row.status as VaultDeviceRecord["status"],
    registeredAt: asIso(row.registered_at)!,
    revokedAt: asIso(row.revoked_at),
  };
}

/**
 * Postgres metadata plane for vault/blob/revision/heads/devices.
 * Wave G: can be primary durable store; members/invites remain file-plane until schema expands.
 */
export class VaultSyncPostgresMetadataMirror {
  constructor(private readonly sql: VaultSyncSqlClient) {}

  async ensureSchema(): Promise<void> {
    await ensureVaultSyncSchema(this.sql);
  }

  async upsertVault(vault: VaultRecord): Promise<void> {
    await this.sql.query(
      `INSERT INTO vault_sync_vaults (
        vault_id, owner_account_id, mode, protocol_version, encryption_version,
        salt_b64, kdf_params_json, quota_bytes, usage_bytes, team_enabled, created_at, deleted_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)
      ON CONFLICT (vault_id) DO UPDATE SET
        owner_account_id = EXCLUDED.owner_account_id,
        mode = EXCLUDED.mode,
        protocol_version = EXCLUDED.protocol_version,
        encryption_version = EXCLUDED.encryption_version,
        salt_b64 = EXCLUDED.salt_b64,
        kdf_params_json = EXCLUDED.kdf_params_json,
        quota_bytes = EXCLUDED.quota_bytes,
        usage_bytes = EXCLUDED.usage_bytes,
        team_enabled = EXCLUDED.team_enabled,
        deleted_at = EXCLUDED.deleted_at`,
      [
        vault.vaultId,
        vault.ownerAccountId,
        vault.mode,
        vault.protocolVersion,
        vault.encryptionVersion,
        vault.saltB64,
        JSON.stringify(vault.kdfParams),
        vault.quotaBytes,
        vault.usageBytes,
        Boolean(vault.teamEnabled),
        vault.createdAt,
        vault.deletedAt ?? null,
      ],
    );
  }

  async getVault(vaultId: string): Promise<VaultRecord | null> {
    const result = await this.sql.query<VaultRow>(
      `SELECT vault_id, owner_account_id, mode, protocol_version, encryption_version,
              salt_b64, kdf_params_json, quota_bytes, usage_bytes, team_enabled, created_at, deleted_at
       FROM vault_sync_vaults WHERE vault_id = $1`,
      [vaultId],
    );
    const row = result.rows[0];
    return row ? mapVault(row) : null;
  }

  async listVaultIdsByOwner(ownerAccountId: string): Promise<string[]> {
    const result = await this.sql.query<{ vault_id: string }>(
      `SELECT vault_id FROM vault_sync_vaults
       WHERE owner_account_id = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [ownerAccountId],
    );
    return result.rows.map((r) => r.vault_id);
  }

  async insertBlob(blob: BlobRecord): Promise<void> {
    await this.sql.query(
      `INSERT INTO vault_sync_blobs (
        blob_id, vault_id, size_bytes, ciphertext_hash, storage_key, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (blob_id) DO NOTHING`,
      [
        blob.blobId,
        blob.vaultId,
        blob.sizeBytes,
        blob.ciphertextHash,
        blob.storageKey,
        blob.createdAt,
      ],
    );
  }

  async listBlobs(vaultId: string): Promise<BlobRecord[]> {
    const result = await this.sql.query<BlobRow>(
      `SELECT blob_id, vault_id, size_bytes, ciphertext_hash, storage_key, created_at
       FROM vault_sync_blobs WHERE vault_id = $1 ORDER BY created_at ASC`,
      [vaultId],
    );
    return result.rows.map(mapBlob);
  }

  async insertRevision(params: {
    revision: FileRevision;
    serverReceivedAt: string;
    idempotencyKey?: string | null;
  }): Promise<void> {
    const rev = params.revision;
    await this.sql.query(
      `INSERT INTO vault_sync_file_revisions (
        vault_id, revision_id, opaque_path_id, parent_revision_ids, device_id, device_sequence,
        encrypted_metadata_b64, ciphertext_blob_id, plaintext_size, ciphertext_hash, tombstone,
        protocol_version, encryption_version, conflict_group_id, created_at, server_received_at,
        idempotency_key
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      )
      ON CONFLICT (vault_id, revision_id) DO NOTHING`,
      [
        rev.vaultId,
        rev.revisionId,
        rev.opaquePathId,
        rev.parentRevisionIds,
        rev.deviceId,
        rev.deviceSequence,
        rev.encryptedMetadataB64,
        rev.ciphertextBlobId,
        rev.plaintextSize,
        rev.ciphertextHash,
        rev.tombstone,
        rev.protocolVersion,
        rev.encryptionVersion,
        rev.conflictGroupId ?? null,
        rev.createdAt,
        params.serverReceivedAt,
        params.idempotencyKey ?? null,
      ],
    );
  }

  async listRevisions(vaultId: string): Promise<FileRevision[]> {
    const result = await this.sql.query<RevisionRow>(
      `SELECT vault_id, revision_id, opaque_path_id, parent_revision_ids, device_id, device_sequence,
              encrypted_metadata_b64, ciphertext_blob_id, plaintext_size, ciphertext_hash, tombstone,
              protocol_version, encryption_version, conflict_group_id, created_at
       FROM vault_sync_file_revisions
       WHERE vault_id = $1
       ORDER BY created_at ASC, revision_id ASC`,
      [vaultId],
    );
    return result.rows.map(mapRevision);
  }

  async replaceHeads(vaultId: string, opaquePathId: string, revisionIds: string[]): Promise<void> {
    await this.sql.query(
      `DELETE FROM vault_sync_path_heads WHERE vault_id = $1 AND opaque_path_id = $2`,
      [vaultId, opaquePathId],
    );
    for (const revisionId of revisionIds) {
      await this.sql.query(
        `INSERT INTO vault_sync_path_heads (vault_id, opaque_path_id, revision_id)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [vaultId, opaquePathId, revisionId],
      );
    }
  }

  async listHeads(vaultId: string): Promise<Record<string, string[]>> {
    const result = await this.sql.query<HeadRow>(
      `SELECT opaque_path_id, revision_id FROM vault_sync_path_heads WHERE vault_id = $1`,
      [vaultId],
    );
    const heads: Record<string, string[]> = {};
    for (const row of result.rows) {
      const list = heads[row.opaque_path_id] ?? [];
      list.push(row.revision_id);
      heads[row.opaque_path_id] = list;
    }
    return heads;
  }

  async upsertDevice(device: VaultDeviceRecord): Promise<void> {
    await this.sql.query(
      `INSERT INTO vault_sync_devices (
        vault_id, device_id, platform, last_sequence, status, registered_at, revoked_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (vault_id, device_id) DO UPDATE SET
        platform = EXCLUDED.platform,
        last_sequence = EXCLUDED.last_sequence,
        status = EXCLUDED.status,
        revoked_at = EXCLUDED.revoked_at`,
      [
        device.vaultId,
        device.deviceId,
        device.platform,
        device.lastSequence,
        device.status,
        device.registeredAt,
        device.revokedAt ?? null,
      ],
    );
  }

  async listDevices(vaultId: string): Promise<VaultDeviceRecord[]> {
    const result = await this.sql.query<DeviceRow>(
      `SELECT vault_id, device_id, platform, last_sequence, status, registered_at, revoked_at
       FROM vault_sync_devices WHERE vault_id = $1 ORDER BY registered_at ASC`,
      [vaultId],
    );
    return result.rows.map(mapDevice);
  }
}

export type VaultSyncMetadataPrimary = "file" | "postgres";

export function resolveVaultSyncMetadataPrimary(
  env: NodeJS.ProcessEnv = process.env,
): VaultSyncMetadataPrimary {
  const raw = (env.OPENBOT_VAULT_SYNC_METADATA_PRIMARY ?? "file").trim().toLowerCase();
  return raw === "postgres" ? "postgres" : "file";
}
