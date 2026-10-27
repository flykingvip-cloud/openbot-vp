# DS 路径 1 落地说明 — 管理面收敛到已索引语料（2026-10-27）

| 项       | 值                                                                                            |
| -------- | --------------------------------------------------------------------------------------------- |
| 日期     | 2026-10-27 Asia/Shanghai                                                                      |
| 选型     | [alignment-options](/design/memory-data-space-search-alignment-options-2026-10-26) **路径 1** |
| 调查     | [contract-survey](/design/memory-data-space-search-contract-survey-2026-10-26)                |
| 基线 tip | 合入事实级评估 #111 后的 `origin/main`                                                        |
| 状态     | 本 PR 实现管理面 list/forget 收敛；**不**扩索引、**不**部署、**不**事实级遗忘                 |

## 做了什么

- `listAgentMemoryEntries`：改为扫描 agent **workspace** 下与 `manager.search` memory 源一致的语料：`MEMORY.md` / `memory.md` + `memory/**/*.md`。
- `forgetMemoryEntry`：仅允许删除上述 workspace 相对 key（防路径穿越）；**不再**以 DS `memory/agent|workspace|personal` 为候选根。
- Gateway 重复的 `memory-list` 改为 re-export，避免双实现漂移。
- O5 文件删除提示微调：标明对象为工作区已索引记忆语料。

## 刻意不做

- **不**把 DS `agents/<id>/memory/agent/**` 纳入 `listIndexedDocuments` / embedding。
- **不**串联 CogniWeave `forgetSource` / artifact lifecycle（仍受 D4 约束）。
- **不**在 Memory Center 文件面管理 sessions / collaboration 语料（仍走会话/协作既有生命周期；与 search 同源但不经本 forget RPC）。
- **不**自动迁移历史 DS `memory/agent` 文件；该批文件不再出现在 MC 可管理列表（遗留只读于文件系统，迁移另批）。
- **不**事实级全来源遗忘；**不**部署。

## 迁移期可见性

历史仅存在于 DS `memory/agent` 的文件：list/forget 将不可见/不可删。这是路径 1 的预期代价；若需回收，另批「一次性迁入 workspace」或只读遗留区 UX。
