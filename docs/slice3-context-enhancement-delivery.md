# 切片 3 交付：原判定与恢复提示的任务上下文增强

时区：Asia/Shanghai。PR [#216](https://github.com/flykingvip-cloud/openbot-vp/pull/216)。  
工作树：`/Users/daniel/AI VP/openbot-pr216-slice2`。对照树未改。  
**不合并、不生产部署。**

## 绑定

- 本轮行为完整 SHA：`7948817deb031b31e16a7b429993259e371b4c6a`
- 基线：已 `merge origin/main`（含 #217 silent-pair，`75d3d0844`）；祖先门禁：`origin/main` 是 HEAD 祖先
- 切片 2 普通插问（reply_lane 及时独立 LLM）：**仍未完成**，不改名、不混入本切片；未实施
- 执行入口 / 续跑循环 / 模型裁决调用：**未增加**

## #217 交叉影响

- 合入路径主要为 `apps/android/**`、employee silent-pair、`connect-policy` / ws message-handler
- 与本任务路径（task-board / turn-relation / mid-task / plan-speak / UI chat）**无重叠**
- 冲突：无；按保留双方历史的正常 merge，未强推、未改 main

## 红灯 → 绿灯（本轮补修）

| 红灯 | 修复 | 绿证 |
|---|---|---|
| 局部修订废弃全部旧约束 | 仅 `isOwnerConstraintFullReplace` 整体 supersede；局部/模糊保留 active，恢复提示注明后文仅覆盖冲突 | slice3-context local/full/fuzzy + turn-relation |
| 非原子「读→查→writeFileSync」冒充 CAS | 复用既有 `withFileLockSync`（`${board}.lock`）；读、身份/epoch 检查、更新、tmp+rename 同临界区；`writeEpoch` 取盘上值 +1 | cross-process 双进程竞争 |
| main 非祖先 | merge `origin/main` | `git merge-base --is-ancestor origin/main HEAD` |

验收序列（单测）：**A 执行 → 长约束 → 纠正一项 → 查询约束 → 插问 disposition → 恢复 A → 暂停 → 旧唤醒拒绝**  
文件：`slice3-context-event-sequence.test.ts`。

## 约束覆盖语义（权威）

- `effectiveConstraints`：**有序日志** `{ text, atMs, kind: supplement\|revise, superseded? }`
- **局部修订**（`isOwnerConstraintRevision` 且非 full-replace）：追加 `kind: revise`，**不**自动把无关旧 active 标 superseded
- **整体替换**（`isOwnerConstraintFullReplace`，如「整体替换为…」「以本条为准全部重来」）：此前 active → `superseded: true`，历史保留
- **模糊纠正**：保留有序原文；`buildResumePrompt` 明确后文仅覆盖冲突部分
- **当前有效**：`activeConstraintTexts` = 未 superseded 全文
- **显示 vs 权威**：`stop.summary` 截断仅展示；恢复/重试用日志全文
- **无**关键词自动删旧要求；**无**新裁决模型

## 任务板原子更新（机制名，非空头 CAS）

- 锁：`withFileLockSync`（`src/infra/file-lock.ts` / `src/plugin-sdk/file-lock.ts`），选项 `SESSION_TASK_BOARD_LOCK_OPTIONS`
- 临界区：`withSessionTaskBoardLock` → 读盘 → 身份/`expectedWriteEpoch` 校验 → `appendSameTaskConstraint` → `writeSessionTaskBoardUnlocked`（tmp + `renameSync`），`writeEpoch = diskEpoch + 1`
- 同板其它写入出口经同一 `writeSessionTaskBoard` / locked helper，不得绕过锁
- **证据**：`session-task-board.cross-process.test.ts` + `…-child.ts` — 两进程并发 `commitSameTaskConstraint`，两行均落盘、`writeEpoch` 单调、无丢行。顺序制造过期 epoch **不是**并发证明。
- 文档**不**宣称「CAS 已单独保障并发」；并发正确性来自 **文件锁临界区 + 盘上 epoch**。

## 原判定点改动列表

| 判定点 | 改动 | 权威状态 | 被收窄的旧逻辑 |
|---|---|---|---|
| `isOwnerConstraintFullReplace` | 新 helper，与 local revise 分离 | 谁可整体废弃 | revise≡清空全部 active |
| `appendSameTaskConstraint` | 仅 fullReplace 时 map superseded | 板内存 | 任意 revise 即清场 |
| `buildResumePrompt` | active 全文 + 冲突覆盖说明 | 恢复提示 | 把历史全当同时有效 / 或误丢局部 |
| `commitSameTaskConstraint` / `writeSessionTaskBoard` | `withFileLockSync` RMW + 盘上 epoch | 唯一持久化入口 | 无锁先读后写 |
| `classifyTurnRelation` | 可选上下文；不把约束史拼进 incoming 扫正则 | 关系判定 | 历史词误触 |
| persist gates | 查询/「继续」不入约束 | 谁可入板 | 一切 amend 持久化 |

**未改**：授权门禁、协议终止、预算、自动替代唤醒、续跑循环结构、入口枚举。

## 停止优先

上下文增强不解除 pause/cancel/`abortInFlight`/`wakeSuppress`/claim 拒绝。

## 定向测试（本机 Asia/Shanghai）

12 files / **53 passed**（含 local/full/fuzzy、跨进程竞争、事件序列、身份、inbound-stop、Gateway pause abort、collect-amend、queue-policy、aside、turn-relation）。

## 切片 2 普通插问（仍未完成）

一般 aside 的 **reply_lane 及时独立 LLM 回复** 仍未实施；设计见 `docs/slice2-aside-reply-concurrency-design.md`（只设计、本轮不实施）。  
board_readonly / 进度板投影保留在切片 2 阶段性成果内。

## 调用链（约束写入）

主人补充/修订 → `agent-runner` collect-amend / mid-task → `shouldPersistOwnerConstraint` → `commitSameTaskConstraint`（`expectedTaskId`）→ `withFileLockSync(board)` → 读盘校验 → `appendSameTaskConstraint`（fullReplace?）→ `writeSessionTaskBoardUnlocked` → 回复层只读 `activeConstraintTexts` / `buildResumePrompt`。

## 行为 SHA

`7948817deb031b31e16a7b429993259e371b4c6a`
