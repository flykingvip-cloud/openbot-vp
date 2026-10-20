# Phase 2 Cycle 0 HMAC / harness rename landed SHA Git verification (PR 1120)

Replay these commands. Do not treat a chat statement as landed evidence.

## Commands

```text
git fetch origin
git rev-parse origin/main
git log origin/main --oneline -8
git merge-base --is-ancestor b03ffa66a8870f42042f4a0f743bd1b7cd1b6926 origin/main
git merge-base --is-ancestor 16cea426e711516629e52c0522c39a7a77628655 origin/main
git show --stat --format=fuller b03ffa66a8870f42042f4a0f743bd1b7cd1b6926
git diff --name-status b03ffa66a8870f42042f4a0f743bd1b7cd1b6926^ b03ffa66a8870f42042f4a0f743bd1b7cd1b6926 -- src/objective-shadow docs/design/evidence scripts/dev
```

## Result recorded 2026-09-14T02:38:52Z

| Check                              | Result                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `git fetch origin`                 | exit 0 (isolated worktree `openbot-task-focus-unify`)                                                           |
| `git rev-parse origin/main`        | `01b6d5a910ef74e2ca344b80f9418b5d6d21f9cb`                                                                      |
| `git log origin/main --oneline -8` | includes `b03ffa66a8 Phase 2: HMAC key-file perms and runtime_callsite_harness rename (#1120)`                  |
| ancestry                           | `b03ffa66a8870f42042f4a0f743bd1b7cd1b6926` is an ancestor of `origin/main`                                      |
| GitHub API (secondary)             | PR 1120 `state=MERGED`, `mergeCommit=b03ffa66a8870f42042f4a0f743bd1b7cd1b6926`, `mergedAt=2026-09-14T02:02:25Z` |

PR head `846b7770709e3f0e2ecc10f81837bcc83ce02e87` is **not** the land identity. The land identity is the squash SHA above.

`origin/main` later also contains `#1119` (`01b6d5a910`). The HMAC / harness-rename identity is the squash SHA, not the later Evolution commit.

## Required contents on `origin/main`

HMAC key-file fallback in `src/objective-shadow/feature.ts` on `b03ffa66a8870f42042f4a0f743bd1b7cd1b6926`:

- inline `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY` first
- else `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY_FILE`
- `lstat` before read: regular file, not symlink, `mode & 0o077 === 0`, owner is current process user
- missing / empty / directory / wide mode / wrong uid / no `getuid` fail-closed
- Key is not in the repo, JSONL, window state, or reports

Split corpora (do not add together):

| sourceKind                 | report on `origin/main`                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `synthetic_observe_api`    | `docs/design/evidence/objective-shadow-observation-cycle-0-2026-09-13.md`                  |
| `runtime_callsite_harness` | `docs/design/evidence/objective-shadow-observation-cycle-0-runtime-callsite-2026-09-13.md` |
| `launchd_gateway`          | not present                                                                                |

## Out-of-scope check

`git diff` of the squash vs its parent changes HMAC read/tests, Cycle 0 `sourceKind` rename, protocol, and spec notes. It does not add runtime `claimWorkUnit`, Participation, Lease, Pointer, Contribution, or Ledger writers. Flag default remains OFF. Phase 3a / 3b / 4 / 5 are not approved and are not in this merge as executors.

## Observation status after this verification

- Expert merge acceptance (2026-09-14): `#1120` squash identity is correct; Cycle 0 layering is correct
- Landed SHA is Git-verified: `b03ffa66a8870f42042f4a0f743bd1b7cd1b6926`
- Cycle 0 remains signed as `synthetic_observe_api` + `runtime_callsite_harness` only
- `launchd_gateway` is still pending — wait for a build whose `build-info.commit` contains `#1107` and `#1120`, then deploy by the existing release process
- A later Gateway `build-info.commit` must contain both `#1107` (`16cea426e711516629e52c0522c39a7a77628655`) and `#1120` (`b03ffa66a8870f42042f4a0f743bd1b7cd1b6926`) before a `launchd_gateway` report can be opened
- This verification did not modify LaunchAgent configuration and did not restart the running Gateway
- Do not treat this document as Phase 3 approval
