---
title: Claw4 firmware HTTP compat
summary: Scheme B1 gateway/adjacent compat for Claw4 POST /api/v1/upload and conversation messages
---

# Claw4 firmware HTTP compat (Scheme B1)

Claw4 firmware (`openclaw_screen`) posts whole WAV turns to `POST /api/v1/upload` and refreshes bubbles via `GET /api/v1/conversation/{id}/messages`. OpenBot implements that contract as a **compat layer on the gateway / integrations stub**, not inside the frozen device-control SDK surface.

This layer does **not**:

- Change frozen `/api/device-platform/v1` OpenAPI field names
- Implement metalio `AsrProvider` / `TtsProvider`
- Create a second conversation store
- Mix camera media tickets (JPEG/PNG) into the WAV upload route
- Flip `grayRelease` or PROMOTE anything

## Routes

| Method | Path                                 | Notes                                                                         |
| ------ | ------------------------------------ | ----------------------------------------------------------------------------- |
| `POST` | `/api/v1/upload`                     | `Content-Type: audio/wav`. Maps to integrations `conversations` + `turns`.    |
| `GET`  | `/api/v1/conversation/{id}/messages` | Firmware-usable `{ code: 0, data: { conversationId, messages } }`.            |
| `POST` | `/api/v1/record/upload`              | **Reserved stub** — same success envelope; body semantics TODO (later slice). |

Optional conversation continuity uses the **query parameter** `conversationId` (not a custom header). Example: `POST /api/v1/upload?conversationId=conv_…`.

Also exposed (same store) as integrations read model:

- `GET /api/integrations/v1/conversations/{id}/messages`

## Auth model (for Agent A / device-sdk)

Firmware auth reuses the **integrations service grant**, not a new device-control pair field:

1. **`Authorization: Basic <serviceClientId:secret>`** — integrations service client (same audience used at grant exchange).
2. **`X-OpenBot-Grant-Credential: <one-time credential from grant exchange>`** — identifies the active grant.
3. **`X-Device-Id: <external device id>`** — **required**. Must equal `grant.deviceId`. Mismatch → `BINDING_MISMATCH`.

Revoke behavior: `requireGrant(..., allowRevoked=false)` runs first. A revoked (or expired) grant fails **immediately** with `AUTH_REVOKED` (HTTP 401) on upload, messages, and the record/upload stub. No turn is accepted after revoke.

Device-control pairing / bind / local revoke tokens stay on `/api/device-platform/v1`. This compat layer does not invent pairing fields on `/api/v1/*`.

## ASR / text path (WAV-only first slice)

No FunASR / tenclass hardcoding.

1. If query **`transcript=`** or header **`X-Transcript-Text`** is non-empty → **pass-through** (test / on-device ASR). Query wins when both are set (UTF-8 friendly).
2. Otherwise → labeled **stub** transcript: `[claw4-asr-stub] audio/wav bytes=<n>`.

That text is submitted into the existing integrations turn API (`input.type = text`). Camera upload tickets remain on `/api/integrations/v1/media/*` and are rejected on this route when `Content-Type` is not `audio/wav`.

## Response shape

Success:

```json
{ "code": 0, "data": { "text": "…", "conversationId": "conv_…" } }
```

Errors use the same envelope with non-zero `code` (HTTP status) and `error: { code, message, retryable }` using integrations business codes (`AUTH_REVOKED`, `PARAM_UNSUPPORTED`, …).

## Where it is mounted

- **Adjacent (primary joint path):** device-digital-human stub HTTP (`listenDeviceDh`) on port **8787** serves `/api/v1/*` against the in-process `DeviceDhService`. Keep using this for Agent A / device-sdk loopback until the gateway inject is enabled.
- **Gateway (18789):** `handleClaw4FirmwareHttpRequest` owns the same paths when a `DeviceDhService` is configured. Without a backend → HTTP 503 `UNAVAILABLE` for those paths only (does not claim other `/api/v1/*`).

### Enabling the gateway in-process backend (local 18789)

Default gateway leaves Claw4 routes on 503 so production cam_b / grayRelease stay untouched. Two ways to bind a backend:

1. **Programmatic inject** (tests / custom ops): call `setClaw4FirmwareService(service)` before requests (alias: `setClaw4FirmwareServiceForTests`).
2. **Env in-process bind** (ops for local gateway): set both of:
   - `OPENBOT_CLAW4_FIRMWARE_INPROCESS=1`
   - `OPENBOT_DEVICE_DH_STUB_CONFIG` — path to the same stub clients JSON used by the 8787 stub (for example `src/integrations/device-digital-human/examples/stub-clients.sample.json`)

Optional (same as the adjacent stub):

| Env                                   | Role                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- |
| `OPENBOT_DEVICE_DH_APPROVAL_TOKEN`    | Approval token for the in-process service (default `dev-approval-token`) |
| `OPENBOT_DEVICE_DH_AGENT=1`           | Turn model calls local gateway chat completions instead of placeholder |
| `OPENBOT_DEVICE_DH_STUB_PLACEHOLDER=1`| Force offline placeholder hatch                                      |
| `OPENBOT_DEVICE_DH_MEDIA_ALLOW_ORIGINS` | Extra media pull origins                                           |

Restart / kickstart the gateway after setting env so the lazy bind runs. The env bind creates a **gateway-local** store — it does not share memory with a separate 8787 process.

### Grant mint on local 18789 (same store as Claw4)

When the in-process bind above is on (or a service is injected), the gateway also owns the **grant mint** surface against that same `DeviceDhService`:

| Method | Path | Notes |
| ------ | ---- | ----- |
| `POST` | `/api/integrations/v1/consent/authorization-codes` | Consent client Basic; PKCE S256 |
| `POST` | `/api/integrations/v1/grants/exchange` | Service client Basic; returns `authorizationRef` + credential |
| `GET` | `/api/integrations/v1/grants/{authorizationRef}` | Service Basic + `X-OpenBot-Grant-Credential` |

Joint can mint on **18789** and immediately use the credential on Claw4 `/api/v1/upload` without a temporary ops seed and without crossing to 8787. The rest of `/api/integrations/v1` (turns, SSE, media, rebind, revoke, …) stays **unmounted** on the gateway.

**Default / production:** with `OPENBOT_CLAW4_FIRMWARE_INPROCESS` unset and no inject, grant paths are **not claimed** (fail closed / unchanged). If INPROCESS is set but `OPENBOT_DEVICE_DH_STUB_CONFIG` is missing/invalid, grant mint returns HTTP 503 `UNAVAILABLE`.

**Stub 8787** remains a valid full joint path (`OPENBOT_DEVICE_DH_STUB=1` on port 8787) for the complete integrations API.

This does **not** reverse-proxy `OPENBOT_DEVICE_DH_STUB_URL` onto the gateway and does **not** mount the full `/api/integrations/v1` surface on 18789.

### Local verify (after bind)

1. Mint a grant on 18789: `POST /api/integrations/v1/consent/authorization-codes` then `POST /api/integrations/v1/grants/exchange` (same Basic clients as the stub sample config).
2. Confirm Claw4 routes no longer 503: `POST /api/v1/upload` with Basic + `X-OpenBot-Grant-Credential` + `X-Device-Id` and `Content-Type: audio/wav` (optional `X-Transcript-Text` / `transcript=`).
3. `GET /api/v1/conversation/{id}/messages` returns `{ code: 0, data: { conversationId, messages } }`.
4. Stub 8787 remains a valid joint path if the gateway bind is off.

## B3 field ambiguities (left open)

- Exact firmware message list field names beyond `{ id, role, text, turnId?, runId?, createdAt }` (SDK may want `speaker` / `ts` aliases).
- Whether `data.text` on upload must ever be the **assistant** reply instead of the ASR transcript (Claw4 PDF says 识别文本; we return ASR/pass-through text).
- `POST /api/v1/record/upload` body (PCM chunk vs WAV vs multipart) — reserved stub only.
- Whether firmware will send grant credential as-is long-term or expect a device-token mint on top of bind.
