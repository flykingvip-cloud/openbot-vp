# 切片 2 reply_lane 联合回归与落地实证

时区：Asia/Shanghai。PR [#216](https://github.com/flykingvip-cloud/openbot-vp/pull/216)。  
工作树：`/Users/daniel/AI VP/openbot-pr216-slice2`。对照树未改。  
**不合并、不生产部署。** 切片 3 停止功能扩展。

## 绑定

- 行为基线（slice3 RMW）：`e82695c145629277cf3e2b656929e4b63bac3cfb`
- 上一轮 tip（分流 + 三项初修）：`bb949e8e508e18b32a59749b63b234e963749bd3`
- 本轮 tip（取消生命周期 + 真实 chat.history 衔接 + 时间合并）：`b1f6481da42a8cf2299f3b084c8fa3e5c0b51ab1`
- 祖先门禁：`git fetch origin && git merge-base --is-ancestor origin/main HEAD` → PASS（推送前再验）

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
  src/gateway/server-methods/chat.aside-dialogue-history.test.ts \
  src/gateway/server-chat.aside-ab-run-isolation.test.ts \
  ui/src/ui/app-chat.node.test.ts \
  ui/src/ui/controllers/chat.test.ts
```

**结果：22 files / 259 passed**（Asia/Shanghai 2026-11-03 09:58；含 `chat.aside-dialogue-history.test.ts` 真实 chat.history 接口；A/B 终局隔离仍绿）。

## 只读独立回复实证（须验证四项）

| 隔离项 | 做法 | 测 |
|---|---|---|
| 转录写入 | B → ephemeral `sessionFile`（`openbot-aside-reply-*`），不写 A jsonl；用户可见靠 return payloads | `mid-task-aside-reply-lane.test.ts` |
| 会话锁 | 独立 `sessionId`，不占 `ACTIVE_EMBEDDED_RUNS[A]`；aside 只锁自己的文件 | isolation assert + run args |
| 消息归属 | aside `runId` = 本次 `opts.runId`；`runReplyAgent` 直接返回，不 followup 串 A | `agent-runner.aside-reply-lane.test.ts` |
| 取消范围 | 首次 await 前登记 + AbortSignal 传入运行器；墓碑/taskId 阻断；pause/cancel → abort A + asides | reply_lane prep/tombstone/signal 测 + agent-runner |
| 刷新可见 | sidecar 经 `mergeChatHistoryWithAsideDialogue` 接入 `chat.history`；A 结束后仍可恢复 B 气泡 | `chat.aside-dialogue-history.test.ts` |
| 历史合并 | 旁路与主对话按时间+消息身份合并，sidecar 满也不挤掉最新 A | `mergeAsideAndParentHistoryTurns` + history 测 |

## 插话分流（不全进 reply_lane）

普通插问 → reply_lane；进度/只读板问 → 投影；补充纠正/安全限制 → 原任务板（屏障优先）；暂停取消 → 原停止路径。详见 `slice2-aside-reply-design.md` §3.1。

## 普通插问边界（诚实）

| 能力 | 状态 |
|---|---|
| 进度 / board_readonly | 已有 |
| reply_lane 及时答（不跟 A 串行） | **本轮已落地** |
| 不写板、disableTools、无第二控制者 | **本轮已落地** |
| A/B 共址 jsonl | **仍缺口** |
| Gateway A/B final/cancel 隔离交叉测 | **已绿**（`server-chat.aside-ab-run-isolation.test.ts`） |
| 真实 chat.history 刷新／重连／A 结束后追问 | **本轮已补**（`chat.aside-dialogue-history.test.ts`） |
| 取消 prepare 窗口 / 墓碑 / runner 前信号 | **本轮已补**（`mid-task-aside-reply-lane.test.ts`） |
| 关键词特例堆叠 / 第二任务引擎 | **不做** |

## 代码入口

- `src/auto-reply/reply/mid-task-aside-reply-lane.ts`
- `src/auto-reply/reply/agent-runner.ts`（`reply_lane_pending` 分支 + abort 旁路）


## 本轮历史链路收尾（合并后裁剪 / 跨来源去重 / 正常回复上下文）

| 缺口 | 改法 | 证据 |
|---|---|---|
| 1 chat.history 上限被绕过 | `mergeChatHistoryWithAsideDialogue` **先于** `boundChatHistoryMessages`；auth overlay 仍在 bound 之后 | `chat.aside-dialogue-history.test.ts`：`merge then boundChatHistoryMessages so sidecar cannot bypass limit` |
| 2 A 结束后普通回复读不到 B | `runPreparedReply` 经动态 import 注入 `buildAsideDialogueContextPromptForNormalReply` → `extraSystemPrompt`（不共写 A jsonl） | `get-reply-run.aside-dialogue-context.test.ts` |
| 3 跨来源去重 | `stableDialogueMessageIdentity`（`mid:` / `rt:role:text`）；禁止用 `transcript:`/`aside:` 前缀冒充 | history + reply_lane 测：同 messageId / 同 role+text 去重 |

动态 import 说明：避免 `get-reply-run` 静态拉入 `mid-task-aside-reply-lane`→`pi-embedded`，以免破坏 agent-runner aside 测对 embedded runner 的 mock。

不新增调度／任务状态逻辑。取消生命周期保持关闭。A/B 不共址 jsonl 不作阻塞。不合并、不部署。

## 本轮三缺口收尾（取消生命周期 + 历史衔接）

| 缺口 | 改法 | 证据 |
|---|---|---|
| 1 取消窗口 | `registerMidTaskAsideLane` 在首次 `mkdtemp`/`writeFile` **之前**；绑定 `taskId`；`abortSignal` 传入 `runEmbeddedPiAgent`；`ownerStopBlocksAside` 用 `isTaskTombstoned` 即使 current 已清 | `registers cancel signal before first await…`；`cancel tombstone blocks…`；`passes abortSignal into runner…` |
| 2 刷新后可见 | `chat.history` 经 `mergeChatHistoryWithAsideDialogue` 画 sidecar；不共写 A jsonl | `chat.history paints aside bubbles after refresh (and after A-ended)` |
| 3 旁路挤掉主对话 | `mergeAsideAndParentHistoryTurns` 时间+身份合并后再截取；`loadAsideReplyContextHistory` 不再在满载时只返回旁路 | `merge helper keeps A and B ordered by time`；`multi-round B then A new reply…` |

不新增调度逻辑／任务机制。不合并、不部署。
