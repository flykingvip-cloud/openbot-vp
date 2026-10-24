---
title: Claw4 firmware HTTP compat
summary: Scheme B1 gateway/adjacent compat for Claw4 POST /api/v1/upload and conversation messages (P0 + P1 bind)
---

# Claw4 firmware HTTP compat (Scheme B1 + P0)

Claw4 firmware (`openclaw_screen`) posts whole WAV turns to `POST /api/v1/upload` and refreshes bubbles via `GET /api/v1/conversation/{id}/messages`. OpenBot implements that contract as a **compat layer on the gateway / integrations stub**, not inside the frozen device-control SDK surface.

This layer does **not**:

- Change frozen `/api/device-platform/v1` OpenAPI field names (`OPENBOT_CONTRACT_SHA=d7f0e1d834dc9ccece6723f6d71dea8fa0cfcb1f`; CONTROL freeze untouched)
- Implement metalio `AsrProvider` / `TtsProvider` (Agent A owns Providers; B injects A's audio bridge)
- Create a second conversation store
- Mix camera media tickets (JPEG/PNG) into the WAV upload route
- Flip `grayRelease` or PROMOTE anything
- Touch cam_b

## Routes

| Method | Path                                 | Notes                                                                         |
| ------ | ------------------------------------ | ----------------------------------------------------------------------------- |
| `POST` | `/api/v1/upload`                     | `Content-Type: audio/wav`. Maps to integrations `conversations` + `turns`.    |
| `GET`  | `/api/v1/conversation/{id}/messages` | Firmware-usable `{ code: 0, data: { conversationId, messages } }`.            |
| `POST` | `/api/v1/record/upload`              | **Reserved stub** — same success envelope; body semantics TODO (later slice). |

Optional conversation continuity uses the **query parameter** `conversationId` (not a custom header). Example: `POST /api/v1/upload?conversationId=conv_…`.

Also exposed (same store) as integrations read model:

- `GET /api/integrations/v1/conversations/{id}/messages`

## Auth model (restricted service callers)

Firmware auth reuses the **integrations service grant**, not a new device-control pair field. Callers are **restricted to service-role** Basic clients:

1. **`Authorization: Basic <serviceClientId:secret>`** — integrations **service** client only (consent Basic is rejected). Same audience used at grant exchange.
2. **`X-OpenBot-Grant-Credential: <one-time credential from grant exchange>`** — identifies the active grant.
3. **`X-Device-Id: <external device id>`** — **required**. Must equal `grant.deviceId`. Mismatch → `BINDING_MISMATCH`.

Revoke behavior: `requireGrant(..., allowRevoked=false)` runs first. A revoked (or expired) grant fails **immediately** with `AUTH_REVOKED` (HTTP 401) on upload, messages, and the record/upload stub. No turn is accepted after revoke. Unbound / missing credential → fail closed (`AUTH_INVALID`).

### Firmware MUST NOT embed platform Basic credentials

The Claw4 / metalio firmware image **must not** burn or ship the platform `serviceClientId:secret`. Those credentials stay on the **device-platform service** (Agent A / backend) that exchanges the grant and calls OpenBot. Firmware may carry only the short-lived grant credential (and device id) obtained after user bind — never the platform Basic pair.

Device-control pairing / bind / local revoke tokens stay on `/api/device-platform/v1`. This compat layer does not invent pairing fields on `/api/v1/*`.

## Single runtime topology (do not mix hosts)

One session must stay on **one** runtime host:

| Host | Port | Owns |
| ---- | ---- | ---- |
| Gateway (in-process bind) | **18789** | B1 **grant mint** + Claw4 **upload** / messages (when `OPENBOT_CLAW4_FIRMWARE_INPROCESS=1` + stub config, or inject) |
| Adjacent stub | **8787** | **Full** integrations surface: turns, SSE, media, rebind, revoke, **and** the same Claw4 `/api/v1/*` routes |

Rules:

- Mint + upload on **18789** only when the in-process bind shares one `DeviceDhService` (same process memory).
- Full turns / SSE / rebind / revoke remain on **8787** unless/until those routes are deliberately mounted on the gateway (they are not today).
- **Do not** mint a grant on 8787 and upload on 18789 (or the reverse) — stores do not share memory across processes; the credential will not resolve.
- Upload stays on this compat layer — **not** on the frozen device-control plane.

## ASR / text path (P0 honesty)

No FunASR / tenclass hardcoding. B does not implement Providers; it calls an injectable **audio bridge** aligned with Agent A's `AudioBridge.transcribeWav` (device-sdk `adapters/voice`).

### Formal / production (default)

Fail closed when ASR would invent a stub or treat silence as speech:

1. If a non-empty pass-through transcript is supplied → use it (on-device ASR). Precedence: **body field `transcript`** (when the HTTP adapter parses multipart/JSON) → header **`X-Transcript-Text`** → deprecated query **`transcript=`**.
2. Else if `setClaw4AudioBridge(...)` / request inject provides a bridge → `bridge.transcribeWav(wavBytes)` (Agent A's bridge when wired). Empty bridge output → `PARAM_UNSUPPORTED`.
3. Else → **`PARAM_UNSUPPORTED`** (no `[claw4-asr-stub]`, no silent pass-through).

### Explicit stub / test switch

Set **`OPENBOT_CLAW4_ASR_STUB=1`** (or `true` / `yes` / `stub`) to allow the labeled stub transcript `[claw4-asr-stub] audio/wav bytes=<n>` when no pass-through and no bridge. Joint smoke only — never treat this as production ASR.

### Speech must not live in URL query (access-log leak)

- **Do not** put user speech in `?transcript=` for new clients.
- Prefer **`X-Transcript-Text`** (or a future multipart/JSON **body** field `transcript`).
- Query `transcript=` remains for **backward compat** only and is **deprecated**. Access / request logs must use `redactClaw4UploadUrlForLog` (or equivalent) so the raw speech value is never written.

That text is submitted into the existing integrations turn API (`input.type = text`). Camera upload tickets remain on `/api/integrations/v1/media/*` and are rejected on this route when `Content-Type` is not `audio/wav`.

### Agent A audio bridge (pinned)

**Pin:** `DEVICE_SDK_AUDIO_BRIDGE_SHA` = **`9b7fb6a8b8bc1ac17563c71f216b112446cb7b0c`** (flykingvip-cloud/openbot-device-sdk PR #31 device-edge-auth 两跳 proxy on main; builds on #30 voice-harness / #29 Opus uplink / #28 VoiceEnv). Exports `createAudioBridge`, `createAudioBridgeFromVoiceEnv`, and `createVoiceProvidersFromEnv` from `adapters/voice` (also re-exported via metalio / services). SDK 侧另有 `npm run device-edge-auth -- --smoke`（device→edge→OpenBot 两跳 lab proxy 冒烟；本仓本 PR **不**接入 device-edge-auth / 两跳 proxy / 鉴权改动）。

`OPENBOT_CONTRACT_SHA` remains **`d7f0e1d834dc9ccece6723f6d71dea8fa0cfcb1f`** (unchanged; CONTROL freeze untouched).

B wires for real:

- **Preferred:** `bindClaw4AudioBridgeFromVoiceEnv` / Agent A `createAudioBridgeFromVoiceEnv` — default mock; `reference-http` via Agent A `OPENBOT_ASR_PROVIDER` / `OPENBOT_TTS_PROVIDER` (+ HTTP URLs). B only passes env into the factory (no vendor hardcoding).
- `bindClaw4AudioBridgeFromCreateAudioBridge(createAudioBridge, { asr, tts })` — calls Agent A factory and `setClaw4AudioBridge` (MODULE override path)
- `bindClaw4AudioBridgeFromDeviceSdk({ asr, tts })` — dynamic import via `OPENBOT_DEVICE_SDK_ROOT` (checkout at the pin SHA) or `OPENBOT_DEVICE_SDK_AUDIO_BRIDGE_MODULE`
- Abort in-flight ASR via `createAbortHandle().signal` (compat mirrors caller `AbortSignal` onto the handle)
- Product TTS: inject a **speaking** `TtsProvider` (or test `ProportionalSilenceTtsProvider`). **Reject** `OpusFrameTtsProvider` for product 播报 — it ignores `text` (VoiceEnv uses `forbidOpusFrameForSpoken:true`)
- Formal mode rejects stub ASR unless `OPENBOT_CLAW4_ASR_STUB=1`


### P1 startup bind (device-sdk audio bridge)

**Default off.** Setting `OPENBOT_DEVICE_SDK_ROOT` (or `OPENBOT_DEVICE_SDK_AUDIO_BRIDGE_MODULE`) alone does **not** mean the bridge is bound — those only locate Agent A `createAudioBridge`. Formal upload without a bound bridge / pass-through transcript still returns `PARAM_UNSUPPORTED`.

| Env | Semantics |
| --- | --------- |
| `OPENBOT_CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE=1` / `true` | **Allow** lazy bind of `createAudioBridge` into `setClaw4AudioBridge`. |
| `OPENBOT_CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE=0` / `false` | **Deny** bind. Explicit `0`/`false` **suppresses** the implicit path below. |
| (unset) | Default off, unless the implicit convenience below applies. |

**Implicit allow** (only when the explicit bind env is **unset**):

- `OPENBOT_CLAW4_FIRMWARE_INPROCESS=1` **and**
- (`OPENBOT_DEVICE_SDK_ROOT` **or** `OPENBOT_DEVICE_SDK_AUDIO_BRIDGE_MODULE`) is set

When bind is allowed:

1. **VoiceEnv (preferred when MODULE unset):** import `createAudioBridgeFromVoiceEnv` from the pinned SDK (`OPENBOT_DEVICE_SDK_ROOT` → `adapters/voice/src/index.ts`, or `OPENBOT_DEVICE_SDK_AUDIO_BRIDGE_MODULE` exporting that factory). Default providers are **mock**. Set Agent A `OPENBOT_ASR_PROVIDER` / `OPENBOT_TTS_PROVIDER` (e.g. `reference-http`) plus HTTP URL envs for real reference adapters — B only forwards env into the factory.
2. **MODULE override (fail-closed):** both of the following must be set; partial (only one) leaves unbound:

| Env | Role |
| --- | ---- |
| `OPENBOT_DEVICE_SDK_ASR_MODULE` | Module URL/path: `default` export factory/instance, or named `create*()` (e.g. `createAsrProvider` / `createMockAsrProvider`) |
| `OPENBOT_DEVICE_SDK_TTS_MODULE` | Module URL/path: speaking TTS factory/instance (`createTtsProvider` / `createProportionalSilenceTtsProvider`). **`OpusFrameTtsProvider` is rejected** |

If MODULE override is invalid, or VoiceEnv import/factory throws, OpenBot logs clearly and **leaves the bridge unbound** (no half-bind). Product ASR/TTS vendor adapters remain Agent A's work — B does not hardcode FunASR/EdgeTTS paths.

Lazy bind runs on the first formal transcript resolve that needs a bridge (`ensureClaw4DeviceSdkAudioBridgeBound`), same lifecycle style as the in-process firmware service bind.

**Pin tip:** **`9b7fb6a…`** (`9b7fb6a8b8bc1ac17563c71f216b112446cb7b0c`) — device-sdk PR #31（`npm run device-edge-auth -- --smoke`；device→edge→OpenBot 两跳 lab proxy；本仓不接入）. Builds on #30 voice-harness / #29 Opus uplink / #28 VoiceEnv. Opus 上行选型（#29）仍适用：`asrProvider.stream()` + `codec:"opus"`；PCM-only 才 `wrapAsrProviderWithOpusDecode`；WAV upload / `transcribeWav` 不变。

**Opus 上行选型（Agent A #29，本仓不改实现）：** 分包上行用 `asrProvider.stream()` 并标 `codec:"opus"`；仅当 Provider 只吃 PCM 时才 `wrapAsrProviderWithOpusDecode`；整段 WAV upload / `transcribeWav` 路径不变。绑桥逻辑、BIND 开关、MODULE/VoiceEnv、拒 `OpusFrameTtsProvider`、合同针 `d7f0e1d8…` / CONTROL_FREEZE **本 PR 一律不改**。

## Upload idempotency (P0)

`POST /api/v1/upload` maps to `submitTurn`, which requires a stable **Idempotency-Key**.

| Source | Behavior |
| ------ | -------- |
| Header **`Idempotency-Key`** | Preferred. Client-stable across retries. |
| (absent) | Content-addressed fallback: `claw4-upload:{authorizationRef}:{conversationId}:{sha256(wav)[0:32]}` |

`turnId` is derived from the idempotency key (not `randomId`), so a retry with the same key and same body replays instead of minting a second turn. **Do not** use a random turnId as the retry key.

## Response / messages shape (golden)

Success upload:

```json
{ "code": 0, "data": { "text": "…", "conversationId": "conv_…" } }
```

Messages list golden (this PR):

```json
{ "code": 0, "data": { "conversationId": "conv_…", "messages": [ { "id", "role", "text", "turnId?", "runId?", "createdAt" } ] } }
```

**Gap (do not invent a second golden here):** older firmware shapes using HTTP `200` without `code:0`, or `records` / `content` instead of `messages[].text`, remain pending firmware source / pcap confirmation. This PR does not add alternate response shapes.

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
| `OPENBOT_CLAW4_ASR_STUB=1`            | Allow labeled stub ASR when no bridge / pass-through (smoke only)  |
| `OPENBOT_CLAW4_BIND_DEVICE_SDK_AUDIO_BRIDGE` | `1`/`true` allow P1 bind; `0`/`false` deny (suppresses INPROCESS implicit); unset = default off |
| `OPENBOT_DEVICE_SDK_ASR_MODULE`       | Provider module for ASR factory/instance (required when bind allowed) |
| `OPENBOT_DEVICE_SDK_TTS_MODULE`       | Provider module for speaking TTS factory/instance (required when bind allowed) |
| `OPENBOT_DEVICE_SDK_ROOT` / `OPENBOT_DEVICE_SDK_AUDIO_BRIDGE_MODULE` | Locate `createAudioBridge` only — **not** “already bound” |

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

1. Mint a grant on 18789: `POST /api/integrations/v1/consent/authorization-codes` then `POST /api/integrations/v1/grants/exchange` (same Basic clients as the stub sample config — **service** caller only for Claw4).
2. Confirm Claw4 routes no longer 503: `POST /api/v1/upload` with Basic + `X-OpenBot-Grant-Credential` + `X-Device-Id` and `Content-Type: audio/wav` (prefer `X-Transcript-Text` or bridge; optional deprecated `transcript=`). Send a stable `Idempotency-Key` on retries.
3. `GET /api/v1/conversation/{id}/messages` returns `{ code: 0, data: { conversationId, messages } }` with `messages[].text`.
4. Stub 8787 remains a valid joint path if the gateway bind is off — but do not mix hosts for one session.

## B3 / P0 field ambiguities (left open)

- Exact firmware message list field names beyond `{ id, role, text, turnId?, runId?, createdAt }` (SDK may want `speaker` / `ts` aliases).
- Whether `data.text` on upload must ever be the **assistant** reply instead of the ASR transcript (Claw4 PDF says 识别文本; we return ASR/pass-through text).
- `POST /api/v1/record/upload` body (PCM chunk vs WAV vs multipart) — reserved stub only.
- Whether firmware will send grant credential as-is long-term or expect a device-token mint on top of bind.
- Old response shapes (`200` / `records` / `content`) — gap pending firmware source/pcap; **not** a second golden in this PR.
- Multipart body field `transcript` parser on raw `audio/wav` uploads — interface accepts `transcriptBody` when a future adapter parses it; header remains the practical non-query path today.
