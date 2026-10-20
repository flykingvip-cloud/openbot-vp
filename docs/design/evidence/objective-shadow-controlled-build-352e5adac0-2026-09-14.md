# Controlled build and isolated deploy of origin/main `352e5adac0`

Recorded `2026-09-14T03:16:23Z`. Isolated worktree `openbot-task-focus-unify`.

This is **not** a LIVE cutover, **not** a LaunchAgent restart, and **not** a `launchd_gateway` window grant.

## What ran

1. `git fetch origin` then detached checkout of `origin/main` `352e5adac0fac59db8bf80c6b3aff072c2161b52`
2. `pnpm build` in that checkout
3. `cutover-from-ghcr.sh --plan --candidate 352e5adac0fac59db8bf80c6b3aff072c2161b52` (read-only; no `--stage`, no swap)
4. Isolated controlled Gateway on `127.0.0.1:18889` from the new `dist`, separate `HOME` / state, no shadow env
5. Rollback: stop `:18889`. LaunchAgent and production LIVE left running

Forbidden actions not taken: LaunchAgent rewrite, production flag inject, LaunchAgent restart, LIVE container swap, shadow JSONL collection, Phase 3a / 3b / 4 / 5.

## Build artifact

Read from the built file `dist/build-info.json` after `pnpm build`:

```json
{
  "version": "2026.7.12-rc.2",
  "commit": "352e5adac0fac59db8bf80c6b3aff072c2161b52",
  "builtAt": "2026-09-14T03:13:43.627Z",
  "probeModuleSha": "ea6e7337fbf3f1da"
}
```

Checksums:

| File                   | sha256                                                             |
| ---------------------- | ------------------------------------------------------------------ |
| `dist/build-info.json` | `92b56555c85480d2592de38f7cfcae4c61b31dea7fd1ad07e20627bb33ea5b11` |
| `dist/index.js`        | `92d94c307c59cdf5ccf15bb64daa95ee4d6178da81bfb9710960d0bbd071443c` |

`git merge-base --is-ancestor` of the **build-info commit** (not of a branch name):

| SHA                                                | Result   |
| -------------------------------------------------- | -------- |
| `#1107` `16cea426e711516629e52c0522c39a7a77628655` | ancestor |
| `#1120` `b03ffa66a8870f42042f4a0f743bd1b7cd1b6926` | ancestor |

Source tree at that commit contains `isTrustedHmacKeyFileStat` / `lstatSync` / `mode & 0o077`.

## Forward-only vs actual LIVE

`cutover-from-ghcr.sh --plan` read LIVE from `podman exec openbot-gateway-rc cat /app/dist/build-info.json`:

| Field                                       | Value                                       |
| ------------------------------------------- | ------------------------------------------- |
| LIVE `build-info.commit`                    | `16cea426e711516629e52c0522c39a7a77628655`  |
| candidate                                   | `352e5adac0fac59db8bf80c6b3aff072c2161b52`  |
| verdict                                     | `allow` (`candidate contains LIVE history`) |
| LIVE healthz                                | 200                                         |
| LIVE readyz                                 | `ready:true`, `failing:[]`                  |
| LIVE `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW*` | unset                                       |

`--stage` and the printed LIVE swap/rollback commands were **not** executed.

## Controlled Gateway observation

| Field                                       | Value                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| Bind                                        | `127.0.0.1:18889`                                                      |
| Process                                     | `openbot-gateway` pid `55489`                                          |
| How `build-info` was read                   | `dist/build-info.json` of the process cwd (same tree the PID executed) |
| healthz                                     | 200 `{"ok":true,"status":"live"}`                                      |
| readyz                                      | `ready:true`, `failing:[]`                                             |
| Process env shadow keys                     | none                                                                   |
| Isolated config contains `OBJECTIVE_SHADOW` | no                                                                     |
| Isolated `*objective-shadow*` files         | none                                                                   |

## Rollback verification

Stop `:18889`. Afterwards:

| Surface                        | Result                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `127.0.0.1:18889/healthz`      | connection refused                                                             |
| LaunchAgent plist sha256       | `9d52bbd8a078856831e5cccd03ffc5db11c7e5668f4ac29718100749ae58a0d5` (unchanged) |
| LaunchAgent shared-tree `dist` | `620c767fb1c47fa9e8206eee1b190165ecfeb1ff`                                     |
| LaunchAgent `:18789` healthz   | 200                                                                            |
| Production LIVE commit         | `16cea426e711516629e52c0522c39a7a77628655`                                     |
| Production LIVE healthz        | 200                                                                            |

## What this does not authorize

- Opening `sourceKind: launchd_gateway` (LaunchAgent is still `620c767fb1`)
- Swapping production `openbot-gateway-rc`
- Setting a production shadow flag
- Summing this process with synthetic / harness corpora
