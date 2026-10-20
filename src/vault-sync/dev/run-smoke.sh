#!/usr/bin/env bash
# Wave J: optional Postgres + MinIO live smoke for Knowledge Vault Sync.
# Does NOT claim production cutover / P2 acceptance.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
COMPOSE_FILE="$(cd "$(dirname "$0")" && pwd)/docker-compose.smoke.yml"

export OPENBOT_VAULT_SYNC_LIVE="${OPENBOT_VAULT_SYNC_LIVE:-1}"
export OPENBOT_VAULT_SYNC_DATABASE_URL="${OPENBOT_VAULT_SYNC_DATABASE_URL:-postgres://openbot:openbot@127.0.0.1:55432/vault_sync}"
export OPENBOT_VAULT_SYNC_S3_ENDPOINT="${OPENBOT_VAULT_SYNC_S3_ENDPOINT:-http://127.0.0.1:19000}"
export OPENBOT_VAULT_SYNC_S3_BUCKET="${OPENBOT_VAULT_SYNC_S3_BUCKET:-openbot-vault}"
export OPENBOT_VAULT_SYNC_S3_ACCESS_KEY="${OPENBOT_VAULT_SYNC_S3_ACCESS_KEY:-minioadmin}"
export OPENBOT_VAULT_SYNC_S3_SECRET_KEY="${OPENBOT_VAULT_SYNC_S3_SECRET_KEY:-minioadmin}"
export OPENBOT_VAULT_SYNC_S3_FORCE_PATH_STYLE="${OPENBOT_VAULT_SYNC_S3_FORCE_PATH_STYLE:-1}"

if [[ "${VAULT_SYNC_SMOKE_SKIP_COMPOSE:-0}" != "1" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker not found; set VAULT_SYNC_SMOKE_SKIP_COMPOSE=1 and provide live env" >&2
    exit 1
  fi
  docker compose -f "$COMPOSE_FILE" up -d
  for _ in $(seq 1 60); do
    if docker compose -f "$COMPOSE_FILE" exec -T vault-sync-pg pg_isready -U openbot -d vault_sync >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  # Ensure MinIO bucket exists (init container can race).
  docker run --rm --network host --entrypoint=/bin/sh \
    minio/mc:RELEASE.2025-04-16T18-13-26Z \
    -c 'for i in $(seq 1 30); do mc alias set local http://127.0.0.1:19000 minioadmin minioadmin && break; sleep 1; done; mc mb -p local/openbot-vault || true'
fi

cd "$ROOT"
pnpm vitest run --config vitest.live.config.ts src/vault-sync/store/postgres-s3.live.test.ts
