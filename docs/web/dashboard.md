---
summary: "Gateway dashboard (Control UI) access and auth"
read_when:
  - Changing dashboard authentication or exposure modes
title: "Dashboard"
---

# Dashboard (Control UI)

The Gateway dashboard is the browser Control UI served at `/` by default
(override with `gateway.controlUi.basePath`).

Quick open (local Gateway):

- [http://127.0.0.1:18789/](http://127.0.0.1:18789/) (or [http://localhost:18789/](http://localhost:18789/))

Key references:

- [Control UI](/web/control-ui) for usage and UI capabilities.
- [Tailscale](/gateway/tailscale) for Serve/Funnel automation.
- [Web surfaces](/web) for bind modes and security notes.

Authentication is enforced at the WebSocket handshake. The required credential depends on `gateway.auth.mode`:

- `token` / `password`: `connect.params.auth` supplies the shared secret (CLI, nodes, local dev, break-glass).
- `trusted-proxy`: browser clients rely on the platform/BFF session and proxy-injected identity headers; no shared gateway token is required in normal product flows.

See `gateway.auth` in [Gateway configuration](/gateway/configuration) and [Trusted Proxy Auth](/gateway/trusted-proxy-auth).

Security note: the Control UI is an **admin surface** (chat, config, exec approvals).
Do not expose it publicly. For `token` mode, the UI keeps dashboard URL tokens in sessionStorage
for the current browser tab session and selected gateway URL, and strips them from the URL after load.
For enterprise browser deployments, prefer `trusted-proxy` behind an identity-aware reverse proxy.
Prefer localhost, Tailscale Serve, or an SSH tunnel for operator access.

## Fast path (recommended)

- After onboarding, the CLI auto-opens the dashboard and prints a clean (non-tokenized) link.
- Re-open anytime: `openbot dashboard` (copies link, opens browser if possible, shows SSH hint if headless).
- **Local dev (`token` mode)**: if the UI prompts for auth, paste the token from `gateway.auth.token` (or `OPENBOT_GATEWAY_TOKEN`) into Control UI settings.
- **Enterprise browser (`trusted-proxy` mode)**: sign in through platform or enterprise login; the Control UI reuses the platform/BFF session and does not ask for a shared gateway token in normal product flows.

## Token basics (local vs remote)

- **Localhost**: open `http://127.0.0.1:18789/`.
- **Token source (token/password mode only)**: `gateway.auth.token` (or `OPENBOT_GATEWAY_TOKEN`); `openbot dashboard` can pass it via URL fragment for one-time bootstrap, and the Control UI keeps it in sessionStorage for the current browser tab session and selected gateway URL instead of localStorage.
- If `gateway.auth.token` is SecretRef-managed, `openbot dashboard` prints/copies/opens a non-tokenized URL by design. This avoids exposing externally managed tokens in shell logs, clipboard history, or browser-launch arguments.
- If `gateway.auth.token` is configured as a SecretRef and is unresolved in your current shell, `openbot dashboard` still prints a non-tokenized URL plus actionable auth setup guidance.
- **Not localhost**: use Tailscale Serve (tokenless for Control UI/WebSocket if `gateway.auth.allowTailscale: true`, assumes trusted gateway host; HTTP APIs still need token/password), tailnet bind with a token, an SSH tunnel, or `trusted-proxy` behind an identity-aware reverse proxy. See [Web surfaces](/web) and [Trusted Proxy Auth](/gateway/trusted-proxy-auth).

## If you see “unauthorized” / 1008

- Ensure the gateway is reachable (local: `openbot status`; remote: SSH tunnel `ssh -N -L 18789:127.0.0.1:18789 user@host` then open `http://127.0.0.1:18789/`).
- For `AUTH_TOKEN_MISMATCH`, clients may do one trusted retry with a cached device token when the gateway returns retry hints. If auth still fails after that retry, resolve token drift manually.
- For token drift repair steps, follow [Token drift recovery checklist](/cli/devices#token-drift-recovery-checklist).
- Retrieve or supply the token from the gateway host:
  - Plaintext config: `openbot config get gateway.auth.token`
  - SecretRef-managed config: resolve the external secret provider or export `OPENBOT_GATEWAY_TOKEN` in this shell, then rerun `openbot dashboard`
  - No token configured: `openbot doctor --generate-gateway-token`
- In the dashboard settings, paste the token into the auth field, then connect.
