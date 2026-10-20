#!/usr/bin/env bash
# Materialize BYOK_API_KEY into a root-only env-file from the enterprise-model SecretRef vault.
# NEVER prints the key. NEVER writes into git or evidence directories.
set -euo pipefail

RUNTIME=podman
command -v podman >/dev/null 2>&1 || RUNTIME=docker
PROD_CONTAINER="${OPENBOT_GATEWAY_CONTAINER_PROD:-openbot-gateway-rc}"
OUT_DIR="${BYOK_CANARY_SECRETS_DIR:-/root/.openbot-canary-secrets}"
OUT_FILE="${BYOK_ENV_FILE:-$OUT_DIR/byok.env}"
REF="${BYOK_CREDENTIAL_REF:-}"
VAULT_IN_CONTAINER="${OPENBOT_ENTERPRISE_MODEL_VAULT:-/root/.openbot/openbot-enterprise-model-secrets.json}"

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
TMP_JS="$(mktemp /tmp/materialize-byok-XXXXXX.mjs)"
cleanup() { rm -f "$TMP_JS"; }
trap cleanup EXIT

cat >"$TMP_JS" <<'JS'
import { createDecipheriv } from "node:crypto";
import fs from "node:fs";

const vaultPath = process.env.VAULT_PATH;
const outFile = process.env.OUT_FILE;
const preferRef = (process.env.BYOK_CREDENTIAL_REF || "").trim();
const vault = JSON.parse(fs.readFileSync(vaultPath, "utf8"));
const creds = vault.credentials || {};
const refs = Object.keys(creds);
if (!refs.length) {
  console.error("vault empty");
  process.exit(2);
}
const ref = preferRef || refs[0];
if (!creds[ref]) {
  console.error("ref missing");
  process.exit(2);
}
const keyObj = JSON.parse(fs.readFileSync(`${vaultPath}.key`, "utf8"));
const key = Buffer.from(keyObj.key, "base64");
if (key.length !== 32) {
  console.error("bad key len");
  process.exit(2);
}
const env = creds[ref];
const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
decipher.setAuthTag(Buffer.from(env.tag, "base64"));
const pt = Buffer.concat([
  decipher.update(Buffer.from(env.ct, "base64")),
  decipher.final(),
]);
const secret = JSON.parse(pt.toString("utf8"));
const apiKey = String(secret.apiKey || "").trim();
if (!apiKey) {
  console.error("empty apiKey");
  process.exit(2);
}
const body =
  `BYOK_API_KEY=${apiKey}\n` +
  `BYOK_PROVIDER_TYPE=${process.env.BYOK_PROVIDER_TYPE || "openai-compatible"}\n` +
  `BYOK_BASE_URL=${process.env.BYOK_BASE_URL || ""}\n` +
  `BYOK_UPSTREAM_MODEL=${process.env.BYOK_UPSTREAM_MODEL || "DeepSeek-V4-Flash"}\n`;
fs.writeFileSync(outFile, body, { mode: 0o600 });
console.log(`materialized ok out=${outFile} bytes=${Buffer.byteLength(body)} ref_set=${ref ? 1 : 0}`);
JS

"$RUNTIME" cp "$TMP_JS" "$PROD_CONTAINER:/tmp/materialize-byok-canary-env.mjs"
# Write to a path shared via the prod bind mount, then move into canary secrets dir.
# /root/.openbot is mounted in prod; use a temp under it then mv out of evidence trees.
HOST_TMP_UNDER_STATE="/root/.openbot/.byok-canary-env.tmp"
"$RUNTIME" exec \
  -e VAULT_PATH="$VAULT_IN_CONTAINER" \
  -e OUT_FILE="$HOST_TMP_UNDER_STATE" \
  -e BYOK_CREDENTIAL_REF="$REF" \
  -e BYOK_PROVIDER_TYPE="${BYOK_PROVIDER_TYPE:-openai-compatible}" \
  -e BYOK_BASE_URL="${BYOK_BASE_URL:-https://developer.amd.com.cn/radeon/api/v1}" \
  -e BYOK_UPSTREAM_MODEL="${BYOK_UPSTREAM_MODEL:-DeepSeek-V4-Flash}" \
  "$PROD_CONTAINER" \
  node /tmp/materialize-byok-canary-env.mjs
# Move off the prod state tree into dedicated secrets dir (not evidence)
mv -f "$HOST_TMP_UNDER_STATE" "$OUT_FILE"
chmod 600 "$OUT_FILE"
"$RUNTIME" exec "$PROD_CONTAINER" rm -f /tmp/materialize-byok-canary-env.mjs "$HOST_TMP_UNDER_STATE" 2>/dev/null || true
rm -f "$HOST_TMP_UNDER_STATE" 2>/dev/null || true
# Prove file exists without dumping contents
python3 - "$OUT_FILE" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
text = p.read_text()
line = next(l for l in text.splitlines() if l.startswith("BYOK_API_KEY="))
val = line.split("=", 1)[1]
if len(val) < 8:
    raise SystemExit("materialized key too short")
# never print value
print(f"host_env_ready path={p} mode={oct(p.stat().st_mode & 0o777)} lines={len(text.splitlines())}")
PY
