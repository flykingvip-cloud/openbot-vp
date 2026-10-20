#!/usr/bin/env bash
# Spin up a disposable PostgreSQL cluster configured for IT-CS-01..13
# (wal_level=logical, track_commit_timestamp=on, max_prepared_transactions=0),
# apply Stage A.1 migrations + IT-CS fixtures, run harness.py, destroy cluster.
#
# Usage:
#   deploy/ha/commitsafety/tests/it-cs/run-ephemeral.sh
#   HA_CS_IT_FUZZ_BUMPS=10000 HA_CS_IT_FUZZ_WRITERS=64 deploy/ha/commitsafety/tests/it-cs/run-ephemeral.sh
#   PG_BIN=/usr/lib/postgresql/17/bin deploy/ha/commitsafety/tests/it-cs/run-ephemeral.sh
#
# Hosted Actions may still be dark — this is the local acceptance path.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"   # deploy/ha/commitsafety
if [ -n "${PG_BIN:-}" ]; then
  export PATH="$PG_BIN:$PATH"
fi
command -v initdb >/dev/null || { echo "initdb not found (set PG_BIN)" >&2; exit 2; }
command -v psql >/dev/null || { echo "psql not found" >&2; exit 2; }

# venv with psycopg
VENV="${HA_CS_IT_VENV:-$HERE/.venv}"
if [ ! -x "$VENV/bin/python" ]; then
  echo ">> creating venv at $VENV"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -r "$HERE/requirements.txt"
fi
"$VENV/bin/python" -c "import psycopg" || {
  echo "psycopg missing in $VENV; pip install -r $HERE/requirements.txt" >&2
  exit 2
}

SU="hacs_su"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/hacs-itcs.XXXXXX")"
PORT="${HA_CS_IT_PORT:-$(( 21000 + RANDOM % 20000 ))}"
DB="ha_cs_it"

stop() {
  if [ -d "$WORK/data" ]; then
    pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap stop EXIT

echo ">> initdb + start (port=$PORT work=$WORK)"
initdb -D "$WORK/data" -U "$SU" -A trust -E UTF8 --no-locale >"$WORK/initdb.log" 2>&1 \
  || { cat "$WORK/initdb.log"; exit 1; }

# IT-CS oracle requires logical decoding + commit timestamps.
cat >> "$WORK/data/postgresql.conf" <<CONF
listen_addresses = ''
unix_socket_directories = '$WORK'
port = $PORT
wal_level = logical
max_replication_slots = 4
max_wal_senders = 4
track_commit_timestamp = on
max_prepared_transactions = 0
shared_preload_libraries = ''
CONF

pg_ctl -D "$WORK/data" -l "$WORK/pg.log" -w start >/dev/null \
  || { cat "$WORK/pg.log"; exit 1; }

export PGHOST="$WORK" PGPORT="$PORT" PGUSER="$SU"
psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB OWNER $SU"
export PGDATABASE="$DB"
export DATABASE_URL="dbname=$DB user=$SU host=$WORK port=$PORT"

echo ">> apply Stage A.1 migrations"
"$ROOT/scripts/apply.sh"

echo ">> load IT-CS fixtures (cs_probe / naive_probe / oracle slot)"
psql -X -q -v ON_ERROR_STOP=1 -f "$HERE/setup.sql"

echo ">> run IT-CS harness"
export PYTHONUNBUFFERED=1
set +e
HA_CS_IT_FUZZ_BUMPS="${HA_CS_IT_FUZZ_BUMPS:-200}" \
HA_CS_IT_FUZZ_WRITERS="${HA_CS_IT_FUZZ_WRITERS:-16}" \
HA_CS_IT_PERF_SAMPLES="${HA_CS_IT_PERF_SAMPLES:-400}" \
  "$VENV/bin/python" "$HERE/harness.py"
rc=$?
set -e

echo ">> harness exit=$rc"
exit $rc
