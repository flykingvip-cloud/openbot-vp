# Phase 2 Cycle 0 1121-gate-pass record landed SHA Git verification (PR 1122)

Replay these commands. Do not treat a chat statement as landed evidence.

## Commands

```text
git fetch origin
git rev-parse origin/main
git log origin/main --oneline -8
git merge-base --is-ancestor  c671b8d818c0aecd10a16f1e93db42e07323c1d3 origin/main
git merge-base --is-ancestor 2746d1b28cef9b3873fa8d131bd594a2b88fffc0 origin/main
git show --stat --format=fuller  c671b8d818c0aecd10a16f1e93db42e07323c1d3
```

## Result recorded 2026-09-14T04:12:57Z

| Check                              | Result                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `git fetch origin`                 | exit 0 (isolated worktree `openbot-task-focus-unify`)                                                           |
| `git rev-parse origin/main`        | `c671b8d818c0aecd10a16f1e93db42e07323c1d3`                                                                      |
| `git log origin/main --oneline -8` | tip is `c671b8d818 Phase 2: record PR 1121 Cycle 0 landed SHA (#1122)`                                          |
| ancestry                           | `c671b8d818c0aecd10a16f1e93db42e07323c1d3` is an ancestor of `origin/main` (it is the tip)                      |
| GitHub API (secondary)             | PR 1122 `state=MERGED`, `mergeCommit=c671b8d818c0aecd10a16f1e93db42e07323c1d3`, `mergedAt=2026-09-14T04:12:01Z` |

The land identity is the squash SHA above, not a PR head.

## Required contents on `origin/main`

Docs only. No runtime executor.

| Path                                                                                     | Role                                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `docs/design/evidence/objective-shadow-1121-landed-sha-git-verification-2026-09-14.md`   | `#1121` squash Git verification                   |
| `docs/design/openbot-task-focus-unify-phase2-shadow-observation-2026-09-13.md`           | `#1121` gate-prep passed; window **unauthorized** |
| `docs/design/evidence/objective-shadow-launchd-gateway-window-application-2026-09-14.md` | filing is not a window grant                      |

`git diff` of the squash vs its parent does not add `claimWorkUnit`, Participation, Lease, Pointer, Contribution, or Ledger writers.

## Observation status after this verification

- `#1122` landed SHA is Git-verified: `c671b8d818c0aecd10a16f1e93db42e07323c1d3`
- Expert 2026-09-14 11:43 remains in force: `#1121` gate-prep passed; `launchd_gateway` window **not authorized**
- Cycle 0 stays `synthetic_observe_api` + `runtime_callsite_harness` only
- Formal window application must re-run SHA and deploy checks in a writable git environment
- This verification did not modify LaunchAgent, inject a production flag, restart Gateway, or collect shadow records
- Phase 3a / 3b / 4 / 5 are not approved
