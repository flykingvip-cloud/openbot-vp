---
summary: "Delegate gateway authentication to a trusted reverse proxy (Pomerium, Caddy, nginx + OAuth)"
read_when:
  - Running OpenBot behind an identity-aware proxy
  - Setting up Pomerium, Caddy, or nginx with OAuth in front of OpenBot
  - Fixing WebSocket 1008 unauthorized errors with reverse proxy setups
  - Deciding where to set HSTS and other HTTP hardening headers
---

# Trusted Proxy Auth

> ⚠️ **Security-sensitive feature.** This mode delegates authentication entirely to your reverse proxy. Misconfiguration can expose your Gateway to unauthorized access. Read this page carefully before enabling.

## When to Use

Use `trusted-proxy` auth mode when:

- You run OpenBot behind an **identity-aware proxy** (Pomerium, Caddy + OAuth, nginx + oauth2-proxy, Traefik + forward auth)
- Your proxy handles all authentication and passes user identity via headers
- You're in a Kubernetes or container environment where the proxy is the only path to the Gateway
- You're hitting WebSocket `1008 unauthorized` errors because browsers can't pass tokens in WS payloads

## When NOT to Use

- If your proxy doesn't authenticate users (just a TLS terminator or load balancer)
- If there's any path to the Gateway that bypasses the proxy (firewall holes, internal network access)
- If you're unsure whether your proxy correctly strips/overwrites forwarded headers
- If you only need personal single-user access (consider Tailscale Serve + loopback for simpler setup)

## How It Works

1. Your reverse proxy authenticates users (OAuth, OIDC, SAML, etc.)
2. Proxy adds a header with the authenticated user identity (e.g., `x-forwarded-user: nick@example.com`)
3. OpenBot checks that the request came from a **trusted proxy IP** (configured in `gateway.trustedProxies`)
4. OpenBot extracts the user identity from the configured header
5. Optionally, OpenBot also reads platform session claims like display name, tenant, role, and scopes from additional headers
6. If everything checks out, the request is authorized

## Control UI Pairing Behavior

When `gateway.auth.mode = "trusted-proxy"` is active and the request passes
trusted-proxy checks, Control UI WebSocket sessions can connect without device
pairing identity.

Implications:

- Pairing is no longer the primary gate for Control UI access in this mode.
- Your reverse proxy auth policy and `allowUsers` become the effective access control.
- Keep gateway ingress locked to trusted proxy IPs only (`gateway.trustedProxies` + firewall).

## Configuration

```json5
{
  gateway: {
    // Use loopback for same-host proxy setups; use lan/custom for remote proxy hosts
    bind: "loopback",

    // CRITICAL: Only add your proxy's IP(s) here
    trustedProxies: ["10.0.0.1", "172.17.0.1"],

    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        // Header containing authenticated user identity (required)
        userHeader: "x-forwarded-user",

        // Optional: display name shown in Control UI
        displayNameHeader: "x-forwarded-name",

        // Optional: enterprise / tenant selected by the platform
        tenantHeader: "x-tenant-id",

        // Optional: make proxy-issued role/scopes authoritative for WS auth
        roleHeader: "x-gateway-role",
        scopesHeader: "x-gateway-scopes",

        // Optional: headers that MUST be present (proxy verification)
        requiredHeaders: ["x-forwarded-proto", "x-forwarded-host"],

        // Optional: restrict to specific users (empty = allow all)
        allowUsers: ["nick@example.com", "admin@company.org"],
      },
    },
  },
}
```

If `gateway.bind` is `loopback`, include a loopback proxy address in
`gateway.trustedProxies` (`127.0.0.1`, `::1`, or an equivalent loopback CIDR).

### Configuration Reference

| Field                                             | Required | Description                                                                                                                                                                |
| ------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway.trustedProxies`                          | Yes      | Array of proxy IP addresses to trust. Requests from other IPs are rejected.                                                                                                |
| `gateway.auth.mode`                               | Yes      | Must be `"trusted-proxy"`                                                                                                                                                  |
| `gateway.auth.trustedProxy.userHeader`            | Yes      | Header name containing the authenticated user identity                                                                                                                     |
| `gateway.auth.trustedProxy.displayNameHeader`     | No       | Header name containing a human-readable display name for the user                                                                                                          |
| `gateway.auth.trustedProxy.tenantHeader`          | No       | Header name containing the tenant or enterprise ID for the session                                                                                                         |
| `gateway.auth.trustedProxy.roleHeader`            | No       | Header name containing the effective gateway role                                                                                                                          |
| `gateway.auth.trustedProxy.scopesHeader`          | No       | Header name containing effective gateway scopes                                                                                                                            |
| `gateway.auth.trustedProxy.requiredHeaders`       | No       | Additional headers that must be present for the request to be trusted                                                                                                      |
| `gateway.auth.trustedProxy.allowUsers`            | No       | Allowlist of user identities. Empty means allow all authenticated users.                                                                                                   |
| `gateway.auth.trustedProxy.localOperator`         | No       | Opt-in identity for direct-loopback (127.0.0.1) connections with no proxy header and no session cookie. See [Sanctioned Loopback Operator](#sanctioned-loopback-operator). |
| `gateway.auth.trustedProxy.localOperator.enabled` | No       | Set `true` to enable the loopback operator identity. Default `false` (strictly opt-in).                                                                                    |
| `gateway.auth.trustedProxy.localOperator.user`    | No       | Platform-auth user email adopted for direct-loopback connections. Must be an active user with an enterprise membership.                                                    |

## Sanctioned Loopback Operator

By default, a direct connection to the Gateway over loopback (`127.0.0.1`) that
carries no reverse-proxy identity header and no platform session cookie is
authorized as an identity-less `local` principal. That principal has no session
domain and no enterprise membership, so tenant-scoped surfaces fail closed: the
local Control UI can load, but the employee workbench assistant and collaboration
space reject sends with `enterprise tenant context is required` /
`trusted tenant context required`, and those messages never persist or get a
reply.

`gateway.auth.trustedProxy.localOperator` is an explicit, opt-in way to give that
direct-loopback connection a real platform identity. When enabled, OpenBot maps
the configured email to an active platform-auth user and its enterprise
membership, then adopts that user for the connection (the enterprise tenant is
read from the platform-auth store, never invented from config).

```json5
{
  gateway: {
    bind: "loopback",
    trustedProxies: ["127.0.0.1"],
    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        userHeader: "x-forwarded-user",
        platformAuth: { enabled: true },
        localOperator: {
          enabled: true,
          user: "operator@your-company.example",
        },
      },
    },
  },
}
```

### Security tradeoff

> ⚠️ Enabling this treats **anyone with direct loopback access to the Gateway** as
> the configured operator. It deliberately turns "can reach `127.0.0.1`" into
> "is this operator".

Only enable it on a host where loopback access already implies operator trust,
for example a single-operator gateway host you administer directly. Do **not**
enable it where other processes, tenants, or users share the host and can reach
the loopback port. This is the same boundary called out in
[Trusted Proxy Deployment Examples](/gateway/trusted-proxy-deployment-examples):
anything co-located inside the Gateway boundary inherits loopback access.

Safeguards built into the feature:

- **Opt-in.** Disabled unless `localOperator.enabled` is `true`.
- **Loopback only.** It is evaluated only for requests that pass direct-loopback
  detection; proxied and remote connections continue through the normal
  trusted-proxy and platform-session paths and are never affected.
- **Token still applies.** If `gateway.auth.token` is set, a valid token is still
  required on the loopback connection before any operator identity is adopted.
- **Fails closed.** If the configured email does not resolve to an active user
  with an enterprise membership, the connection falls back to the anonymous
  `local` principal rather than inventing a tenant.

## Platform and BFF Pattern

This is the intended setup when a platform layer owns sign-in, registration, and company membership:

1. The platform authenticates the end user and decides their current tenant and permissions.
2. A BFF or reverse proxy terminates the browser session and forwards requests to OpenBot.
3. The BFF injects the trusted headers OpenBot is configured to read.
4. OpenBot runs with `gateway.auth.mode: "trusted-proxy"` and only trusts requests from `gateway.trustedProxies`.
5. Browser clients stop using shared gateway token or password prompts and instead rely on the existing platform session.

Recommended header set for this pattern:

- `userHeader`
- `displayNameHeader`
- `tenantHeader`
- `roleHeader`
- `scopesHeader`

If you configure `roleHeader` and `scopesHeader`, OpenBot treats those proxy-issued values as authoritative during the WebSocket handshake. If you leave them unset, trusted-proxy mode keeps its legacy behavior and will not override client-declared role/scopes.

## TLS termination and HSTS

Use one TLS termination point and apply HSTS there.

### Recommended pattern: proxy TLS termination

When your reverse proxy handles HTTPS for `https://control.example.com`, set
`Strict-Transport-Security` at the proxy for that domain.

- Good fit for internet-facing deployments.
- Keeps certificate + HTTP hardening policy in one place.
- OpenBot can stay on loopback HTTP behind the proxy.

Example header value:

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### Gateway TLS termination

If OpenBot itself serves HTTPS directly (no TLS-terminating proxy), set:

```json5
{
  gateway: {
    tls: { enabled: true },
    http: {
      securityHeaders: {
        strictTransportSecurity: "max-age=31536000; includeSubDomains",
      },
    },
  },
}
```

`strictTransportSecurity` accepts a string header value, or `false` to disable explicitly.

### Rollout guidance

- Start with a short max age first (for example `max-age=300`) while validating traffic.
- Increase to long-lived values (for example `max-age=31536000`) only after confidence is high.
- Add `includeSubDomains` only if every subdomain is HTTPS-ready.
- Use preload only if you intentionally meet preload requirements for your full domain set.
- Loopback-only local development does not benefit from HSTS.

## Proxy Setup Examples

### Pomerium

Pomerium passes identity in `x-pomerium-claim-email` (or other claim headers) and a JWT in `x-pomerium-jwt-assertion`.

```json5
{
  gateway: {
    bind: "lan",
    trustedProxies: ["10.0.0.1"], // Pomerium's IP
    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        userHeader: "x-pomerium-claim-email",
        requiredHeaders: ["x-pomerium-jwt-assertion"],
      },
    },
  },
}
```

Pomerium config snippet:

```yaml
routes:
  - from: https://openbot.example.com
    to: http://openbot-gateway:18789
    policy:
      - allow:
          or:
            - email:
                is: nick@example.com
    pass_identity_headers: true
```

### Caddy with OAuth

Caddy with the `caddy-security` plugin can authenticate users and pass identity headers.

```json5
{
  gateway: {
    bind: "lan",
    trustedProxies: ["127.0.0.1"], // Caddy's IP (if on same host)
    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        userHeader: "x-forwarded-user",
      },
    },
  },
}
```

Caddyfile snippet:

```
openbot.example.com {
    authenticate with oauth2_provider
    authorize with policy1

    reverse_proxy openbot:18789 {
        header_up X-Forwarded-User {http.auth.user.email}
    }
}
```

### nginx + oauth2-proxy

oauth2-proxy authenticates users and passes identity in `x-auth-request-email`.

```json5
{
  gateway: {
    bind: "lan",
    trustedProxies: ["10.0.0.1"], // nginx/oauth2-proxy IP
    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        userHeader: "x-auth-request-email",
      },
    },
  },
}
```

nginx config snippet:

```nginx
location / {
    auth_request /oauth2/auth;
    auth_request_set $user $upstream_http_x_auth_request_email;

    proxy_pass http://openbot:18789;
    proxy_set_header X-Auth-Request-Email $user;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### Traefik with Forward Auth

```json5
{
  gateway: {
    bind: "lan",
    trustedProxies: ["172.17.0.1"], // Traefik container IP
    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        userHeader: "x-forwarded-user",
      },
    },
  },
}
```

## Security Checklist

Before enabling trusted-proxy auth, verify:

- [ ] **Proxy is the only path**: The Gateway port is firewalled from everything except your proxy
- [ ] **trustedProxies is minimal**: Only your actual proxy IPs, not entire subnets
- [ ] **Proxy strips headers**: Your proxy overwrites (not appends) `x-forwarded-*` headers from clients
- [ ] **TLS termination**: Your proxy handles TLS; users connect via HTTPS
- [ ] **allowUsers is set** (recommended): Restrict to known users rather than allowing anyone authenticated

## Security Audit

`openbot security audit` will flag trusted-proxy auth with a **critical** severity finding. This is intentional — it's a reminder that you're delegating security to your proxy setup.

The audit checks for:

- Missing `trustedProxies` configuration
- Missing `userHeader` configuration
- Empty `allowUsers` (allows any authenticated user)

## Troubleshooting

### "trusted_proxy_untrusted_source"

The request didn't come from an IP in `gateway.trustedProxies`. Check:

- Is the proxy IP correct? (Docker container IPs can change)
- Is there a load balancer in front of your proxy?
- Use `docker inspect` or `kubectl get pods -o wide` to find actual IPs

### "trusted_proxy_user_missing"

The user header was empty or missing. Check:

- Is your proxy configured to pass identity headers?
- Is the header name correct? (case-insensitive, but spelling matters)
- Is the user actually authenticated at the proxy?

### "trusted*proxy_missing_header*\*"

A required header wasn't present. Check:

- Your proxy configuration for those specific headers
- Whether headers are being stripped somewhere in the chain

### "trusted_proxy_user_not_allowed"

The user is authenticated but not in `allowUsers`. Either add them or remove the allowlist.

### WebSocket Still Failing

Make sure your proxy:

- Supports WebSocket upgrades (`Upgrade: websocket`, `Connection: upgrade`)
- Passes the identity headers on WebSocket upgrade requests (not just HTTP)
- Doesn't have a separate auth path for WebSocket connections

## Migration from Token Auth

If you're moving from token auth to trusted-proxy:

1. Configure your proxy to authenticate users and pass headers
2. Test the proxy setup independently (curl with headers)
3. Update OpenBot config with trusted-proxy auth
4. Restart the Gateway
5. Test WebSocket connections from the Control UI
6. Run `openbot security audit` and review findings

## Related

- [Security](/gateway/security) — full security guide
- [Configuration](/gateway/configuration) — config reference
- [Remote Access](/gateway/remote) — other remote access patterns
- [Tailscale](/gateway/tailscale) — simpler alternative for tailnet-only access
