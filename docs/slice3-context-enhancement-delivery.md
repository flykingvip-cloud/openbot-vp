# 切片 3 交付：原判定与恢复提示的任务上下文增强

时区：Asia/Shanghai。PR [#216](https://github.com/flykingvip-cloud/openbot-vp/pull/216)。  
工作树：`/Users/daniel/AI VP/openbot-pr216-slice2`。对照树未改。  
**不合并、不生产部署。**

## 绑定

- 本轮行为完整 SHA（拒过期快照 / locked RMW / 交叉测）：`e82695c145629277cf3e2b656929e4b63bac3cfb`
- 分支 tip（含测试夹具重命名跟进提交）：`289470474facede2edf1f325d9ce57bcdf687491`
- 基线：已 `merge origin/main`（含 #217）；推送前再次 `git fetch` + 祖先门禁
- 切片 2 普通插问（reply_lane 及时独立 LLM）：**仍未完成**，不改名、不混入本切片；未实施
- 执行入口 / 续跑循环 / 模型裁决调用 / 新并发框架：**未增加**；复用既有 `withFileLockSync` 与 mutation 入口

## 本轮阻塞与修复（通用写入口过期快照）

| 红灯 | 修复 | 绿证 |
|---|---|---|
| `writeSessionTaskBoard(sessionFile, board)` 只锁最终写入；调用方可在锁外读改，B 追加后被 A 旧快照整体写回（epoch 仍递增） | ① 生产 RMW 一律 `mutateSessionTaskBoard`（同锁内读最新→改→写）；② `writeSessionTaskBoard` 对非空盘做 **writeEpoch CAS**：缺省/不匹配 → `StaleSessionTaskBoardWriteError`；③ 测试夹具改 `seedSessionTaskBoard`（显式无 CAS，禁止生产使用） | cross-process：constraint×complete / pause·cancel / focus-switch；stale_write 拒写；in-process CAS 单测 |

文档**不再**宣称「CAS 单独保障并发」；生产正确性 = **文件锁临界区 RMW** + 通用写入口的 **epoch 拒过期**。

## 生产 `writeSessionTaskBoard` 调用方审计（测试除外）

| 调用方 | 原问题 | 本轮改法 |
|---|---|---|
| `src/auto-reply/reply/agent-runner.ts`（主人暂停/取消） | 锁外 `read` → `applyIncomingUserMessage` → `writeSessionTaskBoard` | 改为 `mutateSessionTaskBoard`：临界区内 apply + 写 |
| `src/conversation-task/session-task-board.ts` → `recordCheckedTaskCompletion` | 同上（完成落盘） | `mutateSessionTaskBoard` + `finishCurrentTask` |
| `src/conversation-task/session-task-board.ts` → `commitAutomaticPark` | 同上（自动挂起） | `mutateSessionTaskBoard` 内 park |
| `src/conversation-task/session-task-board.ts` → `applyFocusSwitchGate` | 同上（焦点切换） | `mutateSessionTaskBoard` 内 `applyIncomingUserMessage` |
| `src/agents/task-surface/apply.ts`（keep-only） | 锁外读 board 后写 keep-only 快照 | `mutateSessionTaskBoard(live => applyKeepOnlyToBoard(live, plan))` |
| `commitSameTaskConstraint` / `commitBoardMutation` | 已在锁内 RMW | **保持**；仍走 `writeSessionTaskBoardUnlocked` |
| 导出的 `writeSessionTaskBoard` | 可被误用提交过期快照 | **保留**但加 epoch CAS；生产 RMW 不得再走此路径 |

审计后：**无**生产路径再「锁外读改 + writeSessionTaskBoard」。  
`rg 'writeSessionTaskBoard\(' src --glob '!**/session-task-board.ts'` 仅剩测试与 `cross-process-child` 的 stale_write 场景。

## 任务板原子更新（机制）

- 锁：`withFileLockSync` / `withSessionTaskBoardLock`（`${session}.task-board.json.lock`）
- 生产 RMW：`mutateSessionTaskBoard` / `commitSameTaskConstraint` / `commitBoardMutation`
- 解锁写：`writeSessionTaskBoardUnlocked`（tmp + `renameSync`；`writeEpoch = diskEpoch + 1`）
- 通用写：`writeSessionTaskBoard` — `diskEpoch>0` 时要求 `board.writeEpoch === diskEpoch`，否则抛 `StaleSessionTaskBoardWriteError`
- 夹具：`seedSessionTaskBoard` — 同锁替换、无 CAS；**仅测试**

## 跨进程交叉测试（不能只断言 epoch）

文件：`session-task-board.cross-process.test.ts` + `…-child.ts`（`BOARD_MODE`）。

| 场景 | 断言（业务状态，非仅 epoch） |
|---|---|
| 双进程 constraint | 甲/乙行均落盘，无丢行 |
| constraint × **complete** | `unfinished===false`；已成功提交的约束仍在 current 上 |
| constraint × **cancel** | `current` 清空；`tombstone` 含 task-a；**不复活** |
| constraint × **pause** | `wakeSuppress===true`；已落地约束保留 |
| constraint × **focus switch** | current ≠ A；A 的已落地约束在 parked（或归档）上，不丢、不写到 B |
| stale_write × constraint | 陈旧 `writeSessionTaskBoard` 被拒；约束 30 行全在 |
| in-process CAS | 缺 epoch / 错 epoch 抛错；匹配 epoch 可写 |

本机定向（Asia/Shanghai）：`session-task-board.cross-process` 7、`slice3-context` 8、`constraint-identity` 5、`slice3-context-event-sequence` 1 → **4 files / 21 passed**（本轮复跑）。

## 约束覆盖语义（仍有效）

- 局部修订保留无关 active；仅明确整体替换才 supersede
- `activeConstraintTexts` = 未 superseded 全文；`stop.summary` 截断仅展示

## 停止优先 / 切片 2

上下文增强与本轮写路径不解除 pause/cancel/`abortInFlight`/claim 拒绝。  
普通插问即时回复：**仍未完成**。

## 提交序列（本轮）

1. `e82695c145629277cf3e2b656929e4b63bac3cfb` — `fix(slice3): reject stale board snapshots; mutate RMW under lock; cross-process races`
2. `47a080ce0` — task-surface apply → mutate
3. `712cca474` / `3f31dba67` / `289470474` — 测试夹具 `seedSessionTaskBoard`
4. 本 docs 提交绑定上述行为 SHA

## 行为 SHA（权威）

`e82695c145629277cf3e2b656929e4b63bac3cfb`
