#!/usr/bin/env bash
# Ephemeral PG + Stage A.1 migrations + Stage B lab drills 16L–19L.
#
# Usage:
#   deploy/ha/drills/tests/run-ephemeral.sh
#   PG_BIN=/usr/local/opt/postgresql@14/bin deploy/ha/drills/tests/run-ephemeral.sh
#
# Hosted CI may be dark — this is the local acceptance path.
# Production Auto Failover remains OFF / NOT APPROVED.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRILLS="$(cd "$HERE/.." && pwd)"                 # deploy/ha/drills
HA="$(cd "$DRILLS/.." && pwd)"                   # deploy/ha
CS="$HA/commitsafety"
CTL="$HA/controller"

if [ -n "${PG_BIN:-}" ]; then
  export PATH="$PG_BIN:$PATH"
fi
command -v initdb >/dev/null || { echo "initdb not found (set PG_BIN)" >&2; exit 2; }
command -v psql >/dev/null || { echo "psql not found" >&2; exit 2; }

VENV="${HA_DRILL_VENV:-$HERE/.venv}"
if [ ! -x "$VENV/bin/python" ]; then
  echo ">> creating venv at $VENV"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -r "$DRILLS/requirements.txt"
fi
"$VENV/bin/python" -c "import psycopg" || {
  echo "psycopg missing in $VENV" >&2
  exit 2
}

SU="hacs_su"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ha-drill.XXXXXX")"
PORT="${HA_DRILL_PORT:-$(( 23000 + RANDOM % 20000 ))}"
DB="ha_drill_it"

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

# Oracle needs logical decoding; drills share CommitSafety fixtures.
cat >> "$WORK/data/postgresql.conf" <<CONF
listen_addresses = ''
unix_socket_directories = '$WORK'
port = $PORT
wal_level = logical
max_replication_slots = 4
max_wal_senders = 4
track_commit_timestamp = on
max_prepared_transactions = 0
max_connections = 400
shared_preload_libraries = ''
CONF

pg_ctl -D "$WORK/data" -l "$WORK/pg.log" -w start >/dev/null \
  || { cat "$WORK/pg.log"; exit 1; }

export PGHOST="$WORK" PGPORT="$PORT" PGUSER="$SU"
psql -X -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB OWNER $SU"
export PGDATABASE="$DB"
export DATABASE_URL="dbname=$DB user=$SU host=$WORK port=$PORT"

echo ">> apply Stage A.1 CommitSafety migrations"
"$CS/scripts/apply.sh"

echo ">> load Stage B drill fixtures (cs_probe / oracle slot)"
psql -X -q -v ON_ERROR_STOP=1 -f "$HERE/setup.sql"

echo ">> run Stage B lab drills harness (16L–19L)"
export PYTHONUNBUFFERED=1
# controller + drills on PYTHONPATH
export PYTHONPATH="$CTL:$DRILLS${PYTHONPATH:+:$PYTHONPATH}"
export HA_DRILL_RESULTS="${HA_DRILL_RESULTS:-$HERE/results}"
mkdir -p "$HA_DRILL_RESULTS"
set +e
"$VENV/bin/python" "$HERE/harness.py"
rc=$?
set -e
echo ">> harness exit=$rc"
exit $rc
