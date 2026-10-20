-- Knowledge Vault Sync control-plane DDL (P2.7 / Wave E)
-- Ciphertext bytes live in object storage (file|S3); this schema holds opaque metadata only.
-- No plaintext path / content columns.

CREATE TABLE IF NOT EXISTS vault_sync_vaults (
  vault_id            TEXT PRIMARY KEY,
  owner_account_id    TEXT NOT NULL,
  mode                TEXT NOT NULL CHECK (mode IN ('e2ee_private', 'enterprise_hosted')),
  protocol_version    INT NOT NULL DEFAULT 1,
  encryption_version  INT NOT NULL DEFAULT 1,
  salt_b64            TEXT NOT NULL,
  kdf_params_json     JSONB NOT NULL,
  quota_bytes         BIGINT NOT NULL,
  usage_bytes         BIGINT NOT NULL DEFAULT 0,
  team_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL,
  deleted_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS vault_sync_devices (
  vault_id            TEXT NOT NULL REFERENCES vault_sync_vaults(vault_id),
  device_id           TEXT NOT NULL,
  platform            TEXT NOT NULL,
  last_sequence       BIGINT NOT NULL DEFAULT 0,
  status              TEXT NOT NULL CHECK (status IN ('active','revoked')),
  registered_at       TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  PRIMARY KEY (vault_id, device_id)
);

CREATE TABLE IF NOT EXISTS vault_sync_file_revisions (
  vault_id            TEXT NOT NULL,
  revision_id         TEXT NOT NULL,
  opaque_path_id      TEXT NOT NULL,
  parent_revision_ids TEXT[] NOT NULL,
  device_id           TEXT NOT NULL,
  device_sequence     BIGINT NOT NULL,
  encrypted_metadata_b64 TEXT NOT NULL,
  ciphertext_blob_id  TEXT,
  plaintext_size      BIGINT NOT NULL,
  ciphertext_hash     TEXT NOT NULL,
  tombstone           BOOLEAN NOT NULL DEFAULT FALSE,
  protocol_version    INT NOT NULL,
  encryption_version  INT NOT NULL,
  conflict_group_id   TEXT,
  created_at          TIMESTAMPTZ NOT NULL,
  server_received_at  TIMESTAMPTZ NOT NULL,
  idempotency_key     TEXT,
  PRIMARY KEY (vault_id, revision_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS vault_sync_revisions_device_seq
  ON vault_sync_file_revisions (vault_id, device_id, device_sequence);

CREATE UNIQUE INDEX IF NOT EXISTS vault_sync_revisions_idempotency
  ON vault_sync_file_revisions (vault_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS vault_sync_revisions_path_time
  ON vault_sync_file_revisions (vault_id, opaque_path_id, server_received_at);

CREATE TABLE IF NOT EXISTS vault_sync_path_heads (
  vault_id            TEXT NOT NULL,
  opaque_path_id      TEXT NOT NULL,
  revision_id         TEXT NOT NULL,
  PRIMARY KEY (vault_id, opaque_path_id, revision_id)
);

CREATE TABLE IF NOT EXISTS vault_sync_blobs (
  blob_id             TEXT PRIMARY KEY,
  vault_id            TEXT NOT NULL REFERENCES vault_sync_vaults(vault_id),
  size_bytes          BIGINT NOT NULL,
  ciphertext_hash     TEXT NOT NULL,
  storage_key         TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_sync_audit_events (
  id                  BIGSERIAL PRIMARY KEY,
  vault_id            TEXT NOT NULL,
  device_id           TEXT,
  event_type          TEXT NOT NULL,
  payload_json        JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
