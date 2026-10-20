#!/usr/bin/env bash
# =============================================================================
# HA V2.1.2 Stage A.1 CommitSafety — SMOKE verification (NOT the IT-CS suite).
#
# Proves the Stage A.1 SQL is coherent and wired: migrations apply (twice,
# idempotent), coverage check fails/passes correctly, the gate rejects missing
# / stale / wrong-role epochs at COMMIT, written_epoch is stamped + immutable,
# bump guards hold, the gate's ROW SHARE excludes the bump's EXCLUSIVE, a few
# basic bypasses are denied, and the terminate helper works.
# It has no oracle / logical decoding / fuzzing / perf: those are IT-CS-01..13
# (Stage A.2) and are intentionally out of scope here.
#
# DISPOSABLE CLUSTERS ONLY: creates + drops a database and creates cluster-wide
# HA roles. Connect as a superuser through libpq env (PGHOST/PGPORT/PGUSER)
# with trust (or password-less) auth for the openbot_* login roles.
#   HA_CS_SMOKE_DISPOSABLE=1 PGHOST=... PGPORT=... PGUSER=... scripts/smoke.sh
# Usually invoked through scripts/smoke-ephemeral.sh.
# =============================================================================
set -uo pipefail
trap '' PIPE

if [ "${HA_CS_SMOKE_DISPOSABLE:-0}" != "1" ]; then
  echo "refusing to run: set HA_CS_SMOKE_DISPOSABLE=1 (disposable cluster only)" >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SU="${PGUSER:-$(whoami)}"
DB="ha_cs_smoke_$$"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/hacs-smoke.XXXXXX")"
PASS=0
FAIL=0

cleanup() {
  exec 7>&- 2>/dev/null || true
  psql -X -q -U "$SU" -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

ok()  { echo "PASS  $1"; PASS=$((PASS + 1)); }
bad() { echo "FAIL  $1"; printf '%s\n' "$2" | sed 's/^/        /'; FAIL=$((FAIL + 1)); }

psql_as() { # role [psql args...]
  local role="$1"; shift
  PGAPPNAME="${APPNAME:-ha-cs-smoke}" psql -X -q -v VERBOSITY=verbose -U "$role" -d "$DB" "$@"
}

expect_ok() { # desc role sql
  local out
  if out=$(printf '%s\n' "$3" | psql_as "$2" -v ON_ERROR_STOP=1 -f - 2>&1); then ok "$1"; else bad "$1" "$out"; fi
}

expect_err() { # desc role sqlstate sql
  local out rc
  out=$(printf '%s\n' "$4" | psql_as "$2" -v ON_ERROR_STOP=1 -f - 2>&1); rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q "ERROR:  $3"; then ok "$1"; else bad "$1 (want SQLSTATE $3, rc=$rc)" "$out"; fi
}

expect_val() { # desc role expected sql
  local got
  # stdin (not -c): psql < 15 only prints the last result of a multi-statement -c
  got=$(printf '%s\n' "$4" | psql_as "$2" -At -v ON_ERROR_STOP=1 -f - 2>&1)
  if [ "$got" = "$3" ]; then ok "$1"; else bad "$1 (want '$3')" "$got"; fi
}

# ---- one background session driven through a FIFO (bash 3.2 compatible) ----
bg_start() { # role appname
  BG_FIFO="$TMP/bg.in"; BG_OUT="$TMP/bg.out"
  rm -f "$BG_FIFO" "$BG_OUT"; mkfifo "$BG_FIFO"
  PGAPPNAME="$2" psql -X -q -v VERBOSITY=verbose -U "$1" -d "$DB" -f - <"$BG_FIFO" >"$BG_OUT" 2>&1 &
  BG_PID=$!
  exec 7>"$BG_FIFO"
}
bg_send() { printf '%s\n' "$1" >&7 2>/dev/null; }
bg_wait_for() { # marker
  local i
  for i in $(seq 1 100); do
    grep -q "$1" "$BG_OUT" 2>/dev/null && return 0
    sleep 0.1
  done
  echo "timeout waiting for '$1' in background session output:" >&2; cat "$BG_OUT" >&2
  return 1
}
bg_stop() { bg_send '\q'; exec 7>&-; wait "$BG_PID" 2>/dev/null; }

make_exec() { # from_epoch from_holder to_holder state -> execution_id
  psql_as openbot_controller -At -v ON_ERROR_STOP=1 -c "
    INSERT INTO public.ha_failover_execution
      (execution_id, lock_name, from_epoch, from_holder, to_holder,
       owner_controller_id, owner_gen, owner_lease_until, state, mode)
    VALUES (gen_random_uuid(), 'openbot_writer', $1, '$2', '$3',
            'smoke-controller', 1, now() + interval '20 seconds', '$4', 'manual')
    RETURNING execution_id"
}

bump_sql() { # exec from to_holder to_role [lock_timeout]
  printf "BEGIN;\nSET LOCAL lock_timeout = '%s';\nSELECT public.openbot_ha_bump_epoch('%s', 1, %s, '%s', '%s');\nCOMMIT;\n" \
    "${5:-5s}" "$1" "$2" "$3" "$4"
}

echo "== HA CommitSafety Stage A.1 smoke on $(psql -X -At -U "$SU" -d postgres -c 'show server_version') (db=$DB) =="
# HA_CS_SMOKE_NONSUPER_MIGRATOR=1 mimics Managed PG: migrations run as a
# non-superuser CREATEROLE role that owns the database (no pg_signal_backend
# admin rights -> expect a WARNING from 001, terminate tests then use SU grant).
MIGRATOR="$SU"
if [ "${HA_CS_SMOKE_NONSUPER_MIGRATOR:-0}" = "1" ]; then
  MIGRATOR="hacs_migrator"
  psql -X -q -U "$SU" -d postgres -v ON_ERROR_STOP=1 \
    -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hacs_migrator') THEN CREATE ROLE hacs_migrator LOGIN CREATEROLE NOSUPERUSER; END IF; END \$\$" || exit 1
fi
psql -X -q -U "$SU" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB OWNER $MIGRATOR" || exit 1
export DATABASE_URL="dbname=$DB user=$MIGRATOR"
echo "   migrator role: $MIGRATOR"
SERVER_NUM=$(psql_as "$SU" -At -c "show server_version_num")

# ---- T01 apply (twice: idempotent / expand-only) ----------------------------
if out=$("$HERE/apply.sh" 2>&1) && out2=$("$HERE/apply.sh" 2>&1); then
  ok "T01 migrations apply cleanly twice (idempotent)"
else
  bad "T01 migrations apply" "$out ${out2:-}"
  echo "cannot continue"; exit 1
fi

if [ "$MIGRATOR" != "$SU" ]; then
  if printf '%s' "$out" | grep -q "could not GRANT pg_signal_backend"; then
    ok "T01b non-superuser migrator: missing pg_signal_backend surfaced as WARNING"
  else
    echo "INFO  T01b non-superuser migrator could grant pg_signal_backend itself"
  fi
  # vendor-console equivalent
  psql_as "$SU" -v ON_ERROR_STOP=1 -c "GRANT pg_signal_backend, pg_read_all_stats TO openbot_ha_owner" >/dev/null 2>&1
fi

# ---- T02/T03/T04 coverage check ---------------------------------------------
if out=$("$HERE/check-coverage.sh" 2>&1); then ok "T02 coverage PASS on fresh schema (HA tables exempt, probe gated)"; else bad "T02 coverage on fresh schema" "$out"; fi

psql_as "$SU" -v ON_ERROR_STOP=1 -c "CREATE TABLE public.smoke_authority (id text PRIMARY KEY, note text)" >/dev/null
if out=$("$HERE/check-coverage.sh" 2>&1); then bad "T03 coverage must FAIL for ungated table" "$out"
elif printf '%s' "$out" | grep -q "smoke_authority"; then ok "T03 coverage FAILS and names ungated table"
else bad "T03 coverage failure should name smoke_authority" "$out"; fi
if out=$("$HERE/check-coverage.sh" --report-only 2>&1); then ok "T03b --report-only reports but exits 0"; else bad "T03b report-only" "$out"; fi

psql_as "$SU" -v ON_ERROR_STOP=1 -c "CREATE TRIGGER openbot_epoch_gate AFTER INSERT ON public.smoke_authority FOR EACH ROW EXECUTE FUNCTION public.openbot_ha_epoch_gate_trg()" >/dev/null
if "$HERE/check-coverage.sh" >/dev/null 2>&1; then bad "T03c non-deferred same-name trigger must not satisfy coverage" ""; else ok "T03c non-constraint/non-deferred same-name trigger rejected by coverage"; fi
psql_as "$SU" -v ON_ERROR_STOP=1 -c "DROP TRIGGER openbot_epoch_gate ON public.smoke_authority" >/dev/null

expect_ok "T03d attach helper gates table" "$SU" "SELECT public.openbot_ha_attach_epoch_gate('public.smoke_authority');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smoke_authority TO openbot_app_a, openbot_app_b;"
if out=$("$HERE/check-coverage.sh" 2>&1); then ok "T03e coverage PASS after attach"; else bad "T03e coverage after attach" "$out"; fi

expect_err "T04 attach helper refuses HA-exempt table" "$SU" "P0001" "SELECT public.openbot_ha_attach_epoch_gate('public.writer_lease');"
psql_as "$SU" -v ON_ERROR_STOP=1 -c "CREATE CONSTRAINT TRIGGER openbot_epoch_gate AFTER INSERT OR UPDATE OR DELETE ON public.ha_controller_instance DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.openbot_ha_epoch_gate_trg()" >/dev/null
if "$HERE/check-coverage.sh" >/dev/null 2>&1; then bad "T04b gate on HA-exempt table must fail coverage" ""; else ok "T04b coverage FAILS when HA-exempt table carries gate"; fi
psql_as "$SU" -v ON_ERROR_STOP=1 -c "DROP TRIGGER openbot_epoch_gate ON public.ha_controller_instance" >/dev/null

# ---- T05..T08 gate basics (epoch 1, H1 unbound) -----------------------------
RUN=$(psql_as "$SU" -At -c "SELECT gen_random_uuid()")
expect_ok "T05 app_a writes probe with expected_epoch=1" openbot_app_a "BEGIN;
SELECT set_config('openbot.expected_epoch', '1', true);
INSERT INTO public.ha_rpo_probe(run_id, seq, client_sent_at, payload_sha256, written_epoch)
VALUES ('$RUN', 1, now(), 'sha-1', 999);
COMMIT;"
expect_val "T05b written_epoch stamped from expected_epoch (client 999 ignored)" "$SU" "1" \
  "SELECT written_epoch FROM public.ha_rpo_probe WHERE run_id = '$RUN' AND seq = 1"
expect_err "T06 probe insert without expected_epoch -> OB001" openbot_app_a "OB001" "BEGIN;
INSERT INTO public.ha_rpo_probe(run_id, seq, client_sent_at, payload_sha256, written_epoch)
VALUES ('$RUN', 2, now(), 'sha-2', 0);
COMMIT;"
expect_err "T06b authoritative write without expected_epoch -> OB001 at COMMIT" openbot_app_a "OB001" "BEGIN;
INSERT INTO public.smoke_authority VALUES ('no-epoch', 'x');
COMMIT;"
expect_err "T06c malformed expected_epoch -> OB001" openbot_app_a "OB001" "BEGIN;
SELECT set_config('openbot.expected_epoch', '1 OR 1=1', true);
INSERT INTO public.smoke_authority VALUES ('bad-epoch', 'x');
COMMIT;"
expect_err "T07 stale/future expected_epoch=2 -> OB002 at COMMIT" openbot_app_a "OB002" "BEGIN;
SELECT set_config('openbot.expected_epoch', '2', true);
INSERT INTO public.smoke_authority VALUES ('wrong-epoch', 'x');
COMMIT;"
expect_err "T08 forged openbot.gate_passed=on does NOT skip the gate" openbot_app_a "OB002" "BEGIN;
SELECT set_config('openbot.gate_passed', 'on', true);
SELECT set_config('openbot.expected_epoch', '2', true);
INSERT INTO public.smoke_authority VALUES ('forged', 'x');
COMMIT;"
expect_val "T08b none of the rejected rows are visible" "$SU" "0" \
  "SELECT count(*) FROM public.smoke_authority WHERE id IN ('no-epoch','bad-epoch','wrong-epoch','forged')"

# ---- T09 written_epoch immutability ------------------------------------------
expect_err "T09 owner/superuser UPDATE of written_epoch -> OB020" "$SU" "OB020" "BEGIN;
SELECT set_config('openbot.expected_epoch', '1', true);
UPDATE public.ha_rpo_probe SET written_epoch = 5 WHERE run_id = '$RUN';
COMMIT;"
expect_ok "T09b UPDATE of other probe columns allowed for owner (still gated)" "$SU" "BEGIN;
SELECT set_config('openbot.expected_epoch', '1', true);
UPDATE public.ha_rpo_probe SET payload_sha256 = 'sha-1b' WHERE run_id = '$RUN';
COMMIT;"
expect_val "T09c written_epoch preserved" "$SU" "1|sha-1b" \
  "SELECT written_epoch || '|' || payload_sha256 FROM public.ha_rpo_probe WHERE run_id = '$RUN'"
expect_err "T09d business role cannot UPDATE probe (append-only)" openbot_app_a "42501" "BEGIN;
SELECT set_config('openbot.expected_epoch', '1', true);
UPDATE public.ha_rpo_probe SET payload_sha256 = 'evil' WHERE run_id = '$RUN';
COMMIT;"
expect_err "T09e business role cannot DELETE probe" openbot_app_a "42501" "DELETE FROM public.ha_rpo_probe;"

# ---- T10 basic bypass denials (subset of §10.6; full IT-CS-07 is Stage A.2) --
expect_err "T10a app cannot DISABLE TRIGGER" openbot_app_a "42501" "ALTER TABLE public.smoke_authority DISABLE TRIGGER ALL;"
expect_err "T10b app cannot TRUNCATE" openbot_app_a "42501" "TRUNCATE public.smoke_authority;"
expect_err "T10c app cannot SET session_replication_role" openbot_app_a "42501" "SET session_replication_role = replica;"
expect_err "T10d app cannot UPDATE writer_epoch_guard" openbot_app_a "42501" "UPDATE public.writer_epoch_guard SET current_epoch = current_epoch + 1;"
expect_err "T10e app cannot call bump" openbot_app_a "42501" "SELECT public.openbot_ha_bump_epoch(gen_random_uuid(), 1, 1, 'node-a', 'openbot_app_a');"
expect_err "T10f app cannot call terminate" openbot_app_a "42501" "SELECT * FROM public.openbot_ha_terminate_holder_sessions('node-b', NULL);"
expect_err "T10g controller has no business-table write" openbot_controller "42501" "INSERT INTO public.smoke_authority VALUES ('ctl', 'x');"
expect_err "T10h 2PC disabled (PREPARE TRANSACTION)" openbot_app_a "55000" "BEGIN;
SELECT set_config('openbot.expected_epoch', '1', true);
INSERT INTO public.smoke_authority VALUES ('2pc', 'x');
PREPARE TRANSACTION 'ha_cs_smoke';"
expect_err "T10i app cannot replace the gate function" openbot_app_a "42501" "CREATE OR REPLACE FUNCTION public.openbot_ha_commit_gate() RETURNS void LANGUAGE sql AS 'SELECT';"

# ---- T11 bump guards + first bump 1 -> 2 (bootstrap -> node-b/app_b) ---------
E1=$(make_exec 1 bootstrap node-b VERIFIED)
expect_err "T11a bump without lock_timeout -> OB012" openbot_controller "OB012" \
  "SELECT public.openbot_ha_bump_epoch('$E1', 1, 1, 'node-b', 'openbot_app_b');"
expect_err "T11b bump with to_holder not matching execution -> OB010" openbot_controller "OB010" "$(bump_sql "$E1" 1 node-a openbot_app_b)"
expect_err "T11c bump with zombie owner_gen -> OB010" openbot_controller "OB010" \
  "BEGIN; SET LOCAL lock_timeout = '5s'; SELECT public.openbot_ha_bump_epoch('$E1', 2, 1, 'node-b', 'openbot_app_b'); COMMIT;"
expect_err "T11d bump with non-app to_db_role -> OB010" openbot_controller "OB010" "$(bump_sql "$E1" 1 node-b openbot_controller)"
expect_val "T11e bump 1 -> 2" openbot_controller "2" "$(bump_sql "$E1" 1 node-b openbot_app_b)"
expect_val "T11f same execution retried is idempotent (still 2, no double +1)" openbot_controller "2" "$(bump_sql "$E1" 1 node-b openbot_app_b)"
expect_val "T11g guard/lease/execution/audit consistent" "$SU" "2|openbot_app_b|node-b|2|LEASED|1" "
SELECT g.current_epoch || '|' || g.holder_db_role || '|' || l.holder_id || '|' || l.epoch || '|' || e.state || '|' ||
       (SELECT count(*) FROM public.writer_lease_audit a WHERE a.execution_id = e.execution_id AND a.action = 'epoch_bump')
  FROM public.writer_epoch_guard g JOIN public.writer_lease l USING (lock_name)
  JOIN public.ha_failover_execution e ON e.execution_id = '$E1'"
EC=$(make_exec 2 node-b node-a CLAIMED)
expect_err "T11h bump of non-VERIFIED execution -> OB010 (INV-VERIFY)" openbot_controller "OB010" "$(bump_sql "$EC" 2 node-a openbot_app_a)"
expect_err "T11i second live execution for same from_epoch -> 23505 (INV-ONE)" openbot_controller "23505" "
INSERT INTO public.ha_failover_execution (execution_id, lock_name, from_epoch, from_holder, to_holder,
  owner_controller_id, owner_lease_until, state, mode)
VALUES (gen_random_uuid(), 'openbot_writer', 2, 'node-b', 'node-a', 'smoke-controller-2', now(), 'CLAIMED', 'manual');"
expect_ok "T11j close the CLAIMED execution (ABORTED_CLOSED)" openbot_controller \
  "UPDATE public.ha_failover_execution SET state = 'ABORTED_CLOSED' WHERE execution_id = '$EC';"
expect_err "T12 manual epoch jump blocked even for superuser -> OB013 (INV-MONO)" "$SU" "OB013" \
  "UPDATE public.writer_epoch_guard SET current_epoch = 9 WHERE lock_name = 'openbot_writer';"

# ---- T13 post-bump gate: old epoch / wrong role / new holder -----------------
expect_err "T13a old epoch 1 after bump -> OB002" openbot_app_a "OB002" "BEGIN;
SELECT set_config('openbot.expected_epoch', '1', true);
INSERT INTO public.smoke_authority VALUES ('old-epoch', 'x');
COMMIT;"
expect_err "T13b H1: app_a claiming epoch 2 -> OB003" openbot_app_a "OB003" "BEGIN;
SELECT set_config('openbot.expected_epoch', '2', true);
INSERT INTO public.smoke_authority VALUES ('wrong-role', 'x');
COMMIT;"
expect_ok "T13c new holder app_b writes with epoch 2" openbot_app_b "BEGIN;
SELECT set_config('openbot.expected_epoch', '2', true);
INSERT INTO public.smoke_authority VALUES ('new-holder', 'x');
INSERT INTO public.ha_rpo_probe(run_id, seq, client_sent_at, payload_sha256, written_epoch)
VALUES ('$RUN', 3, now(), 'sha-3', 1);
COMMIT;"
expect_val "T13d probe written_epoch = 2 for new holder" "$SU" "2" \
  "SELECT written_epoch FROM public.ha_rpo_probe WHERE run_id = '$RUN' AND seq = 3"

# ---- T14 renew ----------------------------------------------------------------
expect_val "T14a holder renew succeeds" openbot_app_b "t" "SELECT public.openbot_ha_renew('node-b', 2) IS NOT NULL"
expect_val "T14b non-holder renew returns NULL (self-fence signal)" openbot_app_a "t" "SELECT public.openbot_ha_renew('node-a', 2) IS NULL"
expect_err "T14c renew ttl bounded" openbot_app_b "OB010" "SELECT public.openbot_ha_renew('node-b', 2, '1 hour');"

# ---- T15 gate ROW SHARE excludes bump EXCLUSIVE --------------------------------
E2=$(make_exec 2 node-b node-a VERIFIED)
bg_start openbot_app_b "openbot:node-b:writer:1515"
bg_send "BEGIN;
SELECT set_config('openbot.expected_epoch', '2', true);
SELECT public.openbot_ha_commit_gate();
\\echo READY15"
if bg_wait_for READY15; then
  expect_val "T15a gate holder has RowShareLock on writer_epoch_guard" "$SU" "1" "
  SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING (pid)
   WHERE l.relation = 'public.writer_epoch_guard'::regclass AND l.mode = 'RowShareLock' AND l.granted
     AND a.application_name = 'openbot:node-b:writer:1515'"
  expect_err "T15b bump cannot get EXCLUSIVE while a gate holder is open -> 55P03" openbot_controller "55P03" \
    "$(bump_sql "$E2" 2 node-a openbot_app_a 1s)"
  bg_send "INSERT INTO public.smoke_authority VALUES ('gate-first', 'x');
COMMIT;
\\echo DONE15"
  bg_wait_for DONE15 >/dev/null
fi
bg_stop
if grep -q "ERROR" "$BG_OUT"; then bad "T15c gate-first transaction commits (c(T) before c(B))" "$(cat "$BG_OUT")"; else ok "T15c gate-first transaction commits (c(T) before c(B))"; fi
expect_val "T15d epoch unchanged by the timed-out bump" "$SU" "2" "SELECT current_epoch FROM public.writer_epoch_guard"

# ---- T16 RC: T_old open -> bump -> T_old COMMIT fails (IT-CS-01 shape) -------
bg_start openbot_app_b "openbot:node-b:writer:1616"
bg_send "BEGIN ISOLATION LEVEL READ COMMITTED;
SELECT set_config('openbot.expected_epoch', '2', true);
INSERT INTO public.smoke_authority VALUES ('rc-stale', 'T_old');
\\echo READY16"
if bg_wait_for READY16; then
  expect_val "T16a bump 2 -> 3 succeeds while T_old is uncommitted (no gate yet)" openbot_controller "3" "$(bump_sql "$E2" 2 node-a openbot_app_a)"
  bg_send "COMMIT;
\\echo DONE16"
  bg_wait_for DONE16 >/dev/null
fi
bg_stop
if grep -q "ERROR:  OB002" "$BG_OUT"; then ok "T16b T_old COMMIT rejected with OB002 (RC)"; else bad "T16b T_old COMMIT must fail OB002" "$(cat "$BG_OUT")"; fi
expect_val "T16c rejected T_old row not visible" "$SU" "0" "SELECT count(*) FROM public.smoke_authority WHERE id = 'rc-stale'"

# ---- T17 RR: snapshot before bump -> FOR SHARE branch -> 40001 --------------
E3=$(make_exec 3 node-a node-b VERIFIED)
bg_start openbot_app_a "openbot:node-a:writer:1717"
bg_send "BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT count(*) FROM public.writer_epoch_guard;
SELECT set_config('openbot.expected_epoch', '3', true);
INSERT INTO public.smoke_authority VALUES ('rr-stale', 'T_old');
\\echo READY17"
if bg_wait_for READY17; then
  expect_val "T17a bump 3 -> 4 succeeds" openbot_controller "4" "$(bump_sql "$E3" 3 node-b openbot_app_b)"
  bg_send "COMMIT;
\\echo DONE17"
  bg_wait_for DONE17 >/dev/null
fi
bg_stop
if grep -Eq "ERROR:  (40001|OB002)" "$BG_OUT"; then ok "T17b RR T_old COMMIT rejected ($(grep -Eo 'ERROR:  (40001|OB002)' "$BG_OUT" | head -1 | cut -c9-))"; else bad "T17b RR T_old COMMIT must fail 40001/OB002" "$(cat "$BG_OUT")"; fi
expect_val "T17c rejected RR row not visible" "$SU" "0" "SELECT count(*) FROM public.smoke_authority WHERE id = 'rr-stale'"

# ---- T18 old-holder session listing + terminate -----------------------------
bg_start openbot_app_a "openbot:node-a:writer:4242"
bg_send "BEGIN;
SELECT 1;
\\echo READY18"
if bg_wait_for READY18; then
  expect_val "T18a holder_sessions sees old holder session" openbot_controller "1" \
    "SELECT count(*) FROM public.openbot_ha_holder_sessions('node-a')"
  expect_val "T18b terminate old holder sessions" openbot_controller "1|t" \
    "SELECT count(*) || '|' || CASE WHEN bool_and(terminated) THEN 't' ELSE 'f' END FROM public.openbot_ha_terminate_holder_sessions('node-a', NULL, 2000, '$E3')"
  expect_val "T18c confirm: old holder sessions = 0" openbot_controller "0" \
    "SELECT count(*) FROM public.openbot_ha_holder_sessions('node-a')"
  expect_val "T18d termination audited in writer_lease_audit" "$SU" "1" \
    "SELECT count(*) FROM public.writer_lease_audit WHERE action = 'terminate_session' AND execution_id = '$E3'"
fi
bg_stop
expect_err "T18e terminate rejects malformed holder_id" openbot_controller "P0001" \
  "SELECT * FROM public.openbot_ha_terminate_holder_sessions('node_a%', NULL);"
expect_err "T18f terminate refuses non-app roles" openbot_controller "P0001" \
  "SELECT * FROM public.openbot_ha_terminate_holder_sessions('node-a', 'openbot_controller');"

# ---- T19 steady-state timeouts on business roles ------------------------------
if [ "$SERVER_NUM" -ge 170000 ]; then
  expect_val "T19 transaction_timeout=30s set on openbot_app_a (PG>=17)" openbot_app_a "30s" "SHOW transaction_timeout"
else
  expect_val "T19 lock_timeout=3s set on openbot_app_a (PG<17: watchdog required for txn timeout)" openbot_app_a "3s" "SHOW lock_timeout"
fi

# ---- T20 final coverage + verify helpers --------------------------------------
if out=$("$HERE/check-coverage.sh" 2>&1); then ok "T20a final coverage PASS"; else bad "T20a final coverage" "$out"; fi
if out=$(psql_as "$SU" -v ON_ERROR_STOP=1 -f "$HERE/../checks/verify_helpers.sql" 2>&1); then ok "T20b verify_helpers.sql runs"; else bad "T20b verify_helpers.sql" "$out"; fi

echo "== smoke result: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
