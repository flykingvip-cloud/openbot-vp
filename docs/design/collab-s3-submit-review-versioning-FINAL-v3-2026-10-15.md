# Collab S3 — Version-bound submit / accept / return (FINAL v3)

| Field   | Value                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------- |
| Date    | 2026-10-15 Asia/Shanghai                                                                                                |
| Status  | Code ready; **flags default OFF** — tip gray needs explicit allowlist                                                   |
| Spec    | `openbot-collab-self-run-FINAL-v3-2026-10-15.md` §S3 + expert hard requirements                                         |
| Depends | **P0 #731**, **S1 #734**, **S2 #735** (tip `4772926fcd…`)                                                               |
| Code    | `claim-contract.ts` (submit/accept/return), `submit-review-versioning.ts`, `collab-s3-submit-review-versioning.test.ts` |

## Scope

1. **交卷绑定版本**: `submitBoardItemForReview` requires `submissionId` (UUID) **and** `artifactVersion`; body summary alone never proves a submit.
2. **验收绑定提交**: `accept` / `return` require `expectedSubmissionId` === pending `submissionId`; wrong/stale version refused (`submission_version_mismatch`).
3. **并发与幂等**: same `submissionId`+`artifactVersion` while open → idempotent ok; different id while open → refuse; after return, pending id cleared so late accept of prior version cannot cover.
4. **空 / 无增量 / 纯复述**: empty body and exact restatement of last returned body never count as submit success.
5. **退回上限**: `acceptanceLoopMaxReturns` (default 3) → escalate human/coordinator wake; audit leaves reason + returnCount.
6. **客观验收标准**: accept must supply `checkedAcceptanceCriteria` covering board Acceptance; 主答权威 ≠ skip criteria. Proxy accept requires `proxyForActorId` + `proxyBasis`.
7. **状态语义**: `submitted_for_review` binds version; `returned` invalidates pending submission (revise + re-confirm plan via S2 gate); `accepted` terminal (no auto advance).

## Flags (stay OFF in this PR)

| Flag                                 | Default | Tip gray enable                    |
| ------------------------------------ | ------- | ---------------------------------- |
| `collaboration.task.claimContract`   | false   | Prefer scoped `001/grp-…` after P0 |
| `collaboration.task.wakeContract`    | false   | Unchanged                          |
| `collaboration.task.challengeWindow` | false   | Unchanged                          |
| `collaboration.runtimeNamespace`     | false   | Unchanged (N2 unsigned)            |
| `botMaySelfAdvanceWithoutHuman`      | false   | **S5 only**                        |

**Does not** open production gray writes. LIVE / Floor untouched. No second orchestrator.

## Acceptance

- Vitest: `collab-s3-submit-review-versioning.test.ts` + updated claim-contract / peer-review tests green
- LIVE_touched = false
- Empty / duplicate / stale version / criteria skip / over-cap return covered

## Out of scope

S4 heartbeat scheduler proof, S5 enabling `botMaySelfAdvanceWithoutHuman`, Floor live, multi-beat, tip production gray writes.
