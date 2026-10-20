# Cycle 0 evidence tip (on origin/main via PR 1112 + PR 1120)

Split reports, HMAC file inject, and key-file permission fail-closed checks are on `origin/main`. Replay the Git commands below. Do not treat a chat statement as landed evidence.

## Binding

| 项                                       | SHA                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Shadow implementation merge (PR 1107)    | `16cea426e711516629e52c0522c39a7a77628655`                                                          |
| Cycle 0 evidence squash (PR 1112)        | `78342a21b149e20d4342066dfd22fb84f2e89068`                                                          |
| HMAC perms + harness rename (PR 1120)    | `b03ffa66a8870f42042f4a0f743bd1b7cd1b6926`                                                          |
| Gate-prep + window application (PR 1121) | `2746d1b28cef9b3873fa8d131bd594a2b88fffc0`                                                          |
| Gate-pass record (PR 1122)               | `c671b8d818c0aecd10a16f1e93db42e07323c1d3`                                                          |
| 1122-record (PR 1123)                    | `afef8eb7d73c55368e888fa5cc7d9e5698f7cd33`                                                          |
| 1123-record (PR 1124)                    | `af5768ebf948c786f9027c1446a6f9cee42d6548`                                                          |
| 1124-record (PR 1125)                    | `e000ecf722116eed036cfbd4b0940230d9d61415`                                                          |
| RUNNING re-verify (PR 1126)              | `f73443dae6a9f326e09a8a775e641d2f5f814842`                                                          |
| `origin/main` at this verification       | `b07683f99da4c85c3145c5f2df04b7b184782fb7`                                                          |
| HMAC key-file implementation             | `src/objective-shadow/feature.ts` in `b03ffa66a887`                                                 |
| Synthetic + harness reports              | PR 1112 squash; `sourceKind` rename on PR 1120                                                      |
| LaunchAgent RUNNING observation          | `docs/design/evidence/objective-shadow-launchd-gateway-running-b07683f99d-2026-09-14.md`            |
| Window application (unsigned)            | `docs/design/evidence/objective-shadow-launchd-gateway-window-application-b07683f99d-2026-09-14.md` |

`16cea426e711516629e52c0522c39a7a77628655`, `b03ffa66a8870f42042f4a0f743bd1b7cd1b6926`, `f73443dae6a9f326e09a8a775e641d2f5f814842`, and `b07683f99da4c85c3145c5f2df04b7b184782fb7` are ancestors of `origin/main`. Local LaunchAgent RUNNING at this recording equals `b07683f99d`. Production LIVE is still `16cea426e711`.

## How to verify (no chat transcript)

```text
git fetch origin
git rev-parse origin/main
git merge-base --is-ancestor 16cea426e711516629e52c0522c39a7a77628655 origin/main
git merge-base --is-ancestor 78342a21b149e20d4342066dfd22fb84f2e89068 origin/main
git merge-base --is-ancestor b03ffa66a8870f42042f4a0f743bd1b7cd1b6926 origin/main
git show b03ffa66a8870f42042f4a0f743bd1b7cd1b6926:src/objective-shadow/feature.ts
git show b03ffa66a8870f42042f4a0f743bd1b7cd1b6926:docs/design/evidence/objective-shadow-observation-cycle-0-2026-09-13.md
git show b03ffa66a8870f42042f4a0f743bd1b7cd1b6926:docs/design/evidence/objective-shadow-observation-cycle-0-runtime-callsite-2026-09-13.md
```

## HMAC contract

- Keychain service `openbot.objective-shadow.hmac`
- File inject `OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY_FILE`
- Read path fail-closes unless `lstat` is a regular file, not a symlink, `mode & 0o077 === 0`, and owner is the current process user
- Ensure/check: `scripts/dev/objective-shadow-hmac-inject.sh`
- Key is not in the repo, JSONL, window state, or reports

## Two corpora (do not add together)

| sourceKind                 | report                                                                                     | records | first write              |
| -------------------------- | ------------------------------------------------------------------------------------------ | ------- | ------------------------ |
| `synthetic_observe_api`    | `docs/design/evidence/objective-shadow-observation-cycle-0-2026-09-13.md`                  | 12      | 2026-09-13T14:37:43.776Z |
| `runtime_callsite_harness` | `docs/design/evidence/objective-shadow-observation-cycle-0-runtime-callsite-2026-09-13.md` | 6       | 2026-09-13T14:50:56.566Z |

`runtime_callsite_harness` is `runPreparedReply` / `runCronIsolatedAgentTurn` / `executeCollaborationRound` / `spawnSubagentDirect` with stubbed side effects. It is not LaunchAgent production traffic. Do not add it to `synthetic_observe_api` or `launchd_gateway`. LaunchAgent was not modified.

Both reports: `forbiddenWriteAttempts = 0`, no plaintext leak, no duplicate runId, window open, runtime result unchanged, Phase 3a/3b/4/5 not approved. Expert 2026-09-14 11:43: `#1121` gate-prep passed; `launchd_gateway` window **not authorized**. Local LaunchAgent RUNNING `2026-09-14T10:42:42Z` is `b07683f99d` and contains `#1107` + `#1120`; production LIVE remains `16cea426e711` (lacks `#1120`). Window application filed, **not signed**. Do not inject a production flag or collect `launchd_gateway`. Do not add the three corpora.
