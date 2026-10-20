# OpenBot 对话与任务执行循环 Cursor 实施方案

**Status:** IMPLEMENTATION HANDOFF - P0 收敛版，待生产 owner 批准
**Date:** 2026-08-20
**Depends on:** `docs/design/chat-inbound-depth-router-revised-proposal-2026-08-20.md`
**Primary scope:** 个人 steward `chat.send`
**Primary objective:** 先完成早落盘、可归因 shadow 分类，以及 `chat` 零知识零工具止血；不在本期引入新的 Task/Policy/Evidence 执行操作系统。

---

## 1. 必须保持的产品合同

### 1.1 性能合同

- `chat` 路径仍然只调用一次主模型。
- P0 不增加意图 LLM、规划 LLM 或评估 LLM。
- 深度分类必须是同步纯函数，目标耗时 `<5ms`，p99 `<10ms`。
- `chat` 不等待知识 bundle、embedding、live source、Task Graph 或健康探测。
- 基础设施健康状态必须读取缓存快照，禁止每回合同步探测依赖。
- `retrieve` 的本地知识阶段必须有硬预算；超时后继续主对话，不无限等待。
- 不为实现新模块而增加固定串行网络跳转。

### 1.2 质量合同

- Depth Router 只决定能力 ceiling，不替代主模型的语义理解。
- 不确定但无副作用的请求保持 `chat`，交给主模型自然回答。
- 明确知识请求不得因规则漏判永久失去检索能力；需要有暗测、纠错和显式重试入口。
- 明确写入、发布和外部副作用不得在不确定时自动执行。
- 复杂 `act` 的主模型始终可见用户最终目标、当前步骤、约束和已验证结果。
- 工具成功不等于任务成功；必须分别记录 step outcome 与 task outcome。

### 1.3 安全合同

- 新策略只能收窄现有能力，不能扩大 ACL、tenant、workspace、额度或发布权限。
- 工具集合创建时过滤一次，工具执行入口再次校验一次。
- 路由、知识或模型失败不能删除已经落盘的用户消息。
- `space:`、mission、cron 和其他渠道在本方案 P0/P1 不改变行为。
- Retrieved content、附件内容和 tool output 一律视为不可信数据，不能被解释为提权指令；本期只保持现有工具和 ACL 边界，不新增执行策略框架。

### 1.4 本期范围裁决

- 本期只做 A 早落盘与阶段事件、B shadow 分类、C `chat` 跳过知识且空工具、D 源面求交/live 门/超时、E `retrieve` 只读白名单。
- 不新增 `src/agents/execution/` 下的 ConversationTask、TaskStep、Execution、Evidence 或 PolicyDecision runtime。
- 不把现有 `runId`、`chat.abort`、`employee-model-gate`、`tool-policy`、workspace ACL、发布意图解析和 `KnowledgeEvidence` 重新包装成第二套合同。
- 多步 Task Graph、结果验收 OS、复杂取消/重试状态机、统一 Capability Registry 延后到独立设计和批准。

## 2. 最终执行模型

```text
chat.send authentication / tenant / workspace gates
  -> persist user message exactly once
  -> ACK
  -> classify depth with local rules
  -> choose lane
       chat     -> one model call, no knowledge, no tools
       retrieve -> bounded local evidence, one model call, read-only tools
       act      -> existing Agent loop, authorized tools
  -> existing Agent / gate / lifecycle
```

## 3. 核心类型合同

建议新增 `src/auto-reply/reply/inbound-depth.ts`：

```ts
export type InboundDepth = "chat" | "retrieve" | "act";

export type InboundCapabilityCeiling = {
  knowledgePrefetchAllowed: boolean;
  liveSourcesAllowed: boolean;
  maxToolMode: "none" | "read" | "write";
  maxSideEffectLevel: "none" | "reversible" | "irreversible_external";
};

export type InboundDepthDecision = {
  depth: InboundDepth;
  reasons: string[];
  routeStrength: "explicit" | "strong" | "weak" | "unknown";
  ceiling: InboundCapabilityCeiling;
  classifierVersion: string;
};

export type InboundDepthInput = {
  text: string;
  hasAttachments: boolean;
  hasLinks: boolean;
  sessionKind: "employee" | "space" | "mission" | "other";
  previousDepth?: InboundDepth;
  hasUnfinishedToolRun: boolean;
  hasExplicitKnowledgeIntent: boolean;
  hasExplicitWriteIntent: boolean;
  hasExplicitPublishIntent: boolean;
};
```

约束：

- `classifyInboundDepth(input)` 必须无 I/O、无配置读取、无模型调用。
- `reasons` 使用稳定枚举字符串，不能写入用户正文。
- `routeStrength` 是规则命中强度，不是概率或分类准确率；禁止用数值阈值自动执行副作用。
- `classifierVersion` 用于灰度对比和回滚，不使用文件 mtime。
- `ceiling` 由 depth 与显式意图确定；最终 `PolicyDecision` 必须与原授权、资源、风险、系统状态及确认策略求交集。

### 3.1 ACK 与现有运行合同

冻结状态顺序：`RECEIVED -> PERSISTED -> ACCEPTED -> ROUTED -> RUNNING`。

`chat.send` ACK 表示用户消息已 durable persisted，且现有 run 已 accepted；不表示 Agent 已开始、工具已执行或任务已完成。复用现有 `clientRunId`、transcript 幂等、`chat.abort` 和 lifecycle，不新建 task identity。

在 `src/auto-reply/types.ts` 的 `GetReplyOptions` 增加可选字段：

```ts
inboundDepthDecision?: InboundDepthDecision;
```

保持 optional，未提供时完全维持旧行为，避免影响其他渠道。

## 4. PR 切分与执行顺序

每个 PR 都必须从最新 `origin/main` 创建，目标为 `main`。Cursor 不得在当前包含其他 WIP 的工作区直接施工。

### PR A：用户消息早落盘与阶段观测

**目标：** 修复 ACK 后普通文本可能未落盘的问题，并建立后续决策所需的基线证据；不改变路由、知识或工具行为。

建议修改：

- `src/gateway/server-methods/chat.ts`
- 新增小型阶段事件 helper，位置优先沿用现有 gateway/agent event 体系
- 对应 `chat.*.test.ts`

实施要求：

1. 将附件分支中的用户 transcript 构造与 append 提取为可复用 helper。
2. 纯文本与附件都在启动 `dispatchInboundMessage` 前执行一次幂等 append。
3. 幂等键继续使用 `clientRunId`。
4. 附件和纯文本共用 content block 构造，禁止双写。
5. append 失败保持现有 fail-closed governance，不启动 Agent。
6. ACK 只允许在用户消息 durable persisted 且现有 chat run accepted 后返回。若 p99 不达标，应优化本地持久化路径，不得弱化 ACK 语义。
7. 记录同一 `clientRunId` 的阶段事件：user persist、dispatch、gate、model start/end、assistant persist；复用现有 lifecycle 事件，不新增 Audit runtime。

验收：

- 纯文本在 Agent 永久 pending 时已恰好一次落盘。
- 附件消息没有重复落盘。
- 相同 idempotency key 重试不会新增第二条用户消息。
- `chat.send` ACK p95 相对基线增加不超过 15ms；若本机文件系统噪音导致不可判定，报告绝对值和样本数，不伪造结论。
- 不改变知识和工具调用次数。
- ACK payload 保持兼容，继续返回现有 `runId`。

回滚：仅回滚早落盘调用；阶段观测保留。

### PR B：深度分类器暗测

**目标：** 引入纯函数和指标，但不改变生产行为。

建议新增或修改：

- `src/auto-reply/reply/inbound-depth.ts`
- `src/auto-reply/reply/inbound-depth.test.ts`
- `src/auto-reply/types.ts`
- `src/auto-reply/reply/get-reply-run.ts`

实施要求：

1. 实现 `classifyInboundDepth`。
2. 仅对个人 employee steward 计算 decision。
3. 先以 shadow mode 记录 `wouldDepth`、`routeStrength` 和 reasons，不影响知识、工具或模型。
4. 表驱动覆盖：中英文寒暄、解释、改写、知识查询、文件操作、发布、附件、链接、续聊和模糊请求。
5. 规则优先使用已有解析器，如发布意图解析；不要复制相互漂移的正则。
6. 对“继续”“然后呢”只有在存在明确未完成工具状态时继承上一 depth。

建议首版保守规则：

- 明确知识检索词 -> `retrieve`
- 明确文件写入、执行、发布、副作用动词 -> `act`
- 其他 -> `chat`
- 有附件但无任务动词 -> `chat`，由模型理解附件，不自动授予写入
- 分类异常 -> `chat` + 全收窄 ceiling

验收：

- 分类函数 p99 `<10ms`。
- 无新模型和网络调用。
- shadow mode 对当前行为零影响。
- 采样日志不包含原始用户正文。
- 代码中不存在把 `routeStrength` 当概率比较的逻辑。

回滚：停止计算 shadow decision，不涉及功能回滚。

### PR C：`chat` 零知识零工具门

**目标：** 首次产生行为变化；`chat` 跳过无条件知识税。

建议修改：

- `src/auto-reply/reply/get-reply-run.ts`
- `src/auto-reply/reply/knowledge-universe-context.ts`
- 相邻测试

实施要求：

1. 新增默认关闭的 runtime flag，避免新增用户可见配置项污染稳定 schema；优先使用现有部署级 feature flag 机制。
2. flag 关闭时保持现状。
3. flag 开启且 `depth=chat` 时，同时满足：不调用 `buildKnowledgeUniversePromptContext`、不加载 embedding/evidence、工具集合为空。
4. 对 `chat` 收窄后续运营身份、workspace scope、data capability listing 等串行拼装：保留必要 ACL/身份安全字段，改为轻量或缓存快照；不得为普通 chat 触发 live source 或完整 capability listing。
5. `knowledge-source-tool` 及其他工具不得在 chat Agent 循环中出现；不能只依赖 prompt 文案。
6. `retrieve/act` 在本 PR 保持旧行为，降低 blast radius。
7. 记录 `knowledgeSkippedReason=depth_chat`、`toolSkippedReason=depth_chat` 和 identity snapshot 命中/未命中。

验收：

- `chat` 不出现 bundle 加载和 embedding 检索。
- `chat` 的工具集合严格为空，包括 `knowledge-source-tool`。
- `chat` 不串行执行完整运营身份、workspace scope 和 data capability listing；若使用缓存快照，必须记录命中率和过期策略。
- `retrieve/act` 与基线一致。
- `chat` 模型调用仍为一次。
- 内部灰度中 `chat` TTFT p95 不高于基线，目标应明显下降。
- 盲测集的闲聊、解释和改写质量不得下降；使用固定输入集和人工双盲评分，不让路由器参与评分。

回滚：关闭 flag，恢复原知识行为。

### PR D：知识源面求交、live 门与超时

**目标：** `retrieve` 只使用受控知识，live source 不再默认执行。

建议修改：

- `src/gateway/knowledge/resolve/intent-classifier.ts`
- `src/gateway/knowledge/resolve/resolve-engine.ts`
- `src/auto-reply/reply/knowledge-universe-context.ts`
- 对应 resolve/evidence 测试

实施要求：

1. 将 capability policy 显式传入知识执行边界。
2. `general` 不再自行授予三类源；最终源集合为意图建议、decision policy、ACL 和 requested hints 的交集。
3. `liveSourcesAllowed=false` 时执行层不得调用 `invokeApiSource`。
4. requested hints 不能突破 decision policy 或 ACL。
5. 为整体知识阶段和单个 live source 添加 abort-aware timeout。
6. 超时返回 degraded 结果，不阻塞主模型。
7. 复用首次加载的 bundle，消除同一 runtime 的第二次 `loadKnowledgeSourceBundle`。
8. prompt 只注入 top-k evidence；首 PR 不改变排序算法。
9. 继续复用现有 `KnowledgeEvidence`，不新增 `RuntimeEvidence` 数据模型；确保现有 tenant/access policy 字段和引用信息不丢失。
10. Evidence 正文作为 untrusted content 传给模型，使用现有 prompt 边界明确声明其不能成为系统指令或能力升级依据。

超时初始值：

- 本地知识整体预算 800ms，仅作为灰度初始值。
- 单个 live source 1500ms，仅在 `act` 且显式 live 意图时适用。
- 最终值根据 p95/p99 调整，不写死为产品永久合同。

验收：

- `retrieve` 默认不调用 live source。
- 明确且获授权的 live 请求仍成功。
- 空结果和超时都能继续产生回答。
- bundle 每回合只加载一次。
- 知识问答基准集的命中率、引用正确率不低于基线允许阈值。
- 过期、越租户或 policy 不匹配的现有 Evidence 不进入 prompt。
- 包含 prompt injection 文本的 Evidence 不能触发 capability 升级或越权工具调用。

回滚：独立 flag 恢复旧源选择；timeout 保护建议保留。

### PR E：`retrieve` 只读工具白名单

**目标：** 将 depth ceiling 落实到实际工具集合和执行入口。

建议修改：

- `src/auto-reply/types.ts`
- `src/auto-reply/reply/agent-runner-execution.ts`
- `src/agents/pi-embedded-runner/run/attempt.ts`
- `src/agents/pi-tools.ts`
- `src/agents/tool-policy.ts`
- 对应 tool-policy 和 runner 测试

实施要求：

1. 沿现有 `GetReplyOptions -> runReplyAgent -> runAgentTurnWithFallback -> runEmbeddedPiAgent` 传递 shadow/decision。
2. 不建立第二套工具策略框架；扩展现有 `tool-policy` allow/deny。
3. `retrieve` 使用显式只读 allowlist；名单必须从现有工具 catalog 审核生成，不能按名字猜测读写属性。
4. `act` 继续使用现有工具集合和授权策略；本期不引入新的 side-effect confirmation/idempotency OS。
5. 工具执行层复用现有 owner-only、sandbox、channel、plugin 和 ACL guard；未知副作用工具默认不进入 `retrieve`。
6. 不允许恢复会话中的旧工具集合突破新回合 ceiling。

验收：

- `retrieve` 看不到写入、exec、发布和外部副作用工具。
- owner-only、sandbox、channel policy 和 plugin policy 原测试保持通过。
- 工具 schema token 数在 `chat/retrieve` 明显下降。
- 伪造工具调用不能突破现有 tool-policy 和 ACL。

回滚：关闭工具策略 flag；现有 owner/ACL 策略不回滚。

## 5. 明确延后：Task/Policy/Evidence Runtime

以下内容不属于本期交付，也不得作为 Cursor 的隐式重构目标：

- 新建 `src/agents/execution/` Task/Step/Execution 状态机
- 新建 PolicyDecision、RuntimeEvidence、Capability Registry
- 动态 Task Graph、独立 planner/evaluator、复杂 re-plan
- side-effect confirmation、跨 API 幂等 OS、完整 cancellation audit
- Multi-Agent、Mission、Workflow 和长任务持久化

这些方向可在 A-E 灰度证明收益后另行立项，必须先完成现有 run/tool/transcript 合同盘点。

## 6. Feature flag 建议

使用相互独立、默认关闭的部署级 flags：

```text
chatInboundPersistEarly
chatInboundDepthShadow
chatInboundDepthRouter
chatInboundKnowledgePolicy
chatInboundToolPolicy
```

要求：

- 早落盘稳定后应成为默认行为，不长期依赖 flag。
- 每个 flag 可以独立关闭，禁止一个总开关同时切换所有行为。
- flags 不应作为新用户配置公开，避免形成永久兼容负担。
- 每条指标记录实际启用的 flag 集和 classifier version。

## 7. 性能与质量基准

Cursor 在 A 阶段提交只读基线脚本或测试夹具，固定以下输入集：

| Lane       | 示例类别                   | 主要指标                                        |
| ---------- | -------------------------- | ----------------------------------------------- |
| `chat`     | 寒暄、解释、改写、追问     | ACK、TTFT、总时长、回答盲评分                   |
| `retrieve` | 纪要、企业知识、个人知识   | TTFT、召回率、引用正确率、live 调用数           |
| `act`      | 文件读取、写入、发布       | 成功率、权限正确率、工具调用数、总时长          |
| failure    | 空检索、知识超时、工具失败 | 是否完成降级、是否重复调用、是否保留 transcript |

最低门禁：

- `chat` 额外模型调用数必须为 0。
- `chat` TTFT p95 不得高于基线 5%；目标为下降。
- `chat` 人工盲评分不得出现统计显著下降。
- `retrieve` 引用正确率不得下降；召回率下降超过 2 个百分点则停止灰度。
- `act` 成功率不得下降；未授权副作用必须为 0。
- transcript 丢失和重复消息必须为 0。

样本不足时不得宣称“无回归”；应报告样本量和置信不足。

## 8. 观测事件

所有事件共享 `clientRunId`/`runId`；本期不引入 task/step identity：

```text
chat.user_persisted
chat.depth_decided
chat.knowledge_started
chat.knowledge_finished
chat.knowledge_degraded
chat.gate_started
chat.gate_finished
chat.model_started
chat.first_token
chat.model_finished
chat.assistant_persisted
chat.tool_policy_applied
chat.tool_rejected
```

日志禁止写入用户原文、附件内容、凭证或 live 配置。session key 使用现有安全标识或哈希。

## 9. Cursor 执行规则

1. 开始前 `git fetch origin`，确认最新 `origin/main` 是 HEAD 祖先。
2. 使用人工提供的独立 worktree；不得切换或创建 worktree。
3. 建立对应 spec/tasks，通过 `pnpm loom register` 注册唯一 owner/session，并运行 `pnpm loom derive`。
4. 每个 PR 只覆盖 A-E 一个阶段，不夹带重构。
5. 每个绿色检查点运行相关测试、`pnpm check`，涉及动态加载时运行 `pnpm build` 并检查 ineffective dynamic import warning。
6. 使用 `scripts/committer`，提交带 `Task:` 和 `Agent:` trailers。
7. bug-fix 声明必须提供复现、根因、受影响代码路径和 fail-before/pass-after 测试。
8. 不修改 `docs/zh-CN/**`。
9. 不切 LIVE；LIVE 灰度由生产 owner 按发布门禁单独授权。

## 10. 明确禁止

- 不给寒暄写单独的 composer 快路径。
- 不让每轮对话先调用分类模型。
- 不让本期每轮对话生成 Task Graph。
- 不让每次工具返回都调用反思模型。
- 不以 prompt 文案代替工具执行层限制。
- 不将附件等同于写入授权。
- 不一次性修改所有消息渠道。
- 不因知识超时丢弃用户消息或让 UI 无限转圈。
- 不在缺少基线数据时声称速度或质量提升。

## 11. 完成定义

本计划只有在以下条件全部满足时才算完成：

1. 个人 steward 普通文本在 Agent 前恰好一次落盘。
2. ACK 明确表示 message persisted，不表示 task started。
3. `chat` 同时不执行知识预取、身份重型串行拼装和任何工具调用，模型调用仍为一次。
4. `retrieve` 默认不出网，超时可降级；源面求交通过现有 KnowledgeEvidence/ACL 合同。
5. 现有 `tool-policy` 和 ACL 不被绕过，`chat` 工具数为 0，`retrieve` 只读白名单。
6. 同一 `clientRunId` 阶段事件可以定位 23:26 类回合卡在落盘、身份、知识、额度门或模型。
7. `chat` TTFT 与盲测质量通过门禁。
8. 知识召回、引用正确率和 `act` 成功率通过门禁。
9. 所有行为可按阶段独立回滚。
10. LIVE 发布满足 main、forward-only、provenance、ledger 和 UI overlay 约束。

**实施优先级：** A 早落盘+阶段事件 -> B shadow 分类 -> C chat 零知识零工具 -> D 源面求交/live 门/超时 -> E retrieve 只读白名单。
