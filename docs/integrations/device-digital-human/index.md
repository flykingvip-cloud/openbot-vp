---
summary: "Frozen v1 contract for the loopback device digital-human stub"
read_when:
  - Integrating a device platform with an OpenBot digital human
  - Running the local integrations v1 stub
title: "Device digital-human API"
---

# Device digital-human API

Version: integrations v1. This page is the contract for the loopback stub in `src/integrations/device-digital-human/`. It is the OpenBot side of a device-platform integration. The stub does not mount on the production gateway.

Machine-readable paths and schemas: [openapi.yaml](/integrations/device-digital-human/openapi.yaml). Staging and credential handoff: [Staging](/integrations/device-digital-human/staging).

## Frozen names

Do not rename these fields:

- `authorizationRef`
- `bindingVersion`
- `digitalHumanId`
- `deviceId`
- `assistant.digitalHumanId`
- `assistant.displayName`
- `assistant.avatar`
- `assistant.animationManifestUrl`
- `assistant.locale`
- `assistant.voiceHint`
- `assistant.status`
- `assistant.visibleText`
- `assistant.messageId`

HTTP prefix: `/api/integrations/v1`.

Responses also include `apiVersion` (`v1`), `protocolVersion` (`1`), `traceId`, and `timestamp`.

## Two identities

Every capability call needs both:

1. Service client HTTP Basic (`clientId:secret`).
2. `X-OpenBot-Grant-Credential`, returned once from grant exchange.

Consent clients (authorization codes and rebind) use Basic only. Bearer tokens, cookies, `X-Forwarded-User`, and `X-OpenBot-User` are rejected with `AUTH_INVALID`. The client cannot send `userId`, `tenantId`, `agentId`, `sessionKey`, or `userSubject` to choose an identity.

A missing object and an object that belongs to another client or grant both return `OBJECT_NOT_FOUND` with the same error body.

## Endpoints

| Method | Path                                             | Auth                                                |
| ------ | ------------------------------------------------ | --------------------------------------------------- |
| POST   | `/consent/authorization-codes`                   | consent Basic, PKCE S256                            |
| POST   | `/grants/exchange`                               | service Basic                                       |
| GET    | `/grants/{authorizationRef}`                     | service Basic + grant credential                    |
| POST   | `/grants/{authorizationRef}/revoke`              | service Basic + grant credential, idempotent        |
| POST   | `/grants/{authorizationRef}/rebind`              | consent Basic                                       |
| PUT    | `/grants/{authorizationRef}/device-capabilities` | service Basic + grant credential                    |
| GET    | `/grants/{authorizationRef}/device-events`       | service Basic + grant credential, SSE               |
| GET    | `/digital-humans/{digitalHumanId}`               | service Basic + grant credential                    |
| POST   | `/conversations`                                 | service Basic + grant credential                    |
| GET    | `/conversations/{conversationId}`                | service Basic + grant credential                    |
| POST   | `/conversations/{conversationId}/close`          | service Basic + grant credential                    |
| POST   | `/conversations/{conversationId}/turns`          | service Basic + grant credential, `Idempotency-Key` |
| GET    | `/runs/{runId}`                                  | service Basic + grant credential                    |
| GET    | `/runs/{runId}/events`                           | service Basic + grant credential, SSE               |
| POST   | `/runs/{runId}/cancel`                           | service Basic + grant credential                    |
| POST   | `/device-tool-requests/{requestId}/result`       | service Basic + grant credential, `Idempotency-Key` |
| POST   | `/media/upload-tickets`                          | service Basic + grant credential                    |
| PUT    | `/media/uploads/{ticket}`                        | ticket only, raw JPEG or PNG                        |

`GET /healthz` is stub process health, not part of the integration contract.

## Grants

1. Consent client posts an authorization code bound to `serviceAudience`, `redirectUri`, PKCE `codeChallenge`, `digitalHumanId`, `deviceId`, and `scopes`.
2. Service client exchanges `authorizationCode` + `codeVerifier`. The response includes `authorizationRef`, one-time `authorizationCredential`, `bindingVersion` (starts at 1), and `assistant`.
3. Later calls send the credential in `X-OpenBot-Grant-Credential`. Query does not return the credential.
4. Revoke is idempotent and emits device event `authorization.revoked` with `authorizationRef`, `bindingVersion`, `digitalHumanId`, and `deviceId`.
5. Rebind is a consent action. It increments `bindingVersion`, closes old conversations, cancels active runs, and rejects in-flight tool results that still carry the old version (`BINDING_MISMATCH`).

`bindingVersion` on a request must match the grant. A mismatch is `BINDING_MISMATCH`.

## Turns and run events

`POST /conversations/{id}/turns` requires `Idempotency-Key`. The same key and the same body return the same `runId` with `disposition: "duplicate"`. The same key and a different body return `IDEMPOTENCY_CONFLICT`. Accepted records are kept in memory for 24 hours (`IDEMPOTENCY_TTL_MS`). Restart clears them. A rejected validation does not consume the key. `traceId` is not part of the hash.

One conversation runs one turn at a time. A second turn while a run is open returns `SESSION_BUSY` and `Retry-After: 1`.

Run SSE is `GET /runs/{runId}/events`. `cursor` or `Last-Event-ID` is the last seen sequence or `eventId`. Events:

- `run.accepted`
- `run.started`
- `assistant.delta` (`speakable: false`, not for TTS)
- `assistant.visible` (`speakable: true`, stable sentence)
- `assistant.final` (`speakable: false`, `reconciliation: true`, do not speak it again)
- `approval.required` (OpenBot only)
- `tool.request` (summary, `speakable: false`)
- `run.completed`
- `run.failed` (`errorCode`, `retryable`)
- `run.cancelled` (`sideEffectsRolledBack: false`)

Envelope fields: `schemaVersion`, `eventId`, `sequence`, `seq`, `cursor`, `runId`, `turnId`, `conversationId`, `bindingVersion`, `type`, `payload`, `data` (same object as `payload`), `createdAt`, and `messageId` on assistant text. Consumers dedupe on `eventId`. A cursor older than the retained buffer returns `CURSOR_EXPIRED`. The stub keeps the latest 1000 events per stream in memory.

`assistant.final` is for reconciliation. Playback uses `assistant.visible` only.

Cancel reasons from the client: `barge_in`, `user`, `timeout`, `unbind`. The response separates `accepted` from the resulting `status`. Completed work is not reported as rolled back.

## Device events, camera, and media

`PUT .../device-capabilities` records a snapshot. Reporting a tool does not grant it. The only invocable tool is `camera.capture`, and only when the grant scope includes it.

`GET .../device-events` is the second SSE stream. It carries `tool.request`, `authorization.revoked`, `binding.updated`, and `run.cancelled` for an open capture. `tool.request` includes `requestId`, `authorizationRef`, `bindingVersion`, `runId`, `turnId`, `toolName`, constrained `params`, `expiresAt`, and `traceId`.

The device platform uploads JPEG or PNG bytes with a short-lived ticket (`PUT /media/uploads/{ticket}`) or places the object on its own HTTPS URL. OpenBot pulls `readUrl`. Pulls allow loopback only, unless `OPENBOT_DEVICE_DH_MEDIA_ALLOW_ORIGINS` lists an origin. Redirects, URL credentials, and non-loopback hosts are `MEDIA_INVALID`. Bytes must match PNG IHDR or JPEG SOF. Declared `contentType`, `width`, `height`, `byteLength`, and `checksum` (`sha256:` hex) must match. The stub does not inflate pixels.

A camera turn stays `waiting_tool` until a result, cancel, revoke, rebind, or timeout (`TOOL_TIMEOUT`). Late results after the run is closed return `LATE_RESULT` and do not resume the run. Results after revoke return `AUTH_REVOKED`.

Camera fulfillment asks the configured model for one speakable sentence. The default process does not call a model: it uses the offline placeholder hatch. Set `OPENBOT_DEVICE_DH_AGENT=1` to call the local OpenBot gateway instead. See [Staging](/integrations/device-digital-human/staging). Either way, this stub does not call an inventory MCP and must not claim that inventory was updated.

## Approvals

`approval.required` is emitted inside OpenBot. The device credential cannot approve. The stub accepts `POST /internal/approvals/{approvalId}` only with `X-OpenBot-Approval-Token`. An approval still does not claim that inventory was updated, because no business service is connected.

## Error codes

| Code                    | HTTP | When                                                          |
| ----------------------- | ---- | ------------------------------------------------------------- |
| `AUTH_INVALID`          | 401  | Missing or rejected client auth, bad PKCE, bad approval token |
| `AUTH_REVOKED`          | 401  | Grant revoked or expired                                      |
| `OBJECT_NOT_FOUND`      | 404  | Missing and forbidden objects, same body                      |
| `SCOPE_DENIED`          | 403  | Scope not on the consent client or the grant                  |
| `BINDING_MISMATCH`      | 409  | `bindingVersion`, device, or human does not match             |
| `IDEMPOTENCY_CONFLICT`  | 409  | Same key, different accepted body                             |
| `SESSION_BUSY`          | 409  | Conversation already has an open run                          |
| `CURSOR_EXPIRED`        | 409  | Event cursor is no longer buffered                            |
| `TOOL_TIMEOUT`          | 504  | Capture deadline passed                                       |
| `MEDIA_INVALID`         | 400  | Type, size, checksum, or URL rejected                         |
| `TIMEOUT`               | 504  | Media pull timed out                                          |
| `RUN_FAILED`            | 409  | Tool result failed without a more specific code               |
| `PARAM_UNSUPPORTED`     | 400  | Missing or forbidden field                                    |
| `DEVICE_OFFLINE`        | 409  | Capabilities missing or `online: false`                       |
| `CAMERA_BUSY`           | 409  | Device reported busy                                          |
| `USER_DENIED`           | 403  | Approval denied, or device denied the capture                 |
| `CANCELLED`             | 409  | Reserved for a cancelled result surfaced as an error          |
| `UPLOAD_FAILED`         | 400  | Device reported an upload failure                             |
| `RATE_LIMITED`          | 429  | Per-client request cap                                        |
| `LATE_RESULT`           | 409  | Result after the run or request closed                        |
| `UNKNOWN_AFTER_RESTART` | 409  | Device result was unknown; the stub will not rerun the tool   |
| `INTERNAL`              | 500  | Unexpected stub failure                                       |

Execution failures after a turn is accepted are also a terminal `run.failed` or `run.cancelled` event. `GET /runs/{id}` then shows the same terminal status.

## Known limits

- In-memory grants, runs, idempotency, events, and media. A restart loses them. There is no cross-process exactly-once tool guarantee.
- The stub does not mount on the production gateway. Real replies are a loopback HTTP call to a gateway that is already running beside it.
- Default model mode is the offline placeholder hatch (`OPENBOT_DEVICE_DH_STUB_PLACEHOLDER=1` forces it). `OPENBOT_DEVICE_DH_AGENT=1` calls `POST /v1/chat/completions` on `OPENBOT_DEVICE_DH_AGENT_BASE_URL` (default `http://127.0.0.1:18789`). A failed or empty agent reply is `run.failed` / `INTERNAL`. It does not fall back to the placeholder sentences.
- No inventory MCP. Vision and chat prompts forbid claiming an inventory write, and a reply that only claims one is `INTERNAL`.
- Image checks are container-level (magic, IHDR/SOF, declared metadata, size caps), not a full decoder.
- Approvals are an internal token on loopback, not the OpenBot product approval UI.
- Idempotency retention is 24 hours and only for accepted turns, exchanges that sent a key, and accepted tool results.
