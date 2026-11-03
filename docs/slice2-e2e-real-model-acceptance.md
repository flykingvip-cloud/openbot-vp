# Slice2 实机验收（真实模型 + Gateway WS）

- **时间**：Asia/Shanghai 2026-11-03 ~11:17–11:18
- **工作树**：`/Users/daniel/AI VP/openbot-pr216-slice2`
- **隔离网关**：`ws://127.0.0.1:19101`（非生产 :18789）；`OPENBOT_STATE_DIR=/tmp/openbot-pr216-e2e-state-01e15de99`
- **模型**：`api-proxy-deepseek/deepseek-v4-flash`
- **驱动**：`src/auto-reply/reply/slice2-e2e-real-model-accept.mjs`
- **原始 JSON**：`/tmp/openbot-pr216-e2e-out/slice2-e2e-real-model-acceptance.json`
- **声明**：**未合并、未部署**

## SHA

开工 tip（信任边界收尾 merge）：`01e15de99c77efa1ef49020e5760dda06a5ceae4`  
行为祖先（旁路信任边界）：`c533c4d79f33861379922534a1341a66f9fcd42b`  
本轮 tip：`6de605dd0da78eaf41ceb93d708570357d69e49a`（验收文档 + e2e 驱动）。
产品缺口修复：`3a712e86e8b1fd8f2af2a09e1276cd443f47b475`。
行为祖先（trust-boundary）：`c533c4d79f33861379922534a1341a66f9fcd42b`。

## 验收点结论

| 点 | 结果 |
|---|---|
| A 长任务 occupancy | PASS（exec `sleep 35` / `sleep 25`） |
| 普通插问 reply_lane 即时答 | PASS（B「星期二」~1s，A 仍运行） |
| 补充约束：已收到 vs 已生效 | PASS（即时 ack「已将补充约束注入…」；A 终局含 `E2E_CONSTRAINT_OK`；板 `effectiveConstraints` 仅 1 条补充约束） |
| 刷新后可见/追问 B | PASS（`chat.history` 含插问；追问与 A 结束后复述均为「星期二」；旁路写入 aside-dialogue，非 extraSystemPrompt） |
| 暂停／取消，旧结果不复活 | PASS（暂停点名任务 A；`lateRevive=0`；a_first「取消当前」移出任务板） |
| 完成顺序 B 先于 A | PASS |
| 完成顺序 A 先于 B | PASS（reply_lane `disableTools`，以近完成门控 + 长流式 B 覆盖重叠窗口） |

## 事件时间线 — B 先完成（session `agent:main:slice2-e2e-1793675831`）

| Asia/Shanghai | 事件 | 可见结果 |
|---|---|---|
| 11:17:11 | scenario.b_first.start | |
| 11:17:15 | A_long.occupancy | ready=true（exec sleep 35） |
| 11:17:17 | B_aside final | 「星期二」；`order.check.b_first` A 仍运行 |
| 11:17:17 | refresh.visible.B | chat.history 可见插问 B |
| 11:17:17 | constraint ack | 「已将补充约束注入当前执行（仅一次）…」 |
| 11:17:17 | followup_B final | 「星期二」（reply_lane，未写入约束） |
| 11:17:48 | A_long.final | 含 `A_LONG_DONE E2E_CONSTRAINT_OK` |
| 11:17:50 | post_A_recall_B | 「星期二」（不可信旁路历史 user-body） |
| 11:17:55 | owner_pause | 已暂停「任务A-长…」；不因旧唤醒复活 |
| 11:18:03 | no_revive_A | lateRevive=0 |

板证：`effectiveConstraints` 仅补充约束一条；aside-dialogue 4 轮；`wakeSuppress=true`。

## 事件时间线 — A 先完成（session `…-a-first`）

| Asia/Shanghai | 事件 | 可见结果 |
|---|---|---|
| 11:18:03 | scenario.a_first.start | |
| 11:18:06 | A_short.occupancy | exec sleep 25 |
| 11:18:27 | near_complete_gate | elapsed≈24s，A 未 final |
| 11:18:27+ | B_slow 流式 | 逐行重复长文（tools-off） |
| 11:18:31 量级 | A_SHORT_DONE | A final 早于 B final |
| 11:18:43 | order.check.a_first | A_before_B=true |
| 11:18:43 | owner_cancel | 取消 A；tombstone；终局隔离 |

## 本轮缺口修复（仅对应失败点）

1. **`commitSameTaskConstraint` 幂等成功**：focus-gate `applyIncoming` 已写入后，steer 路径再 commit 同一正文时 `before===after` 曾误报「未能写入原任务板」。已在板上且未 superseded → 返回 true。测：`session-task-board.constraint-identity.test.ts`。
2. **追问插问/旁路 → aside**：`刚才插问…` / `旁路历史…` 曾被 `AMEND_CONSTRAINT_RE` 的「刚才」收成约束。分类器在 amend 前识别插问/旁路追问为 aside。测：`turn-relation.test.ts`。
3. **chat.ts sessionFile-before-focus**（上轮已改、本轮实机依赖）：无 sessionFile 时不再 `focus_state_unavailable` 跳过 A 建板。
4. **e2e 驱动**：a_first 用近完成门控 + 反省略长流式 B（reply_lane 禁工具，不能用 exec 拖慢 B）。

未新增调度路径/总控/框架。

## 文档「4000」表述

已统一为**历史正文预算**（`ASIDE_NORMAL_REPLY_CONTEXT_MAX_CHARS=4000`，仅 `role: text` 累计；包装说明／不可信声明另有固定开销，**不是**整个提示块硬上限）：

- `docs/slice2-aside-trust-boundary-delivery.md`
- `docs/slice2-aside-reply-design.md`
- `docs/slice2-reply-lane-joint-verification.md`

## 诊断 / 构建

```
pnpm exec vitest run …（联合清单 + get-reply-run.aside-dialogue-context）
→ 23 files / 270 passed（Asia/Shanghai 2026-11-03；非 flake 重跑充绿）
```

实机：`node src/auto-reply/reply/slice2-e2e-real-model-accept.mjs` → `pass=true`。

## 未做

- **未 merge PR #216**
- **未部署 / 无 agent 部署**
