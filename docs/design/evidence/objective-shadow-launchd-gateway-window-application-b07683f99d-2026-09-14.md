# Cycle 0 launchd_gateway window application (`b07683f99d` LaunchAgent)

Submitted `2026-09-14T10:44:43Z`. This filing is **not** a window grant and **not** authorization to inject `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW*`, collect JSONL, or start Phase 3a / 3b / 4 / 5.

Observation: `docs/design/evidence/objective-shadow-launchd-gateway-running-b07683f99d-2026-09-14.md`

The earlier `:18889` / `352e5adac0` filing stays deploy proof only. It is not reused as `sourceKind: launchd_gateway`.

## Running artifact (required)

| Field                 | Value (from the process, not git)                                       |
| --------------------- | ----------------------------------------------------------------------- |
| `build-info.commit`   | `b07683f99da4c85c3145c5f2df04b7b184782fb7`                              |
| `build-info.builtAt`  | `2026-09-14T08:04:59.710Z`                                              |
| `build-info.version`  | `2026.7.12-rc.2`                                                        |
| How the file was read | LaunchAgent pid `99020` program path `.../openbot/dist/build-info.json` |

Ancestry of the **running** commit:

```text
git merge-base --is-ancestor 16cea426e711516629e52c0522c39a7a77628655 b07683f99da4c85c3145c5f2df04b7b184782fb7
git merge-base --is-ancestor b03ffa66a8870f42042f4a0f743bd1b7cd1b6926 b07683f99da4c85c3145c5f2df04b7b184782fb7
```

| Check                       | Result |
| --------------------------- | ------ |
| `#1107` ancestor of RUNNING | yes    |
| `#1120` ancestor of RUNNING | yes    |

Branch / PR SHA used as a stand-in for RUNNING: **not used**.

## Deploy evidence

`--plan` only. `--stage`, LIVE swap, and printed recreate commands were **not** executed.

| Gate                            | Command                                                                            | Exit / result                                      |
| ------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| Forward-only                    | `cutover-from-ghcr.sh --plan --candidate b07683f99da4c85c3145c5f2df04b7b184782fb7` | PASS / `allow` vs LIVE `16cea426e711`              |
| Delivery alignment              | `./deploy/production/scripts/verify-delivery-alignment.sh`                         | not run — no LIVE image / ledger publish this turn |
| Live image identity (container) | `./deploy/production/scripts/verify-live-image-identity.sh`                        | not run — LIVE was not swapped                     |

A forward-only pass does not make production LIVE the observer. LIVE remains `16cea426e711` (lacks `#1120`).

## LaunchAgent integrity

Baseline digest from gate-prep: `9d52bbd8a078856831e5cccd03ffc5db11c7e5668f4ac29718100749ae58a0d5`

| Field                               | Value                                                              |
| ----------------------------------- | ------------------------------------------------------------------ |
| Current plist sha256                | `9d52bbd8a078856831e5cccd03ffc5db11c7e5668f4ac29718100749ae58a0d5` |
| Directly rewritten?                 | no                                                                 |
| Production flag injected this turn? | no                                                                 |
| LaunchAgent restarted this turn?    | no                                                                 |

## HMAC recoverability

`scripts/dev/objective-shadow-hmac-inject.sh check` output (no key bytes):

```text
ok file_mode=600 keychain=openbot.objective-shadow.hmac
```

## Requested window

- Request only: permission to open an observation whose `sourceKind` is `launchd_gateway`
- Observer must remain this LaunchAgent process (or a later launchd process whose own `build-info.commit` still contains `#1107` and `#1120`)
- Do not add counts to `synthetic_observe_api` or `runtime_callsite_harness`
- Phase 3a / 3b / 4 / 5 remain unapproved even if this window is granted
- Until sign-off: no production flag, no collection, no invented records
