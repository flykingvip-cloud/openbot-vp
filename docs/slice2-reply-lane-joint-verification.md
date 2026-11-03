# 切片 2 reply_lane 联合回归与落地实证

时区：Asia/Shanghai。PR [#216](https://github.com/flykingvip-cloud/openbot-vp/pull/216)。  
工作树：`/Users/daniel/AI VP/openbot-pr216-slice2`。对照树未改。  
**不合并、不生产部署。** 切片 3 停止功能扩展。

## 绑定

- 行为基线（slice3 RMW）：`e82695c145629277cf3e2b656929e4b63bac3cfb`
- 本轮 tip（含 reply_lane）：`dcf4fbb76d57a3da0e489d2ad9fba356f4a7826a`
- 祖先门禁：`git fetch origin && git merge-base --is-ancestor origin/main HEAD` → PASS（合入前再验）

## seedSessionTaskBoard 审计

| 项 | 结果 |
|---|---|
| 生产 importer | **无**（仅定义 + `*.test.ts` + docs） |
| 守门测 | `src/conversation-task/session-task-board.seed-audit.test.ts` **PASS** |
| 语义 | 测试夹具显式无 CAS；禁止生产 RMW 使用 |

## 联合回归（切片 1–3 + reply_lane）

```
pnpm exec vitest run \
  src/shared/text/plan-speak-final.test.ts \
  src/agents/pi-embedded-subscribe.plan-speak-outlet.test.ts \
  src/agents/pi-embedded-runner/run/payloads.test.ts \
  src/auto-reply/reply/queue-policy.test.ts \
  src/auto-reply/reply/agent-runner.collect-amend-steer.test.ts \
  src/auto-reply/reply/agent-runner.aside-reply-lane.test.ts \
  src/auto-reply/reply/mid-task-dialogue.test.ts \
  src/auto-reply/reply/mid-task-aside.test.ts \
  src/auto-reply/reply/mid-task-aside-reply-lane.test.ts \
  src/auto-reply/reply/slice2-mid-task-event-sequence.test.ts \
  src/auto-reply/reply/slice3-context-event-sequence.test.ts \
  src/conversation-task/session-task-board.inbound-stop.test.ts \
  src/conversation-task/session-task-board.constraint-identity.test.ts \
  src/conversation-task/session-task-board.slice3-context.test.ts \
  src/conversation-task/session-task-board.cross-process.test.ts \
  src/conversation-task/session-task-board.seed-audit.test.ts \
  src/conversation-task/turn-relation.test.ts \
  src/gateway/server-methods/chat.owner-pause-abort.test.ts \
  ui/src/ui/app-chat.node.test.ts \
  ui/src/ui/controllers/chat.test.ts
```

**结果：20 files / 240 passed**（偶发 cross-process completion 竞态 flake；连续重跑 3 次全绿后本联合跑全绿）。

## 只读独立回复实证（须验证四项）

| 隔离项 | 做法 | 测 |
|---|---|---|
| 转录写入 | B → ephemeral `sessionFile`（`openbot-aside-reply-*`），不写 A jsonl；用户可见靠 return payloads | `mid-task-aside-reply-lane.test.ts` |
| 会话锁 | 独立 `sessionId`，不占 `ACTIVE_EMBEDDED_RUNS[A]`；aside 只锁自己的文件 | isolation assert + run args |
| 消息归属 | aside `runId` = 本次 `opts.runId`；`runReplyAgent` 直接返回，不 followup 串 A | `agent-runner.aside-reply-lane.test.ts` |
| 取消范围 | pause/cancel → abort A + `abortMidTaskAsideLanes`；仅 abort A 的 embedded id 不清 aside 登记 | reply_lane + agent-runner 测 |

## 普通插问边界（诚实）

| 能力 | 状态 |
|---|---|
| 进度 / board_readonly | 已有 |
| reply_lane 及时答（不跟 A 串行） | **本轮已落地** |
| 不写板、disableTools、无第二控制者 | **本轮已落地** |
| A/B 共址 jsonl | **仍缺口** |
| Gateway 清桶专项 hardening | **仍缺口** |
| 关键词特例堆叠 / 第二任务引擎 | **不做** |

## 代码入口

- `src/auto-reply/reply/mid-task-aside-reply-lane.ts`
- `src/auto-reply/reply/agent-runner.ts`（`reply_lane_pending` 分支 + abort 旁路）
