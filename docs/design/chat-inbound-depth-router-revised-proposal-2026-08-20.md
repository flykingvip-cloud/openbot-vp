# 对话入站深度路由器修订方案

**Status:** REVISED DRAFT - 供专家组审核，未经批准不得实施或切换 LIVE
**Date:** 2026-08-20
**Scope:** 员工工作台个人 steward `chat.send` 入站、用户消息持久化、知识预取、Agent 工具能力和回写
**Non-goals:** 寒暄特例、小组 `space:` 多 bot 编排、机器人 mission、cron、其他消息渠道、主模型或 embedding 供应商更换
**Trigger sample:** 2026-08-19 23:26 CST 的 LIVE 员工会话异常。该事件是架构风险的触发样本，不是已经闭环的唯一根因证明。

---

## 0. 审核建议

建议结论为 **修改后批准 P0**，并冻结以下合同：

1. P0 使用 `chat/retrieve/act` 三级深度，不提供无模型 `ack`。
2. 深度只表达本回合成本上限；工具、live source 和写入由显式 capability policy 强制收窄。
3. P0 只覆盖个人 steward `chat.send`，不隐式扩散到 `space:`、mission、cron 或其他渠道。
4. P0 只使用确定性规则，不使用主模型或额外 LLM 分类。
5. 路由失败降级到权限收窄的 `chat`，不自动升级到 `act`。
6. 普通文本用户消息持久化与知识预取、额度门和模型执行解耦，作为独立 P0 强制修复。
7. 所有阶段使用同一 `runId` 埋点，先建立可归因证据，再判断 23:26 事件的具体悬挂点。

History 与 Model Context 的边界见 [context-compiler-contract-2026-08-20.md](./context-compiler-contract-2026-08-20.md)。Inbound depth 不承担 Context Compiler 职责。

## 1. 已核实的现状

### 1.1 当前调用链

```text
UI sendChatMessage
  -> RPC chat.send
       附件消息当前会显式提前写入用户 transcript
       普通纯文本当前不会在此处提前持久化
  -> 同步 ACK，UI 进入运行状态
  -> 异步 dispatchInboundMessage
  -> getReplyFromConfig
       授权、媒体和链接理解、命令与 inline actions
  -> runPreparedReply
       对非心跳且非空文本调用 buildKnowledgeUniversePromptContext
       拼装身份、协作、连续性和知识 system prompt
  -> runReplyAgent / runAgentTurnWithFallback
       employee model gate
       runEmbeddedPiAgent(trigger=user)
       Agent 工具循环
  -> 普通文本用户消息及 assistant 消息进入模型 transcript
  -> 流式事件、credits、知识 lineage
```

关键位置：

| 事实                         | 代码位置                                                                   |
| ---------------------------- | -------------------------------------------------------------------------- |
| 工作台发送                   | `ui/src/ui/controllers/chat.ts`                                            |
| ACK 与异步分发               | `src/gateway/server-methods/chat.ts`                                       |
| 附件用户消息提前落盘         | `src/gateway/server-methods/chat.ts` 的 `appendUserTranscriptMessage` 分支 |
| 入站预处理                   | `src/auto-reply/reply/get-reply.ts`                                        |
| 无深度门的知识上下文         | `src/auto-reply/reply/get-reply-run.ts`                                    |
| general 默认三类源           | `src/gateway/knowledge/resolve/intent-classifier.ts`                       |
| 本地及 live evidence         | `src/gateway/knowledge/resolve/resolve-engine.ts`                          |
| 主模型调用                   | `src/auto-reply/reply/agent-runner-execution.ts`                           |
| 未接入 composer 的问候启发式 | `src/gateway/server-methods/daibai.ts`                                     |

### 1.2 已确认的架构缺口

- 系统没有在知识预取前判断本回合需要多深。
- `classifyKnowledgeIntent` 未命中时返回 `general`、`confidence=0.45`，并默认建议 personal、enterprise、data 三类源。
- `resolveKnowledgeEvidenceForQuery` 在本地检索后，会对符合路由条件的已绑定 API source 调用 `invokeApiSource`，没有本回合 live-source capability 门。
- `runKnowledgeRuntimeEngine` 与 resolve 路径会对同一 client 重复加载知识 bundle。
- `runEmbeddedPiAgent` 的调用参数没有统一的入站 depth/tool capability 合同。只跳过知识 prompt 不能阻止模型随后调用工具。
- 普通纯文本的用户消息没有像附件消息一样在 ACK 附近独立持久化。任一 Agent 前置步骤永久 pending 时，UI 可以已经 ACK，而 transcript 不包含本回合用户消息。
- 知识上下文和单个 live source 缺少面向本回合的硬超时、abort 传播和阶段化观测。

## 2. 事故证据边界

2026-08-19 23:26 的观测材料记录了：

1. `chat.send` 返回 ACK，并分配 `runId=a0d3e36f-181f-4f1b-b2ec-128a9df8d5d9`。
2. 随后记录了知识 bundle 与 employee model gate 相关事件。
3. 未观察到对应模型完成或 assistant 落盘。
4. 相关会话 transcript 没有出现该回合的新消息。

这些事实与当前前置知识路径和普通文本延迟落盘机制一致，但还不能证明知识预取是唯一悬挂点。现有材料缺少同一 `runId` 的以下阶段起止信息：

- 用户消息持久化
- 深度决策
- 知识预取
- live source
- 额度门
- 模型调用
- assistant 持久化

因此，本方案修复已经由代码证实的结构问题，同时把完成事故根因闭环列为 P0 验收项。WebSocket 轮询和 `pattern-detection.subscribe` 的 ownership 错误作为独立治理项处理；没有资源竞争证据前，不将它们表述为本次卡顿原因。

## 3. 目标合同

### 3.1 深度等级

| Depth      | 含义             | 允许                                           | 禁止                                    |
| ---------- | ---------------- | ---------------------------------------------- | --------------------------------------- |
| `chat`     | 仅需自然语言回复 | 无工具主模型、轻量 steward 上下文              | 知识预取、live source、工具、工作区写入 |
| `retrieve` | 需要只读知识     | 受限本地检索、top-k evidence、只读工具、主模型 | 默认 live source、写入、发布            |
| `act`      | 需要工具或副作用 | 经授权的工具、文件操作、发布流程、完整 Agent   | 不得绕过原 ACL、额度门和发布审核        |

P0 不提供 `ack`。无模型确定性回复会改变模型生命周期、额度门、credits、lineage、流式事件和 transcript 合同。只有这些行为被统一封装并有回归测试后，P1 才可增加 `ack`。

### 3.2 Capability policy

路由器返回：

```ts
type InboundDepthDecision = {
  depth: "chat" | "retrieve" | "act";
  reasons: string[];
  routeStrength: "explicit" | "strong" | "weak" | "unknown";
  ceiling: {
    knowledgePrefetchAllowed: boolean;
    liveSourcesAllowed: boolean;
    maxToolMode: "none" | "read" | "write";
    maxSideEffectLevel: "none" | "reversible" | "irreversible_external";
  };
};
```

执行原则：

- depth 是成本等级，ceiling 是后续 PolicyDecision 不得突破的上限。
- `routeStrength` 是规则命中强度，不是概率；禁止用数值 confidence 阈值自动执行副作用。
- ceiling 只能收窄现有授权，不能授予调用方原本没有的权限。
- 知识源选择是路由决策授权、知识意图、ACL 和绑定状态的交集。
- 工具创建层和执行层都必须接收最终 PolicyDecision；不得只靠 system prompt 要求模型自律。
- 模型可以在 ceiling 内变浅，不得自行加深。

Authorization 不等于本次执行确认。完整的 data access、tool execution、risk、reversibility、confirmation、idempotency 和 audit 合同见 `docs/design/chat-execution-loop-cursor-implementation-plan-2026-08-20.md`。

建议默认映射：

| Depth      | knowledgePrefetchAllowed | liveSourcesAllowed    | maxToolMode     | maxSideEffectLevel       |
| ---------- | ------------------------ | --------------------- | --------------- | ------------------------ |
| `chat`     | false                    | false                 | `none`          | `none`                   |
| `retrieve` | true                     | false                 | `read`          | `none`                   |
| `act`      | 按意图                   | 仅显式意图且 ACL 通过 | `write` ceiling | 按显式意图，仍需确认策略 |

### 3.3 路由输入

- 规范化后的用户文本及长度
- 附件、链接和显式文件引用
- 问句、任务动词、知识检索和发布意图
- 会话内最近未完成工具或失败状态
- 最近回合的 depth 与任务状态，用于处理“继续”“然后呢”
- 会话类型；P0 仅在个人 steward `chat.send` 启用

规则要求：

- 短寒暄和普通闲聊默认 `chat`。
- 明确“查询知识库、查纪要、检索资料”进入 `retrieve`。
- 明确“打开或修改文件、写入工作区、发布”进入 `act`。
- 附件不能自动授予写权限；应结合任务动词和已有授权判断。
- 模糊的副作用请求不得猜测执行。
- 规则异常时降级到 `chat`，ceiling 为无知识、无 live source、无工具、无副作用。
- 显式发布或写入请求在路由异常时保留用户消息并返回可重试错误，不得自动升到 `act`。

## 4. 目标流程

```text
chat.send authorization and command gates
  -> persist user transcript exactly once
  -> ACK
  -> classifyInboundDepth
  -> emit depth_decided
  -> optional knowledge stage
       only when knowledgePrefetchAllowed
       bounded timeout and abort propagation
       live source only when liveSourcesAllowed and ACL passes
  -> build tool set from capability policy
  -> employee model gate
  -> runEmbeddedPiAgent
  -> persist assistant result
  -> emit terminal lifecycle event
```

用户消息应在启动异步 Agent 前完成幂等持久化。若现有响应时延要求不允许严格 ACK 前写入，最低合同是 ACK 后立即启动独立、可观测的持久化步骤，并在它成功前不进入知识或模型阶段。附件和纯文本必须复用同一幂等键，避免重复写入。

## 5. 分阶段实施

### P0.1 用户消息持久化与观测

1. 将普通文本用户消息从模型内部落盘时机前移到 `chat.send` 入站边界。
2. 附件与纯文本使用统一的 `appendUserTranscriptMessage` 合同和 `runId` 幂等键。
3. 每个回合记录：
   - `user_persist_start/end/error`
   - `depth_start/decided/error`
   - `knowledge_start/end/timeout/error`
   - `live_source_start/end/timeout/error`
   - `gate_start/end/error`
   - `model_start/first_token/end/error`
   - `assistant_persist_start/end/error`
4. 所有事件带同一 `runId`、session key 哈希、depth 和 capability 摘要，不记录敏感正文。

### P0.2 深度决策与知识门

1. 新增纯函数 `classifyInboundDepth` 及中英文表驱动测试。
2. 在 `buildKnowledgeUniversePromptContext` 之前执行。
3. `< retrieve` 时不调用知识上下文构建。
4. general 意图不再自行授予三类知识源；源面由 decision ceiling 决定。
5. `liveSourcesAllowed=false` 时，执行层不得调用 `invokeApiSource`。
6. 知识预取增加硬超时与 abort；超时降级到无知识 `chat`，但不改变已持久化用户消息。

初始可实验 800ms 的整体本地知识预算和 1500ms 的单个 live source 预算，但它们不是永久合同。最终值应根据灰度环境的 p50、p95、p99 和错误率确定。

### P0.3 工具能力执行

1. 将 `InboundDepthDecision` 向 `runReplyAgent`、`runAgentTurnWithFallback` 和工具创建边界传递。
2. `chat` 创建空工具集。
3. `retrieve` 只创建只读白名单工具。
4. `act` 只创建现有授权允许的工具，写入和发布继续执行原审核。
5. 工具执行入口再次校验 capability，防止恢复会话、错误参数或模型输出绕过创建层。

### P1 性能与一致性

1. 去重 `runKnowledgeRuntimeEngine` 中同一回合的 bundle 加载。
2. 知识 prompt 改为 top-k evidence，不默认拼装全量对象列表。
3. 基于灰度数据调整规则、超时与只读工具白名单。
4. 统一 deterministic-reply 生命周期后，再评估 `ack`。

### P2 扩展与旁路治理

1. 规则不确定时可评估小分类模型，预算不超过 200ms；失败仍降级到 `chat`。
2. 为 `space:` 设计一次 depth 决策、一次共享检索、多 bot 消费的合同。
3. 单独治理 workbench 轮询合并、连接去重和 pattern-detection ownership 噪音。

## 6. 安全与失败策略

- 路由器只限制成本和能力，不参与身份认证，也不能扩大授权。
- ACL、tenant ownership、workspace 授权、额度门和发布审核保持原顺序和语义。
- “降级到 chat”是可用性开放、权限收窄，不应简称为可能引起误解的裸 `fail-open`。
- 路由异常、知识超时和 live source 失败都必须产生 terminal 或 degraded 事件。
- 空检索不得阻塞主模型。
- 模型或知识阶段失败不得删除已经持久化的用户消息。
- 重试使用原幂等键或明确的新 runId，避免重复用户消息。

## 7. 测试门禁

P0 合入前至少满足：

1. `classifyInboundDepth` 覆盖中英文、标点、寒暄、问答、续聊、附件、链接、发布和写入意图。
2. `chat` 不调用 `buildKnowledgeUniversePromptContext`。
3. `liveSourcesAllowed=false` 时不调用 `invokeApiSource`；true 时仍执行现有 ACL 与绑定检查。
4. 普通文本在知识和模型分别 pending、timeout、throw 时，都已恰好一次写入 transcript。
5. 附件消息不会因统一落盘重构产生重复 transcript。
6. `chat` 和 `retrieve` 的伪造工具调用在执行层被拒绝。
7. `act` 不绕过 workspace ACL、发布审核或 employee model gate。
8. 同一 runId 的阶段事件可以准确定位持久化、路由、知识、额度门、模型和 assistant 落盘的失败点。
9. 现有 steward、知识宇宙、growth gate、transcript 幂等和流式生命周期测试保持通过。

## 8. 灰度与回滚

使用默认关闭的 `inboundDepthRouter` feature flag。建议顺序：

1. 先上线用户消息早落盘和阶段埋点，不改变路由行为。
2. 收集当前全路径基线并复现异常，完成 23:26 类事故的根因闭环。
3. 对内部个人 steward 会话开启规则路由，观察 depth 分布、知识跳过率、TTFT、总时长、错误率和能力拒绝率。
4. 确认知识问答召回和 `act` 成功率无显著回退后扩大比例。
5. 关闭 flag 可恢复原路由，但用户消息早落盘和安全埋点不应回滚。

LIVE 切换仍需独立生产 owner 授权，并遵守当前仓库的 main、forward-only、release provenance、UI overlay 和发布账本门禁。

## 9. 实施前置条件

当前审阅时的工作区不是可施工基线：分支包含其他任务 WIP，且新工作必须从最新 `origin/main` 建立。实施前必须：

1. `git fetch origin`。
2. 确认 `origin/main` 是当前 HEAD 的祖先；否则在人工提供的隔离工作区中从最新 main 重放。
3. 建立独立 task/spec，并通过 Loom 注册唯一 owner 与 session。
4. 在 `tasks.md` 生成可机器匹配的路径归属。
5. 每个绿色检查点使用 `scripts/committer`，提交包含 `Task:` 和 `Agent:` trailers。
6. 未经签署不得修改 LIVE 配置或切换 feature flag。

## 10. 审核问题

1. 是否批准 P0 的 `chat/retrieve/act` 三级合同，并将 `ack` 延后？
2. 是否批准 capability policy 与 depth 正交，并由知识层和工具执行层强制执行？
3. 是否批准路由失败固定降级到权限收窄的 `chat`？
4. 是否批准普通文本早落盘与同 runId 阶段埋点作为路由器之前的独立门禁？
5. 是否批准 P0 仅覆盖个人 steward `chat.send`？
6. 是否确认 P0 禁止使用任何额外 LLM 分类？

## 11. 签署

| 角色              | 姓名 | 日期 | 结论 |
| ----------------- | ---- | ---- | ---- |
| 对话和 Agent 架构 |      |      |      |
| 知识宇宙和检索    |      |      |      |
| 员工工作台 UI     |      |      |      |
| 安全和租户边界    |      |      |      |
| 生产 owner        |      |      |      |

**执行约束：** 本文不是施工授权。生产 owner 签署前，不得改变 `get-reply-run.ts` 行为、不得开启 LIVE flag、不得用寒暄特例替代路由器，也不得把 P0 规则扩展到未列入 scope 的会话类型。
