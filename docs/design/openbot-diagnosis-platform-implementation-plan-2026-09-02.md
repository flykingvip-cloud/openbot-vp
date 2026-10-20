# OpenBot Diagnosis Platform 改造升级实施方案

Date: 2026-09-02

Status: **Architecture direction approved for Phase 0 / protocol design; implementation remains gated on protocol freeze and authority-of-record inventory**

Audience: Platform Architecture、Gateway、Agent Runtime、Skill Governance、Enterprise、Security、SRE、Data Governance、QA、Product

Task: `openbot-diagnosis-platform`

Related:

- [OpenBot 四端信息架构与重组实施计划](/design/openbot-four-port-ia-and-reorg-plan-2026-04-12)
- [Agent Growth 云端多租户架构专家评审与实施路线](/design/agent-growth-cloud-multitenant-architecture-review-2026-07-30)
- [Doctor CLI](/cli/doctor)

---

## 0. 执行摘要

另一个团队提出的核心判断成立：OpenBot 不应继续建设彼此独立的 Doctor、Health、Skill 检查和分析 Skill，而应把诊断定义为平台级基础能力，并由统一 Diagnosis Protocol、Control Plane 和 Evidence Plane 管理。

本方案批准进入 Phase 0 架构契约设计，但功能实现仍受协议冻结和权威事实源盘点门禁约束：

1. 批准统一协议、诊断对象分离、专业诊断器注册、证据驱动调度、Case、修复审批和验证闭环。
2. 批准把 `doctor` 定位为安装态与配置态专业诊断器，而不是总控。
3. 批准 Diagnosis Graph，但一期只支持有证据的确定性关系，不批准直接用模型生成任意因果图。
4. 批准 Hypothesis 模型，但一期先实现显式候选、支持证据和反证，不建设复杂概率推断引擎。
5. 批准 Baseline 能力，但优先复用 Skill Invocation 和 Evolution Governance 已有统计，不建立第二套 Skill 健康事实源。
6. 不批准一次性建设独立微服务、全量事件湖、通用图数据库或自动修复代理。
7. 不重新建立独立 Ops 端。诊断能力按现有端职责投影到 Employee、Enterprise、Platform；旧 `/ops/*` 路由只保留兼容，不成为新架构边界。

架构不变量：

> Diagnosis Platform 的目标不是重新拥有一份 OpenBot 的运行事实，而是把现有运行事实转换成统一、可关联、可审计的诊断证据，并围绕 Evidence 产生 Finding、Case、Root Cause 和 Remediation。
>
> 任何新的诊断能力都必须复用既有权威事实源，并通过 Diagnosis Protocol 暴露；禁止通过新建平行事实源解决诊断问题。
>
> 诊断结论可以推断，Evidence 不可以伪造；Recommendation 可以生成，Remediation 必须受治理。

推荐产品定位：

> **OpenBot Diagnosis Platform：面向 Agent、Skill、Tool、渠道、基础设施、会话、数据和业务流程的统一可观测诊断与事件治理平台。**

推荐实施顺序：

```text
协议与边界冻结
→ 现有事实源适配
→ 单会话 Trace MVP
→ Finding 与 Case
→ Evidence 驱动调度
→ Incident 与修复验证
→ 受控语义诊断和基线异常
```

## 1. 评审结论

### 1.1 可直接采纳

| 建议                                      | 结论 | 原因                                                        |
| ----------------------------------------- | ---- | ----------------------------------------------------------- |
| Diagnosis Protocol                        | 采纳 | 当前不同模块的事件、健康和 Finding 结构不统一，需要平台契约 |
| Target、Run、Evidence、Finding、Case 分离 | 采纳 | 可防止模型结论被误作事实，并支持回放与审计                  |
| Diagnoser 能力声明                        | 采纳 | 是按成本、权限和目标调度的必要条件                          |
| Health、Diagnosis、Incident 分层          | 采纳 | 与当前 health、doctor、governance 的职责差异一致            |
| Evidence 驱动调度                         | 采纳 | 可减少无关 Probe、Tool 和模型调用                           |
| 修复审批与验证闭环                        | 采纳 | 与现有 Doctor、Evolution Governance 的人审边界一致          |
| Diagnosis Quality                         | 采纳 | 诊断准确率和证据覆盖率必须可衡量                            |

### 1.2 需要降级后实施

| 建议                | 修订后的实施方式                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Diagnosis Graph     | 一期只允许 `derived_from`、`correlated_with`、`depends_on`、`causes`、`contributes_to`；其中 `causes` 必须满足规则或人工确认 |
| Hypothesis 概率更新 | 一期使用可解释评分和状态机，不宣称贝叶斯概率；以后有标注数据再校准                                                           |
| 动态 Baseline       | 先支持固定阈值、滚动窗口和同对象历史分位数，季节性与多租户同群基线延后                                                       |
| 全面诊断器插件化    | 先在 Gateway 内建立 TypeScript Registry；接口稳定后再开放第三方诊断器                                                        |
| Evidence Plane      | 先做引用式证据和短期耐久 Journal，不复制全部 transcript、Tool 结果和 OTEL 数据                                               |

### 1.3 当前不批准

- 新建独立 Diagnosis 微服务作为一期前置。
- 建设与 `src/infra/diagnostic-events.ts` 平行的第二套在线事件总线。
- 建设与 `src/gateway/skill-invocation/` 平行的 Skill 成功率事实源。
- 让诊断 Skill 自动执行 `openbot doctor --fix`、修改配置、重启服务或重放业务写操作。
- 仅凭时间先后关系生成 `causes` 边。
- 把用户重试、Agent 报错和 Tool 超时分别创建成三个无关联根因。
- 将完整 Prompt、回复、凭据、Tool 参数或 Tool 结果默认写入长期诊断存储。
- 借诊断平台恢复已在下线的独立 Ops 信息架构。

### 1.4 架构不变量

1. **运行事实不归 Diagnosis Platform 所有。** Diagnosis Platform 只拥有 Diagnostic Run、Observation、Assessment、Attribution、Hypothesis、Finding、Relation、Case、Report、Recommendation 和 Verification 状态。
2. **一个事实只有一个 Authority of Record。** Diagnosis Repository 可以保存索引、快照摘要、内容哈希和引用，不得成为 Message、Session、Skill Invocation、Runtime Health 或 OTEL 的第二权威库。
3. **Target 先于 Run 和 Case。** Target 描述“诊断什么”；Run 描述“如何诊断”；Case 描述“为什么把一组 Target、Run 和 Finding 放在一起处理”。
4. **Observation 与诊断判断分离。** 事实观察、异常评估、责任归因和根因假设必须分别记录。
5. **证据可信度与结论可信度分离。** 不能用一个 `confidence` 同时表示证据真实性、异常判断、根因和影响范围。
6. **因果关系受治理。** 模型只能提出候选关系；未经规则、干预证据或人工确认，不能成为正式 RCA。
7. **Planner 选择最小证据集。** 调度单位不仅是 Diagnoser，还包括 Evidence Source、查询范围、成本和敏感级别。
8. **允许没有结论。** `INCONCLUSIVE`、`BLOCKED` 和 `TIMED_OUT` 是专业且正常的完成状态。
9. **诊断与修复分权。** Recommendation 属于诊断域；Remediation 执行属于受治理的既有能力域。
10. **一期只证明一个垂直闭环。** 首个交付只覆盖 `Session → Agent → Skill → Tool`，其余分支通过协议预留而不同时实现。

## 2. OpenBot 当前诊断能力基线

### 2.1 已有能力

| 领域               | 当前实现                                             | 可复用内容                                                 | 当前缺口                                            |
| ------------------ | ---------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| Doctor             | `src/commands/doctor.ts`                             | 配置、安装、状态目录、服务、环境、迁移、凭据引用检查和修复 | CLI 输出非统一 Finding；检查与修复交织              |
| Plugin Hooks       | `src/plugins/types.ts`                               | message、LLM、agent、tool、session、gateway 生命周期       | 缺少统一 Evidence envelope 和耐久投递               |
| Diagnostic events  | `src/infra/diagnostic-events.ts`                     | usage、webhook、queue、session、run、tool loop、heartbeat  | 进程内监听；重启后不保留；schema 仅覆盖运行诊断子集 |
| OTEL               | `extensions/diagnostics-otel/src/service.ts`         | Trace、Metric、Log 导出和脱敏                              | 是可观测性出口，不是业务 Case/Finding Store         |
| Session transcript | `src/sessions/transcript-events.ts` 与 Session JSONL | 消息和 Tool 调用回放来源                                   | 原始记录不是统一诊断事件；需权限和脱敏              |
| Skill Invocation   | `src/gateway/skill-invocation/`                      | invocation、run、session、Agent、Tool 归因、结果、耗时     | 缺少跨组件因果关联和 Case                           |
| Skill Health       | `src/gateway/skill-lifecycle-store.ts`               | 成功率、平均耗时、失败原因窗口                             | 统计粒度有限；没有 P95/P99 和统一 baseline contract |
| Skill Governance   | `src/gateway/evolution-governance/`                  | 异常、动作、baseline、效果验证                             | 是治理消费者，不应成为诊断事实总库                  |
| Agent Health       | `src/gateway/agent-runtime-health.ts`                | 模型配置与渠道连接的真实健康判定                           | 只回答运行健康，不解释单次任务失败                  |
| Channel Health     | `src/gateway/channel-health-monitor.ts`              | 连接、卡死、断线判定和受限重启                             | 缺少与用户会话、路由和投递事件关联                  |
| Routing            | `src/routing/resolve-route.ts`                       | Agent、账号和 Session 路由结果                             | 需要结构化路由决策 Evidence                         |
| Security           | Security audit 与 Doctor security checks             | 安全 Finding 和确定性修复                                  | Finding schema 与 Diagnosis Protocol 尚未统一       |
| UI IA              | `ui/src/ui/navigation.ts`                            | `/ops/incidents`、`/ops/diagnostics` 兼容路径              | 当前映射到 Platform 页面，无统一 Incident 后端对象  |

### 2.2 关键现状判断

1. OpenBot 已有多个高价值事实源，不应重写采集链路。
2. 当前 `DiagnosticEventPayload` 是运行态进程内事件协议，不能直接等同于平台级 Evidence Protocol。
3. 当前 Skill Invocation 事件已有本地耐久记录，应作为 Skill 运行事实权威来源。
4. Evolution Governance 已有 `baseline → action → verification` 雏形，应作为 Remediation Consumer 接入，而不是复制。
5. 当前主要部署和存储模式仍包含单 Gateway、本地 JSON、进程锁和进程内广播；一期必须在此条件下可运行。
6. 云端多实例需要共享身份、租户上下文、ACL、事件 Journal、事务 outbox 和共享存储先完成，不能由诊断项目私自建立第二套多租户身份事实。

### 2.3 Authority of Record

| 数据                             | 权威事实源                                                    | Diagnosis Platform 职责                | 一期接入状态                             |
| -------------------------------- | ------------------------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| Message / Session                | Session store、Message runtime、Session JSONL                 | 引用、索引、脱敏、Trace 关联           | 可接入；需稳定 record locator            |
| Agent route                      | `src/routing/resolve-route.ts`                                | 将 route result 转换为 Evidence        | 缺少耐久 route-resolution event，需补    |
| Agent run / LLM                  | Agent runner 与 Plugin Hooks                                  | 关联 run、结果、错误和耗时             | 可接入；Hook 本身非耐久事实库            |
| Tool invocation                  | before/after Tool Hooks、Session Tool records                 | 关联参数摘要、结果、错误和耗时         | 可接入；必须使用参数 allowlist           |
| Skill Invocation                 | `src/gateway/skill-invocation/`                               | 聚合、关联、评估归因质量               | 已有 JSONL；部分归因和写入是 best-effort |
| Skill Health                     | Skill Invocation 聚合、`src/gateway/skill-lifecycle-store.ts` | 引用窗口，不重复累计                   | 已有成功率和平均耗时；分位数待补         |
| Runtime Health                   | Gateway、Agent runtime、Channel monitor                       | 判断异常并关联具体 Run                 | 可接入；Health 不直接升级为 Root Cause   |
| OTEL Trace                       | OTEL backend                                                  | 保存 trace/span 引用，不复制完整 Trace | 可接入；需稳定 backend locator           |
| Installation / Config            | Config Store、Doctor read-only checks                         | 转换为统一 Evidence                    | Doctor 检查与修复需先拆分                |
| Security Finding                 | Security audit                                                | 适配 Finding 和 Case                   | 不复制扫描规则与修复器                   |
| Business Event                   | Enterprise domain event                                       | 形成 Workflow Evidence                 | 一期不实现，当前事件契约不完整           |
| Governance action / verification | Evolution Governance                                          | 引用 action receipt 和效果窗口         | 已有本地持久化雏形                       |

Authority 规则：

- Authority of Record 决定事实值，Diagnosis Platform 只决定该事实如何支持诊断结论。
- 原始事实被删除或超过保留期后，Evidence 必须显示 `source_expired`，不能用缓存摘要冒充仍可验证的原始事实。
- Authority 数据发生纠正时，相关 Assessment、Hypothesis、Finding 和 Report 必须可重新计算或标记过期。
- Diagnosis Store 禁止提供“更新原始运行事实”的写接口。

### 2.4 源码可行性评审

| 能力边界                | 源码结论                                                                                      | 实施含义                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Skill Invocation 耐久性 | `event-store.ts` 使用 append-only JSONL，并含 `runId`、`sessionKey`、`toolCallId`             | 可作为一期 Skill 事实源，不另建 Skill event DB                                  |
| Skill 归因真实性        | Tool 显式身份优先；unique-owner 和 prompt named-use 属不同可靠度；多处 best-effort catch      | Evidence 必须携带 `attributionResolution` 和归因可信度，不能一律视为已确认      |
| Route Evidence          | `resolveAgentRoute` 返回 `matchedBy`、Agent、account、session，但主要用于即时返回和 debug log | 一期必须新增结构化 route decision event 或耐久引用，否则无法证明“未路由/错路由” |
| Diagnostic event 耐久性 | `src/infra/diagnostic-events.ts` 使用进程内 listener 与 sequence                              | 只能作为采集入口；必须通过 Journal adapter 才能成为可回放 Evidence              |
| Session 关联            | Session store 和 JSONL 已存在，Inbound metadata 使用 best-effort 持久化                       | Trace 必须标记 metadata 缺失，不能假定每次 inbound 都完整落盘                   |
| Tool 关联               | Tool Hook 已包含 `runId`、`toolCallId`、参数、结果、错误和耗时                                | 足以支撑一期 Tool Evidence，但结果内容必须摘要化和脱敏                          |
| Agent Health            | 当前是配置和渠道连通性的纯判定                                                                | 可作为 L1 Health，不足以单独证明一次 Agent run 的根因                           |
| Verification            | Evolution Governance 已保存 baseline 和效果窗口                                               | 可复用其执行回执；Diagnosis Verification 需保持独立协议并引用该事实             |
| Tenant context          | Platform session context 已包含 membership、enterprise、tenant 和 scope                       | Target tenant 必须从可信上下文解析；诊断请求中的 tenant 只是意图                |

结论：当前实现足以支持一期垂直切片，但必须先补 route Evidence、归因质量、Journal 和稳定 Evidence locator。Doctor、Channel、Security、Data、Workflow 暂不进入一期执行范围。

## 3. 目标架构

```text
                         OpenBot Diagnosis Platform
                                      │
                 ┌────────────────────┴────────────────────┐
                 │                                         │
      Diagnosis Control Plane                       Evidence Plane
 Registry / Scheduler / Policy / Case        Adapters / Journal / References
                 │                                         │
                 └────────────────────┬────────────────────┘
                                      │
                         Professional Diagnosers
       ┌────────┬────────┬────────┬────────┬────────┬────────────┐
       │        │        │        │        │        │            │
     Doctor  Runtime  Channel   Agent    Skill    Tool   Trace/Workflow/Data
       └────────┴────────┴────────┴────────┴────────┴────────────┘
                                      │
                         Finding and Diagnosis Graph
                                      │
                           Case / Incident / Report
                                      │
                       Remediation Governance / Verify
                                      │
                          Continuous Improvement
```

### 3.1 三个层级

| 层级                      | 回答的问题                   | 典型产物                                  |
| ------------------------- | ---------------------------- | ----------------------------------------- |
| L1 Health                 | 现在是否正常                 | health snapshot、状态、指标、告警         |
| L2 Diagnosis              | 为什么异常                   | Evidence、Hypothesis、Finding、Graph      |
| L3 Incident / Improvement | 影响什么、如何修复、是否改善 | Case、Incident、Remediation、Verification |

Health 不自动等于 Finding，Finding 不自动升级为 Incident。

### 3.2 主干与分支职责

Control Plane 只负责：

- 解析可信诊断范围。
- 注册和选择 Diagnoser。
- 管理 Run、Hypothesis、Finding、Case 和 Report。
- 汇聚 Evidence reference。
- 执行关联、去重、优先级和权限策略。
- 将经批准的修复交给现有执行能力。

专业诊断器负责：

- 针对声明的 Target 收集或引用 Evidence。
- 执行确定性检查或受控语义判断。
- 更新 Hypothesis。
- 提交 Finding，不直接生成最终报告。

## 4. Diagnosis Protocol v1

协议优先以 TypeScript domain contract 落地，稳定后再冻结 RPC/JSON schema。所有对象必须带 `schemaVersion`、可信租户作用域和来源信息。

### 4.1 DiagnosticTarget

```ts
type DiagnosticTarget = {
  schemaVersion: 1;
  targetType:
    | "gateway"
    | "channel"
    | "agent"
    | "skill"
    | "tool"
    | "session"
    | "run"
    | "workflow"
    | "data_source"
    | "host";
  targetId: string;
  tenantId: string | null;
  authority: string;
  version?: string;
  capability?: string;
  scope: {
    agentId?: string;
    sessionKeyHash?: string;
    timeRange?: { from: string; to: string };
  };
  parent?: { targetType: string; targetId: string; authority: string };
};
```

Target 是独立、可复用的规范引用，不隶属于某个 Case。同一 Target 可以同时用于 QUICK、TARGETED、定时诊断和 Incident。

身份约束：

- `tenantId` 必须由已验证 session、membership 或服务端映射解析，不能信任客户端自由提交。
- `targetId + targetType + authority + tenantId` 构成规范身份，显示名称不得作为 ID。
- `version` 用于 Skill、Agent definition、配置快照等版本敏感对象；没有版本时必须显式省略，不能填 `latest`。
- `capability` 描述 Target 被诊断的能力面，例如 `route`、`execute` 或 `deliver`，不创建新的业务对象身份。

### 4.2 DiagnosticRun

```ts
type DiagnosticRun = {
  runId: string;
  caseId?: string;
  mode: "QUICK" | "TARGETED" | "FULL" | "INCIDENT";
  targets: DiagnosticTarget[];
  requestedBy: DiagnosticPrincipal;
  mutationPolicy: "READ_ONLY" | "SUGGEST";
  budget: { timeoutMs: number; maxDiagnosers: number; modelCalls: number };
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  completion?: "CONFIRMED" | "PROBABLE" | "INCONCLUSIVE" | "BLOCKED" | "TIMED_OUT";
  missingEvidence: EvidenceRequirement[];
  startedAt: string;
  completedAt?: string;
};
```

Diagnosis Run ID 与 Agent `runId` 分开。前者是诊断执行，后者是被诊断的业务运行。

`status=completed` 只表示 Planner 已停止执行，不代表已经找到根因。业务完成语义由 `completion` 表达：

- `CONFIRMED`：根因满足确定性规则或已获人工确认。
- `PROBABLE`：有最优解释，但仍存在未排除候选。
- `INCONCLUSIVE`：证据不足以区分候选，必须列出缺失证据。
- `BLOCKED`：权限、数据保留或外部系统阻止继续诊断。
- `TIMED_OUT`：达到执行时间或成本预算。

### 4.3 Evidence

```ts
type DiagnosticEvidence = {
  evidenceId: string;
  evidenceType: "event" | "metric" | "snapshot" | "config_check" | "probe" | "transcript_ref";
  source: string;
  authorityRecordId: string;
  observedAt: string;
  target: DiagnosticTarget;
  trace?: { traceId?: string; spanId?: string; parentSpanId?: string };
  summary: Record<string, string | number | boolean | null>;
  payloadRef?: { store: string; recordId: string; expiresAt?: string };
  integrity?: { contentHash?: string; collectorVersion: string };
  collection: {
    method: "event_adapter" | "query" | "probe" | "snapshot";
    completeness: "complete" | "partial" | "unknown";
    attributionResolution?: string;
  };
  privacy: { classification: "public" | "internal" | "restricted"; redacted: boolean };
};
```

Evidence 默认保存摘要和引用，不复制原始敏感内容。Skill 文本、模型解释和最终报告不能作为 Evidence。`authorityRecordId` 必须能够定位原始事实，无法定位时只能创建 `partial` Observation，不能宣称证据完整。

### 4.4 Observation、Assessment 与 Attribution

```ts
type DiagnosticObservation = {
  observationId: string;
  target: DiagnosticTarget;
  predicate: string;
  value: string | number | boolean | null;
  evidenceIds: string[];
  observedAt: string;
};

type DiagnosticAssessment = {
  assessmentId: string;
  observationIds: string[];
  code: string;
  verdict: "normal" | "anomalous" | "unknown";
  ruleId?: string;
  baselineRef?: string;
};

type DiagnosticAttribution = {
  attributionId: string;
  assessmentId: string;
  suspectedTarget: DiagnosticTarget;
  responsibilityDomain: string;
  state: "suspected" | "supported" | "confirmed" | "rejected";
  basis: "runtime_identity" | "ownership_map" | "rule" | "model_suggestion" | "human_confirmed";
};
```

示例：

```text
Observation: skill.started = false
Assessment: expected_skill_not_started = anomalous
Attribution: suspectedTarget = skill-router
Hypothesis: routing_rule_mismatch
```

Observation 只能由 Evidence 导出；Assessment 可以由规则产生；Attribution 是责任候选；Hypothesis 才描述可能根因。四者不得压缩成一段模型文本。

### 4.5 Hypothesis

```ts
type DiagnosticHypothesis = {
  hypothesisId: string;
  code: string;
  state: "candidate" | "supported" | "rejected" | "confirmed" | "unknown";
  confidence: {
    evidence: number;
    assessment: number;
    rootCause: number;
    impact?: number;
  };
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  missingEvidence: string[];
  scoringMethod: "rule_v1" | "model_assisted_v1" | "human_confirmed";
};
```

一期各 confidence 是 0–1 的可解释评分，不宣称统计概率。每次变化必须记录 reason code 和所用评分器版本：

- `evidence`：Evidence 来源、完整性、定位能力和归因质量。
- `assessment`：Observation 是否足以证明异常成立。
- `rootCause`：当前 Hypothesis 是否优于替代解释。
- `impact`：受影响对象和数量是否已被可靠统计。

报告不得用最高的一个数代表整条结论。例如“Skill 未启动”的 evidence 可以是 0.99，而“路由规则错误”的 root cause 可能只有 0.71。

### 4.6 Finding

```ts
type DiagnosticFinding = {
  findingId: string;
  code: string;
  title: string;
  target: DiagnosticTarget;
  status: "open" | "acknowledged" | "resolved" | "false_positive";
  severity: "P0" | "P1" | "P2" | "P3" | "P4";
  primaryDomain:
    | "user_interaction"
    | "agent_model"
    | "skill_tool"
    | "channel_delivery"
    | "system_configuration"
    | "business_workflow"
    | "external_dependency"
    | "unknown";
  observationIds: string[];
  assessmentIds: string[];
  attributionIds: string[];
  hypothesisIds: string[];
  evidenceIds: string[];
  confidence: {
    evidence: number;
    assessment: number;
    rootCause: number;
    impact?: number;
  };
  fingerprint: string;
  firstSeenAt: string;
  lastSeenAt: string;
};
```

Finding 是对上述对象的受控聚合，不拥有新的原始事实。P0 必须满足硬条件或人工确认，不能只由模型分数产生。

### 4.7 Diagnosis Graph

```ts
type DiagnosisRelation = {
  relationId: string;
  fromId: string;
  toId: string;
  relation:
    | "derived_from"
    | "correlated_with"
    | "depends_on"
    | "causes"
    | "contributes_to"
    | "duplicates";
  derivation: "EVIDENCE_DERIVED" | "RULE_DERIVED" | "HUMAN_CONFIRMED" | "MODEL_INFERRED";
  state: "candidate" | "accepted" | "rejected";
  confidence: number;
  evidenceIds: string[];
};
```

约束：

- 时间相邻只能生成 `correlated_with` 候选。
- `MODEL_INFERRED` 只能创建 `candidate`，不能直接成为 RCA、Incident 主因或修复依据。
- `causes` 只有在 `EVIDENCE_DERIVED`、`RULE_DERIVED` 或 `HUMAN_CONFIRMED` 时才允许进入 `accepted`。
- 各 Diagnoser 可以提交 Relation candidate，但只有 Correlation Policy 可以升级关系状态。
- Graph 初期使用普通关系表或 adjacency list，不引入图数据库。

### 4.8 Case、Remediation 与 Verification

```text
DiagnosticCase
├── targets
├── diagnosticRuns
├── findings
├── relations
├── impact
├── timeline
└── reports

Remediation
├── recommendation
├── approval
├── executorCapability
├── executionReceipt
└── rollbackReference

Verification
├── baselineWindow
├── observationWindow
├── expectedOutcome
├── measuredOutcome
└── verdict
```

Case 状态建议使用：

```text
OPEN → TRIAGED → DIAGNOSING → MITIGATING → MONITORING → RESOLVED → CLOSED
```

## 5. Diagnoser Contract

```ts
type DiagnoserManifest = {
  id: string;
  version: string;
  targets: DiagnosticTarget["targetType"][];
  modes: DiagnosticRun["mode"][];
  evidenceRequirements: EvidenceRequirement[];
  produces: string[];
  cost: { cpu: "low" | "medium" | "high"; io: "low" | "medium" | "high"; modelCalls: number };
  permissions: string[];
  mutation: "none" | "suggest_only";
};

type EvidenceRequirement = {
  evidenceType: string;
  source: string;
  targetType: DiagnosticTarget["targetType"];
  fields: string[];
  freshnessMs?: number;
  sensitivity: "internal" | "restricted";
  cost: "low" | "medium" | "high";
  required: boolean;
};
```

执行接口：

```ts
interface Diagnoser {
  manifest: DiagnoserManifest;
  diagnose(context: DiagnoserContext): Promise<DiagnoserResult>;
}
```

`DiagnoserResult` 只能包含 Observation、Assessment、Attribution、Hypothesis 更新、Finding draft、Relation candidate 和下一步 Evidence 请求。不得直接修改配置或执行修复。

## 6. 专业诊断器规划

| Diagnoser           | 复用来源                                        | 目标职责                         | 修复边界                            |
| ------------------- | ----------------------------------------------- | -------------------------------- | ----------------------------------- |
| `doctor-static`     | `src/commands/doctor-*`                         | 配置、安装、服务、环境检查       | 调用纯检查函数；不自动修复          |
| `runtime-health`    | Gateway health、heartbeat、queue、session stuck | Gateway、队列、Session 卡死      | 只建议现有恢复能力                  |
| `channel-delivery`  | channel probe/monitor、message hooks            | 收件、连接、账号、投递关联       | 重启仍由现有 monitor 或审批动作执行 |
| `agent-runtime`     | agent health、LLM hooks                         | 模型、Agent 启动和完成故障       | 不改模型策略                        |
| `skill-runtime`     | Skill Invocation、Skill Health                  | 未触发、失败、重复、延迟、版本   | 不复制健康窗口                      |
| `tool-runtime`      | before/after tool hooks、tool loop              | 参数、错误、超时、循环、结果缺失 | 不重放写 Tool                       |
| `trace-interaction` | session JSONL、message hooks                    | 重试、取消、无响应、重复采集     | 模型只辅助语义判断                  |
| `workflow-state`    | 新业务状态事件                                  | 回退、循环、幂等、上下文丢失     | 业务团队确认规则                    |
| `security-posture`  | security audit                                  | 安全 Finding 适配                | 修复仍由 security audit/Doctor 承担 |
| `data-source`       | enterprise-data health                          | 数据源连接、延迟、一致性         | 不直接改连接凭据                    |

## 7. Doctor 改造与共存方案

`doctor` 保持现有 CLI 和修复体验，但逐步拆出结构化纯检查层：

```text
Doctor Check Library
├── checkConfig
├── checkStateIntegrity
├── checkGatewayService
├── checkCredentials
├── checkSandbox
└── checkMemory
       │
       ├── doctor CLI：展示、询问、迁移、修复
       └── doctor-static Diagnoser：只读结果、Evidence、Finding draft
```

必须满足：

1. Diagnosis Platform 不解析 Doctor 终端文本。
2. 不从诊断 Skill 自动执行 `openbot doctor`。
3. `doctor-static` 只调用明确标记为 read-only 的检查函数。
4. Doctor 的 safe migration、config write 和 service mutation 不进入 Diagnoser 执行权限。
5. 修复建议通过 `executorCapability` 指向既有 Doctor 或配置入口。

## 8. Evidence Plane 实施方式

### 8.1 适配而不是替换

新增 Evidence Adapter 层：

```text
DiagnosticEventAdapter
PluginHookAdapter
SessionTranscriptAdapter
SkillInvocationAdapter
DoctorCheckAdapter
ChannelHealthAdapter
AgentHealthAdapter
OtelReferenceAdapter
GovernanceVerificationAdapter
```

现有事件保持原协议，由 Adapter 生成统一 Evidence。避免在第一阶段改动所有生产事件发送方。

### 8.2 本地单 Gateway 阶段

- 使用 append-only JSONL Journal 保存 Diagnostic Run、Evidence 摘要和 Finding 变化。
- Case、关系和索引可先使用与现有 Gateway store 一致的版本化本地持久化接口。
- 写入失败不得阻塞聊天主链，但必须计数、告警并进入有界重试队列，禁止 fail-silent。
- 原始 transcript 和 Tool 结果留在原存储，只保存引用和脱敏摘要。
- Journal 必须支持幂等 `evidenceId` 和重启恢复。

### 8.3 云端多实例阶段

满足共享 Identity、Agent Registry、ACL 和可信 active membership 前置后，再切换到共享 Repository：

- PostgreSQL 或等价事务存储保存 Case、Finding、Relation、Remediation 和索引。
- Object storage 保存经批准的长报告和大体积脱敏证据。
- Transactional outbox 发布 Case/Finding 变化。
- 使用 RLS 或服务端强制 scope；授权上下文只来自已验证 principal。
- 本地 Journal 只作短期 buffer，不保留双主。

## 9. Evidence 驱动调度

调度器输入：

```text
Target + Mode + Symptoms + Available Evidence + Evidence Catalog + Permission + Budget
```

Planner 的输出不是简单的 Diagnoser 列表，而是最小诊断计划：

```ts
type DiagnosisPlanStep = {
  stepId: string;
  hypothesisIds: string[];
  diagnoserId: string;
  evidenceRequests: EvidenceRequirement[];
  expectedInformationGain: "low" | "medium" | "high";
  stopWhen: string[];
};
```

Planner 必须同时选择：

- 哪个 Diagnoser 负责解释证据。
- 从哪个 Authority 获取哪些 Evidence 字段。
- 查询哪个时间窗和 Target 范围。
- 是否需要实时 Probe，还是已有快照足够。
- Evidence 的权限、敏感级别和获取成本。

QUICK 模式只获取区分当前候选所需的最小证据集。例如 Session 诊断先读取 metadata、Agent run 和 Skill Invocation；只有 Tool 候选仍成立时才加载 Tool Evidence，不默认读取完整 transcript。

执行流程：

```text
生成初始 Hypothesis
→ 选择低成本、高区分度 Diagnoser 与 Evidence Source
→ 收集 Evidence
→ 支持或排除 Hypothesis
→ 只调度能缩小不确定性的下一诊断器
→ 达到停止条件
→ 生成 Finding 和 Case 更新
```

示例：机器人未回复。

```text
message.received = true
route.resolved = false
```

此时 Scheduler 应转向 Routing/Configuration，不再执行 Tool 和业务数据诊断。

停止条件：

- 已确认根因且证据覆盖达到阈值。
- 所有候选均被排除，输出 `UNKNOWN` 和缺失证据。
- 达到时间、成本或权限预算。
- 下一步只剩高风险 Probe，需要人工授权。

停止时必须写入 `DiagnosisRun.completion`。无法区分 Skill 路由问题与配置漂移时，应返回：

```text
completion = INCONCLUSIVE
missingEvidence = [route_resolution_event, deployment_config_snapshot]
```

不能为了生成报告而强制选择一个 Root Cause。

## 10. Baseline 与异常判断

### 10.1 一期支持

- 明确的安全和正确性硬阈值。
- Skill、Tool、Agent 的滚动时间窗口。
- 同一对象历史 P50/P95/P99。
- 最小样本数门禁。
- 修复前后相同口径对比。

### 10.2 复用原则

- Skill 成功率、调用次数和耗时从 Skill Invocation 聚合。
- Evolution Governance 可消费统一 Finding 和 Verification，但不再独立采集相同事实。
- OTEL 指标作为外部可观测证据引用，不导入全部原始时序数据。

### 10.3 延后能力

- 季节性自动基线。
- 跨租户同群比较。
- 无监督异常检测。
- 自动阈值学习。
- 未经人工校准的 Skill Selection Accuracy。

## 11. 权限与多端产品投影

仓库正在执行 Ops 职责归位，诊断平台不得重新建立独立 Ops 主工作台。

| 角色与端          | 可见范围                                            | 可执行能力                                      |
| ----------------- | --------------------------------------------------- | ----------------------------------------------- |
| Employee          | 自己的会话和任务                                    | QUICK、解释、重试建议、提交问题                 |
| Enterprise        | 当前可信租户的员工、Agent、Skill、Channel、Workflow | TARGETED、租户 Case、确认业务影响、提交修复审批 |
| Platform          | 跨租户聚合、平台 Runtime、全局 Incident             | FULL/INCIDENT、调度、关联、审批平台恢复         |
| Builder           | 经授权的能力缺陷和版本证据                          | 查看分配的 Finding、提交修复版本和验证信息      |
| Service Principal | 明确 scope 的自动采集或执行                         | 仅 manifest 与 policy 允许的动作                |

权限动作：

```text
diagnosis.read
diagnosis.run
evidence.read_summary
evidence.read_restricted
case.manage
incident.declare
remediation.suggest
remediation.approve
remediation.execute
verification.confirm
```

执行者、审批者和验证者必须分别记录，不允许用一个布尔 `isAdmin` 代替。

## 12. Skill Suite 定位

Skill Suite 是 Diagnosis Platform 的对话入口，不是采集和存储主干。

建议组成：

| Skill                   | 作用                                           |
| ----------------------- | ---------------------------------------------- |
| `openbot-diagnosis`     | 总控入口，解析用户目标并创建受限 Diagnosis Run |
| `trace-analyzer`        | 解释单次会话和运行链路                         |
| `interaction-diagnoser` | 分析重试、重复输入、取消、放弃和上下文问题     |
| `capability-diagnoser`  | 解释 Agent、Skill、Tool 和模型 Finding         |
| `delivery-diagnoser`    | 解释渠道、账号、路由和消息投递问题             |
| `workflow-diagnoser`    | 解释业务状态和流程问题                         |
| `diagnosis-reporter`    | 读取 Case 生成角色适配报告                     |

Skill 不通过自然语言互相调用。总控 Skill 调用结构化 Diagnosis RPC，专业 Skill 是不同分析视角。

建议 RPC：

```text
diagnosis.targets.resolve
diagnosis.runs.create
diagnosis.runs.get
diagnosis.traces.get
diagnosis.findings.list
diagnosis.cases.get
diagnosis.reports.generate
diagnosis.remediations.suggest
```

一期不开放 `remediations.execute` 给 Skill。

## 13. Incident 综合诊断报告

一个 Incident Case 应聚合多个 Diagnoser，而不是拼接多个自然语言报告。

报告结构：

1. 事故摘要和当前状态。
2. 影响开始、发现、缓解、恢复时间。
3. 受影响租户、组合、员工、Agent、Skill、Tool、渠道和 Session。
4. 事实时间线。
5. Trigger、Root Cause、Contributing Factors、Symptoms、Impact。
6. 支持证据、反证、缺失证据和置信度。
7. 临时缓解、永久修复、审批和执行回执。
8. 修复前后指标和验证结论。
9. 纠正与预防任务。
10. 人工确认和报告版本历史。

报告生成器只能引用 Case 中已存在的事实和 Finding。模型可以改善表达，但不能新增未经记录的根因或影响数字。

## 14. 一期垂直切片

一期只交付一条完整链路：

```text
Session
  ↓
Agent Run
  ↓
Skill Invocation
  ↓
Tool Invocation
```

闭环场景：

```text
用户报告当前会话失败
→ QUICK Diagnosis
→ 解析 Session Target 和可信 tenant scope
→ 获取 Session metadata、Agent run、Skill Invocation
→ 按候选选择最小 Tool Evidence
→ 形成 Observation / Assessment / Attribution / Hypothesis
→ 关联症状并确认、推测或无法确认 Root Cause
→ 创建或合并 Case
→ 管理员确认处理动作
→ 引用既有执行回执
→ 使用相同口径进行 Verification
```

### 14.1 一期包含

- `session`、`run`、`agent`、`skill`、`tool` Target。
- QUICK 和 TARGETED 模式。
- Session、Agent Hook、Skill Invocation、Tool Hook 四类 Adapter。
- route decision 最小 Evidence 补点。
- 本地耐久 Journal。
- Observation、Assessment、Attribution、Hypothesis、Finding、Relation、Case 最小协议。
- `CONFIRMED`、`PROBABLE`、`INCONCLUSIVE`、`BLOCKED`、`TIMED_OUT` 完成状态。
- 单 Case 管理员确认和一次修复后 Verification。
- Employee 当前会话解释和 Enterprise 当前租户 Case 视图。

### 14.2 一期不包含

- Doctor、Channel、Security、Data、Workflow Diagnoser。
- FULL 平台巡检和跨租户 Incident 自动编排。
- 图数据库、复杂概率推断和无监督异常发现。
- 独立 Diagnosis 微服务和共享多实例写入。
- 由 Skill 发起的 Remediation execute。
- 完整 transcript 长期复制和任意 Tool payload 保存。

### 14.3 一期价值证明

一期必须用真实回放样本证明：

1. **能找到问题。** 不只是显示 Health，而是指出失败发生在 Agent、Skill 或 Tool 的哪个节点。
2. **能聚合根因。** Tool 超时、Agent 失败和用户重试可以被关联为一个 Case，而不是三个独立根因。
3. **能诚实停止。** 缺少 route/config Evidence 时输出 `INCONCLUSIVE`，不制造 RCA。
4. **能验证修复。** 用同一规则和指标证明修复后失败率或重试率改善。
5. **不建立平行事实源。** 所有 Evidence 都能回到 Session、Agent runtime、Skill Invocation 或 Tool runtime 的权威记录。

## 15. 分阶段实施路线

### Phase 0：协议与重叠清单，2 周

交付：

- 冻结 v1 协议：Target、Run、Evidence、Observation、Assessment、Attribution、Diagnoser、Evidence Requirement、Hypothesis、Finding、Relation、Case、Remediation、Verification。
- 建立 Doctor/Health/Skill Governance/OTEL/Session 的事实源和副作用矩阵。
- 冻结租户、Agent、Session、Run、Skill、Tool 标识映射。
- 建立敏感字段分类和保留策略。
- 收集 20–30 个脱敏真实故障样本。

门禁：

- 每类事实只有一个权威来源。
- 明确哪些现有检查是只读、迁移、配置写、服务变更或网络 Probe。
- 协议通过 Gateway、Security、Enterprise、Skill Governance 联合评审。

### Phase 1：垂直切片 MVP，4–5 周

交付：

- Diagnosis domain contract、Diagnoser Registry 和 Evidence Catalog。
- Session、Agent Hook、Skill Invocation、Tool Hook Adapter。
- route decision 最小结构化 Evidence。
- 本地 append-only Journal、幂等和恢复。
- `QUICK`、`TARGETED` Run。
- 单 Session Trace、Finding、Relation 和 Case。
- 管理员确认、执行回执引用和一次 Verification。
- Employee 当前会话解释和 Enterprise 当前租户 Case 视图。
- 6–8 条确定性规则。

一期规则建议：

- 收到消息但未路由。
- Agent 未启动或失败。
- Tool 超时、错误或循环。
- Session stuck。
- Skill invocation failure。
- 已知实体存在但再次采集。
- 用户连续重试或取消。

门禁：

- 95% 以上 Tool 调用可关联 Session 和 Agent run。
- 100% Skill Evidence 展示 `attributionResolution` 或明确标记未知。
- Journal 写失败不阻塞消息主链，但可观测且可恢复。
- 关闭诊断功能后运行行为不变。
- 不写入明文凭据和完整受限内容。
- 至少一个修复样本完成 `Finding → Case → Receipt → Verification`。
- 证据不足样本稳定返回 `INCONCLUSIVE`。

### Phase 2：横向接入 Runtime、Channel 与 Doctor，3–4 周

交付：

- Runtime Health、Channel delivery、Doctor read-only Adapter。
- Doctor 纯检查与修复路径拆分。
- Platform 跨 Target 聚合。
- Diagnosis Graph 扩展到跨组件关系。
- Platform 跨租户聚合与 Incident 入口。
- 旧 `/ops/*` 兼容路由迁移到相应 Platform surface。

门禁：

- 跨租户读取服务端拒绝。
- 90% 以上 Finding 包含至少两条真实 Evidence 或明确标记证据不足。
- 相同根因聚合准确率达到 90%。

### Phase 3：FULL、INCIDENT 与高级 Planner，3–4 周

交付：

- 跨 Target Evidence 驱动 Planner。
- Hypothesis 排序、反证、缺失证据和跨分支停止条件。
- Security、Data 专业 Diagnoser。
- FULL 与 INCIDENT 模式。

门禁：

- QUICK 模式不执行无关高成本 Diagnoser。
- 无证据时输出 `UNKNOWN`，不强制归因。
- 模型关闭时确定性诊断仍可运行。

### Phase 4：Workflow 与受治理 Remediation 扩展，3–4 周

交付：

- Recommendation、Approval、Execution Receipt、Verification。
- 对接 Doctor、Channel recovery 和 Evolution Governance 的既有执行能力。
- Workflow domain event 与业务状态诊断。
- 修复前后 baseline 对比。
- 回滚引用和人工确认。

门禁：

- Diagnosis 进程无通用写权限。
- 所有状态变更有 principal、scope、时间和 receipt。
- 高风险动作必须显式审批。
- 验证失败不能自动标记 Case resolved。

### Phase 5：共享存储与高级诊断，条件触发

前置条件：

- 共享 Identity、active membership、Agent Registry 和 ACL 已成为权威事实源。
- 多 Gateway 写入模型、RLS、outbox 和租户事件扇出已获批准。

可交付：

- 共享 Diagnosis Repository。
- 动态分位数 baseline。
- 受控语义诊断。
- 跨 Case 模式发现。
- Diagnosis Quality 反馈学习。

## 16. 诊断质量指标

| 指标                      | 定义                                         |
| ------------------------- | -------------------------------------------- |
| Evidence Coverage         | Finding 关键断言中有真实 Evidence 支持的比例 |
| Root Cause Accuracy       | 人工最终确认根因与初始主根因一致率           |
| False Positive Rate       | 被关闭为 false positive 的 Finding 比例      |
| False Negative Rate       | 事后确认但系统未发现的问题比例               |
| Diagnosis Completion Rate | 在预算内形成可行动结论或明确 UNKNOWN 的比例  |
| Mean Time To Diagnose     | Case 创建到确认主要根因的时间                |
| Mean Time To Resolve      | Case 创建到验证完成的时间                    |
| Recommendation Acceptance | 被批准建议占比                               |
| Remediation Success Rate  | 执行后达到验证目标的比例                     |
| Correlation Precision     | Graph 关系经人工确认后仍成立的比例           |

质量指标必须按 Diagnoser 版本分组，避免升级后历史数据污染评估。

## 17. 测试策略

### 16.1 Contract tests

- Schema 版本兼容。
- 非法 Target、Evidence、Finding、Relation 拒绝。
- `causes` 关系证据门禁。
- Finding fingerprint 稳定性。

### 16.2 Adapter tests

- 现有 event 到 Evidence 的无损映射。
- Skill Invocation 不重复计数。
- Session 和 Tool 敏感字段脱敏。
- Adapter 失败不影响生产主链。

### 16.3 Scenario tests

- 消息未路由。
- 渠道收到但 Agent 未启动。
- Tool 超时导致用户重试。
- Skill 未触发与 Skill 触发失败的区分。
- Agent 完成但渠道投递失败。
- Session 上下文重置后重复采集。
- Doctor Finding 只读接入。

### 16.4 Security tests

- 跨租户不可见。
- 普通用户无法读取受限 Evidence。
- 客户端伪造 tenantId 无效。
- Skill 无法直接执行 remediation。
- 报告不泄漏 Prompt、Token、电话和凭据。

### 16.5 Replay and evaluation

- 建立脱敏 golden traces。
- 每条规则必须有 fail-before/pass-after 或正反样本。
- 模型诊断使用独立标注集，不测试固定文案。
- 新 Diagnoser 先 shadow，不直接影响 Incident 或修复。

## 18. 风险与控制

| 风险                 | 控制                                                    |
| -------------------- | ------------------------------------------------------- |
| 形成第二套事实源     | Source-of-Truth 矩阵；Adapter 只引用和归一化            |
| 诊断拖慢消息链       | 异步、有界队列、采样、预算、fail-open but observable    |
| 模型幻觉根因         | Evidence gate、Hypothesis、UNKNOWN、人工确认            |
| Graph 错把相关当因果 | relation 类型分离；`causes` 强门禁                      |
| Doctor 被隐式执行    | 只读 check library；Skill 禁止调用修复命令              |
| 自动修复越权         | Diagnosis 与 Executor 分离；显式 approve/execute/verify |
| 敏感数据扩散         | 引用式 Evidence、字段 allowlist、HMAC、保留期限         |
| 多租户错误归属       | 只信服务端 principal 和 canonical resolver              |
| 本地存储不适合多实例 | Phase 5 前禁止多写实例；Repository 可替换但不双主       |
| 平台范围失控         | 不恢复独立 Ops；按三端职责投影                          |

## 19. 最终交付边界

完整 Diagnosis Platform 最终由以下部分组成：

```text
1 个 Diagnosis Protocol 包
1 个 Control Plane
1 个 Evidence Adapter 与 Journal 层
1 个 Diagnoser Registry 和 Scheduler
一组复用现有事实源的专业 Diagnoser
1 个 Finding / Graph / Case Repository
1 个 Remediation Governance 边界
1 套 Diagnosis Skill Suite
Employee / Enterprise / Platform 三端投影
1 套回放样本与质量评测系统
```

一期不是“造一个更大的 Doctor”，也不是“先写七个 Skill”。一期的真正目标是：

> 在不改变现有主链行为、不复制事实源、不扩大写权限的前提下，建立统一 Diagnosis Protocol，把一次会话中的消息、路由、Agent、Skill、Tool、渠道和健康事实关联成可回放、可解释、可聚合的 Finding 与 Case。

## 20. 实施裁决

架构方向已批准进入 **Phase 0 / protocol design**；功能实现仍受协议冻结和 Authority-of-Record inventory 门禁约束。建议按以下优先级推进：

1. 先统一对象和证据契约。
2. 再适配已有 Doctor、Health、Skill Invocation 和 Session 事实源。
3. 先做单会话 Trace 与确定性诊断。
4. 再建设 Finding、Graph、Case 和 Incident。
5. 最后引入模型语义诊断、动态 baseline 和共享多实例存储。

在 Phase 0 通过评审前，不建议创建生产数据库 schema、不建议建立独立诊断服务、不建议开放任何自动修复权限。
