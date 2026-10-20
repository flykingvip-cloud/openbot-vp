# Phase 1B Item 7 Batch 9–12 CR2 handoff rebind

这是 **evidence rebind only**。未改业务实现。不是新的 retirement batch。不吸收 Batch 13 或已单独接受的 Batch 14/S15。Batch 9–12 **仍不视为 Accepted**，等待 Codex 仅复审 CR2。

`git fetch origin` 后：

- `git rev-parse origin/main` = `697c65c905c624ec80aba2a3386a00a7d0cc818a`
- `git merge-base --is-ancestor 697c65c905c624ec80aba2a3386a00a7d0cc818a origin/main` = true

| Field                           | Value                                      |
| ------------------------------- | ------------------------------------------ |
| status                          | cr2-evidence-rebind                        |
| evidenceRebindOnly              | true                                       |
| rebindOf                        | #643                                       |
| batch9to12Accepted              | false                                      |
| absorbsUnacceptedBatches        | false                                      |
| lastAcceptedRetirementBaseline  | 29                                         |
| remaining / liveWriteWatchIndex | 29 / 29                                    |
| retiredThisChange               | 0                                          |
| item7                           | not-met                                    |
| phase1bExecutionBlocked         | true                                       |
| phase1bUnlock                   | not-issued                                 |
| deployAuthorized                | false                                      |
| live                            | forbidden                                  |
| productionWrite                 | false                                      |
| productionCatalogWrite          | none                                       |
| schemaV2ProductionWrite         | false                                      |
| origin/main                     | `697c65c905c624ec80aba2a3386a00a7d0cc818a` |
| candidateSha                    | `697c65c905c624ec80aba2a3386a00a7d0cc818a` |

未改 `src/gateway/server-methods/agents-handler-workspace-locator.ts`。未改 canonical unlock decision。未启动 Batch 15 或任何新 retirement batch。

## 定向测试（rebind 后复跑）

在 `697c65c905c624ec80aba2a3386a00a7d0cc818a` 上复跑：

- `src/gateway/server-methods/agents-item7-batch9-12-cr2.test.ts`
- `src/gateway/server-methods/agents-item7-s10.test.ts`
- `src/gateway/server-methods/agents-item7-s11.test.ts`
- `src/gateway/server-methods/agents-item7-s12.test.ts`
- `src/gateway/server-methods/agents-item7-s13.test.ts`
- `src/gateway/server-methods/agents.files-scope.test.ts`
- `docs/design/evidence/memory-workspace-phase1b-item7-batch9-12-cr2.test.mjs`

2026-08-23 在 `697c65c905c624ec80aba2a3386a00a7d0cc818a` 复跑结果：vitest 6 files / 60 tests pass（含多资源 / position / group / 跨租户 fail-closed 与拒绝路径零文件操作）；packet test pass。通过后仍不标 Batch 9–12 Accepted。

## 不得声称

- Item 7 met
- Phase 1B unlock
- Batch 9–12 Accepted
- LIVE / Catalog / schema v2 production write
- 下一 retirement batch 已启动
- 本包改变了 CR2 业务实现
- 本包吸收 Batch 13 或 Batch 14/S15
