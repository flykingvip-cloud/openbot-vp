# Trusted-proxy migration — cross-agent handoff

Date: 2026-07-04

Status: **Backend browser-auth bridge landed — pending staging E2E**

From: trusted-proxy browser auth implementation (Cursor session)

---

## Verification (2026-07-04 — post-acceptance-feedback)

| Gate                                                             | Result                 |
| ---------------------------------------------------------------- | ---------------------- |
| `pnpm build`                                                     | Pass (run before land) |
| Platform session bridge (`auth.platform-browser-bridge.test.ts`) | Pass (9)               |
| Bootstrap HTTP token-mode bridge (`control-ui.http.test.ts`)     | Pass                   |
| UI bootstrap + platform-auth reconnect tests                     | Pass                   |
| `server.auth.control-ui.test.ts`                                 | Pass (21)              |
| UI classification / platform-auth / enterprise surfaces tests    | Pass                   |

---

## Core backend closure (addresses acceptance blockers)

### `src/gateway/auth.ts`

- **`authorizePlatformSessionConnect`**: platform cookie session → `method: "trusted-proxy"` (shared helper).
- **`token` / `password` mode + `ws-control-ui`**: platform session is tried **before** shared-secret checks when `platformAuth.enabled`.
- **`resolveControlUiBrowserAuthMode`**: browser reports `trusted-proxy` when platform auth is enabled (even if `gateway.auth.mode` stays `token` for CLI).
- **Default mode**: when `platformAuth` is enabled and `gateway.auth.mode` unset → defaults to `trusted-proxy` (`modeSource: platform-auth`).
- **`auth.mode=none` seam**: unchanged — platform identity still honored via `requirePlatformAuthConfig: false`.

### `src/gateway/server/ws-connection/connect-policy.ts`

- **`isTrustedProxyControlUiOperatorAuth`**: bypasses device-identity requirement when `authMethod === "trusted-proxy"` regardless of configured `auth.mode` (enables token-mode deployments with platform session).

### `src/gateway/control-ui.ts`

- Bootstrap **`authMode`** uses `resolveControlUiBrowserAuthMode` (browser authority).
- Bootstrap **`authSession`** populated via platform cookie when platform auth enabled, not only when `gateway.auth.mode === "trusted-proxy"`.

### Tests

- `src/gateway/auth.platform-browser-bridge.test.ts` — unit + gateway WS/HTTP integration (login, reconnect, bootstrap).
- `src/gateway/server/ws-connection/connect-policy.test.ts` — token mode + `authMethod: trusted-proxy` operator bypass.

---

## Prior deliverables (still valid)

- Error copy / classification (`auth-messages.ts`, `gateway-auth-classification.ts`, enterprise surfaces)
- Platform login redirect fix (`ui/src/ui/app.ts`, `platform-auth.ts`)
- Docs + deployment examples

---

## Remaining (ops, not code)

1. **Staging BFF E2E** — Stage A–C per `docs/gateway/trusted-proxy-deployment-examples.md`
2. **Firewall** — Gateway port only from `gateway.trustedProxies`
3. **Explicit production config** — set `gateway.auth.mode: "trusted-proxy"` + proxy headers (bridge allows gradual migration while `mode: token` + `platformAuth` coexists)

---

## Quick verify

```bash
OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test src/gateway/auth.platform-browser-bridge.test.ts
OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test src/gateway/server.auth.control-ui.test.ts
OPENBOT_TEST_PROFILE=low pnpm test \
  ui/src/ui/controllers/platform-auth.test.ts \
  ui/src/ui/ports/enterprise/views/enterprise-surfaces.browser.test.ts
```
