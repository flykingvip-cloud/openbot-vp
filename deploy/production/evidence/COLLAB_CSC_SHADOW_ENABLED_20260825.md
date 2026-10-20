# COLLAB CSC shadow enabled (2026-08-25)

Production shadow-only enable, executed under explicit production-owner authorization. The
gateway was recreated from the SAME LIVE image with only `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1`
added (strictly shadow-only). No release/cutover; `RELEASE_RECORD.md` and `releases.jsonl` were
not modified and no LIVE ledger row was added.

- SHADOW_ENABLED: YES
- CONTAINER_RECREATED: YES (same SHA)
- LIVE_SHA (unchanged): `a12e4c59e5754e0c280b423c68c989c6973ac9b0`
- Executed: 2026-08-25 18:12:14 +0800

## Authorization

Enable ONLY `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1` (strictly shadow-only, progress-ledger excluded
per Option A); same-SHA recreate of `openbot-gateway-rc` accepting seconds of chat interruption;
auto-rollback on anomaly; `ROUTER` / `KNOWLEDGE_POLICY` / `TOOL_POLICY` / `PERSIST_EARLY` /
`OPENBOT_COLLAB` / `CONTEXT_SCOPE` kept off throughout.

## Enable

Ran `csc-shadow-recreate-v2.sh enable` (sha `bf28e11d…`):

- verify: LIVE `a12e4c59e575`, healthz 200, runtime inbound flags none, env-file gate PASS (mode 600)
- temp env: mode 600, from `/root/.openbot/.env.docker` minus the shadow line and `OPENBOT_PROGRESS_LEDGER_ENABLED`, plus `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1`; `.env.docker` not edited; deleted after run
- `shadow-only diff vs runtime: OK (only OPENBOT_CHAT_INBOUND_DEPTH_SHADOW added)`
- stopped + renamed live to safety `openbot-gateway-rc-prev-preshadow-20260825T101207Z`, recreated from `localhost/openbot:rc-amd64-provenance-a12e4c59e575`
- health-gate healthz 200; identity drift none; flag-verify only shadow; `ENABLE_OK`

## Post-verify (independent)

- build-info commit `a12e4c59e5754e0c280b423c68c989c6973ac9b0`
- healthz 200; readyz `{ready:true, failing:[]}`
- `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1`; inbound family key count exactly 1
- prohibited flags: none (`PERSIST_EARLY` / `DEPTH_ROUTER` / `KNOWLEDGE_POLICY` / `TOOL_POLICY` / `COLLAB` / `CONTEXT_SCOPE` all unset)
- `OPENBOT_PROGRESS_LEDGER_ENABLED`: absent (excluded)
- container StartedAt `2026-08-25 18:12:14 +0800` (new), RestartCount 0, image unchanged

## Safety container (rollback ready)

`openbot-gateway-rc-prev-preshadow-20260825T101207Z` (Exited 0) is kept. Rollback: stop + remove
current, rename safety back to `openbot-gateway-rc`, start, health-gate — or
`csc-shadow-recreate-v2.sh rollback` (kept at `/root/cap2`).

## Shadow observation window (120s, passive)

```
AUTH=PASS  WS_CONNECT=PASS  SUBSCRIPTION_ACK=PASS
NON_DEPTH_EVENT_VISIBLE=YES  DEPTH_EVENTS=0  RAW_TEXT_LEAKS=0
CAPTURE_EXIT=0  SENSITIVE_FIELD_SCAN=PASS
```

`DEPTH_EVENTS=0` reflects no inbound chat traffic during the passive window (traffic is not
synthetically generated). Shadow is enabled and the observation link is live; `chat.depth_decided`
events (with `wouldDepth` / `routeStrength`) will populate on natural traffic, subject to the same
redaction and invariant checks. No anomaly was observed, so no rollback was triggered.

## Not modified

`RELEASE_RECORD.md`, `releases.jsonl`, and the LIVE ledger are unchanged (shadow is a same-SHA flag
toggle, not a release/cutover). No secrets, raw inspect, or env values are included here.

## Next

Optionally run a longer or traffic-coincident observation window to capture `chat.depth_decided`
evidence on real traffic (same redaction + invariants). Rollback remains one step away via the kept
safety container.
