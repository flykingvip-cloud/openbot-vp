# Cycle 0 LaunchAgent RUNNING observation `b07683f99d`

Recorded `2026-09-14T10:42:42Z` in isolated worktree `openbot-task-focus-unify`. Read-only. This turn did not restart LaunchAgent, rewrite the plist, inject a production flag, swap LIVE, or collect `launchd_gateway` records.

This is **not** a window grant. SHA ancestry for the local LaunchAgent process now passes. Collection still requires a signed `launchd_gateway` window application.

## Running artifact (from the process, not git)

| Field                 | Value                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Surface               | LaunchAgent `ai.openbot.gateway`                                                            |
| pid                   | `99020` (previous observation was `46120` / `620c767fb1`)                                   |
| started               | `2026-09-14 16:05:52` local                                                                 |
| program               | `/usr/local/bin/node` `/Users/daniel/AI项目/openbot/dist/index.js` gateway `--port` `18789` |
| `build-info.commit`   | `b07683f99da4c85c3145c5f2df04b7b184782fb7`                                                  |
| `build-info.builtAt`  | `2026-09-14T08:04:59.710Z`                                                                  |
| `build-info.version`  | `2026.7.12-rc.2`                                                                            |
| How the file was read | `dist/build-info.json` next to the program path in launchctl                                |
| healthz               | 200 `{"ok":true,"status":"live"}`                                                           |
| readyz                | `ready:true`, `failing:[]`, `uptimeMs=9345652`                                              |
| Shadow env            | none (`OBJECTIVE_SHADOW*` absent from launchctl print)                                      |

`dist/index.js` mtime `2026-09-14T16:04:23Z` and `build-info.json` mtime `2026-09-14T16:04:59Z` are older than pid start. The process loaded that build.

On-disk `dist` contains `isTrustedHmacKeyFileStat` / `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY_FILE` (for example `dist/ingress-hook-B05VRh-j.js`). Shared-tree git HEAD at recording was `cursor-grok/control-ui-csp-reconnect` `d5d9bedf2e`, which is **not** the observer identity. Observer identity is the running `build-info.commit`.

## Ancestry of that running commit

```text
git merge-base --is-ancestor 16cea426e711516629e52c0522c39a7a77628655 b07683f99da4c85c3145c5f2df04b7b184782fb7
git merge-base --is-ancestor b03ffa66a8870f42042f4a0f743bd1b7cd1b6926 b07683f99da4c85c3145c5f2df04b7b184782fb7
```

| Check                   | Result |
| ----------------------- | ------ |
| `#1107` ancestor        | yes    |
| `#1120` ancestor        | yes    |
| Branch used as stand-in | no     |

`origin/main` at recording was the same SHA (`#1127` squash). That match is additional, not a substitute for reading the process file.

## Surfaces that are not this RUNNING

| Surface                         | `build-info.commit`                        | `#1107` | `#1120` | Shadow |
| ------------------------------- | ------------------------------------------ | ------- | ------- | ------ |
| Production `openbot-gateway-rc` | `16cea426e711516629e52c0522c39a7a77628655` | yes     | no      | unset  |

LIVE healthz 200, readyz ready. This observation does not claim production is the observer.

## Integrity / HMAC

| Check                 | Result                                                             |
| --------------------- | ------------------------------------------------------------------ |
| Plist sha256          | `9d52bbd8a078856831e5cccd03ffc5db11c7e5668f4ac29718100749ae58a0d5` |
| Plist rewritten here? | no                                                                 |
| Flag injected here?   | no                                                                 |
| Restarted here?       | no (pid already `99020` before this turn)                          |
| HMAC `check`          | `ok file_mode=600 keychain=openbot.objective-shadow.hmac`          |

## Status

```text
synthetic_observe_api       verified
runtime_callsite_harness    verified
launchd_gateway             SHA ancestry pass on local LaunchAgent; window unauthorized
```

Phase 3a / 3b / 4 / 5 remain unapproved. Do not add the three corpora.
