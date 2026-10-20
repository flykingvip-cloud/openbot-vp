#!/usr/bin/env bash
# Persist and recover the Phase 2 Objective Shadow HMAC without printing it.
# Source of truth: macOS Keychain.
# Materialized inject: ~/.openbot/secrets/objective-shadow-hmac (mode 0600).
# The key never belongs in git, JSONL, window state, or reports.

set -euo pipefail

SERVICE="openbot.objective-shadow.hmac"
ACCOUNT="OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY"
SECRET_DIR="${HOME}/.openbot/secrets"
SECRET_FILE="${SECRET_DIR}/objective-shadow-hmac"

usage() {
  cat <<'EOF'
Usage:
  scripts/dev/objective-shadow-hmac-inject.sh ensure   Create keychain + 0600 file if missing
  scripts/dev/objective-shadow-hmac-inject.sh check    Verify keychain and file match (no print)
  scripts/dev/objective-shadow-hmac-inject.sh path     Print the key-file path only
EOF
}

umask 077

ensure() {
  mkdir -p "${SECRET_DIR}"
  chmod 700 "${SECRET_DIR}"
  local have_keychain=0
  if security find-generic-password -s "${SERVICE}" -a "${ACCOUNT}" >/dev/null 2>&1; then
    have_keychain=1
  fi
  if [[ "${have_keychain}" -eq 0 ]]; then
    local generated
    generated="$(openssl rand -hex 32)"
    security add-generic-password -s "${SERVICE}" -a "${ACCOUNT}" -w "${generated}" -U >/dev/null
    unset generated
  fi
  if [[ ! -s "${SECRET_FILE}" ]]; then
    security find-generic-password -s "${SERVICE}" -a "${ACCOUNT}" -w >"${SECRET_FILE}"
    chmod 600 "${SECRET_FILE}"
  fi
  chmod 600 "${SECRET_FILE}"
}

check() {
  if [[ ! -s "${SECRET_FILE}" ]]; then
    echo "missing_file" >&2
    return 1
  fi
  if ! security find-generic-password -s "${SERVICE}" -a "${ACCOUNT}" >/dev/null 2>&1; then
    echo "missing_keychain" >&2
    return 1
  fi
  local file_hash chain_hash
  file_hash="$(shasum -a 256 "${SECRET_FILE}" | awk '{print $1}')"
  chain_hash="$(security find-generic-password -s "${SERVICE}" -a "${ACCOUNT}" -w | shasum -a 256 | awk '{print $1}')"
  if [[ "${file_hash}" != "${chain_hash}" ]]; then
    echo "mismatch" >&2
    return 1
  fi
  echo "ok file_mode=$(stat -f '%Lp' "${SECRET_FILE}") keychain=${SERVICE}"
}

cmd="${1:-}"
case "${cmd}" in
  ensure) ensure && check ;;
  check) check ;;
  path) printf '%s\n' "${SECRET_FILE}" ;;
  *) usage >&2; exit 2 ;;
esac
