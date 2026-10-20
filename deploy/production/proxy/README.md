# Wave 2 — Reverse proxy topology (shared Gateway)

> **Status**: operator pack for staging / production edge  
> **Topology**: one Gateway (loopback) + nginx per public host  
> **Related**: `docs/gateway/trusted-proxy-deployment-examples.md`, `deploy/admin-subdomain/`

Browsers must never open the Gateway port directly. All HTTPS and WebSocket
traffic terminates at nginx (or equivalent), which proxies to
`127.0.0.1:18789` and preserves `Host` so the Control UI picks the correct
surface (platform / enterprise / employee).

---

## Domain matrix (canonical openbot.love)

| Host                                | Surface               | Auth path (first production)                  |
| ----------------------------------- | --------------------- | --------------------------------------------- |
| `admin.openbot.love`                | platform console      | Cookie-native platform-auth via gateway       |
| `biz.openbot.love`                  | enterprise console    | Same reverse-proxy; login surface from Host   |
| `gw.openbot.love`                   | employee workbench    | Same                                          |
| `openbot.love` / `www.openbot.love` | public home / sign-in | Anonymous reverse-proxy (no identity headers) |

Optional later: BFF/`auth_request` injecting `x-forwarded-user` (see deployment-examples).
**First production path is cookie-native** (same as `deploy/admin-subdomain/`).

---

## Files in this directory

| File                                      | Purpose                                     |
| ----------------------------------------- | ------------------------------------------- |
| `domains.md`                              | Full matrix + env/origins checklist         |
| `gateway.trusted-proxy.example.json5`     | Gateway keys for multi-origin trusted-proxy |
| `nginx/openbot_gateway.upstream.conf`     | Shared `upstream` snippet                   |
| `nginx/vhost-cookie-native.conf.template` | Template for any `server_name`              |
| `nginx/admin.openbot.love.conf`           | Ready-made admin vhost                      |
| `nginx/biz.openbot.love.conf`             | Ready-made biz vhost                        |
| `nginx/gw.openbot.love.conf`              | Ready-made employee vhost                   |
| `nginx/apex.openbot.love.conf`            | Apex + www                                  |
| `smoke.sh`                                | Automated edge smoke (local + public URL)   |
| `firewall.md`                             | Port / host firewall red lines              |

Legacy single-host pack remains at `deploy/admin-subdomain/` (still valid for admin-only).

---

## Install order (staging or prod host)

### 1. Gateway (loopback only)

```bash
# Config: merge gateway.trusted-proxy.example.json5 into openclaw.json
# Or use openbot config set (see deploy/admin-subdomain/server-setup.sh)

export OPENBOT_PUBLIC_APP_BASE_URL=https://admin.openbot.love
# Prefer container from RC:
#   docker run ... openbot:rc   with volume + env (see deploy/production/)
# Or host binary:
openbot gateway run --bind loopback --port 18789
```

Confirm:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18789/healthz   # 200
ss -ltn | grep 18789   # should be 127.0.0.1 or ::1, not 0.0.0.0 public
```

### 2. nginx

```bash
# On Debian/Ubuntu-style hosts:
sudo cp nginx/openbot_gateway.upstream.conf /etc/nginx/conf.d/00-openbot-upstream.conf
sudo cp nginx/*.openbot.love.conf /etc/nginx/conf.d/
# apex uses apex.openbot.love.conf → rename if needed:
sudo cp nginx/apex.openbot.love.conf /etc/nginx/conf.d/openbot.love.conf

# Apex installers (/install.sh, /install-cli.sh, /install.ps1) and /downloads/
# are static files. Copy them before reload or those URLs 404 (missing files)
# or keep returning Control SPA HTML (old vhost without the locations).
# From repo root:
#   sudo mkdir -p /var/www/openbot-downloads
#   sudo cp scripts/install.sh scripts/install-cli.sh scripts/install.ps1 /var/www/openbot-downloads/

sudo nginx -t && sudo systemctl reload nginx

# TLS (example — certbot injects 443)
sudo certbot --nginx -d admin.openbot.love -d biz.openbot.love -d gw.openbot.love \
  -d openbot.love -d www.openbot.love
```

### 3. Firewall

See `firewall.md`. Minimum: **deny public :18789**.

### 4. Smoke

```bash
# Against public edge (after DNS+TLS):
./smoke.sh --base-url https://admin.openbot.love

# Against local gateway only:
./smoke.sh --local-only
```

---

## Red lines

| #   | Rule                                                                                            |
| --- | ----------------------------------------------------------------------------------------------- |
| P1  | Gateway `bind: loopback` (or equivalent not reachable from internet)                            |
| P2  | `gateway.trustedProxies` includes proxy source (`127.0.0.1` / `::1` when co-located)            |
| P3  | `controlUi.allowedOrigins` lists **every** browser HTTPS origin                                 |
| P4  | nginx preserves `Host`, sets `X-Forwarded-Proto` + `X-Forwarded-Host`                           |
| P5  | WebSocket: `Upgrade` + `Connection` headers                                                     |
| P6  | Do not trust client-supplied `X-Forwarded-User` / tenant headers without BFF strip+inject       |
| P7  | Cookie-native platform login needs `platformAuth.enabled: true` + `OPENBOT_PUBLIC_APP_BASE_URL` |

---

## Wave 2 exit criteria

- [ ] All planned hosts resolve and serve TLS
- [ ] `GET https://admin.../__openbot/control-ui-config.json` returns JSON (`platformAuth` as configured)
- [ ] Platform login path returns JSON (not nginx 404 HTML)
- [ ] Control UI WebSocket connects (browser or smoke)
- [ ] Gateway container/process has an external auto-restart supervisor
- [ ] Public probe of `:18789` fails from outside the host
- [ ] `smoke.sh` exit 0 on staging

Shared multi-tenant data isolation remains **B4 / kiro** — this pack only fixes the **edge exposure** surface.
