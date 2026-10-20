# Cycle 0 launchd_gateway gate prep (not a window application)

Recorded `2026-09-14T03:06:56Z` in isolated worktree `openbot-task-focus-unify`.

This document is **gate-prep only**. It is **not** authorization to open a `launchd_gateway` window, inject a production flag, rewrite LaunchAgent, restart Gateway, or enter Phase 3a / 3b / 4 / 5.

After a new build is deployed through the existing release process, submit a **separate** window application. That application must quote the **running** `build-info.commit` and deploy evidence. Branch names and PR SHAs are not proof of being live.

## Approval matrix

| 项                                 | 状态                                              |
| ---------------------------------- | ------------------------------------------------- |
| `#1120` squash                     | landed `b03ffa66a8870f42042f4a0f743bd1b7cd1b6926` |
| Cycle 0 `synthetic_observe_api`    | 已验证                                            |
| Cycle 0 `runtime_callsite_harness` | 已验证                                            |
| Gate-prep materials                | this document                                     |
| `launchd_gateway` window           | **not authorized**                                |
| Phase 3a / 3b / 4 / 5              | **not approved**                                  |

## Forbidden in this phase

- Rewrite LaunchAgent
- Inject `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW*` into a running or production process
- Restart Gateway
- Start Phase 3a / 3b
- Open Phase 4 alignment or Phase 5 completion gate
- Infer "already live" from `origin/main` or PR ancestry

## Required SHAs (code presence ≠ live)

These must later appear as **ancestors of the running `build-info.commit`**, not merely of `origin/main`:

| PR      | SHA                                        |
| ------- | ------------------------------------------ |
| `#1107` | `16cea426e711516629e52c0522c39a7a77628655` |
| `#1120` | `b03ffa66a8870f42042f4a0f743bd1b7cd1b6926` |

`origin/main` at this recording: `352e5adac0fac59db8bf80c6b3aff072c2161b52` (contains both). That fact **does not** mean any Gateway is running that tip.

## Current live / local baselines (read-only)

Do not treat these as the future window's observer SHA.

| Surface                                                   | `build-info.commit`                        | Contains `#1107` + `#1120` | Shadow flag in process env |
| --------------------------------------------------------- | ------------------------------------------ | -------------------------- | -------------------------- |
| Local LaunchAgent `ai.openbot.gateway` shared-tree `dist` | `620c767fb1c47fa9e8206eee1b190165ecfeb1ff` | no                         | no                         |
| Last recorded production LIVE (seq86 ledger)              | `16cea426e711516629e52c0522c39a7a77628655` | `#1107` only               | unset (seq86 record)       |

Local process at recording: `pid=46120`, `job state=running`, program still `.../openbot/dist/index.js`. This turn did not restart it.

## LaunchAgent not-rewritten baseline

Read-only snapshot of the plist. A later window application must show the same digest, or prove any change came from the existing release path rather than a direct edit.

```text
path: ~/Library/LaunchAgents/ai.openbot.gateway.plist
sha256: 9d52bbd8a078856831e5cccd03ffc5db11c7e5668f4ac29718100749ae58a0d5
mode: 0644
uid: 501
size: 3046
```

Observed env at last inspection: no `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW*` keys. Do not add them in this phase.

## HMAC hosting check (operator machine, not process inject)

`scripts/dev/objective-shadow-hmac-inject.sh check` at recording:

```text
ok file_mode=600 keychain=openbot.objective-shadow.hmac
```

Materialized path (no key bytes): `~/.openbot/secrets/objective-shadow-hmac`.

This proves the operator key file and Keychain still match. It does **not** prove a Gateway process loaded the file.

## New-build acceptance commands (run after deploy, not now)

Replay against the **running** artifact. Fail closed if any command is skipped.

```text
# 1. Read the live write point. Do not substitute origin/main or a PR SHA.
# Local LaunchAgent:
python3 -c 'import json; print(json.load(open("dist/build-info.json"))["commit"])'
# Production container (existing release path):
# podman exec openbot-gateway-rc cat /app/dist/build-info.json

# 2. The running commit must contain both landed SHAs.
git fetch origin
RUNNING=<paste build-info.commit>
git merge-base --is-ancestor 16cea426e711516629e52c0522c39a7a77628655 "$RUNNING"
git merge-base --is-ancestor b03ffa66a8870f42042f4a0f743bd1b7cd1b6926 "$RUNNING"

# 3. Forward-only against the previously running LIVE, not against a branch name.
./deploy/production/scripts/verify-forward-only.sh --candidate "$RUNNING"

# 4. Publication / image identity when the target is the production container.
./deploy/production/scripts/verify-delivery-alignment.sh
./deploy/production/scripts/verify-live-image-identity.sh

# 5. LaunchAgent plist digest must still match the baseline above
#    (or the release record must explain a non-direct rewrite).
shasum -a 256 "$HOME/Library/LaunchAgents/ai.openbot.gateway.plist"

# 6. HMAC recoverability without printing the key.
scripts/dev/objective-shadow-hmac-inject.sh check
```

A passing `origin/main` ancestry check is **not** a substitute for steps 1–2.

## Separate window application (later)

Only after the commands above pass on the running process, file a new application that includes:

- actual `build-info.commit` / `builtAt` / `version`
- forward-only and delivery-alignment output
- LaunchAgent plist digest vs this baseline
- HMAC check output (no key bytes)
- proposed log / window paths for a **new** `launchd_gateway` corpus
- statement that synthetic and harness counts will not be added in

Until that application is approved, Cycle 0 stays:

```text
synthetic_observe_api       verified
runtime_callsite_harness    verified
launchd_gateway             pending
```
