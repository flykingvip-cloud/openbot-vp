---
summary: "Isolation-only gateway product path for exec-protocol artifact download, plus the tight loopback identity-header control"
read_when:
  - Wiring the isolated gateway to exec-protocol A' for authenticated artifact download
  - Enabling rejectDirectLoopbackIdentityHeaders for isolation drills
  - Checking leftover blockers before any 回源 or production execution cutover
---

# Isolation gateway → exec-protocol artifact path and tight identity headers

This is isolation wiring only. It does **not** cut 回源, does **not** change Hong Kong LIVE, does **not** write a production ledger, and does **not** enable a production execution profile. `OPENBOT_PRODUCTION_EXECUTION_MODE=production` must still be refused. HK→A auth translation remains **BLOCKED**.

## Authenticated product path

After a user is authenticated to the isolated gateway with a **tenant-bearing** session, they can use these gateway HTTP routes. They are **not** the raw exec-protocol port (`:18790`) routes such as `POST /v1/tasks/artifact`.

A membership-scoped enterprise or employee platformAuth cookie can use the facade. A platform-super-admin (or other unbound platform) cookie session has no bound membership, even if the same user belongs to enterprises, and the facade returns `403 exec_protocol_tenant_required`. Isolation re-drill must log in through the enterprise (or otherwise membership-scoped) path, not only `/platform/login` as an unbound super-admin. There is no "super-admin may pick any tenant" bypass. Header-based trusted-proxy sessions still take `tenantId` from the tenant header (including a designated entry hop in tight mode).

| Method | Gateway route                                           | Purpose                                                         |
| ------ | ------------------------------------------------------- | --------------------------------------------------------------- |
| `POST` | `/v1/exec-protocol/tasks`                               | Thin submit facade                                              |
| `POST` | `/v1/exec-protocol/tasks/status`                        | Thin status facade                                              |
| `POST` | `/v1/exec-protocol/tasks/artifact`                      | JSON artifact metadata, optional `bytesBase64`, sha256 verified |
| `GET`  | `/v1/exec-protocol/tasks/:taskId/artifacts/:artifactId` | Octet-stream download with `X-OpenBot-Exec-SHA256`              |

The gateway talks to isolation A' with the existing `ExecHttpClient`. Tenant id is taken from the authenticated session: `enterpriseId` is authoritative when a membership is present; otherwise `tenantId` (the compatibility hint, or the trusted-proxy tenant header). A client-supplied `tenantId` that does not match the session is rejected. Submit `userId` always comes from the authenticated session; a client-supplied `userId` that does not match is rejected with `403 exec_protocol_user_mismatch`. The gateway re-verifies sha256 and byte count before returning bytes.

Unauthenticated callers are not shown `exec_protocol_production_refused` or `exec_protocol_config_refused`. Those errors are returned only after authentication. `OPENBOT_PRODUCTION_EXECUTION_MODE=production` still always refuses enablement.

The official image entry remains `node openbot.mjs gateway`. No separate tsx/src sidecar is required for this facade; it is mounted from the gateway HTTP stack.

## Isolation config

`gateway.execProtocol` is **off by default**. When enabling it, pass every isolation key explicitly (config object or `OPENBOT_EXEC_PROTOCOL_*` env). Signed isolation numbers are **not** auto-filled when a key is missing.

```json5
{
  gateway: {
    execProtocol: {
      enabled: true,
      // leaseToken: set via OPENBOT_EXEC_PROTOCOL_LEASE_TOKEN; do not commit it
      // controlPlaneUrl: "http://127.0.0.1:18790", // optional; otherwise http://{bind}:{port}
      profileName: "exec-protocol-v1-isolation",
      bind: "127.0.0.1",
      port: 18790,
      connectTimeoutMs: 3000,
      requestTimeoutMs: 5000,
      executionTimeoutMs: 60000,
      maxTransportRetries: 3,
      transportBackoffMs: [200, 400],
      idempotencyTtlMs: 86400000,
      cancelDeadlineMs: 10000,
      leaseTtlMs: 3600000,
      maxClockSkewMs: 30000,
    },
  },
}
```

Environment alternatives:

- `OPENBOT_EXEC_PROTOCOL_LEASE_TOKEN` — required when `leaseToken` is not in config. Never log this value.
- `OPENBOT_EXEC_PROTOCOL_CONTROL_PLANE_URL` — optional loopback URL override.
- The existing `OPENBOT_EXEC_PROTOCOL_BIND` / `PORT` / timeout / lease / backoff variables, all required when the config object does not itself contain the complete isolation key set.

`OPENBOT_PRODUCTION_EXECUTION_MODE=production` is still refused. Do not copy these isolation values into production defaults.

## Tight identity-header control

Default / production-shaped trusted-proxy behavior is **unchanged**: if `gateway.trustedProxies` includes loopback (`127.0.0.1`, `::1`) and a client talks directly to the gateway, `X-Forwarded-User` may still be accepted. That is the historical behavior (Hong Kong LIVE today still uses `trusted-proxy` + loopback `trustedProxies` + nginx zeroing `X-Forwarded-User`). This change does **not** pre-approve moving production `trustedProxies` to Hong Kong private source IPs, and it does **not** solve HK→A auth translation (still BLOCKED).

For isolation drills, set an **off-by-default** flag:

```json5
{
  gateway: {
    trustedProxies: ["127.0.0.1", "::1"],
    auth: {
      mode: "trusted-proxy",
      trustedProxy: {
        userHeader: "x-forwarded-user",
        platformAuth: { enabled: true },
        // Tight path: a mere loopback client cannot become an arbitrary user
        // by sending X-Forwarded-User.
        rejectDirectLoopbackIdentityHeaders: true,
        // Optional: designated 模拟入口 hop. If omitted, loopback identity
        // headers are rejected; platformAuth cookies still work.
        // entryHopHeader: "x-openbot-entry-hop", // default
        // entryHopCredential: set only in the isolation secret store; never commit
      },
    },
  },
}
```

In tight mode:

- Direct-to-gateway forged `X-Forwarded-User` from `127.0.0.1` / `::1` is **not** accepted as that user.
- Login through the designated 模拟入口 still works via a **membership-scoped** platformAuth session cookie. An unbound platform-super-admin cookie is not enough to download artifacts.
- If the entry needs to inject identity headers, it must also present `entryHopCredential` on `entryHopHeader` (default `x-openbot-entry-hop`). Never log the credential.
- A non-loopback address that is already in `trustedProxies` is unchanged, including default production-shaped proxy tests.

## Leftover blockers (not solved by this change)

- Cloud enterprise network / peering item 2-C (Hong Kong VPC to `10.21.88.0/24`) is not opened.
- HK→A auth translation remains BLOCKED.
- Production exec-protocol profile remains unimplemented and must refuse enablement.
- U2 / cloud PC remains BLOCKED.
- Official sandbox / browser business images are not on A/B.
- Production-volume restore RTO has only been exercised on small synthetic data.

Do not treat a green isolation unit test run as permission to squash-merge without 双规发布 review, and do not treat GitHub Checks account-quota failures as “CI passed”.
