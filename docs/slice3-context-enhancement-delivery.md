# 切片 3 交付：原判定与恢复提示的任务上下文增强

时区：Asia/Shanghai。PR [#216](https://github.com/flykingvip-cloud/openbot-vp/pull/216)。  
工作树：`/Users/daniel/AI VP/openbot-pr216-slice2`。对照树未改。  
**不合并、不生产部署。**

## 绑定

- 本轮行为 tip：
- 切片 2 普通插问（reply_lane 及时独立 LLM）：**仍未完成**，不改名、不混入本切片
- 执行入口 / 续跑循环 / 模型裁决调用：**未增加**

## 红灯 → 绿灯路径

失败用例先落在：

- `src/conversation-task/session-task-board.slice3-context.test.ts`
- `src/auto-reply/reply/slice3-context-event-sequence.test.ts`
- `src/conversation-task/turn-relation.test.ts`（persist gates）

| 红灯场景 | 修复点 | 绿证 |
|---|---|---|
| 查询目标／约束写入约束 | `shouldPersistOwnerConstraint` 拒绝读问句；`appendSameTaskConstraint` / `commitSameTaskConstraint` 早退 | slice3-context + mid-task-aside |
| 「继续」记成业务约束 | `isBareContinueCue` + persist gate；collect-amend steer 在 `persistOwnerConstraint:false` 时不注入 | turn-relation + queue-policy |
| 显式替代后恢复提示同时有效 | `ConstraintEntry` + revise→`superseded`；`buildResumePrompt` 只用 `activeConstraintTexts` | slice3-context + event-sequence |
| 长约束尾部丢失 | 全文入 `effectiveConstraints`；`stop.summary` 仅 48 字显示标记 | inbound-stop + slice3-context |
| A 约束写入已切换的 B | `expectedTaskId` + `writeEpoch` CAS | constraint-identity + CAS 用例 |

验收序列（单测）：**A 执行 → 长约束 → 纠正一项 → 查询约束 → 插问 disposition → 恢复 A → 暂停 → 旧唤醒拒绝**  
文件：`slice3-context-event-sequence.test.ts` — 目标保留、修订顺序、查询不写、约束一次、暂停不被恢复提示解除、旧事件不复活。

## 约束覆盖语义（权威）

- `effectiveConstraints` 现为 **有序日志**（`ConstraintEntry[]`）：`{ text, atMs, kind: supplement|revise, superseded? }`
- **历史保留**：被覆盖的行标 `superseded: true`，不物理删除、不靠关键词扫删旧要求
- **当前有效**：`activeConstraintTexts` = 未 superseded 的全文（顺序保留）
- **修订判定**：复用既有 `isPriorUtteranceCorrection` + 明确替换开场（`不对/改为/以本条为准…`）→ `kind: revise` 并将此前 active 行标 superseded；**无新裁决模型**
- **补充**：`kind: supplement` 追加，不自动清旧 active
- **显示 vs 权威**：`stop.summary` 的「约束：…」截断仅展示；恢复/重试以日志全文为准

## 原判定点改动列表

| 判定点 | 改动 | 权威状态 | 被收窄的旧逻辑 |
|---|---|---|---|
| `classifyTurnRelation` | 可选 `TurnRelationContext`；**不**把约束历史拼进 `incoming` 做正则 | 仍只扫本轮 incoming + currentGoal | 避免历史词误触门禁 |
| `shouldPersistOwnerConstraint` / `isBareContinueCue` / `isOwnerConstraintRevision` | 新门闸（同文件 helpers） | 谁可入板 | 「一切 amend 都持久化」 |
| `appendSameTaskConstraint` | 唯一板内更新规则（日志 + revise/supersede） | 板内存 | 字符串追加＝全部仍有效 |
| `commitSameTaskConstraint` | `expectedTaskId` + 可选 `expectedWriteEpoch` CAS；再读再写 | 文件持久化唯一入口 | 仅身份先读后写 |
| `buildResumePrompt` | 只投影 active 全文；文案标明后文修订覆盖 | 恢复提示 | 列出全部历史条目为「同时有效」 |
| `writeSessionTaskBoard` | 每次成功写入 bump `writeEpoch`（独立于 `focusRevision`） | CAS 世代 | 无世代保护 |
| `shouldAttemptCollectAmendSteer` | `persistOwnerConstraint===false` 拒 steer | 续跑/注入 | bare continue 误 inject |
| `agent-runner` collect-amend | 传 `shouldPersistOwnerConstraint`；读问句走 board_readonly | 回复层只表达 | 回复模块自行拼接约束 |
| `mid-task-aside` | 读问用 `activeConstraintTexts` | 只读投影 | 把已 superseded 当有效 |

**未改**：授权门禁、协议终止、预算限制、自动创建替代唤醒、续跑循环结构、入口枚举。

## 停止优先

上下文增强不解除 pause/cancel/`abortInFlight`/`wakeSuppress`/claim 拒绝。验收序列末段：暂停后 `claimTaskBoardContinue` 拒旧唤醒；恢复提示不清除 `wakeSuppress`。

## 唯一更新路径与并发

- 持久化：仅 `commitSameTaskConstraint` → `appendSameTaskConstraint` → `writeSessionTaskBoard`
- 回复模块：读板 / 投影；不自拼约束写入
- CAS：`writeEpoch` 在读→突变→写前后校验；身份与 epoch 任一失配 → false（不伪造成功）

## 定向测试（本机 Asia/Shanghai）

9 files / **44 passed**（含 slice3 红→绿、事件序列、身份、inbound-stop、collect-amend、queue-policy、aside、turn-relation）。

## 切片 2 普通插问（仍未完成）

一般 aside 的 **reply_lane 及时独立 LLM 回复** 仍未实施；本轮仅另附设计说明  
`docs/slice2-aside-reply-concurrency-design.md`（只设计、不实施）。  
board_readonly / 进度板投影能力保留在切片 2 阶段性成果内。

## 行为 SHA


