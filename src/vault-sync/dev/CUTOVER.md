# Knowledge Vault Sync — production metadata cutover runbook (Wave L)

**Status:** operator checklist / scaffold. Completing this document does **not** mean P2 acceptance or production cutover is done.

## Preconditions

- Postgres reachable via `OPENBOT_VAULT_SYNC_DATABASE_URL`
- Object store ready: `OPENBOT_VAULT_SYNC_BLOB_BACKEND=s3` (+ `OPENBOT_VAULT_SYNC_S3_*`) or file backend kept intentionally
- Gateway build includes vault-sync schema apply (`ensureVaultSyncSchema`)
- Optional live smoke green: `./src/vault-sync/dev/run-smoke.sh` (Wave J)
- Cutover-shaped smoke (PG primary + S3 + objectUpload): `./src/vault-sync/dev/run-cutover-smoke.sh` (Wave Q)
- Human sign-off template: `src/vault-sync/dev/CUTOVER-SIGNOFF.template.md`

## Env matrix

| Variable                                 | Cutover value              | Notes                    |
| ---------------------------------------- | -------------------------- | ------------------------ |
| `OPENBOT_VAULT_SYNC_DATABASE_URL`        | required                   | PG for metadata          |
| `OPENBOT_VAULT_SYNC_METADATA_PRIMARY`    | `postgres`                 | Fail-hard primary writes |
| `OPENBOT_VAULT_SYNC_BLOB_BACKEND`        | `s3` (prod) / `file` (dev) | Ciphertext bytes         |
| `OPENBOT_VAULT_SYNC_LEGACY_GATEWAY_SYNC` | unset / `0`                | Must stay off            |

Primary PG covers: vaults, devices, blobs meta, revisions, heads, members, invites, **audit events** (Wave L). Ciphertext stays in object store.

## Cutover steps (human-gated)

1. **Backup** file-plane vault roots + confirm PG backups / PITR.
2. **Schema**: start Gateway once with DB URL so `ensureVaultSyncSchema` creates/updates tables (incl. `vault_sync_audit_events` index).
3. **Dual-write soak** (optional): run with DB URL but `METADATA_PRIMARY=file` (best-effort mirror) and compare row counts.
4. **Flip primary**: set `OPENBOT_VAULT_SYNC_METADATA_PRIMARY=postgres`, restart Gateway.
5. **Verify**: create vault → sync small file → revoke device → `flush` path / RPC success; check PG has vault + revision + audit (`device_revoked`).
6. **Hydrate drill**: wipe one vault’s file cache dir → call `hydrateVaultMetadataFromPostgres` (or restart recovery path) → inventory/audit restored.
7. **Sign-off**: human records date, env, smoke evidence in `CUTOVER-SIGNOFF.template.md`. Until then: **not accepted**.

## Rollback

1. Set `OPENBOT_VAULT_SYNC_METADATA_PRIMARY=file` (or unset).
2. Restart Gateway; file JSON remains local cache — restore from backup if file plane was wiped.
3. Keep PG read-only for forensics; do not delete audit rows during rollback.

## Explicit non-claims

- Not Chromium UI / mobile device E2E acceptance
- Not “production deployed”
- Not P0–P4 package pass
