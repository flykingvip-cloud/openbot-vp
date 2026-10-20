# OpenBot 协作群作答编排优化方案

Date: 2026-06-19

Status: Draft for implementation

Audience: Gateway/Runtime、员工端 UI、Collaboration Learning、产品与体验团队

Related:

- `docs/design/openbot-collaboration-group-dialogue-optimization-2026-06-18.md`
- `docs/design/openbot-multi-agent-collaboration-os-freeze-2026-06-19.md`

---

## 1. 背景

当前 OpenBot 协作群已经具备：

- 多 Bot 群聊调度能力
- 群级 `round_plan` 摘要与头部解释性 UI
- group transcript / group ledger / participation overlay

但在真实对话中，仍暴露出一个核心体验问题：

> 同一轮里，多个 Bot 往往会围绕同一问题各自独立作答，出现内容重复、观点重叠、协作价值感不足的问题。

以“数字人战队”群最近一次知识型提问为例，用户询问“谁知道端午节的由来？”，同一轮内有 6 个 Bot 连续作答。大部分答案都覆盖了“屈原投江、赛龙舟、吃粽子、驱邪避疫”等相同事实，只有少数角色提供了真正的补充视角。

这说明当前系统已经具备“多角色”，但尚未形成稳定的“多角色协作纪律”。

---

## 2. 问题定义

### 2.1 用户侧问题

从用户体验看，当前协作群对话主要存在以下问题：

1. 多个 Bot 在同一轮里重复表达相同观点，信息密度提升有限。
2. 后发 Bot 没有承担“补充”“纠错”“收口”等协作职责，而是再次独立完整作答。
3. 部分角色会输出低价值存在感回复，例如“这个问题交给某某”“我去通知其他成员”。
4. 简单问答型问题被放大成群体并发作答，导致阅读负担增加。

### 2.2 运行时根因

当前问题不是单纯的 prompt 表达问题，而是编排机制问题：

1. 同一轮 Bot 执行采用并行模式，多个成员在同一时间开始推理。
2. 每个 Bot 看到的是“本轮开始前”的群历史，而不是“同一轮里其他 Bot 刚刚产出的回答”。
3. 当前 prompt 只约束“不要代替别人发言”，没有把“只做增量贡献”设为硬规则。
4. 当前调度对简单知识问答、分析问题、头脑风暴问题缺乏不同的响应模式。

---

## 3. 当前代码现状

### 3.1 群内作答是并行执行

当前群聊路径中，被选中的 Bot 会在同一轮通过并行方式执行：

- `src/gateway/server-methods/chat.ts`

这意味着后发 Bot 无法基于前发 Bot 在本轮中刚刚产出的答案做实时补充。

### 3.2 当前 Bot 能看到的是本轮前历史

当前执行链会为群 Bot 注入 `InboundHistory`：

- `src/gateway/server-methods/chat.ts`
- `src/gateway/collaboration-dispatch/group-inbound-history.ts`

但这份历史在 round 启动前构建，因此不包含同一轮里其他 Bot 的新答案。

### 3.3 当前协作 prompt 已有基础约束，但不足以解决重复

当前协作回合 prompt 已包含：

- 同轮其他成员也会回复
- 不要代替其他成员发言
- 在介绍 follow-up 场景下不要重复长篇介绍

见：

- `src/gateway/collaboration-dispatch/discussion-turn-prompt.ts`

但当前 prompt 仍缺少以下硬规则：

- 如果没有新增价值，则返回 `NO_REPLY`
- 后发角色只能提供差异化补充，而不能重复完整答案
- 特定角色默认只允许“补充”或“收口”，不允许“主答”

---

## 4. 产品目标

本次优化的核心目标不是“让 Bot 回复更快或更慢”，而是：

> 把协作群从“多人同时答题”升级成“多人协同解题”。

### 4.1 目标

1. 简单问题默认只允许 1 个主答 Bot。
2. 多 Bot 协作时，后发成员必须做增量贡献。
3. 对没有新增价值的回答，系统应允许静默。
4. 群内协作结果应体现角色分工，而不是内容堆叠。
5. 群协作价值体现在“补充、纠错、质疑、总结”，而不是“人人都答一遍”。

### 4.2 非目标

1. 不追求所有问题都变成多人协作。
2. 不以统一固定延迟替代协作编排。
3. 不在本阶段引入重型 LLM 裁判链路。
4. 不在未收敛主干前引入新的平行调度框架。

---

## 5. 总体方案

## 5.1 核心策略

引入“分阶段协作作答”机制，替代当前的“同轮完全并行作答”。

同一轮内，Bot 不再默认都以“独立完整回答”模式运行，而是根据问题类型和调度角色进入不同协作职责：

- `lead`
- `supplement`
- `challenge`
- `wrap`

### 5.2 核心原则

1. 等待不是统一固定延迟，而是“阶段间等待”。
2. 后发 Bot 必须看见前发 Bot 的摘要。
3. 角色的输出目标是“增量价值”，不是“独立完成题目”。
4. 如果无法提供显著增量，则允许 `NO_REPLY`。

---

## 6. 响应模式设计

根据用户问题类型，为同一轮确定一个 `responseMode`：

### 6.1 `single_owner`

适用场景：

- 定义解释
- 基础知识问答
- 节日、历史、常识类问题
- 用户显然只需要一个准确答案的场景

执行规则：

- 只选 1 个主答者
- 最多允许 1 个高价值补充者
- 协调者默认不重复正面作答

### 6.2 `lead_plus_supplement`

适用场景：

- 分析类问题
- 比较类问题
- 建议类问题
- 方案拆解类问题

执行规则：

- 1 个主答者给出主体框架
- 1-2 个补充者从不同角度做增量补充
- 可选 1 个收口者给出简短总结

### 6.3 `debate_or_brainstorm`

适用场景：

- 各位怎么看
- 讨论一下
- 头脑风暴
- 群体分工 / 方案评审

执行规则：

- 允许多成员参与
- 但必须分配明确协作职责
- 不允许每个人都从头到尾独立完整讲一遍

---

## 7. 阶段式执行模型

### 7.1 现状问题

当前同一轮中 tier0/tier1 Bot 采用并行执行，因此：

- A 与 B 同时开始推理
- B 看不到 A 刚刚回答了什么
- B 只能基于本轮前历史独立作答

### 7.2 新模型

同一轮执行拆成 3 个阶段：

1. `lead` 阶段
2. `supplement/challenge` 阶段
3. `wrap` 阶段

执行流程：

```text
User message
  → decideParticipants()
  → assign contributionRole
  → execute lead
  → persist lead summary
  → wait coordination window
  → execute supplement/challenge
  → persist same-round summaries
  → execute wrap
  → finalize round
```

### 7.3 阶段间等待窗口

建议改为“自适应阶段间等待”，而不是统一固定延迟：

| responseMode           | 建议等待     |
| ---------------------- | ------------ |
| `single_owner`         | 0 秒         |
| `lead_plus_supplement` | 0.8 - 1.5 秒 |
| `debate_or_brainstorm` | 2 - 4 秒     |
| 高复杂讨论             | 4 - 6 秒     |

说明：

- 不建议默认拉到 10 秒，避免群响应过慢。
- 等待应发生在 `lead` 产出后，而不是 round 一开始。
- 目标是让后发 Bot 获得可消费的同轮摘要，而不是人为制造“慢回复”。

---

## 8. 同轮增量约束

### 8.1 必须新增的运行时上下文

为补充者和收口者注入：

- `sameRoundReplies`
- `sameRoundSummary`
- `coveredFacts`
- `uncoveredAngles`

其来源是同一轮前序 Bot 的已提交回答摘要。

### 8.2 补充者硬规则

补充者只能做以下事情之一：

1. 提供不同视角
2. 做更深层解释
3. 提供例子 / 应用
4. 指出前述答案遗漏
5. 做纠错或质疑

不允许：

1. 把同一题再完整答一遍
2. 社交性刷存在感
3. 低价值“转交式”输出
4. 重复前序已覆盖的核心事实

### 8.3 无增量则静默

如果某个 Bot 在当前角色下无法提供新增价值：

- 应直接返回 `NO_REPLY`
- 不应为了“参与感”输出重复或低价值文本

---

## 9. Prompt 约束升级

### 9.1 现有基础

当前 prompt 已有：

- 同轮还有谁会回复
- 不要代替别人发言
- 某些 follow-up 场景下不要重复介绍

### 9.2 需要新增的规则

在 `src/gateway/collaboration-dispatch/discussion-turn-prompt.ts` 中补充：

1. 你不是独立答题者，而是本轮协作者。
2. 前面成员已覆盖的核心点不得重复展开。
3. 你的目标是提供增量价值，而不是完整重答。
4. 如果无法显著增加信息量，请返回 `NO_REPLY`。
5. `wrap` 角色只负责总结，不重复正面回答。

推荐新增规则文案：

```text
如果前序成员已经覆盖了主要事实，请不要重复完整答案。
你的目标是做增量贡献：补充、纠错、深化、举例或收口。
如果你无法提供明显新增价值，请直接返回 NO_REPLY。
```

---

## 10. 角色级发言纪律

### 10.1 推荐默认纪律

| 角色        | 默认行为                           |
| ----------- | ---------------------------------- |
| 协调者      | 默认 `wrap`，除非被明确点名        |
| 执行秘书型  | 默认静默或补充流程，不参与知识主答 |
| 教学/陪伴型 | 适合 `lead` 或举例型补充           |
| 深度分析型  | 适合 `supplement` / `challenge`    |
| 市场/行业型 | 适合领域化补充，不做通用知识主答   |

### 10.2 特别约束

对“高级秘书”一类角色增加硬约束：

- 不再输出“这个问题交给某某”
- 当其他成员已在回答时默认静默
- 仅在流程、安排、跟进、记录类问题中发言

---

## 11. 具体实现拆分

### 11.1 Phase A — 止血版

目标：快速减少群内多人重复抢答

任务：

1. 在 `decision-engine.ts` 增加 `responseMode`
2. 简单知识问答收敛到 `single_owner`
3. 为参与者分配 `contributionRole`
4. 对 `高级秘书` / 协调者加入默认静默或 wrap 约束
5. 降低简单问题的可见回复上限

建议文件：

- `src/gateway/collaboration-dispatch/decision-engine.ts`
- `src/gateway/collaboration-dispatch/types.ts`
- `src/gateway/collaboration-dispatch/tier1a-duty-engine.ts`

### 11.2 Phase B — 核心机制版

目标：让补充者真正看到前序回答

任务：

1. 把同轮执行从全并行改为 staged orchestration
2. 先执行 `lead`
3. 把 `lead` 回答写入 same-round 摘要
4. 等待短协调窗口
5. 执行 `supplement/challenge`
6. 最后执行 `wrap`

建议文件：

- `src/gateway/server-methods/chat.ts`
- 新增 `src/gateway/collaboration-dispatch/round-orchestrator.ts`

### 11.3 Phase C — 质量控制版

目标：进一步压制重复并形成可观测指标

任务：

1. 新增轻量重复检测
2. 记录 `suppressedAsDuplicate`
3. 记录 `incrementalContribution`
4. 把 responseMode / contributionRole 写入 ledger

建议文件：

- 新增 `src/gateway/collaboration-dispatch/redundancy-guard.ts`
- `src/gateway/collaboration-ledger/types.ts`
- `src/gateway/collaboration-ledger/writer.ts`

### 11.4 Phase D — Mission 与群状态校正

目标：避免 onboarding 逻辑长期支配真实工作群

任务：

1. 成员介绍完成后自动推进 group mission
2. onboarding 型群广播只在初始化阶段生效
3. 普通知识问答不再误触发“全员可回应”

建议文件：

- `src/gateway/collaboration-learning/shared.ts`
- `src/gateway/collaboration-learning/group-charter.ts`
- `src/gateway/collaboration-learning/operating-state-types.ts`

---

## 12. 验收标准

### AC-1 简单知识问答

输入：

`谁知道端午节的由来？`

通过标准：

- 最多 1 个主答
- 最多 1 个高价值补充
- 不允许 4 个以上重复完整回答

### AC-2 分析型问题

输入：

`请分析中国出口结构变化的原因`

通过标准：

- 主答者给整体框架
- 补充者只补数据、风险、不同视角
- 不允许每个人重新完整讲一遍

### AC-3 讨论型问题

输入：

`请大家讨论一下这个方案怎么推进`

通过标准：

- 允许多人参与
- 各角色输出职责明显不同
- 至少出现“主答 / 补充 / 收口”中的两类以上协作行为

### AC-4 重复抑制

若后发 Bot 与前发回答高度重叠：

通过标准：

- 系统自动压制为 `NO_REPLY` 或要求转为增量补充
- 前台 transcript 中不再出现明显低价值重复回答

### AC-5 角色纪律

对于秘书型角色：

通过标准：

- 不再出现“这个问题交给某某来答”式无效前台输出
- 除非问题涉及流程、安排、协调，否则默认不发言

---

## 13. 风险与注意事项

1. 不要直接把所有群作答统一延迟 3-10 秒，否则会显著拉长整体响应时间。
2. 不要只改 prompt 而不改执行模型，否则重复问题无法稳定解决。
3. 不要在未收敛主干前引入新的平行调度系统。
4. 不要让“群协作纪律”变成“大家都不说”，必须保留真正有价值的补充。

---

## 14. 最终实施建议

本次优化的执行顺序必须是：

1. **先收敛简单问题为单主答**
2. **再实现 staged lead/supplement**
3. **再增加重复抑制**
4. **最后补 ledger 指标和 UI 阶段状态**

不要反过来先做复杂语义去重，再保留当前并行大乱斗机制。

---

## 15. 一句话定义

> 本次优化的目标，不是让协作群“回复更慢一点”，而是让协作群从“多人同时答题”升级为“多人协同解题”。
