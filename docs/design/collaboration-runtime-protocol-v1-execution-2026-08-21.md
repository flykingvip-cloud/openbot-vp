# OpenBot 协作运行协议 v1.0 执行方案

Date: 2026-08-21

Status: **Collaboration Runtime v1.0 基线仍有效 · 2026-08-22 生产验收不通过，禁止部署**。P0 合同阻断与下一步顺序见 [生产验收决定](/design/collaboration-csc-production-acceptance-2026-08-22)。开工前 5 项语义修正已落地。P2/P3 **不锁死**。合同：[Production Runtime Contract v1.0](/design/collaboration-production-runtime-contract-v1-2026-08-21)。**冻结：不再增加协作话术规则，不再做大范围架构调整。**

Audience: Gateway / Orchestrator、协作学习、员工端 UI、Agent Growth OS

Related:

- [Production Runtime Contract v1.0](/design/collaboration-production-runtime-contract-v1-2026-08-21)
- [Context Scope Controller v1.1 补充](/design/context-scope-controller-v1-supplement-2026-08-21)
- [协作群对话机制优化](/design/openbot-collaboration-group-dialogue-optimization-2026-06-18)
- [协作群作答编排优化](/design/openbot-collaboration-group-response-orchestration-optimization-2026-06-19)
- [多 Agent 协作 OS 锁版](/design/openbot-multi-agent-collaboration-os-freeze-2026-06-19)
- [协作空间权威收敛](/design/collaboration-space-authority-convergence-2026-08-08)
- C5 协作路径锁定（`managed-collaboration-c5-path-lock-2026-08-20`，未进树）

---

## 0. 一句话目标

把「提示机器人遵守规则」升级为 **Gateway / Orchestrator 在运行时约束谁可以说话**；同时把 **AI 助手 1:1** 与 **协作空间群聊** 收成同一套对话内核，只在 Round 层分叉。

最终形态：

```text
User Intent
  → Task Classification
  → Primary Assignment
  → Primary Response（原子完成）
  → Supplement Evaluation（有增量才派发）
  → Optional Convergence
  → Round Complete + Ledger
```

平台不变量（单主答、主答未完成禁止补充、@ 优先且未匹配不得静默、补充必须有增量、协调者默认不是主答）**不可被 Prompt 或小组配置覆盖**。

**审阅锁定（2026-08-21 终审）：**

| 项                       | 结论                                                 |
| ------------------------ | ---------------------------------------------------- |
| 五层内核                 | **冻结**，见 §3.0                                    |
| Platform / Group / Round | **冻结**                                             |
| Cheap Gate               | **强烈保留**；P0 用 DROP/KEEP/REVIEW，不追求分数精度 |
| Growth                   | P0/P1 只观察，不扣分、不回写调度                     |
| 协作话术规则             | **正式冻结**，不再增加                               |
| P0                       | 进入实现 + 合同测试                                  |
| P2/P3                    | 不锁死                                               |

一句话规范：

> **Policy 管规则，Engine 管选择，State Machine 管时序，CSC 管本轮可看什么，LLM 管内容，Ledger 管事实。**

协作话术规则仍冻结。CSC 是上下文获取权，不增加谁可以说话的规则。详见 [CSC v1.1](/design/context-scope-controller-v1-supplement-2026-08-21)。

四种产品模式（架构预留；P0 只做前三个）：`single_owner` · `lead_plus_supplement`（默认）· `explicit_multi`（多人 @ 必答）· `debate` / `brainstorm`（P2 观察后再做）。

P0 盯 4 个生产指标，而不是再写规则：① 是否少跑无价值 LLM ② 主答是否先完成 ③ 是否降低重复/抢答 ④ 重启、Stop、重复事件后是否正确恢复。

---

## 1. 为什么现在必须做

### 1.1 产品问题

协作群已经能多 Bot 作答，但纪律仍主要靠 prompt：

- 主答与补充在决策层一次选齐，补充成员即使没有增量也会被拉去跑一轮 LLM。
- `@Skill孵化` 这类粘连点名若 parser 失败，会静默落到协调者自己回，违反用户显式意图。
- 一对一助手与协作群走两套 `chat.send` 分支：流式、工具策略、完成判定、Ledger 各自演化，后期无法统一治理。

### 1.2 工程问题

`src/gateway/server-methods/chat.ts` 的 `space:` 分支已经串行 `lead → supplement → wrap`，但：

- **没有 Round 状态机对象**，状态散落在 `for` 循环、`group_lead_settled`、`group_round_complete` 里。
- **Contribution 是事后过滤**（`redundancy-guard` / `NO_REPLY`），不是派发前闸门。
- **Policy 只有 8 个布尔/上限字段**，无法表达超时、冲突、质量、复盘。
- **1:1 助手**刚补上 `addChatRun` 流式与 webchat chat-lane；群聊仍走 `CollaborationRoundInvoked → disableTools`。两套快路径语义接近，实现不共享。

若不在这一层收敛，后续话题相关性、Growth OS、任务认领、学习回流都会继续往 `chat.ts` 堆 `if/else`。

---

## 2. 现状对照（以代码为准）

### 2.1 已经具备、必须复用

| 能力           | 现状落点                                                                                                      | v1.0 中的角色                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 群聊入口       | `chat.ts`：`isSpaceAliasSessionKey` → `decideParticipants` → `runGroupBotDiscussionTurn`                      | Round 宿主，逐步变薄                                        |
| 决策入口       | `collaboration-dispatch/decision-engine.ts` `decideParticipants()`                                            | Primary Assignment Engine 的前身                            |
| 响应模式       | `response-mode.ts`：`single_owner` / `lead_plus_supplement` / `debate_or_brainstorm` / `decision_to_executor` | 保留；辩论模式是「单主答」的显式例外                        |
| 串行编排       | `round-orchestrator.ts` `buildCollaborationRoundStages` + `chat.ts` 分 stage `await`                          | Round State Machine 的执行骨架                              |
| 同轮上下文     | `same-round-context.ts`                                                                                       | 补充判定输入                                                |
| 事后去重       | `redundancy-guard.ts` overlap ≥ 0.55                                                                          | 降为 Contribution Engine 的后置保险，不再当主闸             |
| 点名解析       | `mention-utils.ts` + `decision-engine.ts` `resolveMentionedBots`                                              | MentionResolver；未匹配目前会 fallback 协调者（**必须改**） |
| 职责/相关      | `tier1a-duty-engine.ts` / `tier1b-relevance-engine.ts`                                                        | 主答候选与补充候选的评分资产                                |
| 可见条数       | `visible-reply-limit.ts` 默认 3、硬顶 12                                                                      | Policy.supplement.maxVisible 的运行时上限                   |
| Prompt 纪律    | `discussion-turn-prompt.ts`：禁止工具、要求增量、允许 `NO_REPLY`                                              | 降为 Participation Charter 的文案层                         |
| 群策略快照     | `operating-state-types.ts` `collaborationPolicy`                                                              | 扩展为 Policy v1，而不是另起一套                            |
| Ledger         | `collaboration-ledger/types.ts` dispatch / execution / governance                                             | 扩展 Round Ledger 字段，不新开存储                          |
| 任务/交付物 SM | `collaboration-learning/state-machine.ts`                                                                     | **不要混用**；那是 Task/Deliverable，不是对话 Round         |
| 1:1 深度路由   | `inbound-depth.ts` + `get-reply-run.ts` chat-lane                                                             | 统一对话内核的 Intent/Depth                                 |
| 1:1 流式       | `chat.ts` `addChatRun` + `server-chat.ts` originConnId                                                        | 群聊子轮次已有；1:1 已对齐                                  |
| 完成信号       | `group_lead_settled` / `group_round_complete`                                                                 | 映射到 `PRIMARY_COMPLETED` / `ROUND_COMPLETE`               |

### 2.2 明确缺口

| 缺口           | 现状                                                | v1.0 要求                                                               |
| -------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| Round 状态     | 隐式循环                                            | 显式 `RoundState`，非法转换失败                                         |
| 单主答不变量   | `lead` 通常 1 人，但辩论/广播可多人同时 lead        | 默认 `PRIMARY_COUNT <= 1`；多人仅 `explicit_multi`（P0）或 debate（P2） |
| 补充闸门       | 先跑 LLM，再 overlap / `NO_REPLY`                   | Cheap Gate 通过才创建 supplement run                                    |
| 主答完成合同   | 子轮次 lifecycle `end` 即完成                       | Completion Contract；「我先看看」不算完成；允许流式                     |
| 主答超时       | 依赖整轮 `timeoutMs` / abort                        | 按 `taskType × inboundDepth` 预算 + takeover                            |
| 多人 @         | 第一人当 lead、其余 supplement                      | `explicit_multi` 点名队列，全部必答                                     |
| @ 未匹配       | `mention_unmatched` alert **同时**让 coordinator 回 | `MENTION_UNMATCHED`：告警，禁止静默主答                                 |
| 协调者默认主答 | 无 @ 开放讨论时常选 coordinator / 第一专家          | `coordinator !== primary`，除非 fallback / 显式 / 任务角色要求          |
| Policy         | 8 字段                                              | Platform 默认 + Group 白名单覆盖                                        |
| 1:1 与群       | 两套入口                                            | 同一内核，群多一个 Round 层                                             |
| Growth 指标    | execution 很薄                                      | 先记录 suppression；P0/P1 不扣分                                        |
| 生产运行时     | 内存循环、无 snapshot/幂等/恢复                     | Runtime Contract C1–C6                                                  |

### 2.3 一对一助手 vs 协作空间（当前分叉）

```text
chat.send
 ├─ space:*     群：decideParticipants → 串行 bot turns → group transcript / ledger
 └─ agent:*     1:1：dispatchInboundMessage → inbound-depth chat-lane → 单 bot 流式
```

相同点：都是 Control UI `webchat`、都要流式、都要租户隔离、普通闲聊都应少工具。

不同点：群有多角色、点名、补充、收口；1:1 永远只有一个 Primary。

**统一原则：** 1:1 = 退化 Round（`PRIMARY_COUNT=1`，`supplement.enabled=false`，无 coordinator）。不要为助手再发明第二套状态机。

---

## 3. 目标架构

### 3.0 五层内核（冻结）

```text
1. Collaboration Policy          系统允许什么
2. Intent / Mention / Assignment 这一轮应该找谁
3. Round State Machine           当前谁可以说
4. Contribution / Completion     有没有价值、是否完成
5. Ledger                        实际发生了什么
         ↓
Growth / Learning / Mesh         只观察，不实时改本轮
```

Task/Deliverable State Machine 与 Round State Machine **分文件、分类型**，禁止混用。

### 3.1 三层规范（架构宪法 · 锁定）

本节边界审阅通过，**不再调整**：小组不能覆盖平台不变量；Round 不能让 Bot 改自己的 Allowed Action。

```text
Platform Collaboration Policy     运行时不变量 + 默认值
            │  小组只能覆盖白名单字段
            ▼
Group Collaboration Policy        使命 / 角色 / 阈值 / 阶段
            │  每轮实例化
            ▼
Round Runtime State               谁主答、谁等待、谁可补充、是否超时
```

| 层       | 谁写                                    | 谁不能改                                     |
| -------- | --------------------------------------- | -------------------------------------------- |
| Platform | 代码常量 `DEFAULT_COLLABORATION_POLICY` | Prompt、小组 UI、Growth                      |
| Group    | operating state + 小组设置白名单        | 单主答、@ 未匹配不得静默、主答未完成禁止补充 |
| Round    | Orchestrator 每轮生成                   | Bot 自己改 `Your Allowed Action`             |

### 3.2 四个 Engine（从 `decideParticipants` 拆出，而不是再包一层巨型函数）

```text
User Message
    │
    ▼
┌──────────────────┐
│ Intent Engine    │  用户要干什么？（taskType + inbound depth）
└────────┬─────────┘
         ▼
┌──────────────────┐
│ MentionResolver  │  structured @ → parser → agentId；失败进 MENTION_UNMATCHED
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Primary          │  唯一主答：mention > task×role > capability > phase > fallback
│ Assignment Engine│
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Round State      │  现在谁可以说话？（dispatch 闸门）
│ Machine          │
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Contribution     │  主答完成后：谁有增量？没有则不跑 LLM
│ Engine           │
└────────┬─────────┘
         ▼
Collaboration Round Ledger → Growth / Learning / Mission
```

`FallbackController` 挂在 State Machine 的 `PRIMARY_TIMEOUT` 边，不单独抢主路径。

### 3.3 统一对话内核（助手 + 协作共用）

| 内核模块                               | 1:1 助手                                   | 协作空间                              |
| -------------------------------------- | ------------------------------------------ | ------------------------------------- |
| `chat.send` ACK / abort / `addChatRun` | 是                                         | 子 run `${parent}:${agentId}`         |
| Intent / inbound-depth                 | chat / retrieve / act                      | 同一分类器；群额外产出 `taskType`     |
| 工具策略                               | chat-lane `disableTools`                   | 讨论回合默认空工具；retrieve/act 再开 |
| 流式 + 逐字稿                          | `agent:` typewriter                        | `space:` typewriter                   |
| Round SM                               | 退化：CREATED→ASSIGNED→RESPONDING→COMPLETE | 全状态                                |
| Ledger                                 | 可选轻量 `direct_round`（P2）              | 必写 Collaboration Ledger             |

禁止：助手走 RPC 假对话快路径；禁止群聊再绕过 Round 直接 `BOT_REPLY`。

---

## 4. CollaborationPolicyV1（完整对象）

用户草案里 interface 只写了 F–I，默认值却含 mention / supplement / coordinator。执行以**完整对象**为准。小组覆盖见 §4.3。

```ts
type IncrementType =
  | "correction"
  | "deepening"
  | "example"
  | "missing-angle"
  | "risk"
  | "evidence"
  | "execution"
  | "closure";

interface CollaborationPolicyV1 {
  version: "1.0";

  assignment: {
    coordinatorIsDefaultPrimary: false;
    /** Assignment 不可拆分；Response 允许流式。完成只认 Completion Contract */
    primaryAssignmentAtomic: true;
  };

  mention: {
    mentionBotMustRespond: boolean;
    mentionOverridesPrimary: boolean;
    mentionedBotMode: "primary";
    unmatchedMention: "warn"; // 禁止 "silent-coordinator"
    structuredMentionPriority: boolean;
  };

  supplement: {
    enabled: boolean;
    waitForPrimary: true; // 平台不变量
    requireIncrementalValue: boolean;
    allowedIncrementTypes: IncrementType[];
    maxSupplementBots: number;
    maxIncrementPerBot: 1; // 平台不变量
    duplicateThreshold: number;
    relevanceThreshold: number;
    incrementScoreThreshold: number;
  };

  coordinator: {
    enabled: boolean;
    role: "convergence";
    summarizeWhen: Array<
      "multi-round" | "conflict" | "cross-role" | "explicit-request" | "deliverable-required"
    >;
    avoidSimpleQASummary: boolean;
  };

  conflict: {
    preserveDisagreement: boolean;
    requireExplicitPresentation: boolean;
    autoResolve: false;
    resolutionAuthority: "human" | "coordinator" | "external-policy";
  };

  fallback: {
    allowSecondaryTakeover: boolean;
    takeoverMode: "coordinator" | "best-role-match";
    userNotificationOnTimeout: boolean;
    timeoutPolicy: {
      placeholderMs: number;
      byTaskType: Record<
        | "chitchat"
        | "chat"
        | "knowledge"
        | "analysis"
        | "research"
        | "data"
        | "decision"
        | "execution"
        | "unknown",
        number
      >;
    };
  };

  quality: {
    selfCheckBeforeSend: boolean;
    duplicateDetection: boolean;
    offTopicDetection: boolean;
    violationSelfReport: boolean;
    ledgerEnabled: true; // 平台不变量
  };

  review: {
    enabled: boolean;
    periodicReview: boolean;
    reviewPeriod: "daily" | "weekly" | "mission" | "manual";
    trackViolations: boolean;
    trackContribution: boolean;
  };
}
```

### 4.1 Platform 默认值

```ts
const DEFAULT_COLLABORATION_POLICY: CollaborationPolicyV1 = {
  version: "1.0",
  assignment: {
    coordinatorIsDefaultPrimary: false,
    primaryAssignmentAtomic: true,
  },
  mention: {
    mentionBotMustRespond: true,
    mentionOverridesPrimary: true,
    mentionedBotMode: "primary",
    unmatchedMention: "warn",
    structuredMentionPriority: true,
  },
  supplement: {
    enabled: true,
    waitForPrimary: true,
    requireIncrementalValue: true,
    allowedIncrementTypes: [
      "correction",
      "deepening",
      "example",
      "missing-angle",
      "risk",
      "evidence",
      "execution",
      "closure",
    ],
    maxSupplementBots: 2,
    maxIncrementPerBot: 1,
    duplicateThreshold: 0.75,
    relevanceThreshold: 0.6,
    incrementScoreThreshold: 0.55,
  },
  coordinator: {
    enabled: true,
    role: "convergence",
    summarizeWhen: [
      "multi-round",
      "conflict",
      "cross-role",
      "explicit-request",
      "deliverable-required",
    ],
    avoidSimpleQASummary: true,
  },
  conflict: {
    preserveDisagreement: true,
    requireExplicitPresentation: true,
    autoResolve: false,
    resolutionAuthority: "human",
  },
  fallback: {
    allowSecondaryTakeover: true,
    takeoverMode: "best-role-match",
    userNotificationOnTimeout: true,
    timeoutPolicy: {
      placeholderMs: 5_000,
      byTaskType: {
        chitchat: 8_000,
        chat: 8_000,
        knowledge: 15_000,
        analysis: 30_000,
        research: 60_000,
        data: 60_000,
        decision: 30_000,
        execution: 120_000,
        unknown: 30_000,
      },
    },
  },
  quality: {
    selfCheckBeforeSend: true,
    duplicateDetection: true,
    offTopicDetection: true,
    violationSelfReport: true,
    ledgerEnabled: true,
  },
  review: {
    enabled: true,
    periodicReview: true,
    reviewPeriod: "weekly",
    trackViolations: true,
    trackContribution: true,
  },
  /** CSC：管「本轮允许看什么」，不混进 mention/supplement 话术规则。 */
  contextPolicy: {
    defaultMode: "auto",
    allowMemberOverride: true,
    mandatoryGroupContext: true,
    allowExternalSources: true,
    maxContextTokens: 24_000,
    maxFilesPerRound: 20,
    allowedSourceTypes: ["conversation", "group", "knowledge", "folder", "file", "api"],
  },
};
```

与现状字段映射：

| 旧 `collaborationPolicy`         | 新位置                                                       |
| -------------------------------- | ------------------------------------------------------------ |
| `mentionBotMustRespond`          | `mention.mentionBotMustRespond`                              |
| `openDiscussionWithoutMention`   | 删除「无 @ 就群演」语义；改为 Intent 决定是否打开 supplement |
| `maxVisibleBotRepliesPerRound`   | `1 + supplement.maxSupplementBots`（再夹可见上限）           |
| `coordinatorSummarizeAfterRound` | `coordinator.summarizeWhen` 条件触发，默认不再每轮 wrap      |
| `humanStartsNewRound` 等         | 仍留 operating state 治理段，不进 Round SM                   |

### 4.2 1:1 助手的有效 Policy

助手不读小组 charter。运行时合成：

```ts
{
  ...DEFAULT_COLLABORATION_POLICY,
  supplement: { ...defaults.supplement, enabled: false },
  coordinator: { ...defaults.coordinator, enabled: false },
  mention: { ...defaults.mention, mentionBotMustRespond: true },
}
```

即：当前会话 Bot = Primary；无补充窗口；inbound-depth 仍可把闲聊打到 chat-lane。

### 4.3 Group 允许覆盖的白名单

只允许覆盖：

- `supplement.enabled`
- `supplement.maxSupplementBots`（1–3，硬顶仍受 `COLLABORATION_ABSOLUTE_VISIBLE_TURN_LIMIT`）
- `supplement.duplicateThreshold` / `relevanceThreshold` / `incrementScoreThreshold`
- `coordinator.enabled`
- `fallback.timeoutPolicy.byTaskType.*`（受合同下限约束，见 Runtime Contract C6）
- `fallback.takeoverMode`
- `review.reviewPeriod`

禁止覆盖：`primaryAssignmentAtomic`、`waitForPrimary`、`maxIncrementPerBot`、`unmatchedMention`、`autoResolve`、`ledgerEnabled`、`coordinatorIsDefaultPrimary`。

`primaryMode` / `mentionMode` **不是 Policy**。它们是本轮 Intent/Mention 的解析结果，写在 Round / MentionResolution 上：

```ts
type PrimaryMode = "single" | "explicit_multi";
type MentionMode = "none" | "single_primary" | "explicit_multi";

interface MentionResolution {
  matchedAgentIds: string[];
  unmatchedTokens: string[];
  mode: MentionMode;
}

// PersistedRound
primaryMode: PrimaryMode;      // 无 @ 普通任务 / 单 @ → single；≥2 有效 @ → explicit_multi
mentionMode: MentionMode;
primaryQueue: string[];        // single: [A]；explicit_multi: [A,B,C] 点名顺序
primaryCursor: number;         // 当前队列下标
```

---

## 5. Round 状态机（运行时权威）

### 5.1 状态

```ts
type RoundOccupancy = "none" | "executing";

type RoundState =
  | "ROUND_CREATED"
  | "CLASSIFYING"
  | "MENTION_UNMATCHED" // occupancy=none：阻塞态，不占 Bot 并发、不创建 Run
  | "PRIMARY_ASSIGNED"
  | "PRIMARY_QUEUE" // 主答队列：single=[A]；explicit_multi=[A,B,C]
  | "WAITING_PRIMARY"
  | "PRIMARY_RESPONDING"
  | "PRIMARY_COMPLETED"
  | "PRIMARY_TIMEOUT"
  | "FALLBACK"
  | "SUPPLEMENT_WINDOW"
  | "SUPPLEMENTING"
  | "CONVERGENCE_CHECK"
  | "OPTIONAL_CLOSE"
  | "ROUND_COMPLETE"
  | "ROUND_ABORTED";
```

**任意 Bot 在当前 `primaryQueue[primaryCursor]` 被 dispatch 之前，其他人不得有子 run。** `MENTION_UNMATCHED` 只持久化阻塞记录 + TTL，Gateway **不得**为此挂一个 60 秒的执行任务。

占用分类：

| 状态                                                                                       | occupancy   | 含义                       |
| ------------------------------------------------------------------------------------------ | ----------- | -------------------------- |
| `MENTION_UNMATCHED` / `ROUND_COMPLETE` / `ROUND_ABORTED`                                   | `none`      | 无 Agent Run、不占并发槽   |
| `WAITING_PRIMARY` / `PRIMARY_RESPONDING` / `SUPPLEMENTING` / `FALLBACK` / `OPTIONAL_CLOSE` | `executing` | 至多一个 currentDispatchId |
| 其余过渡态                                                                                 | `none`      | 纯编排，可立即转换         |

### 5.2 转换表

| 当前               | 事件                                    | 下一状态                                   | 允许动作                                              |
| ------------------ | --------------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| CREATED            | `message_received`                      | CLASSIFYING                                | 无发言                                                |
| CLASSIFYING        | `mention_unmatched`                     | MENTION_UNMATCHED                          | occupancy=none；UI 告警；无 Agent Run；TTL 到期 abort |
| MENTION_UNMATCHED  | `user_next_message`                     | ROUND_ABORTED (superseded)                 | 新消息开新 Round，本轮不复活                          |
| MENTION_UNMATCHED  | `unmatched_expired` / abort             | ROUND_ABORTED                              | 禁止改派协调者                                        |
| CLASSIFYING        | `classified`                            | PRIMARY_ASSIGNED                           | 写入 `primaryMode` + `primaryQueue`                   |
| PRIMARY_ASSIGNED   | `queue_ready`                           | PRIMARY_QUEUE                              | 单人队列长度 1，与多人同一套逻辑                      |
| PRIMARY_QUEUE      | `cursor_ready`                          | WAITING_PRIMARY                            | 只允许 `primaryQueue[primaryCursor]`                  |
| WAITING_PRIMARY    | `primary_started`                       | PRIMARY_RESPONDING                         | 仅当前 dispatch 流式                                  |
| PRIMARY_RESPONDING | `completed`（Completion Contract 通过） | PRIMARY_COMPLETED                          | 开始输出 ≠ 完成                                       |
| PRIMARY_RESPONDING | `placeholder`                           | 仍 RESPONDING，直到 placeholder/主预算超时 | 「我看看」不是完成                                    |
| PRIMARY_COMPLETED  | `queue_has_next`                        | PRIMARY_QUEUE                              | `primaryCursor++`；explicit_multi 下一人              |
| PRIMARY_COMPLETED  | `queue_exhausted` + 可补充              | SUPPLEMENT_WINDOW                          | `primaryMode=single` 且非闲聊                         |
| PRIMARY_COMPLETED  | `queue_exhausted` + 不补充              | CONVERGENCE_CHECK                          | single_owner / 闲聊 / explicit_multi 默认跳过补充     |
| PRIMARY_RESPONDING | `timeout`                               | PRIMARY_TIMEOUT                            | 启动兜底                                              |
| PRIMARY_TIMEOUT    | `takeover`                              | FALLBACK                                   | 备用成员一次主答                                      |
| FALLBACK           | `completed` / `failed`                  | PRIMARY_COMPLETED / ABORTED                | 记 fallback                                           |
| SUPPLEMENT_WINDOW  | `candidate_found`                       | SUPPLEMENTING                              | Cheap Gate KEEP/REVIEW 后最多 N 人                    |
| SUPPLEMENT_WINDOW  | `no_candidate`                          | CONVERGENCE_CHECK                          | 不跑补充 LLM                                          |
| SUPPLEMENTING      | `finished`                              | CONVERGENCE_CHECK                          |                                                       |
| CONVERGENCE_CHECK  | `close_required`                        | OPTIONAL_CLOSE                             | 协调者收口                                            |
| CONVERGENCE_CHECK  | `close_not_required`                    | ROUND_COMPLETE                             |                                                       |
| OPTIONAL_CLOSE     | `completed`                             | ROUND_COMPLETE                             | 写 Ledger                                             |
| 任意               | `fatal_error` / abort                   | ROUND_ABORTED                              |                                                       |

### 5.3 与现有串行 stage 的对齐

当前 `buildCollaborationRoundStages`：

```text
lead.bots[]  →  supplement.bots[]  →  wrap.bots[]
```

映射：

```text
lead[]            → primaryQueue（P0 用同一 PRIMARY_QUEUE，不再并行 lead）
supplement[]      → SUPPLEMENT_WINDOW + Cheap Gate 后再逐个 SUPPLEMENTING
wrap[]            → OPTIONAL_CLOSE（仅 needsConvergence）
group_lead_settled → 当前 cursor 的 PRIMARY_COMPLETED（兼容事件名）
group_round_complete → ROUND_COMPLETE
```

### 5.4 平台不变量（代码 assert，Prompt 改不了）

1. `primaryMode=single` 时同时 executing 的主答 ≤ 1；`explicit_multi` 用同一套 `PRIMARY_QUEUE`，**当前 cursor 也只能有一个子 run**。
2. `state` 未到队列耗尽 → `supplement.dispatch === false`。
3. 单 @ → `mentionMode=single_primary` 且 `primaryMode=single`；**≥2 有效 @ → `explicit_multi` 入队全部必答，不得降成 Supplement**。
4. @ 未命中 → `MENTION_UNMATCHED`：occupancy=none，禁止 coordinator 静默顶上；TTL 到期 abort，不挂执行任务。
5. Cheap Gate `DROP` → 不创建子 run；`REVIEW` P0 按 KEEP 处理并记原因。
6. `supplementCount(agentId) <= 1`。
7. `coordinator !== primaryQueue[0]`，除非 fallback / 显式 @ / 任务角色要求。

### 5.5 协作模式与辩论（P0 子集）

P0 实现：`single_owner` · `lead_plus_supplement` · `explicit_multi`。

`debate` / `brainstorm` / `multi_executor` **枚举必须能写入 snapshot**，命中则降级为 `lead_plus_supplement` 并记 `mode_degraded`。P2 是否解锁等运行数据，本方案不锁死。

无 @ 的分析题默认 `lead_plus_supplement`。头脑风暴关键字 P0 不得 6 人并行。

---

## 6. 各 Engine 规格

### 6.1 Intent Engine

输入：用户文本、附件、sessionKind、`ChatType`、inbound-depth。

输出：

```ts
interface IntentClassification {
  taskType:
    | "analysis"
    | "research"
    | "data"
    | "decision"
    | "market"
    | "growth"
    | "content"
    | "execution"
    | "chitchat"
    | "unknown";
  inboundDepth: "chat" | "retrieve" | "act";
  confidence: number;
  requiredCapabilities: string[];
  responseModeHint: CollaborationResponseMode;
  collaborationMode:
    | "single_owner"
    | "lead_plus_supplement"
    | "explicit_multi"
    | "debate"
    | "brainstorm"
    | "multi_executor";
}
```

复用：

- `inbound-depth.ts` `classifyInboundDepth`（chat/retrieve/act）
- `response-mode.ts` 现有简单问答 / 分析 / 辩论关键字（收编为 hint，不再单独决定「几个人同时跑」）

P0 不新训模型：规则分类即可。`requiredCapabilities` 先从 `memberRoleMap.collaborationRole` 做字典映射。

### 6.2 MentionResolver

顺序：

1. UI `chat.send` `mentions[]`（structured）
2. 文本 parser（`mention-utils.ts`）
3. `agentId` / 显示名 / 别名最长前缀匹配（已有，用于中文粘连）

输出：`MentionResolution`（`matchedAgentIds` + `unmatchedTokens` + `mode`）。**不要写回 Policy。**

- 无 @ token → `mode=none`，`primaryMode=single`，队列由 Assignment 填 1 人。
- 1 命中 → `mode=single_primary`，`primaryMode=single`，`primaryQueue=[该 Bot]`。
- ≥2 全部命中 → `mode=explicit_multi`，`primaryMode=explicit_multi`，队列=点名顺序。
- 存在 @ 但 0 命中，或 ≥2 且有未命中 → `MENTION_UNMATCHED`（occupancy=none）。

**删除** `decision-engine.ts` 中「未匹配则 `tier1 = [coordinator]`」分支。

UI：沿用 round plan 头部告警；P0 不另做弹窗。SLA 见 Runtime Contract §6.2。

### 6.3 Primary Assignment Engine

优先级（写死）：

1. 显式点名（structured 优先于文本）
2. `taskType × collaborationRole`
3. 能力匹配（`requiredCapabilities` ∩ 成员能力）
4. 当前 `operatingPhase`（已有 `selectPhasePriorityBots`）
5. 协调者**指定**（仅当 Group Policy 打开且无 1–4）
6. Fallback：`best-role-match`，**不是**默认 coordinator

```ts
interface PrimaryAssignment {
  agentId: string;
  reason: "mention" | "task-role" | "capability" | "phase" | "coordinator" | "fallback";
  confidence: number;
}
```

1:1：`agentId = 当前 session 的 bot`，`reason = "fallback"` 或新值 `"session_owner"`。

### 6.4 Round State Machine

新建模块，建议路径：

`src/gateway/collaboration-dispatch/round-state-machine.ts`

- 纯函数 `transition(state, event) → state` **不够**；必须同时满足 [Runtime Contract](/design/collaboration-production-runtime-contract-v1-2026-08-21)：`PersistedRound`、Event Log、`stateVersion` CAS、`dispatchId` 幂等。
- 非法转换失败，编排器捕获后 `ROUND_ABORTED`。
- 内存 `RoundContext` 只是工作副本；群 Round 权威在 C5 `runtime/rounds/<roundId>.json`。

**禁止**把对话 Round 塞进 `collaboration-learning/state-machine.ts`（那是 Task/Review/Deliverable）。

### 6.5 Contribution Engine

仅在 **primaryQueue 耗尽** 之后运行（`explicit_multi` 默认跳过本窗口）。

**P0 必须先走 Cheap Gate（无 LLM），通过后才创建 supplement dispatch。** Cheap Gate 是协作运行时的 **AI Labor Dispatch Gate**，不只是补充过滤器。禁止「先跑补充 LLM，再用 overlap 决定是否展示」。

P0 **不要**做成看似精确的加权公式。没有生产数据校准权重时，三分即可：

```ts
type CheapGateResult =
  | { decision: "DROP"; reason: SuppressionReason }
  | { decision: "KEEP"; reason: string }
  | { decision: "REVIEW"; reason: string };

// P0：REVIEW 按 KEEP 创建 Run（宁可不误杀），Ledger 记 reason；P1 再上分数。
```

```text
Candidate Generation
  → Cheap Gate（role / capability / mission / phase / relevance 粗判 / 预算 / 可见上限 / 本轮状态）
       DROP → 不创建子 run
       KEEP / REVIEW → LLM
  → 后置 redundancy-guard 仅作发出前保险
```

P1/P2 再用 Ledger 把 KEEP/DROP 校准成分数。禁止在 P0 用 0.71382 这类假精度驱动阈值。

### 6.6 FallbackController

- 预算按 `timeoutPolicy.byTaskType` 与 inbound-depth 解析，见 Runtime Contract C6。**禁止全局 15s。**
- `placeholderMs`：仅有「收到/我看看」且无结论 → `completion.responseStatus=placeholder`，不得标 `PRIMARY_COMPLETED`。
- takeover：`best-role-match` 优先于 coordinator。
- Ledger 必写 `originalPrimary` / `takeoverAgent` / `reason`。
- UI：timeout notice（P0 可用 round plan alert）。

主答完成合同 **P0 即可启发式填值，但接口从第一天锁定** `PrimaryCompletionContract`。`primaryAssignmentAtomic`：Assignment 不可拆分；Response 可 typewriter。

### 6.7 Participation Charter（替换「请参与讨论」）

由 State Machine 按 agent 生成，注入 `discussion-turn-prompt.ts` 头部。字段至少包括：Round id、Task、Primary 名、Current State、Your Allowed Action（`WAIT | SPEAK_PRIMARY | SPEAK_SUPPLEMENT | SPEAK_CLOSE | SILENT`）、增量类型枚举。

Allowed Action = `WAIT` 时：**根本不创建子 run**。Charter 只给被 dispatch 的 Bot。

---

## 7. Ledger 与 Growth

扩展 `CollaborationExecutionRecord` / 新增 round 汇总（同一 jsonl，不换目录）：

```ts
interface CollaborationRoundLedger {
  roundId: string;
  groupId: string;
  userMessageId: string;
  taskType: string;
  primaryAgentId: string;
  primaryAssignmentReason: string;
  fallback?: {
    originalPrimary: string;
    takeoverAgent: string;
    reason: "primary_timeout" | "placeholder_timeout" | "primary_failed";
  };
  participants: Array<{
    agentId: string;
    role: "primary" | "supplement" | "coordinator" | "fallback";
    incrementType?: IncrementType;
    relevanceScore?: number;
    incrementalValue?: number;
    responded: boolean;
    duplicate: boolean;
    offTopic: boolean;
    latencyMs: number;
  }>;
  conflictDetected: boolean;
  convergenceRequired: boolean;
  suppressions: Array<{
    agentId: string;
    suppressionReason:
      | "low_relevance"
      | "duplicate"
      | "low_increment"
      | "role_mismatch"
      | "budget_limit"
      | "visible_limit"
      | "policy_disabled";
    falseSuppression?: boolean;
  }>;
  completedAt: number;
}
```

Growth OS **禁止**用「回复次数」当绩效。P0/P1 只 **Observe → Measure → Diagnose**，**不扣 Agent Growth 分**。链路稳定前，「连续没说话」不能等于「协作能力差」，可能只是调度器没给机会。

| 指标                          | 含义                                                        |
| ----------------------------- | ----------------------------------------------------------- |
| `primaryCompletionRate`       | 主答在超时前 complete                                       |
| `primaryLatency`              | WAITING_PRIMARY → PRIMARY_COMPLETED                         |
| `supplementPrecision`         | 派出补充中非 duplicate / 非 offTopic                        |
| `duplicateRate`               | 被 guard 掉的补充 / 派出补充                                |
| `incrementalValueRate`        | 有增量类型且 overlap 低                                     |
| `fallbackRate`                | 主答超时接管                                                |
| `unmatchedMentionRate`        | @ 未解析                                                    |
| `offTopicRate`                | 质量策略标记                                                |
| `suppressionQuality` / recall | 本该派发却被 Cheap Gate 误杀（`falseSuppression` 复盘回填） |

聚合路径必须是：`Dispatch Opportunity → Eligible → Dispatched | Suppressed → Response → Quality`。只从 Ledger 聚合，**不回写实时调度**。

---

## 8. 员工端

P0 最小：

- 保留 round plan 摘要（谁主答、谁等待）。
- `@` 未匹配告警必须可见（已有 alert kind，确认 UI 渲染）。
- 主答超时 notice。
- 停止按钮 / 流式：沿用已修的 `group_lead_settled` 不清 run、typewriter。

P1：

- Round 容器展示状态：`主答中` / `补充窗口` / `已收口`。
- 补充气泡显示增量类型（若解析成功）。

不做：把状态机画成给用户看的 16 个内部状态名。

---

## 9. `chat.ts` 编排器瘦身

目标：`space:` 分支只做 I/O（transcript、abort、broadcast），决策与闸门全部进 dispatch 模块。

建议新文件（均在 `src/gateway/collaboration-dispatch/`）：

| 文件                           | 职责                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `policy.ts`                    | 默认 Policy、merge 白名单、1:1 合成、**Round 内只读 snapshot** |
| `round-state-machine.ts`       | 纯转换                                                         |
| `round-store.ts`               | PersistedRound CAS + events.jsonl（C5 `runtime/rounds`）       |
| `round-context.ts`             | 工作副本；权威在 store                                         |
| `intent-engine.ts`             | 从 response-mode + inbound-depth 组合；产出 collaborationMode  |
| `primary-assignment-engine.ts` | 从 decision-engine 拆主答                                      |
| `contribution-engine.ts`       | **Cheap Gate（P0）** + 分数；redundancy-guard 后置             |
| `fallback-controller.ts`       | 任务类型超时 / takeover / 重启恢复表                           |
| `participation-charter.ts`     | Charter 文本                                                   |
| `round-runtime.ts`             | 供 `chat.ts` 调用的唯一 `runCollaborationRound()`              |

`decision-engine.ts` 保留为「计划预览」（UI round plan），但 **executionBots 不再等于立刻全部 dispatch**。plan 可以列出「候选补充」，runtime 到窗口再决定是否跑。

`selectGroupDiscussionBotsForScope` 若仍有残留引用，一律改为 `decideParticipants` / `runCollaborationRound`。

---

## 10. 分阶段交付

### P0 — 压缩范围（调度闸门 + Production Runtime Contract）

**目标：** 先主答、Cheap Gate 通过才烧补充 LLM、@ 未匹配不静默、多人 @ 必答、重启/停/幂等可测。

**不再往 P0 塞更多协作话术规则。** 合同正文：[Production Runtime Contract](/design/collaboration-production-runtime-contract-v1-2026-08-21)。

| 块                 | 必须完成                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A Runtime          | Policy Snapshot、PRIMARY_QUEUE + persist、occupancy 分类、Primary-only dispatch、Supplement Window、@ Resolver、unmatched **阻塞态**、abort/stop |
| B 调度             | Primary Assignment、Cheap Contribution Gate、max supplement、duplicate guard、coordinator 不抢 Primary、`explicit_multi`                         |
| C 可靠性 **P0.10** | roundId / dispatchId / eventId / stateVersion / 幂等 / 持久化当前态 / 任务类型 timeout / cancel / recovery                                       |
| D Ledger           | policyVersion、primary、assignmentReason、dispatch、suppression、response、latency、duplicate、offTopic、fallback、finalState                    |
| E 测试             | 见 §10.4（含 restart / 重复事件 / 重复 dispatch）                                                                                                |

工单映射：P0.1 Policy · P0.2 SM · P0.3 `runCollaborationRound` · P0.4 unmatched · P0.5 Cheap Gate · P0.6 Charter 不建 WAIT run · P0.7 Ledger · P0.8 1:1 退化 Round · P0.9 测试 · **P0.10 Runtime Contract 落地**。

**P0 非目标：** runner metadata 完成合同（接口要预留）、debate 对等发言、补充类型强制结构化、Growth 扣分、协调者每轮总结、P2/P3 功能。

### P1 — 完成合同升级与意图入口统一

- `PrimaryCompletionContract.source = runner_metadata`（字段名不变）。
- takeover UI notice 打磨；重启恢复表按合同执行（P0 已有骨架）。
- inbound-depth 与群 Intent 同一函数入口（`sessionKind`）。
- 补充类型改为内部 metadata。

### P2 / P3 — 不锁死

观察 P0/P1：Cheap Gate 误杀率、fallbackRate、explicit_multi 占比、超时是否误伤 research。再决定：

- P2 候选：条件收口、冲突呈现、debate/brainstorm 真模式、1:1 `direct_round` Ledger。
- P3 候选：Growth 在 **Eligible→Dispatched** 链路稳定后才计贡献；周报复盘。

### 10.4 P0 验收

**行为**

1. 简单问答：仅 1 个 Primary；Cheap Gate 全 DROP；无第二 LLM。
2. 分析任务：Primary 完成后 0–2 补充；补充不得早于主答 **Completion Contract**。
3. 单 `@准确名`：该 Bot 为主答；其他人 WAIT。
4. `@A @B` 均命中：`primaryMode=explicit_multi`，走 `PRIMARY_QUEUE` 按顺序各答一次。
5. `@不存在`：`MENTION_UNMATCHED` occupancy=none；无执行任务挂起；协调者不长文顶上。
6. 主答只说「我看看」：不进入 `PRIMARY_COMPLETED`。
7. 用户 Stop：`ROUND_ABORTED`，无后续 supplement。
8. 1:1 闲聊：chat-lane、流式/逐字稿仍在。
9. `research` 任务：主答预算按 60s 量级，不得 15s 接管。

**测试（最低）**

- 转换表 + 不变量；unmatched 不再选 coordinator。
- Cheap Gate 低于阈值 **零 LLM dispatch**。
- lead 完成前 supplement 子 run = 0。
- 合同 R1–R4：Gateway restart、重复 `eventId`、重复 `dispatchId`、用户 Stop。
- Policy 中途修改不影响本轮 snapshot。
- inbound-depth 1:1 问候仍 disableTools；群 lead settled / typewriter 回归。

**试点：** 「数字人测试 / 数字人战队」本地 `127.0.0.1:18789`，不 overlay LIVE。

---

## 11. 风险与明确不做

| 风险                           | 处理                                                        |
| ------------------------------ | ----------------------------------------------------------- |
| 过度规训，头脑风暴被压成单主答 | 模式枚举预留；P0 只降级并记 `mode_degraded`；P2 再开        |
| Cheap Gate 误杀                | 阈值偏松；Ledger `suppressionReason`；看 suppression recall |
| 重启后用户还在等               | P0 不自动重烧主答 LLM；timeout/fallback/abort + 通知        |
| 完成合同靠启发式               | 接口锁定；P1 换 source                                      |
| 继续堆 `chat.ts`               | P0 必须出现 `runCollaborationRound` + `round-store`         |

**不做：**

- 用更大 system prompt 代替闸门。
- 让 Growth 实时改本轮谁发言，或因「没说话」扣分。
- 恢复 D1 `user.daibai.ask` 假对话。
- 把 1:1 助手改成迷你群演。
- 自动用 coordinator 裁决观点冲突。
- 本轮继续加新的协作话术规则。

---

## 12. 建议拆分的实现工单（给排期）

1. `CollaborationPolicyV1` + snapshot + 兼容读旧 operating state
2. `RoundStateMachine` + `round-store`（PersistedRound + events.jsonl + CAS）
3. `MentionResolver`：unmatched SLA + `explicit_multi`
4. `PrimaryAssignmentEngine`
5. Cheap Contribution Gate
6. `runCollaborationRound` 替换 `chat.ts` 三重循环
7. Completion Contract 接口（P0 heuristic）+ 任务类型 timeout + abort
8. Ledger：dispatch / suppression / finalState
9. 1:1 退化 Round（共享 Intent/Policy）
10. **P0.10 合同测试 R1–R10**
11. P1：runner metadata completion
12. P2/P3：不排期，等数据

---

## 13. 成功标准（产品）

协作空间：

> 在正确的时间，以正确的角色，提供必要且有价值的贡献。

生产运行时：

> 规则可快照、状态可恢复、事件可幂等、调度可复现。

AI 助手：

> 与协作空间同一套意图分类、流式与工具策略；不把单聊做成迷你群演。

层次一旦固定——**State Machine 决定能不能说，Engine 决定谁值得说，Prompt 只决定说什么**——能力图谱、Growth、Learning 只挂 Ledger / Engine 边界，不再往 `chat.ts` 堆分支。
