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

| Knob                                    | Purpose                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `OPENBOT_DEVICE_DH_STUB`                | Must be `1` or the process exits                                                                                    |
| `OPENBOT_DEVICE_DH_STUB_CONFIG`         | Path to the client and digital-human JSON                                                                           |
| `OPENBOT_DEVICE_DH_STUB_PORT`           | Listen port, default `8787`                                                                                         |
| `OPENBOT_DEVICE_DH_STUB_HOST`           | Must stay loopback                                                                                                  |
| `OPENBOT_DEVICE_DH_APPROVAL_TOKEN`      | Loopback approval token, default `dev-approval-token`                                                               |
| `OPENBOT_DEVICE_DH_MEDIA_ALLOW_ORIGINS` | Comma-separated extra pull origins                                                                                  |
| `OPENBOT_DEVICE_DH_AGENT`               | `1` calls the local OpenBot gateway                                                                                 |
| `OPENBOT_DEVICE_DH_MODEL_MODE`          | `agent` or `placeholder`                                                                                            |
| `OPENBOT_DEVICE_DH_STUB_PLACEHOLDER`    | `1` forces the offline hatch, even if agent is set                                                                  |
| `OPENBOT_DEVICE_DH_AGENT_BASE_URL`      | Gateway origin, default `http://127.0.0.1:18789`                                                                    |
| `OPENBOT_DEVICE_DH_AGENT_TOKEN`         | Gateway bearer token. Falls back to `OPENBOT_GATEWAY_TOKEN`, then `OPENCLAW_GATEWAY_TOKEN`                          |
| `OPENBOT_DEVICE_DH_AGENT_ID`            | Debug override for `x-openclaw-agent-id`. Ignored unless `OPENBOT_DEVICE_DH_AGENT_DEBUG=1`. Not a default of `main` |
| `OPENBOT_DEVICE_DH_AGENT_DEBUG`         | `1` sends every grant to `OPENBOT_DEVICE_DH_AGENT_ID`. Product traffic uses each human's `gatewayAgentId`           |
| `OPENBOT_DEVICE_DH_AGENT_SESSION_KEY`   | Fixed UI session such as `space:aegis`. Ignored unless `OPENBOT_DEVICE_DH_AGENT_SESSION_FORCE=1`                    |
| `OPENBOT_DEVICE_DH_AGENT_SESSION_FORCE` | `1` pins every grant to `OPENBOT_DEVICE_DH_AGENT_SESSION_KEY`. Conversations then share one gateway session         |
| `OPENBOT_DEVICE_DH_AGENT_TIMEOUT_MS`    | Chat completion timeout, default `60000`                                                                            |
| `OPENBOT_DEVICE_DH_AGENT_ALLOW_REMOTE`  | `1` allows a non-loopback base URL                                                                                  |

Audit lines are JSON on stderr. They include `traceId`, `clientId`, `authorizationRef`, `deviceId`, `userSubject`, `tenantId`, `digitalHumanId`, `runId`, and `requestId`. They do not include client secrets, grant credentials, PKCE verifiers, read URLs, or image bytes.

Health: `GET /healthz` returns `{ "ok": true, "service": "device-digital-human-stub" }`.

## Credential rotation and rollback

Replace the secret in the config file and restart the process. Old Basic credentials fail with `AUTH_INVALID`. Existing in-memory grants die with the process, so the device platform must exchange a new authorization code.

Rollback is stopping the process. There is no database migration. Nothing in the production gateway reads this module.

## Monitoring

Watch stderr for `outcome: "denied"` and `outcome: "error"`, especially `AUTH_REVOKED`, `LATE_RESULT`, `MEDIA_INVALID`, and `TOOL_TIMEOUT`. A missing process is a failed `/healthz`. This stub has no metrics endpoint.

## Real agent and vision

The stub stays a separate loopback process. It does not register routes on the production gateway. When agent mode is on, a normal turn and a camera frame both call the gateway chat-completions route, which runs the same agent path as `openbot agent`.

Default target on the same machine as OpenBot:

```bash
export OPENBOT_DEVICE_DH_STUB=1
export OPENBOT_DEVICE_DH_AGENT=1
export OPENBOT_DEVICE_DH_AGENT_BASE_URL=http://127.0.0.1:18789
export OPENBOT_DEVICE_DH_AGENT_TOKEN="$OPENBOT_GATEWAY_TOKEN"
```

Put `gatewayAgentId` on each digital human in the stub config. That id is `x-openclaw-agent-id` and the `openclaw:<agentId>` model. A grant may use only the agent listed for its own human (`allowedGatewayAgentIds` when set, otherwise that one id). A human with no `gatewayAgentId` fails the run. The stub does not fall back to `main`.

```json
{ "digitalHumanId": "agent-demo-1", "gatewayAgentId": "demo-agent-1" }
```

The product session key is `device-dh:<digitalHumanId>:<conversationId>`. Two grants therefore do not share a gateway session. `OPENBOT_DEVICE_DH_AGENT_SESSION_KEY` is not applied unless `OPENBOT_DEVICE_DH_AGENT_SESSION_FORCE=1`. That force flag is a debug pin for one Control UI session, for example `space:aegis` (`http://127.0.0.1:18789/?session=space%3Aaegis`). Every grant then merges into that session. Leave the force flag unset for real traffic.

`OPENBOT_DEVICE_DH_AGENT_ID` is the same kind of override. It is used only when `OPENBOT_DEVICE_DH_AGENT_DEBUG=1`, and then every grant shares that one agent.

Call path:

1. `POST http://127.0.0.1:18789/v1/chat/completions`
2. Headers: `Authorization: Bearer <token>` when a token is set, `x-openclaw-agent-id`, `x-openclaw-session-key`, `x-openclaw-message-channel: webchat`
3. Body: `model` is `openclaw:<agentId>`, `stream` is true, `messages` is a system prompt plus the user text
4. After `camera.capture` bytes are pulled, the user message is a text prompt plus `image_url` with a `data:image/jpeg;base64,...` or `data:image/png;base64,...` URL. The gateway accepts those data URLs on this route. JPEG and PNG only.
5. The gateway SSE stream is accumulated first. Sentences that claim an inventory write are removed. One `assistant.delta` (`speakable: false`) then carries the remaining sentence, and the same sentence is `assistant.visible` plus reconciliation `assistant.final`.

The gateway serves this route only when `gateway.http.endpoints.chatCompletions.enabled` is true. It is off by default. Auth follows the gateway: token mode uses `gateway.auth.token` / `OPENBOT_GATEWAY_TOKEN`; password mode uses that password as the bearer value; `gateway.auth.mode=none` can omit the token. A 401, 404, timeout, empty reply, or missing `gatewayAgentId` ends the run with `run.failed` and `INTERNAL`. Agent mode does not fall back to the placeholder sentences or to agent `main`.

`POST /conversations/{id}/turns` stores the run and the idempotency record, then returns `202` and `runId` before the gateway call finishes. Progress is the run SSE. A retry with the same `Idempotency-Key` and the same body returns that `runId` with `disposition: "duplicate"` even while the gateway call is still open. A different key while the run is open is `SESSION_BUSY`.

Cancel aborts the stub's in-flight `fetch` to `/v1/chat/completions`. The stub also best-effort calls gateway WebSocket method `chat.abort` for that session key when agent mode is on. That call is not required for the stub result: `/v1/chat/completions` has no HTTP cancel, and closing the HTTP request only stops the SSE writer (`req.on("close")` does not abort the agent). Tools the agent already started are not rolled back (`sideEffectsRolledBack` stays false). After cancel, the stub does not emit another `assistant.visible` or `assistant.final`. `run.cancelled` is the terminal event.

Live secrets stay on the operator machine. CI does not call `127.0.0.1:18789`. Contract tests inject a mock completions server.

The base URL must be loopback unless `OPENBOT_DEVICE_DH_AGENT_ALLOW_REMOTE=1`. Do not put the token in the URL.

This stub still does not call an inventory MCP. The prompt tells the agent not to claim an inventory write. A reply that only claims one fails the run.

`OPENBOT_DEVICE_DH_STUB_PLACEHOLDER=1` keeps the offline hatch for a rehearsal without a gateway. That is the default when `OPENBOT_DEVICE_DH_AGENT` is unset, so `examples/rehearse.sh` does not need a key.

## What staging does not prove

- The default rehearsal does not call a live model. Agent mode does, on a gateway running beside the stub.
- `OPENBOT_DEVICE_DH_AGENT_ID` and `OPENBOT_DEVICE_DH_AGENT_SESSION_KEY` are debug overrides. Product runs use `gatewayAgentId` and `device-dh:<digitalHumanId>:<conversationId>`.
- Cancel aborts the stub HTTP call and best-effort `chat.abort`. It does not prove that gateway tools already in progress were stopped.
- No inventory write.
- No durable store. A crash is `UNKNOWN_AFTER_RESTART` from the device platform point of view: the run is gone, and the stub will not repeat a capture.
- No product approval screen. Approvals use the internal token.
- Media pull is loopback plus an explicit origin allowlist. Do not open arbitrary intranet URLs.
- JPEG and PNG fixtures under `examples/fixtures/` (`frame.png`, `frame.jpg`) are synthetic 1x1 images for the pull path.
