# COLLAB CSC shadow-off WS observation baseline (2026-08-24)

Read-only verification that the production gateway agent WebSocket observation link is
live while all inbound/CSC flags are unset and shadow is OFF. No production mutation.

## Baseline (fixed)

- LIVE_SHA: `a12e4c59e5754e0c280b423c68c989c6973ac9b0`
- LEDGER_SEQ: 41
- SHADOW: OFF
- FLAGS: all unset (`OPENBOT_CHAT_INBOUND_*`, `OPENBOT_COLLAB`, `CONTEXT_SCOPE`)

## Execution context (redacted)

- Executed by `kiro-collab-csc` acting as operator over SSH on the production host; read-only capture.
- Channel: gateway agent WebSocket broadcast at loopback `ws://127.0.0.1:18789` (container `openbot-gateway-rc`, `--network host`).
- Tool: `scripts/capture-chat-depth-events.cjs` (main Appendix E), verified on host `sha256sum == c5bd973b15eec22344a9d2f8bc8aebff599661bc5a9cd200d4c235ee5a1d1d6b`.
- `ws` provisioned from the running container image (`ws@8.19.0`, dependency-free); no internet install.
- Token handling: resolved from the gateway's own config secret-ref `gateway.auth.token = {source: env, id: OPENBOT_GATEWAY_TOKEN}`; written to a `chmod 600` file; never printed to chat, argv, log, or JSONL; removed after the run. Auth mode observed: `trusted-proxy` with a loopback token gate.

## Phase 0 read-only gate (before)

```
EXPECTED_LIVE=a12e4c59e5754e0c280b423c68c989c6973ac9b0
ACTUAL_LIVE=a12e4c59e5754e0c280b423c68c989c6973ac9b0
HEALTHZ=200
READYZ={"ready":true,"failing":[]}
FLAGS_BEFORE=ALL_UNSET
PHASE_0=PASS
```

## Capture SMOKE_SUMMARY (60s, redacted)

```
AUTH_SOURCE=OPENBOT_OPERATOR_TOKEN_FILE
AUTH=PASS
WS_CONNECT=PASS
SUBSCRIPTION_ACK=PASS
NON_DEPTH_EVENT_VISIBLE=YES
DEPTH_EVENTS=0
RAW_TEXT_LEAKS=0
DEVICE_REGISTERED=NO
LIVE_TOUCHED=NO
FLAGS_CHANGED=NO
CAPTURE_EXIT=0
DEPTH_JSONL_LINES=0
```

Note: `DEPTH_EVENTS=0` is the expected shadow-OFF result and does not prove shadow works; it
only confirms the observation link is live while flags are unset. `NON_DEPTH_EVENT_VISIBLE=YES`
(a non-depth agent event was observed) plus the connect ack establishes the subscription path;
WS 101 alone was not treated as sufficient.

## Phase 6 sensitive-field scan

```
SENSITIVE_FIELD_SCAN=PASS
```

Field-name scan only on the JSONL (no content printed); JSONL had 0 records (no
`chat.depth_decided` under shadow-off). No `text/body/content/prompt/message/attachment(s)/token/secret/password/apiKey/authorization` field names present.

## Phase 7 production-unchanged (after)

```
ACTUAL_LIVE_AFTER=a12e4c59e5754e0c280b423c68c989c6973ac9b0
HEALTHZ_AFTER=200
READYZ_AFTER={"ready":true,"failing":[]}
FLAGS_AFTER=ALL_UNSET
CONTAINER_RESTARTED=NO (startedAt unchanged)
PRODUCTION_MUTATION=NONE
```

## Phase 8 cleanup

```
RAW_CAPTURE_REMOVED=YES
TOKEN_FILE_REMOVED=YES
TOOLING_REMOVED=YES (host left pristine)
```

## Acceptance conclusion

All acceptance criteria PASS: AUTH, WS_CONNECT, SUBSCRIPTION_ACK, NON_DEPTH_EVENT_VISIBLE=YES,
DEPTH_EVENTS=0, RAW_TEXT_LEAKS=0, DEVICE_REGISTERED=NO, LIVE_TOUCHED=NO, FLAGS_CHANGED=NO.
Baseline evidence `docs/design/evidence/collaboration-csc-shadow-off-baseline-2026-08-24.json`
is set to `status=PASS`.

## Next-stage admission (still gated)

Shadow remains OFF. This baseline does not enable anything. Enabling
`OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1` (same-SHA recreate with auto-rollback, ROUTER/KNOWLEDGE/TOOL/COLLAB/CONTEXT_SCOPE
kept unset) requires a separate, explicit production-owner authorization requested after this
baseline lands. `RELEASE_RECORD.md` and `releases.jsonl` are intentionally not modified by this stage.
