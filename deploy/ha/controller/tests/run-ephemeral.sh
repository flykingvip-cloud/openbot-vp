#!/usr/bin/env bash
# Ephemeral PG + Stage A.1 migrations + Dual Controller Stage C harness.
#
# Usage:
#   deploy/ha/controller/tests/run-ephemeral.sh
#   PG_BIN=/usr/local/opt/postgresql@14/bin deploy/ha/controller/tests/run-ephemeral.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CTL="$(cd "$HERE/.." && pwd)"                 # deploy/ha/controller
CS="$(cd "$CTL/../commitsafety" && pwd)"      # deploy/ha/commitsafety

if [ -n "${PG_BIN:-}" ]; then
  export PATH="$PG_BIN:$PATH"
fi
command -v initdb >/dev/null || { echo "initdb not found (set PG_BIN)" >&2; exit 2; }
command -v psql >/dev/null || { echo "psql not found" >&2; exit 2; }

VENV="${HA_CTL_VENV:-$HERE/.venv}"
if [ ! -x "$VENV/bin/python" ]; then
  echo ">> creating venv at $VENV"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -r "$CTL/requirements.txt"
fi
"$VENV/bin/python" -c "import psycopg" || {
  echo "psycopg missing in $VENV" >&2
  exit 2
}

SU="hacs_su"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ha-ctl.XXXXXX")"
PORT="${HA_CTL_PORT:-$(( 22000 + RANDOM % 20000 ))}"
DB="ha_ctl_it"

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

cat >> "$WORK/data/postgresql.conf" <<CONF
listen_addresses = ''
unix_socket_directories = '$WORK'
port = $PORT
max_prepared_transactions = 0
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

# Trust auth: openbot_* roles can connect without password on unix socket.
echo ">> run Dual Controller harness"
export PYTHONUNBUFFERED=1
export PYTHONPATH="$CTL${PYTHONPATH:+:$PYTHONPATH}"
set +e
"$VENV/bin/python" "$HERE/harness.py"
rc=$?
set -e
echo ">> harness exit=$rc"
exit $rc
