#!/usr/bin/env bash
#
# server-setup.sh — wire admin.openbot.love to the OpenBot gateway
#
# Run this ON THE HOST that serves admin.openbot.love (as root or with sudo).
# It: (1) writes the gateway trusted-proxy + platform-auth config, (2) starts the
# gateway on loopback:18789, (3) installs the nginx vhost, (4) verifies.
#
# Authoritative reference: docs/gateway/trusted-proxy-deployment-examples.md
#
# SECURITY: trusted-proxy mode makes the gateway trust identity headers from the
# proxy. Keep the gateway bound to loopback and firewall :18789 so ONLY this nginx
# can reach it. Do not expose 18789 publicly.

set -euo pipefail

# ---- knobs -----------------------------------------------------------------
DOMAIN="${DOMAIN:-admin.openbot.love}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://${DOMAIN}}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@openbot.love}"
# Where this repo's deploy folder was copied on the server (contains the .conf):
CONF_SRC="${CONF_SRC:-$(cd "$(dirname "$0")" && pwd)/${DOMAIN}.conf}"
NGINX_CONF_DST="${NGINX_CONF_DST:-/etc/nginx/conf.d/${DOMAIN}.conf}"

log() { printf '\n==> %s\n' "$*"; }

# ---- 0. sanity -------------------------------------------------------------
command -v openbot >/dev/null 2>&1 || {
  log "openbot not found; installing globally (needs root)"
  npm i -g @upbeyond/openbot@latest
}
command -v nginx >/dev/null 2>&1 || { echo "nginx is required on this host" >&2; exit 1; }
[ -f "$CONF_SRC" ] || { echo "vhost template not found: $CONF_SRC" >&2; exit 1; }

# ---- 1. gateway config -----------------------------------------------------
# platform login is a sub-feature of trusted-proxy auth; these keys turn it on.
log "Configuring gateway (trusted-proxy + platform auth)"
openbot config set gateway.mode local
openbot config set gateway.bind loopback
openbot config set gateway.auth.mode trusted-proxy
openbot config set gateway.auth.trustedProxy.userHeader x-forwarded-user
openbot config set gateway.auth.trustedProxy.platformAuth.enabled true
# trustedProxies + allowedOrigins are arrays; --strict-json stores them as arrays
# (config set parses values as JSON5; see docs/cli/config.md).
openbot config set gateway.trustedProxies '["127.0.0.1","::1"]' --strict-json
openbot config set gateway.controlUi.allowedOrigins "[\"${PUBLIC_BASE_URL}\"]" --strict-json
openbot config validate

# ---- 2. (re)start the gateway on loopback:GATEWAY_PORT ----------------------
log "Starting gateway on loopback:${GATEWAY_PORT}"
export OPENBOT_PUBLIC_APP_BASE_URL="${PUBLIC_BASE_URL}"   # allows the public /login route
pkill -9 -f "openbot-gateway" 2>/dev/null || true
nohup openbot gateway run --bind loopback --port "${GATEWAY_PORT}" --force \
  > /tmp/openbot-gateway.log 2>&1 &
sleep 3
ss -ltnp 2>/dev/null | grep -q ":${GATEWAY_PORT}" \
  && echo "gateway listening on :${GATEWAY_PORT}" \
  || { echo "gateway did not bind :${GATEWAY_PORT}; see /tmp/openbot-gateway.log" >&2; tail -n 40 /tmp/openbot-gateway.log >&2 || true; exit 1; }

# ---- 3. install nginx vhost ------------------------------------------------
log "Installing nginx vhost -> ${NGINX_CONF_DST}"
cp "$CONF_SRC" "$NGINX_CONF_DST"
nginx -t
systemctl reload nginx

log "Issuing TLS cert for ${DOMAIN} (certbot)"
if command -v certbot >/dev/null 2>&1; then
  certbot --nginx --non-interactive --agree-tos --redirect \
    --email "${CERTBOT_EMAIL}" -d "${DOMAIN}" || \
    echo "certbot failed (check DNS/80 reachability); the HTTP vhost is still live." >&2
else
  echo "certbot not installed; skipping TLS. Install certbot then: certbot --nginx -d ${DOMAIN}" >&2
fi

# ---- 4. verify -------------------------------------------------------------
log "Verifying /__openbot/* now reaches the gateway (expect JSON, not nginx 'Not Found')"
set +e
echo "--- control-ui-config.json (expect platformAuth.enabled: true) ---"
curl -sS -i "${PUBLIC_BASE_URL}/__openbot/control-ui-config.json" | sed -n '1,20p'
echo "--- platform-auth/login (expect JSON body with a code, not a 404 page) ---"
curl -sS -i -X POST "${PUBLIC_BASE_URL}/__openbot/platform-auth/login" \
  -H 'Content-Type: application/json' -d '{}' | sed -n '1,20p'
set -e

log "Done. If the two responses above are JSON, open ${PUBLIC_BASE_URL} — you should"
log "get the dedicated platform login page, and after login land on the dashboard."
log "SECURITY REMINDER: firewall :${GATEWAY_PORT} so only this proxy can reach it."
