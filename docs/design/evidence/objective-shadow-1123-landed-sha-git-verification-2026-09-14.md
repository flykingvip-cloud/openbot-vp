# Phase 2 Cycle 0 1122-record landed SHA Git verification (PR 1123)

Replay these commands. Do not treat a chat statement as landed evidence.

## Commands

```text
git fetch origin
git rev-parse origin/main
git log origin/main --oneline -8
git merge-base --is-ancestor afef8eb7d73c55368e888fa5cc7d9e5698f7cd33 origin/main
git merge-base --is-ancestor  c671b8d818c0aecd10a16f1e93db42e07323c1d3 origin/main
git show --stat --format=fuller afef8eb7d73c55368e888fa5cc7d9e5698f7cd33
```

## Result recorded 2026-09-14T04:25:21Z

| Check                              | Result                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `git fetch origin`                 | exit 0 (isolated worktree `openbot-task-focus-unify`)                                                           |
| `git rev-parse origin/main`        | `afef8eb7d73c55368e888fa5cc7d9e5698f7cd33`                                                                      |
| `git log origin/main --oneline -8` | tip is `afef8eb7d7 Phase 2: record PR 1122 Cycle 0 landed SHA (#1123)`                                          |
| ancestry                           | `afef8eb7d73c55368e888fa5cc7d9e5698f7cd33` is an ancestor of `origin/main` (it is the tip)                      |
| GitHub API (secondary)             | PR 1123 `state=MERGED`, `mergeCommit=afef8eb7d73c55368e888fa5cc7d9e5698f7cd33`, `mergedAt=2026-09-14T04:24:19Z` |

The land identity is the squash SHA above, not a PR head. `origin/main` also contains `#1117` (`8963d9bb1e`) between `#1122` and this squash. The Cycle 0 record identity is the squash SHA, not `#1117`.

## Required contents on `origin/main`

Docs only. No runtime executor.

| Path                                                                                   | Role                            |
| -------------------------------------------------------------------------------------- | ------------------------------- |
| `docs/design/evidence/objective-shadow-1122-landed-sha-git-verification-2026-09-14.md` | `#1122` squash Git verification |
| protocol status                                                                        | window **unauthorized**         |

`git diff` of the squash vs its parent does not add `claimWorkUnit`, Participation, Lease, Pointer, Contribution, or Ledger writers.

## Observation status after this verification

- `#1123` landed SHA is Git-verified: `afef8eb7d73c55368e888fa5cc7d9e5698f7cd33`
- `#1121` gate-prep remains passed; `launchd_gateway` window **not authorized**
- Cycle 0 stays `synthetic_observe_api` + `runtime_callsite_harness` only
- Formal window application must re-run SHA and deploy checks in a writable git environment
- This verification did not modify LaunchAgent, inject a production flag, restart Gateway, or collect shadow records
- Phase 3a / 3b / 4 / 5 are not approved
