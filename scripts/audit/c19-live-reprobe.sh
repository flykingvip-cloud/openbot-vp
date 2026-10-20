#!/usr/bin/env bash
# Operator entrypoint for Codex C19 live re-probe.
#
# OPENBOT_CONTROLLED_AUDIT_STORE must be a full OpenBot stateDir controlled
# read-only snapshot root (NOT a tenants/<tenant> subtree alone).
#
# Expected layout:
#   <controlled-audit-store>/
#   ├── agents/
#   ├── tenants/<SAMPLE_TENANT>/users/<SAMPLE_USER>/
#   ├── canvas/                 (may be empty)
#   └── skills/                 (may be empty)
#
# Required env (export before invoking — do not rely on one-shot VAR=val
# prefixes when redirecting with ${EVIDENCE_ID}):
#   OPENBOT_CONTROLLED_AUDIT_STORE
#   SAMPLE_TENANT
#   SAMPLE_USER
#
# Optional env:
#   EVIDENCE_ID=workspace-isolation-YYYYMMDD-c19-live
#   PROBE_AT=<ISO>                  default: now UTC second precision
#   RECENT_DAYS=14
#   OPENBOT_C19_BINDING_MANIFEST    durable A/B/C role manifest (recommended)
#   OUT_DIR=/tmp/c19-live           also write raw + summary files there
#
# Production discovery (do not guess from docs alone):
#   printenv OPENBOT_STATE_DIR
#   printenv OPENBOT_TENANTS_ROOT
#   OPENBOT_CONTROLLED_AUDIT_STORE = OPENBOT_STATE_DIR snapshot root
#   OPENBOT_TENANTS_ROOT           = $OPENBOT_CONTROLLED_AUDIT_STORE/tenants
#
# Exit 0 only when c19Assertions.gates.allPass is true.
# Read-only vs the state tree: never writes under OPENBOT_CONTROLLED_AUDIT_STORE.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROBE="$ROOT/scripts/audit/workspace-isolation-probe.mjs"

if [[ ! -f "$PROBE" ]]; then
  echo "missing probe script: $PROBE" >&2
  exit 2
fi

STORE="${OPENBOT_CONTROLLED_AUDIT_STORE:-${1:-}}"
if [[ -z "$STORE" ]]; then
  echo "usage: export OPENBOT_CONTROLLED_AUDIT_STORE=<full-stateDir-snapshot>" >&2
  echo "       export SAMPLE_TENANT=... SAMPLE_USER=... EVIDENCE_ID=... OUT_DIR=..." >&2
  echo "       bash scripts/audit/c19-live-reprobe.sh > docs/design/evidence/\${EVIDENCE_ID}.summary.json" >&2
  exit 2
fi
STORE="$(cd "$STORE" && pwd)"

: "${SAMPLE_TENANT:?SAMPLE_TENANT required}"
: "${SAMPLE_USER:?SAMPLE_USER required}"

fail_preflight() {
  echo "C19 preflight failed: $1" >&2
  exit 2
}

[[ -d "$STORE" ]] || fail_preflight "not a directory: $STORE"
[[ -d "$STORE/tenants" ]] || fail_preflight "missing tenants/ under stateDir snapshot (got tenants-only subtree?)"
[[ -d "$STORE/agents" ]] || fail_preflight "missing agents/ — OPENBOT_CONTROLLED_AUDIT_STORE must be full stateDir, not tenants/<tenant>"
[[ -d "$STORE/tenants/$SAMPLE_TENANT" ]] || fail_preflight "missing tenants/$SAMPLE_TENANT"
[[ -d "$STORE/tenants/$SAMPLE_TENANT/users/$SAMPLE_USER" ]] ||
  fail_preflight "missing tenants/$SAMPLE_TENANT/users/$SAMPLE_USER"

# Shared roots must exist as directories on a full stateDir snapshot (may be empty).
for shared in canvas skills; do
  if [[ ! -e "$STORE/$shared" ]]; then
    echo "warning: missing $shared/ (expected on full stateDir; continuing)" >&2
  elif [[ ! -d "$STORE/$shared" ]]; then
    fail_preflight "$shared exists but is not a directory"
  fi
done

# Guard: operator accidentally pointed at tenants/<tenant> or users/<user>.
case "$STORE" in
  */tenants|*/tenants/*)
    fail_preflight "store path looks like a tenants subtree; use full stateDir snapshot root"
    ;;
esac

EVIDENCE_ID="${EVIDENCE_ID:-workspace-isolation-$(date -u +%Y%m%d)-c19-live}"
PROBE_AT="${PROBE_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
RECENT_DAYS="${RECENT_DAYS:-14}"
if command -v shasum >/dev/null 2>&1; then
  PROBE_SHA="$(shasum -a 256 "$PROBE" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  PROBE_SHA="$(sha256sum "$PROBE" | awk '{print $1}')"
else
  PROBE_SHA="$(
    node -e 'const fs=require("fs");const c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$PROBE"
  )"
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/c19-live-XXXXXX")"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

export OPENBOT_STATE_DIR="$STORE"
export SAMPLE_TENANT SAMPLE_USER PROBE_AT RECENT_DAYS

echo "probeScriptSha256=$PROBE_SHA" >&2
echo "store=$STORE evidenceId=$EVIDENCE_ID probeAt=$PROBE_AT" >&2
echo "tenantsRoot=$STORE/tenants sample=tenants/$SAMPLE_TENANT/users/$SAMPLE_USER" >&2

node "$PROBE" "$STORE" --mode raw-controlled >"$TMP/raw.json"
node "$PROBE" --mode summary-redacted --evidence-id "$EVIDENCE_ID" <"$TMP/raw.json" >"$TMP/summary.json"

if [[ -n "${OUT_DIR:-}" ]]; then
  mkdir -p "$OUT_DIR"
  cp "$TMP/raw.json" "$OUT_DIR/${EVIDENCE_ID}.raw.json"
  cp "$TMP/summary.json" "$OUT_DIR/${EVIDENCE_ID}.summary.json"
  echo "wrote $OUT_DIR/${EVIDENCE_ID}.{raw,summary}.json" >&2
fi

node -e '
const fs = require("fs");
const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const a = s.c19Assertions;
if (!a) {
  console.error("missing c19Assertions in summary");
  process.exit(3);
}
const out = {
  evidenceId: s.evidenceId,
  summarySha256: s.summarySha256,
  probeScriptSha256: s.probe?.scriptSha256 ?? null,
  writableCanonicalByOwnerScope: a.writableCanonicalByOwnerScope,
  legacyRootRoles: a.legacyRootRoles,
  unknownOwnership: a.unknownOwnership,
  sharedRootRecentWrites: a.sharedRootRecentWrites,
  crossTenantEnumeration: a.crossTenantEnumeration,
  gates: a.gates,
};
// Assertions digest → stderr; stdout remains a single redacted summary JSON.
console.error(JSON.stringify(out, null, 2));
if (!a.gates?.allPass) process.exit(4);
' "$TMP/summary.json"

# stdout: redacted summary only (commit when gates pass).
cat "$TMP/summary.json"
