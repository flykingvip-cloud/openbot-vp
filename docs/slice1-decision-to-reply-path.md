# Slice 1 — 判断如何传到各回复出口（目标树 openbot-vp）

工作树：`/Users/daniel/AI VP/openbot`（`flykingvip-cloud/openbot-vp`）。  
对照树 `/Users/daniel/AI项目/openbot`（`0c22e483…`）未改，不得把其「模块不存在」结论推广到本树。

## 主路径顺序（attempt.ts，未重排）

1. 模型执行（tool / assistant stop）
2. `runExecutionStallContinueLoop` ≈2675：有限续跑
   - 判定：`executionContinueKind` / `shouldContinueAfterEmptyToolFinal`
3. `dropSupersededStallTexts` ≈2772：清掉已被续跑越过的停滞文案
4. `rewriteAttemptVisibleReply` ≈2781：终局可见改写（语言 / plan-speak 透传 / OGUI / `settleTurnCompletion`）
5. `onBlockReplyFlush` 等投递

## 谁判断什么（单一负责位置）

| 决定                   | 负责位置                                                                                | 传到出口的内容                                                              | 缺口（改前）                                                  |
| ---------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 是否续跑（推进中）     | `executionContinueKind` → stall loop                                                    | 隐式：续跑成功则停笔文案被 drop；**无结构化「正在推进」传给 partial/block** | 回复层用关键词自造「请确认/购物暂停」                         |
| 需要主人输入           | stall 内 `HARD_DECISION_RE` / waiting_confirmation / missing choice；OGUI；模型原文问句 | 主要靠**助手原文**；turn-completion `true_fork` 可改写终局                  | 回复层可能覆盖成购物 CTA                                      |
| 等待外部条件           | 模型 progress / short holding；`isExecutionStallFinal` 触发续跑                         | 进度原文；续跑后可被清除                                                    | 流式阶段可能被改写成暂停原因                                  |
| 已完成                 | `settleTurnCompletion` → delivered                                                      | 终局 `visibleText`                                                          | 正文含价格等词时曾被 plan-speak 规则误伤（若仍像 plan-speak） |
| 取消 / 超时 / 协议终止 | attempt 循环 `isAbortedOrTimedOut` / protocol boundary                                  | 停止续跑；不经 reply 改写制造新状态                                         | 切片 2 贯通校验（本期不扩）                                   |

## 各出口实际拿到什么

### 终局（rewriteAttemptVisibleReply）

- 输入：续跑后的 `messages` / `assistantTexts`（已 drop 被替代停滞）
- 曾调用 `rewritePlanSpeakFinal`：**用正文关键词发明暂停 CTA**（购物正向准入仍是关键词判断）
- 再调用 `settleTurnCompletion`（真正的完成契约）
- **改后**：`rewritePlanSpeakFinal` 透传，不再发明暂停；完成/分叉仍归 turn-completion

### 流式 partial（pi-embedded-subscribe.handlers.messages）

- `parseReplyDirectives` → `cleanedText` → `onPartialReply({ text: cleanedText })`
- 同样经 `rewritePlanSpeakFinal`；**此时续跑尚未发生**，没有停止结果
- **改后**：透传进度原文；不得预先编造暂停原因
- 待证：线上「闪现」是否仅由此路径投递（调用链已证会跑改写；用户可见闪现仍待日志）

### block

- **与 partial 不是同一条解析路径**：
  - partial：`handlers.messages` 对整段快照调用 `parseReplyDirectives`（内含 `rewritePlanSpeakFinal`）→ `onPartialReply`
  - block chunk（text_end / chunker）：原始 delta 进 `blockChunker`/`blockBuffer` → `emitBlockChunk` → `createStreamingDirectiveAccumulator` 的 `parseChunk`（媒体/reply-tag/scratchpad/silent；**不经** `rewritePlanSpeakFinal`）→ `onBlockReply`
  - message_end 兜底 block：同样走 `consumeReplyDirectives`（streaming accumulator），与 partial 的 `parseReplyDirectives` 分流
- 终局 `rewriteAttemptVisibleReply` 在续跑之后；若 partial 曾发明错误 CTA，用户可能已先看见（本期靠透传消除）

## 规则表（实施约束）

| 规则                   | 实现位置                                | 调用入口                                                      |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------- |
| 是否改写计划话术为暂停 | `rewritePlanSpeakFinal`（现为恒等透传） | 终局 rewrite-visible-reply、流式/block `parseReplyDirectives` |
| 是否续跑               | `executionContinueKind` 等              | `runExecutionStallContinueLoop`                               |
| 终局交付/阻塞/分叉     | `settleTurnCompletion`                  | `rewriteAttemptVisibleReply` 末尾                             |
| 是否允许恢复任务       | 任务板校验（切片 2）                    | 入队/领取                                                     |

同一规则可多入口调用；不得多处各写一套互斥语义。

## 本期最小修改

- 收窄/移除回复层「根据计划话术生成暂停请求」
- 不新增分类器、裁决层、续跑循环、调度器、摘要存储
- 不重排 attempt 主顺序
- 购物/视频/分析/写作仅作交叉样本，验收按通用行为

## 仍待证 / 留给切片 2+

- 线上 partial 闪现根因（需事件序列日志）
- 结构化「执行结果」显式参数传到各出口：**仅发现具体传递缺口时补充最小参数**；不预留第二套状态体系或完整枚举
- 暂停/取消贯通续跑与续醒校验
