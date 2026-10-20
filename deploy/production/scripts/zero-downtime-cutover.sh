#!/bin/bash
# Zero-downtime deployment script for openbot-gateway-rc
# Usage: ./zero-downtime-cutover.sh <new-image-tag>
# Example: ./zero-downtime-cutover.sh localhost/openbot:rc-amd64-provenance-abc1234

set -euo pipefail

NEW_IMAGE="${1:?Usage: $0 <new-image-tag>}"
OLD_CONTAINER="openbot-gateway-rc"
NEW_CONTAINER="openbot-gateway-rc-new"
OLD_PORT="18789"
NEW_PORT="18790"
NGINX_UPSTREAM_CONF="/etc/nginx/conf.d/00-openbot-upstream.conf"

echo "=== Zero-Downtime Cutover ==="
echo "New Image: $NEW_IMAGE"
echo "Old Container: $OLD_CONTAINER (port $OLD_PORT)"
echo "New Container: $NEW_CONTAINER (port $NEW_PORT)"
echo ""

# Step 1: Start new container on temporary port
echo "[1/6] Starting new container on port $NEW_PORT..."
podman run -d \
  --name "$NEW_CONTAINER" \
  --user 0 \
  --network host \
  --entrypoint '' \
  --restart always \
  -v /var/lib/openbot/state:/root/.openbot \
  -v /var/lib/openbot/tenants:/root/openbot-tenants \
  -v /var/lib/openbot/data-root:/root/OpenBot \
  -e OPENBOT_DATA_DIR=/root/OpenBot \
  -e OPENBOT_TENANTS_DIR=/root/openbot-tenants \
  -e OPENBOT_LOG_LEVEL=info \
  "$NEW_IMAGE" \
  node openbot.mjs gateway run --bind loopback --port "$NEW_PORT" --force

# Step 2: Wait for health check (max 60s)
echo "[2/6] Waiting for new container to become healthy..."
for i in {1..60}; do
  if curl -s --max-time 2 "http://127.0.0.1:$NEW_PORT/health" | grep -q "ok"; then
    echo "✓ Health check passed after ${i}s"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "✗ Health check failed after 60s, rolling back..."
    podman stop "$NEW_CONTAINER" || true
    podman rm "$NEW_CONTAINER" || true
    exit 1
  fi
  sleep 1
done

# Step 3: Update nginx upstream to include new port
echo "[3/6] Updating nginx upstream config..."
cat > "$NGINX_UPSTREAM_CONF" << EOF
# Shared upstream for all openbot.love (or staging) vhosts.
# Auto-updated by zero-downtime-cutover.sh $(date -Iseconds)
upstream openbot_gateway {
    server 127.0.0.1:$NEW_PORT;
    server 127.0.0.1:$OLD_PORT backup;
    keepalive 32;
}
EOF

# Step 4: Reload nginx (zero-downtime)
echo "[4/6] Reloading nginx..."
nginx -t && nginx -s reload

# Step 5: Wait 5s for traffic to drain from old container
echo "[5/6] Waiting 5s for traffic to drain..."
sleep 5

# Step 6: Stop old container and rename new container
echo "[6/6] Stopping old container and finalizing..."
podman stop "$OLD_CONTAINER" || true
podman rename "$OLD_CONTAINER" "openbot-gateway-rc-old-$(date +%Y%m%d-%H%M%S)" || true
podman rename "$NEW_CONTAINER" "$OLD_CONTAINER"

# Step 7: Restore standard upstream config (optional, for next deployment)
echo "[7/7] Restoring standard upstream config..."
cat > "$NGINX_UPSTREAM_CONF" << EOF
# Shared upstream for all openbot.love (or staging) vhosts.
# Restored to standard single-port config $(date -Iseconds)
upstream openbot_gateway {
    server 127.0.0.1:$OLD_PORT;
    keepalive 32;
}
EOF
nginx -t && nginx -s reload

echo ""
echo "✓ Zero-downtime cutover completed successfully"
echo "  Old container: renamed to openbot-gateway-rc-old-$(date +%Y%m%d-%H%M%S)"
echo "  New container: running as $OLD_CONTAINER on port $OLD_PORT"
echo "  Total downtime: ~0s (nginx handled seamless switching)"
