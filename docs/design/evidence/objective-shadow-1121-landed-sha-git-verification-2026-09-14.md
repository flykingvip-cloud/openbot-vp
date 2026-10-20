# Phase 2 Cycle 0 gate-prep / window-application landed SHA Git verification (PR 1121)

Replay these commands. Do not treat a chat statement as landed evidence.

## Commands

```text
git fetch origin
git rev-parse origin/main
git log origin/main --oneline -8
git merge-base --is-ancestor 2746d1b28cef9b3873fa8d131bd594a2b88fffc0 origin/main
git merge-base --is-ancestor b03ffa66a8870f42042f4a0f743bd1b7cd1b6926 origin/main
git show --stat --format=fuller 2746d1b28cef9b3873fa8d131bd594a2b88fffc0
```

## Result recorded 2026-09-14T03:40:37Z

| Check                              | Result                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `git fetch origin`                 | exit 0 (isolated worktree `openbot-task-focus-unify`)                                                           |
| `git rev-parse origin/main`        | `2746d1b28cef9b3873fa8d131bd594a2b88fffc0`                                                                      |
| `git log origin/main --oneline -8` | tip is `2746d1b28c Phase 2: record PR 1120 Cycle 0 landed SHA (#1121)`                                          |
| ancestry                           | `2746d1b28cef9b3873fa8d131bd594a2b88fffc0` is an ancestor of `origin/main` (it is the tip)                      |
| GitHub API (secondary)             | PR 1121 `state=MERGED`, `mergeCommit=2746d1b28cef9b3873fa8d131bd594a2b88fffc0`, `mergedAt=2026-09-14T03:25:08Z` |

The land identity is the squash SHA above, not a PR head.

## Required contents on `origin/main`

Docs only. No runtime executor.

| Path                                                                                     | Role                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------ |
| `docs/design/evidence/objective-shadow-1120-landed-sha-git-verification-2026-09-14.md`   | `#1120` squash Git verification            |
| `docs/design/evidence/objective-shadow-controlled-build-352e5adac0-2026-09-14.md`        | controlled build + isolated `:18889` proof |
| `docs/design/evidence/objective-shadow-launchd-gateway-window-application-2026-09-14.md` | window application, **unsigned**           |
| `docs/design/evidence/objective-shadow-launchd-gateway-gate-prep-2026-09-14.md`          | gate-prep materials                        |
| `docs/design/openbot-task-focus-unify-phase2-shadow-observation-2026-09-13.md`           | protocol: window not authorized            |

`git diff` of the squash vs its parent does not add `claimWorkUnit`, Participation, Lease, Pointer, Contribution, or Ledger writers. Flag default remains OFF.

## Observation status after this verification

- Expert 2026-09-14 11:43: `#1121` gate-prep **passed**; formal `launchd_gateway` window **not authorized**
- `#1121` landed SHA is Git-verified: `2746d1b28cef9b3873fa8d131bd594a2b88fffc0`
- Cycle 0 remains `synthetic_observe_api` + `runtime_callsite_harness` only
- Formal window application must re-run SHA and deploy checks in a **writable git** checkout (`git fetch origin` must work). A shared-tree fetch permission failure does not change the gate and does not count as that re-verify
- This verification did not modify LaunchAgent, inject a production flag, restart Gateway, or collect shadow records
- Phase 3a / 3b / 4 / 5 are not approved
