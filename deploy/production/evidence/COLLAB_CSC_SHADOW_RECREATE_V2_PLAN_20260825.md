# COLLAB CSC shadow-only recreate v2 — plan + isolated drill (2026-08-25)

PLAN + isolated drill ONLY. No production container was recreated, restarted, or
functionally modified; shadow was NOT enabled. Re-validates the "same LIVE image, only
OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1" recreate on the cleaned persistent env, and (Option A)
makes the recreate STRICTLY shadow-only.

- PLAN_ONLY: YES
- PRODUCTION_RECREATE: NO
- LIVE_TOUCHED: NO
- FLAGS_CHANGED: NO (runtime)
- SHADOW_ENABLED: NO
- PRODUCTION_CLOSEOUT: NOT_ACCEPTED

## Frozen baseline

- FROZEN_MAIN: `dbfe448e9110ea1bce51377d4803894c6a8ec557`
- LIVE_SHA: `a12e4c59e5754e0c280b423c68c989c6973ac9b0` (ancestor of FROZEN_MAIN: YES)
- LIVE image: `localhost/openbot:rc-amd64-provenance-a12e4c59e575`
- Container `openbot-gateway-rc`: StartedAt `2026-08-24 06:37:47 +0800` (unchanged), RestartCount 0
- healthz 200; readyz `{ready:true, failing:[]}`; runtime inbound/CSC/Context flags: all unset

## Permission gate — tightened, now PASS

`/root/.openbot/.env.docker` was `644` (world-readable) with secrets, so the gate was FAIL.
Under the authorized permission-tightening it was set to `600` (content sha `030f738f…`
unchanged, matching sibling `.env`); the running container was unaffected (StartedAt
unchanged, healthz 200). `ENV_FILE_PERMISSION_GATE=PASS`. Reversible via `chmod 644`. The v2
script enforces this gate and fails closed if the base env-file is world-readable with secrets.

## v2 script (strictly shadow-only)

`csc-shadow-recreate-v2.sh` (Appendix A), sha256 `bf28e11d8b36d91ab5c3427f328d86776296c0149aca8a0b8aae0531fe0a72e6`:
modes verify/plan/enable/rollback; `plan` derives network/user/restart/mounts/ports/command
from live `inspect`; image pinned to LIVE; base env-file must be clean and pass the permission
gate; `enable` writes a temp mode-600 env from the vetted base, dropping any shadow line and the
exclude keys (default `OPENBOT_PROGRESS_LEDGER_ENABLED`, overridable via `CSC_TEMP_ENV_EXCLUDE`)
and appending exactly `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1`; never edits `.env.docker`; a
"shadow-only diff vs runtime" guard requires every temp-env variable except the shadow key to
already exist in the running container (recreate introduces no new variable other than the shadow
flag); keeps a safety container; auto-rolls-back on recreate/health/identity/flag failure; the
temp env is deleted on success AND failure. Static: `bash -n` PASS, `shellcheck -S style` clean.

## Option A — progress-ledger drift resolved

The cleaned `.env.docker` still carried `OPENBOT_PROGRESS_LEDGER_ENABLED`, which the running
container does not have. Per operator decision (Option A), the temp env now also excludes that
key, so the recreate is strictly shadow-only. Confirmed on the real container by the read-only
`plan`: `shadow-only diff vs runtime: OK (only OPENBOT_CHAT_INBOUND_DEPTH_SHADOW added)`, and the
temp-env variable-name list no longer contains `OPENBOT_PROGRESS_LEDGER_ENABLED`.

## Isolated drill — DRILL_RESULT=PASS (49/49)

Run through an engine stand-in (fake podman/docker + curl + mktemp) on the authoring host — it
does NOT touch `openbot-gateway-rc` or any real container. Rationale: the authoring host is macOS
(Docker host-networking cannot serve loopback health) and failure injection (health failure, SHA
drift) is deterministic only with a stand-in. Covered: normal recreate (ENABLE_OK, safety kept);
recreate/health/SHA-drift auto-rollback (original restored, healthz 200); multi-flag + preset-shadow

- permission-gate rejected (no mutation); progress-ledger excluded (still strictly shadow-only);
  non-excluded extra var rejected as drift (no mutation); safety-missing fail-closed; temp-env deleted
  on success and failure. Full log in Appendix C.

## WS shadow-off baseline (re-verified; shadow NOT enabled)

Main Appendix E capture (tool sha `c5bd973b…`), 60s read-only, token from `OPENBOT_OPERATOR_TOKEN_FILE`:

```
AUTH=PASS  WS_CONNECT=PASS  SUBSCRIPTION_ACK=PASS
NON_DEPTH_EVENT_VISIBLE=YES  DEPTH_EVENTS=0  RAW_TEXT_LEAKS=0
DEVICE_REGISTERED=NO  LIVE_TOUCHED=NO  FLAGS_CHANGED=NO
CAPTURE_EXIT=0  SENSITIVE_FIELD_SCAN=PASS
```

## Next-stage admission (still gated on explicit enable authorization)

The permission gate is cleared and the plan is strictly shadow-only. The actual enable (same-SHA
recreate, seconds of chat interruption, auto-rollback, ROUTER/KNOWLEDGE/TOOL/PERSIST_EARLY/COLLAB/
CONTEXT_SCOPE kept off) still requires a separate explicit production-owner authorization.
`RELEASE_RECORD.md` and `releases.jsonl` are not modified by this stage.

## Appendix A — csc-shadow-recreate-v2.sh

```bash
#!/usr/bin/env bash
# csc-shadow-recreate-v2.sh
# Enable ONLY OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1 by recreating the gateway from
# the SAME LIVE image, deriving the full run spec from live `inspect` (no
# transcription). Safety: env-file permission+flag gate, rename-safety,
# health-gate, identity-drift guard, flag-verify, auto-rollback.
#
# Modes:  verify | plan | enable | rollback
# Engine: CONTAINER_ENGINE (podman on prod; docker for the isolated drill).
# Secrets: never printed. The temp env is mode 600 and removed on every exit.
set -uo pipefail

CLI="${CONTAINER_ENGINE:-podman}"
CONTAINER="${CSC_CONTAINER:-openbot-gateway-rc}"
IMAGE="${CSC_IMAGE:-localhost/openbot:rc-amd64-provenance-a12e4c59e575}"
ENV_FILE="${CSC_ENV_FILE:-/root/.openbot/.env.docker}"
HEALTH_URL="${CSC_HEALTH_URL:-http://127.0.0.1:18789/healthz}"
EXPECT_COMMIT="${CSC_EXPECT_COMMIT:-a12e4c59e5754e0c280b423c68c989c6973ac9b0}"
BUILD_INFO_PATH="${CSC_BUILD_INFO_PATH:-/app/dist/build-info.json}"
HEALTH_RETRIES="${CSC_HEALTH_RETRIES:-30}"

SHADOW_KEY="OPENBOT_CHAT_INBOUND_DEPTH_SHADOW"
SHADOW_LINE="${SHADOW_KEY}=1"
# Keys also dropped from the temp env so the recreate is STRICTLY shadow-only:
# present in the base env-file but NOT in the running container. Space-separated,
# overridable via CSC_TEMP_ENV_EXCLUDE.
TEMP_ENV_EXCLUDE="${CSC_TEMP_ENV_EXCLUDE:-OPENBOT_PROGRESS_LEDGER_ENABLED}"
# Any inbound/CSC/Context family assignment. Env lines are NAME=value, so a
# line-start prefix match on the NAME is correct (a trailing '=' right after the
# prefix would wrongly require e.g. `OPENBOT_CHAT_INBOUND_=`).
FAMILY_FLAG_RE='^(OPENBOT_CHAT_INBOUND_|OPENBOT_COLLAB|CONTEXT_SCOPE)'
SENSITIVE_NAME_RE='TOKEN|SECRET|PASSWORD|PASS|API_?KEY|PRIVATE_KEY|CREDENTIAL'

TS="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_ENV=""
RUN_ARGV=()

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
cleanup_tmp() {
  if [ -n "$TMP_ENV" ] && [ -f "$TMP_ENV" ]; then
    rm -f "$TMP_ENV"
    log "temp env removed"
  fi
  TMP_ENV=""
}
trap cleanup_tmp EXIT
die() { log "FATAL: $*"; exit 1; }

# GNU stat (-c) with BSD (-f) fallback so the drill runs on macOS too.
file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null; }

live_commit() {
  "$CLI" exec "$CONTAINER" cat "$BUILD_INFO_PATH" 2>/dev/null | grep -oE '[0-9a-f]{40}' | head -1
}

health_ok() {
  local i code
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    code="$(curl -fsS -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || true)"
    if [ "$code" = "200" ]; then return 0; fi
    sleep 1
  done
  return 1
}

container_exists() { "$CLI" container inspect "$1" >/dev/null 2>&1; }

runtime_flags() {
  "$CLI" exec "$CONTAINER" printenv 2>/dev/null | grep -E "$FAMILY_FLAG_RE" | sort
}

runtime_var_names() {
  "$CLI" exec "$CONTAINER" printenv 2>/dev/null | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' | sort -u
}

# Guarantee strictly shadow-only: every variable in the temp env except the
# shadow key must already exist in the running container (i.e. the recreate
# introduces no new variable other than the shadow flag).
assert_shadow_only() {
  local tmp="$1" rt_names tmp_names extra
  rt_names="$(runtime_var_names)"
  tmp_names="$(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$tmp" | grep -vxF "$SHADOW_KEY" | sort -u)"
  extra="$(comm -23 <(printf '%s\n' "$tmp_names") <(printf '%s\n' "$rt_names"))"
  if [ -n "$extra" ]; then
    log "temp env would introduce variables absent from the running container:"
    printf '  %s\n' "$extra"
    die "not strictly shadow-only: temp env introduces non-shadow variables absent from runtime"
  fi
  log "shadow-only diff vs runtime: OK (only ${SHADOW_KEY} added)"
}

# Refuse unless the env-file is clean (no preset shadow, no other inbound/CSC
# flags) and not world-readable while holding secrets (permission gate).
assert_env_file_safe() {
  [ -f "$ENV_FILE" ] || die "env-file not found: $ENV_FILE"
  if grep -nE "^${SHADOW_KEY}=" "$ENV_FILE" >/dev/null 2>&1; then
    die "env-file already defines ${SHADOW_KEY}; base must be clean (enable adds it to a temp env)"
  fi
  if grep -E "$FAMILY_FLAG_RE" "$ENV_FILE" | grep -vE "^${SHADOW_KEY}=" | grep -qE '.'; then
    die "env-file carries prohibited inbound/CSC/Context flags; refusing"
  fi
  local mode sens
  mode="$(file_mode "$ENV_FILE")"
  sens="$(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$ENV_FILE" | grep -iE "$SENSITIVE_NAME_RE" | tr '\n' ' ')"
  case "$mode" in
    *[4-7])
      if [ -n "$sens" ]; then
        die "ENV_FILE_PERMISSION_GATE=FAIL: $ENV_FILE mode=$mode is world-readable and holds sensitive keys ($sens); tighten to 600 first"
      fi
      ;;
  esac
  log "env-file gate PASS (mode=$mode; no prohibited inbound flags)"
}

# Reconstruct the run argv from live inspect (network/user/restart/mounts/ports/cmd).
build_run_argv() {
  local run_env_file="$1"
  local net user restart mounts_n cmd_n i src dst rw ports_raw pb hp cp
  net="$("$CLI" inspect "$CONTAINER" --format '{{.HostConfig.NetworkMode}}')"
  user="$("$CLI" inspect "$CONTAINER" --format '{{.Config.User}}')"
  restart="$("$CLI" inspect "$CONTAINER" --format '{{.HostConfig.RestartPolicy.Name}}')"
  RUN_ARGV=(run -d --name "$CONTAINER")
  case "$net" in
    "" | default | bridge) : ;;
    *) RUN_ARGV+=(--network "$net") ;;
  esac
  [ -n "$user" ] && RUN_ARGV+=(--user "$user")
  [ -n "$restart" ] && [ "$restart" != "no" ] && RUN_ARGV+=(--restart "$restart")
  mounts_n="$("$CLI" inspect "$CONTAINER" --format '{{len .Mounts}}')"
  for ((i = 0; i < mounts_n; i++)); do
    src="$("$CLI" inspect "$CONTAINER" --format "{{ (index .Mounts $i).Source }}")"
    dst="$("$CLI" inspect "$CONTAINER" --format "{{ (index .Mounts $i).Destination }}")"
    rw="$("$CLI" inspect "$CONTAINER" --format "{{ (index .Mounts $i).RW }}")"
    if [ "$rw" = "true" ]; then
      RUN_ARGV+=(-v "${src}:${dst}:rw")
    else
      RUN_ARGV+=(-v "${src}:${dst}:ro")
    fi
  done
  # shellcheck disable=SC2016  # $p/$c are Go-template variables for `inspect --format`; they must stay literal, not shell-expanded
  ports_raw="$("$CLI" inspect "$CONTAINER" --format '{{range $p, $c := .HostConfig.PortBindings}}{{if $c}}{{(index $c 0).HostPort}}:{{$p}} {{end}}{{end}}' 2>/dev/null || true)"
  # shellcheck disable=SC2206  # intentional word-split of space-separated "hostport:containerport/proto" tokens
  local port_arr=($ports_raw)
  if [ "${#port_arr[@]}" -gt 0 ]; then
    for pb in "${port_arr[@]}"; do
      hp="${pb%%:*}"
      cp="${pb#*:}"
      cp="${cp%%/*}"
      [ -n "$hp" ] && [ -n "$cp" ] && RUN_ARGV+=(-p "${hp}:${cp}")
    done
  fi
  RUN_ARGV+=(--env-file "$run_env_file" "$IMAGE")
  cmd_n="$("$CLI" inspect "$CONTAINER" --format '{{len .Config.Cmd}}')"
  for ((i = 0; i < cmd_n; i++)); do
    RUN_ARGV+=("$("$CLI" inspect "$CONTAINER" --format "{{ index .Config.Cmd $i }}")")
  done
}

# Build the temp env from the vetted env-file: strip any shadow line and the
# exclude keys (to match runtime), then append exactly one shadow line.
make_temp_env() {
  assert_env_file_safe
  TMP_ENV="$(mktemp)"
  chmod 600 "$TMP_ENV"
  local excl_re="^${SHADOW_KEY}=" k
  # shellcheck disable=SC2206  # intentional word-split of space-separated key list
  local excl_arr=($TEMP_ENV_EXCLUDE)
  for k in ${excl_arr[@]+"${excl_arr[@]}"}; do excl_re="${excl_re}|^${k}="; done
  grep -vE "$excl_re" "$ENV_FILE" >"$TMP_ENV"
  printf '%s\n' "$SHADOW_LINE" >>"$TMP_ENV"
  if grep -E "$FAMILY_FLAG_RE" "$TMP_ENV" | grep -vE "^${SHADOW_KEY}=1$" | grep -qE '.'; then
    die "temp env contains prohibited flags"
  fi
  local sh_count fam_count mode
  sh_count="$(grep -cE "^${SHADOW_KEY}=1$" "$TMP_ENV")"
  fam_count="$(grep -cE "$FAMILY_FLAG_RE" "$TMP_ENV")"
  [ "$sh_count" = "1" ] || die "temp env: shadow flag count != 1 (got $sh_count)"
  [ "$fam_count" = "1" ] || die "temp env: unexpected extra inbound keys (count=$fam_count)"
  mode="$(file_mode "$TMP_ENV")"
  [ "$mode" = "600" ] || die "temp env not mode 600 (got $mode)"
  assert_shadow_only "$TMP_ENV"
  log "temp env prepared: mode 600, shadow-only (1 inbound key)"
}

do_verify() {
  local c rt
  c="$(live_commit)"
  log "live build-info commit=${c:-<none>}"
  [ "$c" = "$EXPECT_COMMIT" ] || die "LIVE commit mismatch (got '${c}', want '${EXPECT_COMMIT}')"
  if health_ok; then log "healthz 200"; else die "healthz not 200 at $HEALTH_URL"; fi
  rt="$(runtime_flags || true)"
  if [ -n "$rt" ]; then
    log "runtime inbound/CSC flags present:"
    printf '%s\n' "$rt"
    die "runtime already carries inbound/CSC/Context flags"
  fi
  log "runtime inbound/CSC/Context flags: none"
  assert_env_file_safe
  log "VERIFY_OK"
}

do_plan() {
  do_verify
  # build + validate the REAL temp env (incl shadow-only diff vs runtime); no container change
  make_temp_env
  build_run_argv "<TEMP_MODE600_ENV derived from ${ENV_FILE}>"
  log "reconstructed recreate command (from live inspect; no env values):"
  printf '   %s' "$CLI"
  printf ' %q' "${RUN_ARGV[@]}"
  printf '\n'
  log "temp env variable NAMES (values NOT shown):"
  sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/  \1/p' "$TMP_ENV" | sort
  cleanup_tmp
  log "PLAN_OK (no changes made)"
}

rollback_to() {
  local safety="$1"
  log "[rollback] restoring '$safety' -> '$CONTAINER'"
  "$CLI" rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if ! container_exists "$safety"; then
    log "FATAL: safety container '$safety' missing; MANUAL RECOVERY REQUIRED"
    return 1
  fi
  "$CLI" rename "$safety" "$CONTAINER" || { log "FATAL: rename-back failed"; return 1; }
  "$CLI" start "$CONTAINER" >/dev/null 2>&1 || { log "FATAL: start after rollback failed"; return 1; }
  if health_ok; then log "ROLLBACK_OK healthz 200"; return 0; else log "FATAL: rollback health failed"; return 1; fi
}

do_enable() {
  do_verify
  make_temp_env
  build_run_argv "$TMP_ENV"
  local safety="${CONTAINER}-prev-preshadow-${TS}"
  "$CLI" stop "$CONTAINER" >/dev/null 2>&1 || die "stop failed (no change; container still '$CONTAINER')"
  if ! "$CLI" rename "$CONTAINER" "$safety"; then
    "$CLI" start "$CONTAINER" >/dev/null 2>&1 || true
    die "rename to safety failed; restarted original"
  fi
  log "stopped and renamed live -> $safety"
  if ! "$CLI" "${RUN_ARGV[@]}" >/dev/null 2>&1; then
    log "recreate failed; auto-rollback"
    rollback_to "$safety" || true
    die "recreate failed; rolled back"
  fi
  log "recreated '$CONTAINER' from $IMAGE with temp env (shadow-only)"
  if ! health_ok; then
    log "health failed; auto-rollback"
    rollback_to "$safety" || true
    die "health failed; rolled back"
  fi
  local c rt bad
  c="$(live_commit)"
  if [ "$c" != "$EXPECT_COMMIT" ]; then
    log "identity drift (got '$c'); auto-rollback"
    rollback_to "$safety" || true
    die "identity drift; rolled back"
  fi
  rt="$(runtime_flags || true)"
  bad="$(printf '%s\n' "$rt" | grep -vE "^${SHADOW_KEY}=1$" | grep -E '.' || true)"
  if [ -n "$bad" ]; then
    log "unexpected flags after recreate:"
    printf '%s\n' "$bad"
    rollback_to "$safety" || true
    die "flag verify failed; rolled back"
  fi
  if ! printf '%s\n' "$rt" | grep -qE "^${SHADOW_KEY}=1$"; then
    rollback_to "$safety" || true
    die "shadow flag not set after recreate; rolled back"
  fi
  cleanup_tmp
  log "ENABLE_OK (shadow-only); safety container kept: $safety"
}

do_rollback() {
  local safety
  safety="$("$CLI" ps -a --format '{{.Names}}' | grep -E "^${CONTAINER}-prev-preshadow-" | sort | tail -1 || true)"
  [ -n "$safety" ] || die "no safety container found (${CONTAINER}-prev-preshadow-*)"
  rollback_to "$safety" || die "rollback failed"
  log "ROLLBACK complete from $safety"
}

main() {
  local mode="${1:-}"
  case "$mode" in
    verify) do_verify ;;
    plan) do_plan ;;
    enable) do_enable ;;
    rollback) do_rollback ;;
    *) die "usage: CONTAINER_ENGINE=podman $0 {verify|plan|enable|rollback}" ;;
  esac
}
main "$@"
```

## Appendix B.1 — drill/fakeengine (engine stand-in)

```bash
#!/usr/bin/env bash
# Engine stand-in for the isolated drill. Implements the subset of podman/docker
# subcommands csc-shadow-recreate-v2.sh uses, backed by a state dir. Deterministic
# failure injection via CSC_DRILL_SCENARIO. NEVER touches real containers.
set -uo pipefail
STATE="${FAKE_STATE:?}"
EXPECT="${FAKE_EXPECT_COMMIT:-a12e4c59e5754e0c280b423c68c989c6973ac9b0}"
SCEN="${CSC_DRILL_SCENARIO:-normal}"
mkdir -p "$STATE"
getattr() { grep -E "^$2=" "$STATE/$1" 2>/dev/null | head -1 | cut -d= -f2-; }

cmd="${1:-}"
shift || true
case "$cmd" in
  run)
    name=""; envfile=""; image=""
    args=("$@"); i=0
    while [ "$i" -lt "${#args[@]}" ]; do
      a="${args[$i]}"
      case "$a" in
        --name) i=$((i + 1)); name="${args[$i]}" ;;
        --env-file) i=$((i + 1)); envfile="${args[$i]}" ;;
        --network | --user | --restart | -v | -p | -e) i=$((i + 1)) ;;
        -d) : ;;
        *) image="$a" ;;
      esac
      i=$((i + 1))
    done
    [ "$SCEN" = recreate_fail ] && { echo "fakeengine: simulated recreate failure" >&2; exit 1; }
    commit="$EXPECT"; [ "$SCEN" = sha_drift ] && commit="dr1ftdr1ftdr1ftdr1ftdr1ftdr1ftdr1ftdr1ft"
    health="ok"; [ "$SCEN" = health_fail ] && health="fail"
    { echo "image=$image"; echo "envfile=$envfile"; echo "commit=$commit"; echo "health=$health"; echo "status=running"; } >"$STATE/$name"
    echo "fake-id-$name"
    ;;
  stop)
    f="$STATE/${1:?}"
    [ -f "$f" ] && { grep -v '^status=' "$f" >"$f.t"; echo "status=stopped" >>"$f.t"; mv "$f.t" "$f"; }
    exit 0
    ;;
  rename)
    [ -f "$STATE/${1:?}" ] || exit 1
    mv "$STATE/$1" "$STATE/${2:?}"; exit 0
    ;;
  rm)
    for a in "$@"; do [ "$a" = "-f" ] && continue; rm -f "$STATE/$a"; done; exit 0
    ;;
  container)
    sub="${1:?}"; shift
    [ "$sub" = inspect ] && { [ -f "$STATE/${1:?}" ] && exit 0 || exit 1; }
    exit 0
    ;;
  ps)
    ls -1 "$STATE" 2>/dev/null | grep -vE '\.(t|bak)$' || true
    exit 0
    ;;
  inspect)
    name="${1:?}"; shift; fmt=""
    while [ "$#" -gt 0 ]; do [ "$1" = --format ] && { fmt="${2:-}"; shift 2; continue; }; shift; done
    [ -f "$STATE/$name" ] || exit 1
    case "$fmt" in
      *NetworkMode*) echo "bridge" ;;
      *RestartPolicy*) echo "always" ;;
      *Config.User*) echo "0" ;;
      *Config.Cmd*) echo "0" ;;
      *.Mounts*) echo "0" ;;
      *PortBindings*) echo "" ;;
      *) echo "" ;;
    esac
    ;;
  exec)
    name="${1:?}"; shift
    if [ "${1:-}" = cat ]; then echo "{\"commit\":\"$(getattr "$name" commit)\"}"; exit 0; fi
    if [ "${1:-}" = printenv ]; then ef="$(getattr "$name" envfile)"; [ -f "$ef" ] && cat "$ef"; exit 0; fi
    exit 0
    ;;
  *) echo "fakeengine: unsupported '$cmd'" >&2; exit 2 ;;
esac
```

## Appendix B.2 — drill/curl (health stand-in)

```bash
#!/usr/bin/env bash
# curl stand-in for the drill: reports health of CSC_CONTAINER from FAKE_STATE.
# Emulates `-w '%{http_code}'` (prints code) and `-f` (exit 22 on HTTP >= 400).
STATE="${FAKE_STATE:?}"
name="${CSC_CONTAINER:?}"
h="$(grep -E '^health=' "$STATE/$name" 2>/dev/null | head -1 | cut -d= -f2-)"
if [ "$h" = "ok" ]; then
  printf '200'
  exit 0
fi
printf '500'
exit 22
```

## Appendix B.3 — drill/mktemp (temp-file capture stand-in)

```bash
#!/usr/bin/env bash
# mktemp stand-in for the drill: creates a real temp file in MKTEMP_CAP and
# records its path so the drill can assert the script deletes it.
CAP="${MKTEMP_CAP:?}"
mkdir -p "$CAP"
f="$CAP/tmp.$$.${RANDOM}${RANDOM}"
: >"$f"
echo "$f" >>"$CAP/paths.log"
echo "$f"
```

## Appendix B.4 — drill/run-drill.sh (scenarios + assertions)

```bash
#!/usr/bin/env bash
# Isolated control-flow drill for csc-shadow-recreate-v2.sh via an engine stand-in.
# Does NOT touch openbot-gateway-rc or any real container/engine.
set -uo pipefail
HERE="/tmp/csc/drill"
SCRIPT="/tmp/csc/csc-shadow-recreate-v2.sh"
EXPECT="a12e4c59e5754e0c280b423c68c989c6973ac9b0"
IMAGE="localhost/openbot:rc-amd64-provenance-a12e4c59e575"
export FAKE_EXPECT_COMMIT="$EXPECT"
chmod +x "$HERE/fakeengine" "$HERE/curl" "$HERE/mktemp"

# env-file fixtures
printf 'NODE_ENV=production\nOPENBOT_STATE_DIR=/root/.openbot\nOPENBOT_GATEWAY_TOKEN=REDACTEDVALUE\n' >"$HERE/env-clean"; chmod 600 "$HERE/env-clean"
printf 'NODE_ENV=production\nOPENBOT_CHAT_INBOUND_DEPTH_ROUTER=1\n' >"$HERE/env-multiflag"; chmod 600 "$HERE/env-multiflag"
printf 'NODE_ENV=production\nOPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1\n' >"$HERE/env-preset"; chmod 600 "$HERE/env-preset"
printf 'NODE_ENV=production\nOPENBOT_GATEWAY_TOKEN=REDACTEDVALUE\n' >"$HERE/env-perm644"; chmod 644 "$HERE/env-perm644"
printf 'NODE_ENV=production\nOPENBOT_STATE_DIR=/root/.openbot\nOPENBOT_GATEWAY_TOKEN=REDACTEDVALUE\nOPENBOT_PROGRESS_LEDGER_ENABLED=1\n' >"$HERE/env-ledger"; chmod 600 "$HERE/env-ledger"
printf 'NODE_ENV=production\nOPENBOT_STATE_DIR=/root/.openbot\nOPENBOT_GATEWAY_TOKEN=REDACTEDVALUE\nWIDGET_X=1\n' >"$HERE/env-extra"; chmod 600 "$HERE/env-extra"

PASS=0; FAIL=0
seed() { # statedir envfile  -> original healthy container at EXPECT
  rm -rf "$1"; mkdir -p "$1"
  { echo "image=$IMAGE"; echo "envfile=$2"; echo "commit=$EXPECT"; echo "health=ok"; echo "status=running"; } >"$1/openbot-gateway-rc"
}
check() { # label cond(0/1) detail
  if [ "$2" = "0" ]; then echo "  PASS: $1"; PASS=$((PASS + 1)); else echo "  FAIL: $1 ($3)"; FAIL=$((FAIL + 1)); fi
}

run() { # label scenario mode envfile expect(pass|fail) needle {seed_safety?}
  local label="$1" scen="$2" mode="$3" envf="$4" expect="$5" needle="$6" seedsafety="${7:-no}"
  local sd cap out rc leftover p
  sd="$HERE/state-$label"; cap="$HERE/cap-$label"
  # running container always has a CLEAN env; $envf is only the base env-file under test
  seed "$sd" "$HERE/env-clean"
  rm -rf "$cap"; mkdir -p "$cap"
  [ "$seedsafety" = "yes" ] || rm -f "$sd"/*prev-preshadow* 2>/dev/null
  echo "== $label (scenario=$scen mode=$mode) =="
  out="$(CONTAINER_ENGINE="$HERE/fakeengine" FAKE_STATE="$sd" CSC_DRILL_SCENARIO="$scen" \
    CSC_CONTAINER="openbot-gateway-rc" CSC_IMAGE="$IMAGE" CSC_ENV_FILE="$envf" \
    CSC_HEALTH_URL="http://127.0.0.1:18789/healthz" CSC_EXPECT_COMMIT="$EXPECT" \
    CSC_BUILD_INFO_PATH="/app/dist/build-info.json" CSC_HEALTH_RETRIES=2 \
    MKTEMP_CAP="$cap" PATH="$HERE:$PATH" bash "$SCRIPT" "$mode" 2>&1)"
  rc=$?
  # exit expectation
  if [ "$expect" = "pass" ]; then [ "$rc" = "0" ] && check "exit 0" 0 || check "exit 0" 1 "rc=$rc"; else [ "$rc" != "0" ] && check "nonzero exit" 0 || check "nonzero exit" 1 "rc=$rc"; fi
  # needle
  printf '%s\n' "$out" | grep -qE "$needle" && check "log contains /$needle/" 0 || check "log contains /$needle/" 1 "missing"
  # temp env cleaned: every mktemp'd path must be deleted
  leftover=0
  if [ -f "$cap/paths.log" ]; then while read -r p; do [ -e "$p" ] && leftover=$((leftover + 1)); done <"$cap/paths.log"; fi
  [ "$leftover" = "0" ] && check "temp env cleaned (all mktemp files deleted)" 0 || check "temp env cleaned" 1 "leftover=$leftover"
  RUN_OUT="$out"; RUN_SD="$sd"
}

restored_ok() { # assert original restored healthy, no safety leftover
  local c h safety
  c="$(grep -E '^commit=' "$RUN_SD/openbot-gateway-rc" 2>/dev/null | cut -d= -f2-)"
  h="$(grep -E '^health=' "$RUN_SD/openbot-gateway-rc" 2>/dev/null | cut -d= -f2-)"
  safety="$(ls -1 "$RUN_SD" 2>/dev/null | grep -c 'prev-preshadow' || true)"
  { [ "$c" = "$EXPECT" ] && [ "$h" = "ok" ]; } && check "original restored (commit=EXPECT, health=ok)" 0 || check "original restored" 1 "commit=$c health=$h"
  [ "$safety" = "0" ] && check "no safety leftover after rollback" 0 || check "no safety leftover" 1 "count=$safety"
}
unchanged_ok() { # assert no mutation (gate rejected before any change)
  local safety
  safety="$(ls -1 "$RUN_SD" 2>/dev/null | grep -c 'prev-preshadow' || true)"
  [ -f "$RUN_SD/openbot-gateway-rc" ] && [ "$safety" = "0" ] && check "state unchanged (no stop/rename/safety)" 0 || check "state unchanged" 1 "safety=$safety"
}

echo "################ csc-shadow-recreate-v2 isolated drill ################"
run "verify-normal"   normal        verify   "$HERE/env-clean"    pass "VERIFY_OK"
run "plan-normal"     normal        plan     "$HERE/env-clean"    pass "PLAN_OK"; unchanged_ok
run "enable-normal"   normal        enable   "$HERE/env-clean"    pass "ENABLE_OK \(shadow-only\)"
  ls -1 "$RUN_SD" | grep -q 'prev-preshadow' && check "safety container kept after enable" 0 || check "safety kept" 1 "none"
run "recreate-fail"   recreate_fail enable   "$HERE/env-clean"    fail "recreate failed; rolled back"; restored_ok
run "health-fail"     health_fail   enable   "$HERE/env-clean"    fail "health failed; rolled back"; restored_ok
run "sha-drift"       sha_drift     enable   "$HERE/env-clean"    fail "identity drift; rolled back"; restored_ok
run "multi-flag"      normal        enable   "$HERE/env-multiflag" fail "prohibited inbound"; unchanged_ok
run "preset-shadow"   normal        enable   "$HERE/env-preset"   fail "already defines"; unchanged_ok
run "perm-gate-fail"  normal        enable   "$HERE/env-perm644"  fail "ENV_FILE_PERMISSION_GATE=FAIL"; unchanged_ok
run "ledger-excluded" normal        enable   "$HERE/env-ledger"   pass "ENABLE_OK \(shadow-only\)"
  printf '%s\n' "$RUN_OUT" | grep -q "shadow-only diff vs runtime: OK" && check "progress-ledger excluded (strictly shadow-only)" 0 || check "progress-ledger excluded" 1 "no shadow-only-OK log"
run "extra-var-drift" normal        enable   "$HERE/env-extra"    fail "not strictly shadow-only"; unchanged_ok
# safety-missing fail-closed: rollback with no safety present
run "safety-missing"  normal        rollback "$HERE/env-clean"   fail "no safety container found"

echo "################ DRILL SUMMARY: PASS=$PASS FAIL=$FAIL ################"
[ "$FAIL" = "0" ] && echo "DRILL_RESULT=PASS" || echo "DRILL_RESULT=FAIL"
```

## Appendix C — drill output

```
### bash -n
BASH_N=PASS
### shellcheck
SHELLCHECK=PASS

### drill
################ csc-shadow-recreate-v2 isolated drill ################
== verify-normal (scenario=normal mode=verify) ==
  PASS: exit 0
  PASS: log contains /VERIFY_OK/
  PASS: temp env cleaned (all mktemp files deleted)
== plan-normal (scenario=normal mode=plan) ==
  PASS: exit 0
  PASS: log contains /PLAN_OK/
  PASS: temp env cleaned (all mktemp files deleted)
  PASS: state unchanged (no stop/rename/safety)
== enable-normal (scenario=normal mode=enable) ==
  PASS: exit 0
  PASS: log contains /ENABLE_OK \(shadow-only\)/
  PASS: temp env cleaned (all mktemp files deleted)
  PASS: safety container kept after enable
== recreate-fail (scenario=recreate_fail mode=enable) ==
  PASS: nonzero exit
  PASS: log contains /recreate failed; rolled back/
  PASS: temp env cleaned (all mktemp files deleted)
  PASS: original restored (commit=EXPECT, health=ok)
  PASS: no safety leftover after rollback
== health-fail (scenario=health_fail mode=enable) ==
  PASS: nonzero exit
  PASS: log contains /health failed; rolled back/
  PASS: temp env cleaned (all mktemp files deleted)
  PASS: original restored (commit=EXPECT, health=ok)
  PASS: no safety leftover after rollback
== sha-drift (scenario=sha_drift mode=enable) ==
  PASS: nonzero exit
  PASS: log contains /identity drift; rolled back/
  PASS: temp env cleaned (all mktemp files deleted)
  PASS: original restored (commit=EXPECT, health=ok)
  PASS: no safety leftover after rollback
== multi-flag (scenario=normal mode=enable) ==
  PASS: nonzero exit
  PASS: log contains /prohibited inbound/
  PASS: temp env cleaned (all mktemp files deleted)
  PASS: state unchanged (no stop/rename/safety)
== preset-shadow (scenario=normal mode=enable) ==
  PASS: nonzero exit
  PASS: log contains /already defines/
  PASS: temp env cleaned (all mktemp files deleted)
  PASS: state unchanged (no stop/rename/safety)
== perm-gate-fail (scenario=normal mode=enable) ==
  PASS: nonzero exit
  PASS: log contains /ENV_FILE_PERMISSION_GATE=FAIL/
  PASS: temp env cleaned (all mktemp files deleted)
  PASS: state unchanged (no stop/rename/safety)
== ledger-excluded (scenario=normal mode=enable) ==
  PASS: exit 0
  PASS: log contains /ENABLE_OK \(shadow-only\)/
  PASS: temp env cleaned (all mktemp files deleted)
  PASS: progress-ledger excluded (strictly shadow-only)
== extra-var-drift (scenario=normal mode=enable) ==
  PASS: nonzero exit
  PASS: log contains /not strictly shadow-only/
  PASS: temp env cleaned (all mktemp files deleted)
  PASS: state unchanged (no stop/rename/safety)
== safety-missing (scenario=normal mode=rollback) ==
  PASS: nonzero exit
  PASS: log contains /no safety container found/
  PASS: temp env cleaned (all mktemp files deleted)
################ DRILL SUMMARY: PASS=49 FAIL=0 ################
DRILL_RESULT=PASS
```
