# Phase 2 Cycle 0 evidence landed SHA Git verification (PR 1112)

Replay these commands. Do not treat a chat statement as landed evidence.

## Commands

```text
git fetch origin
git rev-parse origin/main
git log origin/main --oneline -8
git merge-base --is-ancestor 78342a21b149e20d4342066dfd22fb84f2e89068 origin/main
git merge-base --is-ancestor 16cea426e711516629e52c0522c39a7a77628655 origin/main
git show --stat --format=fuller 78342a21b149e20d4342066dfd22fb84f2e89068
git diff --name-status 78342a21b149e20d4342066dfd22fb84f2e89068^ 78342a21b149e20d4342066dfd22fb84f2e89068 -- src/objective-shadow scripts/dev docs/design/evidence
```

## Result recorded 2026-09-14T00:09:44Z

| Check                              | Result                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `git fetch origin`                 | exit 0 (isolated worktree `openbot-task-focus-unify`)                                                           |
| `git rev-parse origin/main`        | `8dab07bb1dea8785aa3a1b29c244958ffae0620a`                                                                      |
| `git log origin/main --oneline -8` | includes `78342a21b1 Phase 2: Cycle 0 HMAC hosting and split observation evidence (#1112)`                      |
| ancestry                           | `78342a21b149e20d4342066dfd22fb84f2e89068` is an ancestor of `origin/main`                                      |
| GitHub API (secondary)             | PR 1112 `state=MERGED`, `mergeCommit=78342a21b149e20d4342066dfd22fb84f2e89068`, `mergedAt=2026-09-14T00:02:28Z` |

Parent (squash): `405fcea5766d21530b4ce9ccd476eb5ff4751cb7`.

`origin/main` later also contains `#1113` (`8dab07bb1d`). The Cycle 0 evidence identity is the squash SHA above, not the later Knowledge commit.

## Required contents on `origin/main`

HMAC recovery in `src/objective-shadow/feature.ts` on `78342a21b149e20d4342066dfd22fb84f2e89068`:

- `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY` first
- else `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY_FILE` via `readKeyFromFile`
- Key is not in the repo, JSONL, window state, or reports

Split corpora (do not add together):

| sourceKind                 | report on `origin/main`                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `synthetic_observe_api`    | `docs/design/evidence/objective-shadow-observation-cycle-0-2026-09-13.md`                  |
| `runtime_callsite_harness` | `docs/design/evidence/objective-shadow-observation-cycle-0-runtime-callsite-2026-09-13.md` |

Also present: Cycle 0 manifest, Cycle 0 evidence tip, HMAC inject script, runtime call-site probe, and HMAC file-inject tests.

## Out-of-scope check

`git diff` of the squash vs its parent adds observation evidence, HMAC file inject, and tests. It does not add runtime `claimWorkUnit`, Participation, Lease, Pointer, Contribution, or Ledger writers. Flag default remains OFF. Phase 1b Cron L2 prompt is unchanged. Phase 3a / 3b / 4 / 5 are not approved and are not in this merge as executors.

## Observation status after this verification

- Landed SHA is Git-verified: `78342a21b149e20d4342066dfd22fb84f2e89068`
- Cycle 0 split reports and HMAC file inject are on `origin/main`
- Cycle 0 still awaits expert sign-off
- Do not treat this document as Phase 3 approval
