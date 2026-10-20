---
summary: "Staging handoff for the device digital-human loopback stub"
read_when:
  - Handing the device digital-human stub to a device-platform integrator
  - Rehearsing the camera and revoke loop
title: "Device digital-human staging"
---

# Device digital-human staging

The stub is a separate loopback process. Do not point production gateway ingress at it. Contract: [Device digital-human API](/integrations/device-digital-human).

## Start

From the repository root:

```bash
export OPENBOT_DEVICE_DH_STUB=1
export OPENBOT_DEVICE_DH_STUB_CONFIG="$PWD/src/integrations/device-digital-human/examples/stub-clients.sample.json"
export OPENBOT_DEVICE_DH_STUB_PORT=8787
pnpm exec tsx src/integrations/device-digital-human/stub-server.ts
```

Stdout prints `listening on http://127.0.0.1:8787`. The process refuses to start unless `OPENBOT_DEVICE_DH_STUB=1`, and it binds `127.0.0.1` only. `OPENBOT_DEVICE_DH_STUB_PORT` defaults to `8787`. `0` asks the OS for an ephemeral port.

Sample clients (secrets are fixtures, at least 16 characters, not production credentials):

- `consent-sim` / `consent-secret-16+` / role `consent` / humans `agent-demo-1`, `agent-demo-2` / scopes `chat`, `camera.capture`, `media.read`
- `device-platform` / `service-secret-16+` / role `service` / redirect `https://device.example/callback`

Copy `src/integrations/device-digital-human/examples/stub-clients.sample.json` to a local `stub-clients.json` and replace secrets before any shared staging host. Keep that file out of git.

## Rehearse

```bash
OPENBOT_DEVICE_DH_STUB_PORT=8787 \
  bash src/integrations/device-digital-human/examples/rehearse.sh
```

The script starts the stub, exchanges a grant, submits a camera turn, pulls `examples/fixtures/frame.png`, checks `assistant.visible` / `assistant.final`, cancels a second turn, and revokes the grant. Success prints `rehearse ok`.

Tests:

```bash
pnpm exec vitest run --config vitest.config.ts \
  src/integrations/device-digital-human/contract.test.ts \
  src/integrations/device-digital-human/examples/examples.test.ts
```

## Ops

| Knob                                    | Purpose                                               |
| --------------------------------------- | ----------------------------------------------------- |
| `OPENBOT_DEVICE_DH_STUB`                | Must be `1` or the process exits                      |
| `OPENBOT_DEVICE_DH_STUB_CONFIG`         | Path to the client and digital-human JSON             |
| `OPENBOT_DEVICE_DH_STUB_PORT`           | Listen port, default `8787`                           |
| `OPENBOT_DEVICE_DH_STUB_HOST`           | Must stay loopback                                    |
| `OPENBOT_DEVICE_DH_APPROVAL_TOKEN`      | Loopback approval token, default `dev-approval-token` |
| `OPENBOT_DEVICE_DH_MEDIA_ALLOW_ORIGINS` | Comma-separated extra pull origins                    |

Audit lines are JSON on stderr. They include `traceId`, `clientId`, `authorizationRef`, `deviceId`, `userSubject`, `tenantId`, `digitalHumanId`, `runId`, and `requestId`. They do not include client secrets, grant credentials, PKCE verifiers, read URLs, or image bytes.

Health: `GET /healthz` returns `{ "ok": true, "service": "device-digital-human-stub" }`.

## Credential rotation and rollback

Replace the secret in the config file and restart the process. Old Basic credentials fail with `AUTH_INVALID`. Existing in-memory grants die with the process, so the device platform must exchange a new authorization code.

Rollback is stopping the process. There is no database migration. Nothing in the production gateway reads this module.

## Monitoring

Watch stderr for `outcome: "denied"` and `outcome: "error"`, especially `AUTH_REVOKED`, `LATE_RESULT`, `MEDIA_INVALID`, and `TOOL_TIMEOUT`. A missing process is a failed `/healthz`. This stub has no metrics endpoint.

## What staging does not prove

- No live model, vision model, or inventory write.
- No durable store. A crash is `UNKNOWN_AFTER_RESTART` from the device platform point of view: the run is gone, and the stub will not repeat a capture.
- No product approval screen. Approvals use the internal token.
- Media pull is loopback plus an explicit origin allowlist. Do not open arbitrary intranet URLs.
- JPEG and PNG fixtures under `examples/fixtures/` (`frame.png`, `frame.jpg`) are synthetic 1x1 images for the pull path.
