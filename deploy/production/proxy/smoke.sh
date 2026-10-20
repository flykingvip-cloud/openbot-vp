#!/usr/bin/env bash
#
# Wave 2 edge smoke tests.
# Usage:
#   ./smoke.sh --local-only
#   ./smoke.sh --base-url https://admin.openbot.love
#   ./smoke.sh --base-url https://admin.staging.example.com --gateway http://127.0.0.1:18789
#
set -euo pipefail

BASE_URL=""
GATEWAY_URL="http://127.0.0.1:18789"
LOCAL_ONLY=0
STRICT_JSON=1

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    --gateway) GATEWAY_URL="${2:-}"; shift 2 ;;
    --local-only) LOCAL_ONLY=1; shift ;;
    --help|-h) usage ;;
    *) echo "Unknown arg: $1" >&2; usage ;;
  esac
done

if [[ "$LOCAL_ONLY" -eq 0 && -z "$BASE_URL" ]]; then
  echo "Provide --base-url or --local-only" >&2
  usage
fi

PASS=0
FAIL=0
warn() { printf 'WARN  %s\n' "$*" >&2; }
ok() { printf 'PASS  %s\n' "$*"; PASS=$((PASS + 1)); }
bad() { printf 'FAIL  %s\n' "$*" >&2; FAIL=$((FAIL + 1)); }

# $1 name, $2 url, $3 optional curl args...
check_http() {
  local name="$1"
  local url="$2"
  shift 2
  local code body_file
  body_file="$(mktemp)"
  code="$(curl -sS -o "$body_file" -w '%{http_code}' --connect-timeout 5 --max-time 30 "$@" "$url" || echo "000")"
  if [[ "$code" == "200" || "$code" == "401" || "$code" == "400" || "$code" == "405" ]]; then
    # 401/400 on login with empty body still proves gateway JSON path (not nginx HTML 404)
    if [[ "$STRICT_JSON" -eq 1 ]]; then
      if head -c 200 "$body_file" | grep -q '{'; then
        ok "$name → HTTP $code (JSON-ish)"
      elif [[ "$code" == "200" ]]; then
        # healthz may be plain ok
        ok "$name → HTTP $code"
      else
        bad "$name → HTTP $code but body not JSON (first bytes: $(head -c 80 "$body_file" | tr '\n' ' '))"
      fi
    else
      ok "$name → HTTP $code"
    fi
  else
    bad "$name → HTTP $code (url=$url) body=$(head -c 120 "$body_file" | tr '\n' ' ')"
  fi
  rm -f "$body_file"
}

echo "== Wave 2 smoke =="
echo "gateway: $GATEWAY_URL"
[[ -n "$BASE_URL" ]] && echo "edge:    $BASE_URL"
echo

# --- Local gateway ---
check_http "local /healthz" "${GATEWAY_URL}/healthz" || true
STRICT_JSON=0
check_http "local /readyz" "${GATEWAY_URL}/readyz" || true
STRICT_JSON=1

# control-ui-config may be under /__openbot/
check_http "local control-ui-config" "${GATEWAY_URL}/__openbot/control-ui-config.json" || true

# Empty login should still hit platform-auth handler (JSON), not missing route
body_file="$(mktemp)"
code="$(curl -sS -o "$body_file" -w '%{http_code}' --connect-timeout 5 --max-time 30 \
  -X POST -H 'Content-Type: application/json' -d '{}' \
  "${GATEWAY_URL}/__openbot/platform-auth/login" || echo "000")"
if [[ "$code" == "404" ]] && head -c 200 "$body_file" | grep -qi 'not found\|html'; then
  bad "local platform-auth/login → $code HTML (gateway not serving /__openbot)"
elif [[ "$code" == "000" ]]; then
  bad "local platform-auth/login → unreachable"
elif head -c 200 "$body_file" | grep -q '{'; then
  ok "local platform-auth/login → HTTP $code (JSON handler)"
else
  warn "local platform-auth/login → HTTP $code (check platformAuth.enabled)"
  # Not always FAIL: auth may be disabled in pure token mode
fi
rm -f "$body_file"

if [[ "$LOCAL_ONLY" -eq 1 ]]; then
  echo
  echo "Summary: PASS=$PASS FAIL=$FAIL (local-only)"
  [[ "$FAIL" -eq 0 ]]
  exit $?
fi

# --- Public edge ---
check_http "edge SPA /" "${BASE_URL}/" || true
check_http "edge control-ui-config" "${BASE_URL}/__openbot/control-ui-config.json" || true

body_file="$(mktemp)"
code="$(curl -sS -o "$body_file" -w '%{http_code}' --connect-timeout 5 --max-time 30 \
  -X POST -H 'Content-Type: application/json' -d '{}' \
  "${BASE_URL}/__openbot/platform-auth/login" || echo "000")"
if [[ "$code" == "404" ]] && head -c 400 "$body_file" | grep -qi 'nginx\|not found'; then
  bad "edge platform-auth/login → nginx 404 (proxy /__openbot missing)"
elif head -c 200 "$body_file" | grep -q '{'; then
  ok "edge platform-auth/login → HTTP $code (JSON)"
else
  bad "edge platform-auth/login → HTTP $code body=$(head -c 100 "$body_file" | tr '\n' ' ')"
fi
rm -f "$body_file"

# Optional: other origins if BASE_URL is admin — best-effort sibling hosts
if [[ "$BASE_URL" == *admin.* ]]; then
  for sibling in biz gw; do
    sib="${BASE_URL/admin./${sibling}.}"
    code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 15 "${sib}/" || echo "000")"
    if [[ "$code" == "200" || "$code" == "301" || "$code" == "302" ]]; then
      ok "sibling ${sibling} / → HTTP $code"
    else
      warn "sibling ${sibling} / → HTTP $code (optional until DNS ready)"
    fi
  done
fi

echo
echo "Summary: PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "See deploy/production/proxy/README.md red lines." >&2
  exit 1
fi
exit 0
