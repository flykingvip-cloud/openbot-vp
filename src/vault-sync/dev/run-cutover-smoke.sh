#!/usr/bin/env bash
# Wave Q: PG metadata primary + S3 blob backend cutover smoke (extends Wave J).
# Runs live vitest against dockerized Postgres + MinIO when available.
# Does NOT claim production cutover / P2 acceptance — human sign-off still required.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

export OPENBOT_VAULT_SYNC_LIVE="${OPENBOT_VAULT_SYNC_LIVE:-1}"
export OPENBOT_VAULT_SYNC_METADATA_PRIMARY="${OPENBOT_VAULT_SYNC_METADATA_PRIMARY:-postgres}"
export OPENBOT_VAULT_SYNC_BLOB_BACKEND="${OPENBOT_VAULT_SYNC_BLOB_BACKEND:-s3}"

echo "== Vault Sync cutover smoke (Wave Q) =="
echo "  METADATA_PRIMARY=${OPENBOT_VAULT_SYNC_METADATA_PRIMARY}"
echo "  BLOB_BACKEND=${OPENBOT_VAULT_SYNC_BLOB_BACKEND}"
echo "  (Human sign-off: src/vault-sync/dev/CUTOVER-SIGNOFF.template.md)"
echo

exec "$SCRIPT_DIR/run-smoke.sh" "$@"
