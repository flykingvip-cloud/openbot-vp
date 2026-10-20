# Cycle 0 launchd_gateway window application

Submitted `2026-09-14T03:16:23Z`. Expert 2026-09-14 11:43: `#1121` **gate-prep passed**; this filing is **not** a `launchd_gateway` window grant.

Until a later application is signed in a **writable git environment** (fresh `git fetch origin`, RUNNING `build-info.commit`, forward-only, delivery-alignment, live-image identity), do not set a production flag, restart LaunchAgent, collect or invent `launchd_gateway` records, or start Phase 3a / 3b / 4 / 5.

A shared-tree `git fetch` permission failure does not change that conclusion and does not substitute for the writable-environment re-verify.

Build/deploy evidence: `docs/design/evidence/objective-shadow-controlled-build-352e5adac0-2026-09-14.md`

## Running artifact (required)

The observed running write point was the **isolated controlled Gateway** on `127.0.0.1:18889`, not LaunchAgent and not production LIVE.

| Field                 | Value (from the process, not git)                                             |
| --------------------- | ----------------------------------------------------------------------------- |
| `build-info.commit`   | `352e5adac0fac59db8bf80c6b3aff072c2161b52`                                    |
| `build-info.builtAt`  | `2026-09-14T03:13:43.627Z`                                                    |
| `build-info.version`  | `2026.7.12-rc.2`                                                              |
| How the file was read | `dist/build-info.json` of the cwd executed by pid `55489` (`openbot-gateway`) |

Ancestry of that **running** commit:

```text
git merge-base --is-ancestor 16cea426e711516629e52c0522c39a7a77628655 352e5adac0fac59db8bf80c6b3aff072c2161b52
git merge-base --is-ancestor b03ffa66a8870f42042f4a0f743bd1b7cd1b6926 352e5adac0fac59db8bf80c6b3aff072c2161b52
```

| Check                       | Result |
| --------------------------- | ------ |
| `#1107` ancestor of RUNNING | yes    |
| `#1120` ancestor of RUNNING | yes    |

Branch / PR SHA used as a stand-in for RUNNING: **not used**.

## Surfaces that are not this RUNNING

| Surface                          | `build-info.commit` after rollback         |
| -------------------------------- | ------------------------------------------ |
| LaunchAgent `ai.openbot.gateway` | `620c767fb1c47fa9e8206eee1b190165ecfeb1ff` |
| Production `openbot-gateway-rc`  | `16cea426e711516629e52c0522c39a7a77628655` |

A `launchd_gateway` report still requires a later LaunchAgent (or equivalent launchd) process whose own `build-info.commit` contains `#1107` and `#1120`. This filing does not claim that process exists yet.

## Deploy evidence

| Gate                | Command                                                                            | Exit / result                                                   |
| ------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Forward-only        | `cutover-from-ghcr.sh --plan --candidate 352e5adac0fac59db8bf80c6b3aff072c2161b52` | PASS / `allow` vs LIVE `16cea426e711`                           |
| Isolated healthz    | `curl http://127.0.0.1:18889/healthz`                                              | 200 `{"ok":true,"status":"live"}`                               |
| Isolated readyz     | `curl http://127.0.0.1:18889/readyz`                                               | `ready:true`, `failing:[]`                                      |
| Rollback            | stop `:18889`                                                                      | 18889 down; LIVE and LaunchAgent healthz 200, commits unchanged |
| Delivery alignment  | `./deploy/production/scripts/verify-delivery-alignment.sh`                         | not run — no LIVE image / ledger publish this turn              |
| Live image identity | `./deploy/production/scripts/verify-live-image-identity.sh`                        | not run — LIVE was not swapped                                  |

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

- Request only: permission to open a later observation whose `sourceKind` is `launchd_gateway`
- Observer must then be a launchd Gateway whose `build-info.commit` is read from that process and contains `#1107` and `#1120`
- Do not add counts to `synthetic_observe_api` or `runtime_callsite_harness`
- Phase 3a / 3b / 4 / 5 remain unapproved even if this window is granted
- Isolated `:18889` evidence above is build/deploy proof, not a `launchd_gateway` corpus
