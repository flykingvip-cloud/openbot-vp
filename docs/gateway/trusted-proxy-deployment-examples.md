---
summary: "Reverse proxy and BFF deployment templates for trusted-proxy browser auth"
read_when:
  - Standing up enterprise OpenBot behind an identity-aware proxy
  - Wiring platform login headers into the Gateway
  - Serving employee, enterprise, and platform on separate subdomains
title: "Trusted Proxy Deployment Examples"
---

# Trusted proxy deployment examples

Use these templates with [Trusted Proxy Migration](/gateway/trusted-proxy-migration) and [Trusted Proxy Auth](/gateway/trusted-proxy-auth).

Principles:

- Browsers reach OpenBot **only** through the proxy/BFF.
- The proxy authenticates users, then **overwrites** identity headers on every HTTP and WebSocket request.
- OpenBot trusts proxy identity only when `remoteAddress` is listed in `gateway.trustedProxies`.

## Process isolation (hard requirement)

- The Gateway container (or dedicated Gateway host) must **not** co-host any non-OpenBot process. Do not run databases, cron jobs, one-off scripts, or other applications inside the Gateway container.
- The reverse proxy / BFF always runs **outside** the Gateway container: as a separate container, a host service, or an edge appliance. Never bundle nginx (or any other proxy) into the Gateway image.
- Rationale: anything co-located inside the Gateway boundary inherits the Gateway's filesystem and loopback access (state dir, session transcripts, hook endpoints), which bypasses the trusted-proxy identity model described in [Trusted Proxy Auth](/gateway/trusted-proxy-auth).

## Gateway config (canonical)

```json5
{
  gateway: {
    bind: "loopback",
    trustedProxies: ["127.0.0.1", "::1"],
    controlUi: {
      allowedOrigins: ["https://openbot.example.com"],
    },
    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        userHeader: "x-forwarded-user",
        displayNameHeader: "x-forwarded-name",
        tenantHeader: "x-tenant-id",
        roleHeader: "x-gateway-role",
        scopesHeader: "x-gateway-scopes",
        requiredHeaders: ["x-forwarded-proto", "x-forwarded-host"],
      },
    },
  },
}
```

If the proxy runs on the same host as the Gateway, include a loopback address in `gateway.trustedProxies`.

## Header semantics (BFF must set)

| Header              | Example                             | Purpose                            |
| ------------------- | ----------------------------------- | ---------------------------------- |
| `x-forwarded-user`  | `alice@acme.com`                    | Immutable login identity           |
| `x-forwarded-name`  | `Alice`                             | Display label                      |
| `x-tenant-id`       | `acme-1234`                         | Active enterprise tenant           |
| `x-gateway-role`    | `operator`                          | Effective Gateway role for WS auth |
| `x-gateway-scopes`  | `operator.admin,operator.approvals` | Comma- or space-separated scopes   |
| `x-forwarded-proto` | `https`                             | Proxy verification                 |
| `x-forwarded-host`  | `openbot.example.com`               | Proxy verification                 |

Platform login must update the BFF session so tenant switch changes `x-tenant-id` immediately on the next request.

## nginx + platform BFF (sketch)

```nginx
upstream openbot_gateway {
  server 127.0.0.1:18789;
}

server {
  listen 443 ssl http2;
  server_name openbot.example.com;

  # TLS + HSTS at the edge (see Trusted Proxy Auth)

  location / {
    # auth_request hits your platform/BFF session validator
    auth_request /_platform/session;

    auth_request_set $user $upstream_http_x_session_user;
    auth_request_set $name $upstream_http_x_session_name;
    auth_request_set $tenant $upstream_http_x_session_tenant;
    auth_request_set $role $upstream_http_x_session_role;
    auth_request_set $scopes $upstream_http_x_session_scopes;

    proxy_pass http://openbot_gateway;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_set_header X-Forwarded-User $user;
    proxy_set_header X-Forwarded-Name $name;
    proxy_set_header X-Tenant-Id $tenant;
    proxy_set_header X-Gateway-Role $role;
    proxy_set_header X-Gateway-Scopes $scopes;
  }

  location = /_platform/session {
    internal;
    proxy_pass http://127.0.0.1:3000/internal/session/validate;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Cookie $http_cookie;
  }
}
```

Strip any client-supplied `x-forwarded-user`, `x-tenant-id`, `x-gateway-role`, and `x-gateway-scopes` **before** injecting BFF values.

## Multi-subdomain routing for openbot.love

OpenBot serves every surface from a single gateway. The browser bundle selects the active port from the request host (`ui/src/ui/routing/subdomain-resolver.ts`), so the proxy only needs to route each domain to the same gateway and preserve the `Host` header.

Canonical host to port mapping:

| Host                 | Port        | Landing surface     | Identity injected |
| -------------------- | ----------- | ------------------- | ----------------- |
| `admin.openbot.love` | platform    | Platform console    | platform admin    |
| `biz.openbot.love`   | enterprise  | Enterprise console  | enterprise admin  |
| `gw.openbot.love`    | employee    | Employee workbench  | employee          |
| `openbot.love`       | public home | Marketing + sign in | none (anonymous)  |
| `www.openbot.love`   | public home | Marketing + sign in | none (anonymous)  |

Unknown subdomains, multi level subdomains, and non `openbot.love` hosts are not port locked and fall back to path based routing. The map lives in `SUBDOMAIN_PORT_MAP` (`subdomain-resolver.ts`); add a port by editing that map and `subdomainForPort`.

### Gateway config: allow every browser origin

The WebSocket handshake rejects unknown origins, so list all five in `gateway.controlUi.allowedOrigins`:

```json5
{
  gateway: {
    // ...trusted-proxy auth as in "Gateway config (canonical)" above...
    controlUi: {
      allowedOrigins: [
        "https://admin.openbot.love",
        "https://biz.openbot.love",
        "https://gw.openbot.love",
        "https://openbot.love",
        "https://www.openbot.love",
      ],
    },
  },
}
```

### nginx: one upstream, per-domain server blocks

Every domain proxies to the same gateway and forwards `Host` unchanged (the bundle reads it to pick the port). The public apex and `www` serve the marketing home with no auth gate; each port domain runs its own session validator so the BFF issues the role, tenant, and scopes for that surface.

```nginx
upstream openbot_gateway {
  server 127.0.0.1:18789;
}

# Public marketing + sign in (anonymous, no identity headers)
server {
  listen 443 ssl http2;
  server_name openbot.love www.openbot.love;

  location / {
    proxy_pass http://openbot_gateway;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;                # REQUIRED: bundle derives the port from Host
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}

# Authenticated port. Duplicate this block for each of:
#   gw.openbot.love    with surface=employee
#   biz.openbot.love   with surface=enterprise
#   admin.openbot.love with surface=platform
# changing only server_name and the surface value.
server {
  listen 443 ssl http2;
  server_name admin.openbot.love;

  location / {
    auth_request /_session;
    auth_request_set $user $upstream_http_x_session_user;
    auth_request_set $tenant $upstream_http_x_session_tenant;
    auth_request_set $role $upstream_http_x_session_role;
    auth_request_set $scopes $upstream_http_x_session_scopes;

    proxy_pass http://openbot_gateway;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-User $user;
    proxy_set_header X-Tenant-Id $tenant;
    proxy_set_header X-Gateway-Role $role;
    proxy_set_header X-Gateway-Scopes $scopes;
  }

  location = /_session {
    internal;
    proxy_pass http://127.0.0.1:3000/internal/session/validate?surface=platform;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Cookie $http_cookie;
  }
}
```

The validator keys on the surface (or `$host`) to decide the role: `admin.openbot.love` must return a platform admin session, `biz.openbot.love` an enterprise admin session, and `gw.openbot.love` an employee session. Strip client supplied identity headers before injecting BFF values, as in the single domain example above.

## Shadow validation (Stage A)

Before cutover, log BFF-derived headers alongside platform session state and compare:

1. Platform login → note session user/tenant/role.
2. `curl -sS -H "Cookie: ..." https://openbot.example.com/openclaw/__openbot/control-ui/bootstrap-config` → confirm `authMode: "trusted-proxy"` and matching `authSession`.
3. Open browser → platform login → enterprise console without Control UI token prompt.
4. Refresh and confirm WS reconnect stays authenticated.

## Direct-access negative test

From a machine that is **not** the trusted proxy, a bare WebSocket connect without proxy headers must fail:

```bash
# Expect 1008 / trusted_proxy_untrusted_source or platform session missing — not success
openbot gateway call health --url ws://<gateway-host>:18789
```

Firewall the Gateway port so only the proxy IP can reach it.

## Related

- [Trusted Proxy Auth](/gateway/trusted-proxy-auth)
- [Trusted Proxy Migration](/gateway/trusted-proxy-migration)
- [Dashboard](/web/dashboard)
- [Control UI](/web/control-ui)
