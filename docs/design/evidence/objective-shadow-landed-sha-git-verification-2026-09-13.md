# Phase 2 Shadow landed SHA Git verification

Replay these commands. Do not treat a chat statement as landed evidence.

## Commands

```text
git fetch origin
git rev-parse origin/main
git log origin/main --oneline -5
git merge-base --is-ancestor 16cea426e711516629e52c0522c39a7a77628655 origin/main
git diff --name-status 16cea426e711516629e52c0522c39a7a77628655^1 16cea426e711516629e52c0522c39a7a77628655 -- src/objective-shadow src/auto-reply/reply/get-reply-run.ts src/cron/isolated-agent/run.ts src/gateway/collaboration-dispatch/round-runtime.ts src/agents/subagent-spawn.ts
```

## Result recorded 2026-09-13T14:31:00Z

| Check                              | Result                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `git fetch origin`                 | exit 0 (isolated worktree `openbot-task-focus-unify`; FETCH_HEAD writable)                                      |
| `git rev-parse origin/main`        | `16cea426e711516629e52c0522c39a7a77628655`                                                                      |
| `git log origin/main --oneline -5` | first line is `16cea426e7 Merge pull request #1107 from gmood2008/cursor/task-focus-unify-phase0`               |
| ancestry                           | `16cea426e711516629e52c0522c39a7a77628655` is `origin/main`                                                     |
| GitHub API (secondary)             | PR 1107 `state=MERGED`, `mergeCommit=16cea426e711516629e52c0522c39a7a77628655`, `mergedAt=2026-09-13T14:15:01Z` |

Parents: `e404a3116edf843482fd4027dc079a1a6e5a48f1` (first) + `ce4ec809470c0478725e76614fc0c5b2188e670d` (PR tip).

## Required contents on `origin/main`

`src/objective-shadow/**` is present (22 files), including `cron-objective.ts`, `observe.ts`, `runtime.ts`, `observation-report.ts`, and tests.

Four ingress hooks on `origin/main`:

| Ingress       | File                                                      | Proof                                                                                                                      |
| ------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Chat          | `src/auto-reply/reply/get-reply-run.ts:631`               | `observeObjectiveShadowFromIngress`; candidates from `readConversationTaskCandidates({ conversationId: sessionKey })`      |
| Cron isolated | `src/cron/isolated-agent/run.ts:375`                      | dynamic import; `cronCandidatesFromJob`; `cronOccurrenceId` / `runId` = occurrence session, `cronJobId` = permanent job id |
| Collaboration | `src/gateway/collaboration-dispatch/round-runtime.ts:393` | `ingress: "collaboration_turn"`; `readSharedTaskCandidates`                                                                |
| Subagent      | `src/agents/subagent-spawn.ts:360`                        | `candidates: []`; `parentRunId: ctx.parentRunId`                                                                           |

Cron full-contract revision on `origin/main` `src/objective-shadow/cron-objective.ts`:

- `objectiveId` = `cron-obj:` + permanent job id
- `revision` digest includes hashed `goal`, `intentText`, `acceptanceRules`, compiled instruction, dataBindings, schedule, delivery, payload semantics
- raw goal / instruction text is not written to JSONL

## Out-of-scope check

`git diff` of the merge vs first parent adds forbidden-write **symbol lists and tests only** (`write-guard.ts`, `import-boundary.test.ts`). It does not add runtime `claimWorkUnit`, Participation, Lease, Pointer, Contribution, or Ledger writers. Flag default remains OFF in `src/objective-shadow/feature.ts`. Phase 3a / 3b / 4 / 5 are not approved and are not in this merge as executors.

## Observation status after this verification

- Landed SHA is Git-verified: `16cea426e711516629e52c0522c39a7a77628655`
- Observation window still `pending_first_write` until an independent HMAC key is set and the first redacted JSONL line is written
- Do not treat this document as Phase 3 approval
