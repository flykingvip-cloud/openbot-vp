# Cycle 0 launchd_gateway writable-git RUNNING re-verify

Recorded `2026-09-14T05:06:20Z` in isolated worktree `openbot-task-focus-unify` after PR #1125 landed.

This is the writable-git re-verify required by protocol §8. It is **not** a `launchd_gateway` window grant, **not** a production cutover, and **not** another SHA-record-of-SHA-record.

Verdict: **fail closed**. No running surface contains both `#1107` and `#1120`. Do not inject a production flag, rewrite LaunchAgent, restart Gateway, collect or invent `launchd_gateway` records, or enter Phase 3a / 3b / 4 / 5.

## PR 1125 land (Git, secondary)

Replay. Do not treat a chat statement as landed evidence.

```text
git fetch origin
git rev-parse origin/main
git merge-base --is-ancestor e000ecf722116eed036cfbd4b0940230d9d61415 origin/main
git show --stat --format=fuller e000ecf722116eed036cfbd4b0940230d9d61415
```

| Check                  | Result                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `git fetch origin`     | exit 0                                                                                                          |
| `origin/main`          | `e000ecf722116eed036cfbd4b0940230d9d61415`                                                                      |
| ancestry               | that SHA is the tip                                                                                             |
| GitHub API (secondary) | PR 1125 `state=MERGED`, `mergeCommit=e000ecf722116eed036cfbd4b0940230d9d61415`, `mergedAt=2026-09-14T05:02:41Z` |

The squash is docs only. It does not change the observer identity of any Gateway.

## Hard condition 1–2: RUNNING `build-info.commit`

Read from the process or container. Branch / PR / `origin/main` were not substituted.

| Surface                                                    | How read                                                                                          | `commit`                                   | `builtAt`                  | `version`        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------- | ---------------- |
| Local LaunchAgent `ai.openbot.gateway`                     | program path `.../openbot/dist/build-info.json` (pid `46120`, cwd `/`, healthz 200, readyz ready) | `620c767fb1c47fa9e8206eee1b190165ecfeb1ff` | `2026-09-13T13:47:29.626Z` | `2026.7.12-rc.2` |
| Production LIVE `openbot-gateway-rc` on `root@8.217.93.71` | `ssh … podman exec openbot-gateway-rc cat /app/dist/build-info.json`                              | `16cea426e711516629e52c0522c39a7a77628655` | `2026-09-13T14:16:56.813Z` | `2026.7.12-rc.2` |

Ancestry of those **running** commits (exit 0 = yes):

| Check                  | LaunchAgent `620c767fb1` | LIVE `16cea426e711` | `origin/main` `e000ecf722` |
| ---------------------- | ------------------------ | ------------------- | -------------------------- |
| `#1107` `16cea426e711` | no                       | yes                 | yes                        |
| `#1120` `b03ffa66a887` | no                       | no                  | yes                        |
| Shadow env in process  | none                     | `UNSET`             | n/a                        |

`origin/main` containing both SHAs is **not** a substitute for a running process.

LaunchAgent program is still the shared-tree `dist/index.js`. File mtimes (`2026-09-13T21:47:29Z` local build-info) are older than pid start `2026-09-14 11:01:39`. This turn did not rebuild that tree and did not restart the job. `uptimeMs` at recording: `7453435`.

## Hard condition 3: deploy gates

`--plan` only. `--stage`, LIVE swap, and printed recreate commands were **not** executed.

```text
./deploy/production/scripts/cutover-from-ghcr.sh --plan --candidate e000ecf722116eed036cfbd4b0940230d9d61415
```

| Gate                | Result                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| Forward-only        | PASS / `allow` (`candidate contains LIVE history`) vs LIVE `16cea426e711` |
| Delivery alignment  | not run — no LIVE image / ledger publish this turn                        |
| Live image identity | not run — LIVE was not swapped                                            |

A forward-only pass for `origin/main` does not make that tip the RUNNING observer.

## Hard condition 4: LaunchAgent plist

Baseline from gate-prep: `9d52bbd8a078856831e5cccd03ffc5db11c7e5668f4ac29718100749ae58a0d5`

| Field                               | Value                                                              |
| ----------------------------------- | ------------------------------------------------------------------ |
| Current plist sha256                | `9d52bbd8a078856831e5cccd03ffc5db11c7e5668f4ac29718100749ae58a0d5` |
| Directly rewritten?                 | no                                                                 |
| Production flag injected this turn? | no                                                                 |
| LaunchAgent restarted this turn?    | no                                                                 |

## Hard condition 5: HMAC recoverability

`scripts/dev/objective-shadow-hmac-inject.sh check` (no key bytes):

```text
ok file_mode=600 keychain=openbot.objective-shadow.hmac
```

This proves the operator key file and Keychain still match. It does **not** prove a Gateway process loaded the file.

## Hard condition 6–7: window application / sign-off

Not filed as ready. A complete `launchd_gateway` application still requires a launchd (or equivalent) process whose own `build-info.commit` contains `#1107` and `#1120`, then separate expert sign-off.

The earlier isolated `:18889` / `352e5adac0` build remains deploy proof only. It is not reused as `sourceKind: launchd_gateway`.

## Observation status

```text
synthetic_observe_api       verified
runtime_callsite_harness    verified
launchd_gateway             pending (RUNNING missing #1120)
```

Phase 3a / 3b / 4 / 5 remain unapproved.

Next required action: deploy a build whose `build-info.commit` contains `#1107` and `#1120` through the **existing release path**, then re-read that process. Do not open another landed-SHA record unless Cycle 0 identity itself changes.
