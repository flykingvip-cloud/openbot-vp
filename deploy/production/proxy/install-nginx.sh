#!/usr/bin/env bash
# Install Wave 2 nginx snippets on a Linux host (requires root/sudo).
# Does not start the gateway — configure that first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
NGINX_CONF_D="${NGINX_CONF_D:-/etc/nginx/conf.d}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Re-run with sudo" >&2
  exit 1
fi

command -v nginx >/dev/null || { echo "nginx not installed" >&2; exit 1; }

cp "$ROOT/nginx/map-connection-upgrade.conf" "$NGINX_CONF_D/00-openbot-map-upgrade.conf"
cp "$ROOT/nginx/openbot_gateway.upstream.conf" "$NGINX_CONF_D/00-openbot-upstream.conf"
cp "$ROOT/nginx/admin.openbot.love.conf" "$NGINX_CONF_D/"
cp "$ROOT/nginx/biz.openbot.love.conf" "$NGINX_CONF_D/"
cp "$ROOT/nginx/gw.openbot.love.conf" "$NGINX_CONF_D/"
cp "$ROOT/nginx/apex.openbot.love.conf" "$NGINX_CONF_D/openbot.love.conf"

nginx -t
systemctl reload nginx
echo "nginx Wave 2 vhosts installed under $NGINX_CONF_D"
echo "Next: certbot --nginx -d admin.openbot.love -d biz.openbot.love -d gw.openbot.love -d openbot.love -d www.openbot.love"
echo "Then: $ROOT/smoke.sh --base-url https://admin.openbot.love"
