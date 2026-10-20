# Phase 2 Cycle 0 1123-record landed SHA Git verification (PR 1124)

Replay these commands. Do not treat a chat statement as landed evidence.

## Commands

```text
git fetch origin
git rev-parse origin/main
git log origin/main --oneline -8
git merge-base --is-ancestor af5768ebf948c786f9027c1446a6f9cee42d6548 origin/main
git merge-base --is-ancestor afef8eb7d73c55368e888fa5cc7d9e5698f7cd33 origin/main
git show --stat --format=fuller af5768ebf948c786f9027c1446a6f9cee42d6548
```

## Result recorded 2026-09-14T04:47:46Z

| Check                              | Result                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `git fetch origin`                 | exit 0 (isolated worktree `openbot-task-focus-unify`)                                                           |
| `git rev-parse origin/main`        | `af5768ebf948c786f9027c1446a6f9cee42d6548`                                                                      |
| `git log origin/main --oneline -8` | tip is `af5768ebf9 Phase 2: record PR 1123 Cycle 0 landed SHA (#1124)`                                          |
| ancestry                           | `af5768ebf948c786f9027c1446a6f9cee42d6548` is an ancestor of `origin/main` (it is the tip)                      |
| GitHub API (secondary)             | PR 1124 `state=MERGED`, `mergeCommit=af5768ebf948c786f9027c1446a6f9cee42d6548`, `mergedAt=2026-09-14T04:46:36Z` |

The land identity is the squash SHA above, not a PR head. `#1124` sits directly on `#1123` (`afef8eb7d73c55368e888fa5cc7d9e5698f7cd33`). No other squash sits between them. The Cycle 0 record identity is this squash, not a later SHA-record PR.

## Required contents on `origin/main`

Docs only. No runtime executor.

| Path                                                                                   | Role                            |
| -------------------------------------------------------------------------------------- | ------------------------------- |
| `docs/design/evidence/objective-shadow-1123-landed-sha-git-verification-2026-09-14.md` | `#1123` squash Git verification |
| protocol status                                                                        | window **unauthorized**         |

`git diff` of the squash vs its parent does not add `claimWorkUnit`, Participation, Lease, Pointer, Contribution, or Ledger writers.

## Observation status after this verification

- `#1124` landed SHA is Git-verified: `af5768ebf948c786f9027c1446a6f9cee42d6548`
- `#1121` gate-prep remains passed; `launchd_gateway` window **not authorized**
- Cycle 0 stays `synthetic_observe_api` + `runtime_callsite_harness` only
- Formal window application must re-run SHA and deploy checks in a writable git environment
- This verification did not modify LaunchAgent, inject a production flag, restart Gateway, or collect shadow records
- Phase 3a / 3b / 4 / 5 are not approved
- Stop the SHA-record-of-SHA-record chain here. The next required action is a writable-git re-verify of a RUNNING Gateway whose `build-info.commit` contains `#1107` and `#1120`, or a new expert grant. Do not open another landed-SHA record unless Cycle 0 identity itself changes.
