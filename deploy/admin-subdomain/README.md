# admin.openbot.love platform console — deploy notes

Operator runbook for wiring `admin.openbot.love` to the OpenBot gateway so the
platform admin login works. Authoritative reference (read this first):

- **`deploy/production/proxy/`** — Wave 2 multi-domain pack (admin + biz + gw + apex), smoke + firewall
- `docs/gateway/trusted-proxy-deployment-examples.md` (multi-subdomain: admin/biz/gw)
- `docs/gateway/trusted-proxy-auth.md`

## Why login returns 404 today

`admin.openbot.love` currently serves only the static control-ui SPA; its nginx
returns `404 Not Found` for `/__openbot/*`. The SPA calls same-origin
`/__openbot/control-ui-config.json` and `/__openbot/platform-auth/login`, so with
no gateway behind those paths the login shows `Request failed (404)` and the
console has no data. Two gaps, both server-side:

1. The OpenBot gateway is not running on the host that serves this subdomain.
2. nginx does not proxy `/__openbot/*` (and the WebSocket) to the gateway.

## Fix — three steps on the host that serves admin.openbot.love

### 1. Run the gateway (loopback:18789)

Set the gateway config (json5) — the parts that make platform login work:

```json5
{
  gateway: {
    bind: "loopback",
    trustedProxies: ["127.0.0.1", "::1"],
    controlUi: {
      // REQUIRED: the WS handshake rejects unknown origins.
      allowedOrigins: ["https://admin.openbot.love"],
    },
    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        userHeader: "x-forwarded-user", // required field
        requiredHeaders: ["x-forwarded-proto", "x-forwarded-host"],
        platformAuth: { enabled: true }, // enables /__openbot/platform-auth/*
      },
    },
  },
}
```

Then run it (firewall :18789 so only this proxy can reach it):

```bash
export OPENBOT_PUBLIC_APP_BASE_URL=https://admin.openbot.love   # canonical link base (emails/invites)
# Allow every Control UI host that shares this gateway (enterprise/employee/home logins):
export OPENBOT_PUBLIC_APP_BASE_URLS=https://admin.openbot.love,https://biz.openbot.love,https://gw.openbot.love,https://openbot.love,https://www.openbot.love
pkill -9 -f openbot-gateway || true
nohup openbot gateway run --bind loopback --port 18789 --force \
  > /tmp/openbot-gateway.log 2>&1 &
```

Notes (verified in code):

- Platform login is a sub-feature of trusted-proxy auth: `resolvePlatformAuthConfig`
  (`src/gateway/platform-auth/config.ts`) only activates when
  `gateway.auth.trustedProxy.platformAuth.enabled` is set. Without it, `/login`
  returns JSON 404 `PLATFORM_AUTH_DISABLED`.
- The public `/login` route is allowed when the request originates from loopback
  and its proto+host match any URL in `OPENBOT_PUBLIC_APP_BASE_URLS` (or a
  comma-separated `OPENBOT_PUBLIC_APP_BASE_URL`, plus `OPENBOT_PUBLIC_HOME_BASE_URL`)
  via `isConfiguredPublicPlatformRequest` (`src/gateway/platform-auth/public-request.ts`).
  A single-host `OPENBOT_PUBLIC_APP_BASE_URL=https://admin.openbot.love` alone will
  403 enterprise logins on `biz.openbot.love` with `PLATFORM_AUTH_LOCAL_ONLY`.
  nginx on the same host proxying to `127.0.0.1` satisfies the loopback requirement.
- The email/password login sets the `openbot_platform_session` cookie, which the
  gateway translates into a trusted-proxy session — so this host does not need a
  BFF injecting `x-forwarded-user` for the platform console. If you DO front it with
  an SSO/BFF, use the `auth_request` per-domain block from the deployment-examples doc.

### 2. Install the nginx vhost

Copy `admin.openbot.love.conf` (in this folder) to the host and enable it:

```bash
cp admin.openbot.love.conf /etc/nginx/conf.d/admin.openbot.love.conf
nginx -t && systemctl reload nginx
certbot --nginx -d admin.openbot.love   # adds 443 + 80->443 redirect
# certbot often writes `listen 443 ssl;` without http2 — enable it (nginx 1.24.x):
#   sed -i 's/listen 443 ssl;/listen 443 ssl http2;/; s/listen \[::\]:443 ssl;/listen [::]:443 ssl http2;/' \
#     /etc/nginx/conf.d/admin.openbot.love.conf
#   nginx -t && systemctl reload nginx
# Verify: curl -sI --http2 https://admin.openbot.love/ | head -1   # expect HTTP/2
```

The vhost is a reverse proxy to `127.0.0.1:18789` that preserves `Host`
(the browser bundle derives the platform port from the host), forwards
`X-Forwarded-Proto`/`X-Forwarded-Host`, and upgrades the WebSocket.

### 3. Verify

```bash
# Must be JSON now (not nginx text/plain "Not Found"):
curl -i https://admin.openbot.love/__openbot/control-ui-config.json     # expect platformAuth.enabled: true
curl -i -X POST https://admin.openbot.love/__openbot/platform-auth/login \
  -H 'Content-Type: application/json' -d '{}'                            # expect JSON with a code, not a 404 page
```

Once these return JSON, the front-end guard takes over: an unauthenticated visitor
gets the dedicated platform login page; after a successful login `connect()` reloads
data and the app lands on the platform dashboard.

## Security

`trusted-proxy` mode makes the gateway trust identity headers from the proxy.
Only enable it behind this nginx (which sets/strips `X-Forwarded-*`), keep the
gateway bound to loopback, and firewall `:18789` so only the proxy can reach it.
Verify with the direct-access negative test in the deployment-examples doc.
