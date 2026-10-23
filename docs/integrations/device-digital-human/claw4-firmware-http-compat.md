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

- **Adjacent (primary store):** device-digital-human stub HTTP (`listenDeviceDh`) serves `/api/v1/*` against the in-process `DeviceDhService`.
- **Gateway:** `handleClaw4FirmwareHttpRequest` owns the same paths when a `DeviceDhService` is injected (`setClaw4FirmwareServiceForTests` / ops bind). Without a backend → HTTP 503 for those paths only (does not claim other `/api/v1/*`).

## B3 field ambiguities (left open)

- Exact firmware message list field names beyond `{ id, role, text, turnId?, runId?, createdAt }` (SDK may want `speaker` / `ts` aliases).
- Whether `data.text` on upload must ever be the **assistant** reply instead of the ASR transcript (Claw4 PDF says 识别文本; we return ASR/pass-through text).
- `POST /api/v1/record/upload` body (PCM chunk vs WAV vs multipart) — reserved stub only.
- Whether firmware will send grant credential as-is long-term or expect a device-token mint on top of bind.
