#!/usr/bin/env bash
# Apply the HA V2.1.2 Stage A.1 CommitSafety migrations in order.
# Each file runs in its own transaction; every file is idempotent (expand-only),
# so re-running is safe.
#
# Usage:
#   DATABASE_URL='postgresql://<migrator>@<host>:5432/<db>?sslmode=require' \
#     deploy/ha/commitsafety/scripts/apply.sh
# Credentials come from the environment / secret manager (PGPASSWORD,
# ~/.pgpass, IAM token). Never commit them.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
: "${DATABASE_URL:?DATABASE_URL (migration role connection) is required}"

for f in "$ROOT"/migrations/[0-9][0-9][0-9]_*.sql; do
  echo ">> applying $(basename "$f")"
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$f"
done
echo ">> CommitSafety Stage A.1 migrations applied."
