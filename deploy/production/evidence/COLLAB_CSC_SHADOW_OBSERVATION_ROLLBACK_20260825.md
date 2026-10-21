# COLLAB CSC shadow observation + rollback (2026-08-25)

After the authorized shadow enable, a passive observation window was run and then shadow was
disabled by rolling back to the pre-shadow safety container (same SHA). Production ends at the
pre-enable shadow-OFF baseline. `RELEASE_RECORD.md` / `https://github.com/flykingvip-cloud/harness-Benchmark-Engine/blob/main/deploy/production/releases.jsonl` / LIVE ledger unchanged.

- SHADOW_ENABLED_NOW: NO
- LIVE_SHA (unchanged): `a12e4c59e5754e0c280b423c68c989c6973ac9b0`

## Observation window (240s, shadow ON, passive)

```
AUTH=PASS  WS_CONNECT=PASS  SUBSCRIPTION_ACK=PASS
NON_DEPTH_EVENT_VISIBLE=YES  DEPTH_EVENTS=0  RAW_TEXT_LEAKS=0
CAPTURE_EXIT=0  SENSITIVE_FIELD_SCAN=PASS
```

`DEPTH_EVENTS=0` reflects no natural inbound chat traffic during the passive window (traffic is
not synthetically generated). Shadow was enabled and the observation link was live; no anomaly, so
no automatic rollback was triggered during observation.

## Rollback (operator-directed disable)

Ran `csc-shadow-recreate-v2.sh rollback`, restoring `openbot-gateway-rc-prev-preshadow-20260825T101207Z`:
`ROLLBACK_OK healthz 200`.

Note: an initial rollback invocation was interrupted by concurrent main-workspace git activity (a
rebase conflict in `.loom/registry.yaml` on another agent's branch) and was killed at the command
timeout WITHOUT executing. Production stayed safe throughout (the shadow container remained Up and
healthy, the safety container intact), and the csc worktree was unaffected. The rollback was then
re-run cleanly and succeeded.

## Post-rollback verify

- build-info commit `a12e4c59e5754e0c280b423c68c989c6973ac9b0`
- healthz 200; readyz `{ready:true, failing:[]}`
- inbound/CSC/Context runtime flags: none (shadow OFF; inbound family key count 0)
- restored pre-shadow container running, RestartCount 0
- no leftover `prev-preshadow-20260825T101207Z` container (renamed back); rollback tooling removed from the host

## End state

Production is back to the pre-enable shadow-OFF baseline. Re-enabling shadow later is a single
authorized step (`csc-shadow-recreate-v2.sh enable`, strictly shadow-only) under a fresh explicit
authorization; `.env.docker` is now `600`, so the permission gate passes. No secrets, raw inspect,
or env values are included here.
