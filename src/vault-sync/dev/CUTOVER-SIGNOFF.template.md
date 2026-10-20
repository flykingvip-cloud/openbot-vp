# Knowledge Vault Sync — Cutover Sign-off Record (template)

> Copy this file to your ops journal or paste into the deployment ticket.
> **Green `./src/vault-sync/dev/run-cutover-smoke.sh` alone does not equal P2 acceptance.**

## Environment

| Field                                  | Value     |
| -------------------------------------- | --------- |
| Date (UTC)                             |           |
| Operator                               |           |
| Gateway image / git tag                |           |
| `OPENBOT_VAULT_SYNC_DATABASE_URL` host |           |
| `OPENBOT_VAULT_SYNC_METADATA_PRIMARY`  | postgres  |
| `OPENBOT_VAULT_SYNC_BLOB_BACKEND`      | s3 / file |
| S3 endpoint (if s3)                    |           |
| Legacy gateway sync disabled           | yes / no  |

## Automated evidence

| Check                                       | Command                                     | Result             | Log ref |
| ------------------------------------------- | ------------------------------------------- | ------------------ | ------- |
| PG+S3 live smoke                            | `./src/vault-sync/dev/run-cutover-smoke.sh` | PASS / FAIL        |         |
| Hydrate drill (manual step 6 in CUTOVER.md) |                                             | PASS / FAIL / SKIP |         |
| Rollback drill (optional)                   |                                             | PASS / FAIL / SKIP |         |

## Manual cutover steps (from CUTOVER.md)

| Step                                           | Done | Notes |
| ---------------------------------------------- | ---- | ----- |
| 1. Backup file-plane + PG PITR confirmed       |      |       |
| 2. Schema apply via gateway startup            |      |       |
| 3. Dual-write soak (optional)                  |      |       |
| 4. Flip `METADATA_PRIMARY=postgres`            |      |       |
| 5. Verify vault → sync → revoke device + audit |      |       |
| 6. Hydrate after cache wipe                    |      |       |

## Decision

| Outcome                                 | Selected |
| --------------------------------------- | -------- |
| **ACCEPT** cutover for this environment | [ ]      |
| **REJECT** — rollback per CUTOVER.md    | [ ]      |

Approver signature / ticket link:

---

**Explicit non-claims:** Not Chromium UI acceptance. Not mobile device acceptance. Not full P0–P4 package pass.
