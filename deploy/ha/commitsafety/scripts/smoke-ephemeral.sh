#!/usr/bin/env bash
# Spin up a throwaway PostgreSQL cluster (initdb, trust auth, unix socket only),
# run scripts/smoke.sh against it, then destroy it. Nothing touches any
# existing database.
#   deploy/ha/commitsafety/scripts/smoke-ephemeral.sh
#   PG_BIN=/usr/lib/postgresql/17/bin deploy/ha/commitsafety/scripts/smoke-ephemeral.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${PG_BIN:-}" ]; then
  export PATH="$PG_BIN:$PATH"
fi
command -v initdb >/dev/null || { echo "initdb not found (set PG_BIN)" >&2; exit 2; }

# Two disposable clusters: migrations as superuser, and as a non-superuser
# CREATEROLE migrator that owns the DB (closest to Managed PG).
MODES="${HA_CS_SMOKE_MODES:-super nonsuper}"
SU="hacs_su"
WORK=""

stop() {
  if [ -n "$WORK" ]; then
    pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
  WORK=""
}
trap stop EXIT

rc=0
for mode in $MODES; do
  WORK="$(mktemp -d /tmp/hacs.XXXXXX)"
  PORT="${HA_CS_SMOKE_PORT:-$(( 20000 + RANDOM % 20000 ))}"
  initdb -D "$WORK/data" -U "$SU" -A trust -E UTF8 --no-locale >"$WORK/initdb.log" 2>&1 \
    || { cat "$WORK/initdb.log"; exit 1; }
  pg_ctl -D "$WORK/data" -l "$WORK/pg.log" -w \
    -o "-c listen_addresses='' -k $WORK -p $PORT -c max_prepared_transactions=0" start >/dev/null \
    || { cat "$WORK/pg.log"; exit 1; }
  echo "######## mode=$mode ########"
  nonsuper=0; [ "$mode" = "nonsuper" ] && nonsuper=1
  HA_CS_SMOKE_DISPOSABLE=1 HA_CS_SMOKE_NONSUPER_MIGRATOR=$nonsuper \
    PGHOST="$WORK" PGPORT="$PORT" PGUSER="$SU" "$HERE/smoke.sh" || rc=1
  stop
done
exit $rc
