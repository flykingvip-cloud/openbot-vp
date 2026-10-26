# Account Computer noVNC token refresh (2026-10-08)

## Symptom

ROADMAP v3 live smoke on main `6b6b749f` PASS overall, but the computer iframe sometimes painted plain text **Invalid or expired token** (gateway `handleNoVncObserverHttp` 404 body) while Desktop Session FSM still advanced (accept also synthesizes observer `postMessage`).

## Root cause

1. Observer tokens are **one-shot** (`consumeNoVncObserverToken` deletes on first successful GET). Remount / `iframe.src` restore of the same URL always yields 404.
2. UI `computerPreviewOpenPlan` short-circuited `open` → `status` whenever `inputGrantLive` looked true — including **AUTH_EXPIRED / RECONNECTING / STREAM_STALLED**. Credential refresh therefore never minted a fresh `streamUrl`.
3. `applyServerComputerPreview` could keep a consumed view URL when a later `open` minted a new one (same mode).
4. `HEAD` on `/sandbox/novnc?token=` previously went through `consume` (prefetch risk).

Accept harness note: `run-roadmap-v3-smoke-live.mjs` deliberately set `iframe.src = about:blank` then restored the same URL during stall probe — that alone reproduces the 404 body. Product must still self-heal via credential rotate (no `location.reload`).

## Fix (DESKTOP_NOVNC_TOKEN_REFRESH_M1)

- Force `browser.preview` **open** (token rotate) when session phase requires refresh; do not status-skip on live grant during anomaly.
- Always adopt a newly minted `streamUrl` when it differs.
- Same-origin iframe `@load` detects Invalid/expired body → `rotateComputerPreviewStreamCredential` (clear URL + AUTH_EXPIRED + credential reconnect).
- `HEAD` peeks via `describeNoVncObserverToken` and does **not** consume.

Iron rules unchanged: streamUrl ⇒ STREAM_ATTACHED only; no DPR; no `location.reload` recovery.
