# OpenBot Diagnosis Platform Phase 1 垂直切片：场景与验收

Date: 2026-09-02

Status: **Phase 0 scenario contract remains the fixture law. 3.6/3.7/3.8 signed off. 3.9 wires Agent/Tool from read-only observations. 4.4 adds in-process cross-target Case aggregation and Diagnosis Graph (refs only, no main-chain). 5.1/5.2 add a read-only Composite Diagnosis Report projector plus validation/JSON export (no HTTP/RPC/store). 4.1/4.2 remain unchecked. 5.2 ≠ Phase 3 完成 ≠ Diagnosis Platform 完成.**

Task: `openbot-diagnosis-platform`

Parent: [OpenBot Diagnosis Platform 改造升级实施方案](/design/openbot-diagnosis-platform-implementation-plan-2026-09-02)

Audience: Protocol Engineer、Authority Auditor、Gateway、Skill Governance、QA

---

## 0. 范围与不变量

Phase 1 只证明一条垂直闭环，不建设 Doctor / Channel / Security / Data / Workflow 执行面：

```text
Session
  → Agent Run
  → Skill Invocation
  → Tool Invocation
  → Observation
  → Assessment
  → Attribution
  → Hypothesis
  → Finding
  → Case
  → Verification
```

**Phase 0 完成 ≠ Diagnosis Platform 完成。** 本文件只冻结场景合同与脱敏 fixture。签收 Phase 0 并不授权建设 Diagnosis Platform runtime、自动修复、平行事实源或消息主链变更。

本切片遵守父方案架构不变量，并额外冻结以下验收不变量：

1. **运行事实不归 Diagnosis 所有。** Fixture 与协议对象只引用 Session / Agent runtime / Skill Invocation / Tool runtime 的 `authorityRecordId`；禁止写回这些权威库。
2. **L1 Health ≠ 单次 RCA。** `src/gateway/agent-runtime-health.ts` 的 `online | degraded | offline | unconfigured` 只能作为 `snapshot` Evidence，不得单独升级为 Root Cause。
3. **Skill 归因分级。** 仅 `attributionResolution = identity_tool_name` 可把 Attribution 推到 `confirmed` + `basis = runtime_identity`。`unique_owner`、`prompt_named_use`、`none` 不得当作已确认身份。
4. **Route Evidence 是预留接口，当前不存在。** `src/routing/resolve-route.ts` 的 `matchedBy` 仅即时返回与 debug log，没有耐久 `route_resolution` 事件。缺少该 Evidence 时必须 `INCONCLUSIVE`，禁止编造“未路由 / 错路由”根因。
5. **用户重试不是独立根因。** Tool 超时、Agent 失败、用户连续重试必须合并为 **一个 Case、一个 primary Finding**。
6. **`MODEL_INFERRED` 不能被接受为 `causes`。** 模型边只能停留在 `candidate`。
7. **证据可信度与结论可信度分离。** `confidence.evidence` / `assessment` / `rootCause` / `impact` 必须独立计分，禁止用单一分数代表整条链。
8. **过期 locator 必须标 `source_expired`。** `payloadRef.expiresAt` 已过期时，`collection.completeness` **只能**是 `source_expired`。`complete` / `partial` / `unknown` 一律校验失败。权威记录不可定位但仍未过期时，才允许 `partial` 或 `unknown`。
9. **协议无 UI / NLP 依赖。** 场景合同、Fixture、validators 不得引用页面路由、自然语言意图或 Prompt 全文。

---

## 1. Fixture 图信封（DiagnosticRunGraph）

Phase 0 用一份 JSON 图表示一次已停止的 Diagnostic Run。对象字段对齐父方案 §4；`schemaVersion` 一律为 `1`。

```ts
type DiagnosticRunGraph = {
  schemaVersion: 1;
  graphKind: "DiagnosticRunGraph";
  run: DiagnosticRun; // 含 completion、missingEvidence
  evidences: DiagnosticEvidence[];
  observations: DiagnosticObservation[];
  assessments: DiagnosticAssessment[];
  attributions: DiagnosticAttribution[];
  hypotheses: DiagnosticHypothesis[];
  findings: DiagnosticFinding[];
  relations: DiagnosisRelation[];
  case: DiagnosticCase;
  verification: DiagnosticVerification | null;
};
```

`DiagnosticRun.runId` 是 **诊断执行 ID**，与被诊断的 Agent `runId`（出现在 Target `targetType: "run"` 与 Evidence summary 的 `agentRunId`）严格分开。

`src/diagnosis/types.ts` 冻结的 Case / Verification 字段（场景图必须通过这些 validators）：

```ts
type DiagnosticCase = {
  schemaVersion: 1;
  caseId: string;
  tenantId: string | null;
  status: "OPEN" | "TRIAGED" | "DIAGNOSING" | "MITIGATING" | "MONITORING" | "RESOLVED" | "CLOSED";
  targets: DiagnosticTarget[];
  diagnosticRunIds: string[];
  findingIds: string[];
  relationIds: string[];
  impact?: { affectedCount?: number; code?: string };
  timeline: Array<{ at: string; code: string }>;
};

type DiagnosticVerification = {
  schemaVersion: 1;
  verificationId: string;
  caseId: string;
  baselineWindow: { from: string; to: string };
  observationWindow: { from: string; to: string };
  expectedOutcome: Record<string, string | number | boolean | null>;
  measuredOutcome?: Record<string, string | number | boolean | null>;
  verdict?: "improved" | "unchanged" | "regressed" | "inconclusive";
};
```

场景 Fixture 在 Case 上保留协议允许的附加合同字段（validators 忽略未知键，但禁止 `uiText` / `reportMarkdown` / `locale`）：

- `mergeKey`：tenant + sessionKeyHash + fingerprint
- `mergedObservationPredicates`：场景 4 必须同时含 `tool.timeout`、`agent.run.failed`、`session.user_retry`

Verification 的 `expectedOutcome` / `measuredOutcome` 只放 metric 名与数值；治理回执 ID 如需出现，写在 measuredOutcome 的 `authorityRecordId` 摘要字段，**不**把 Evolution Governance 窗口时序复制进 Diagnosis。`INCONCLUSIVE` Run 的 `verification` 为 `null`。

`DiagnosticRun` 必须带 `diagnosedAgentRunId`（被诊断的 Agent run，可 null），且不得等于诊断 `runId`。`requestedBy.kind` 为 `user | service | system`。

脱敏约定（所有 Fixture 必须满足）：

| 禁止写入                     | 允许写入                                                                 |
| ---------------------------- | ------------------------------------------------------------------------ |
| 真实 token / 电话 / 用户身份 | `tenant-fixture-a`、`agent-fixture-main`、`principal-fixture-employee-a` |
| 完整 Prompt / 回复正文       | 错误类别、布尔谓词、耗时毫秒                                             |
| Tool 参数 / Tool 结果全文    | `toolNameClass`（如 `web_fetch`）、`errorClass`                          |
| 生产 URL / 内网地址          | fake `sha256:fixture-…` hash、`sessionKeyHash`                           |
| 明文 session key             | `sessionKeyHash` only                                                    |

---

## 2. QUICK 与 TARGETED（仅本切片）

| 维度           | QUICK                                                                | TARGETED                                                                     |
| -------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 入口           | Employee 当前会话失败 / “为什么没回”                                 | Enterprise 指定 Session / Agent run / Skill / Tool                           |
| 初始 Target    | `session`（由可信 membership 解析 `tenantId`）                       | 调用方给出的 `session` / `run` / `skill` / `tool`，仍须服务端校验 tenant     |
| 默认 Evidence  | Session metadata、Agent run 是否启动/完成、Skill Invocation 有无记录 | 上述全部 + 该 Target 的完整时间窗引用                                        |
| Tool Evidence  | **仅当** Tool 候选仍成立时才请求                                     | 若 Target 是 `tool` 或 Hypothesis 仍指向 Tool，则必须请求                    |
| Route Evidence | 若 Adapter 尚未落地：记入 `missingEvidence`，不探测网络              | 同样不得伪造；可把 `route_resolution` 标为 required 后停止                   |
| Transcript     | 不读全文；最多 `transcript_ref` locator                              | 仍禁止复制全文；允许更长 `timeRange` 的引用                                  |
| Budget 建议    | `timeoutMs ≤ 8000`，`maxDiagnosers ≤ 3`，`modelCalls = 0`            | `timeoutMs ≤ 30000`，`maxDiagnosers ≤ 5`，`modelCalls = 0`（一期确定性规则） |
| 停止           | 确认节点、或候选无法区分、或预算耗尽                                 | 同上；允许为排除反证多取一条低成本 Evidence                                  |
| 一期禁止       | FULL / INCIDENT、高风险 Probe、Remediation execute                   | 同左                                                                         |

两种模式的 `mutationPolicy` 只能是 `READ_ONLY` 或 `SUGGEST`。Fixture 一律 `READ_ONLY`。

---

## 3. Evidence Planner（Diagnoser + Evidence Source）

Planner 的调度单位是 **Diagnoser × Evidence Source × 字段 × 时间窗**，不是“把所有诊断器跑一遍”。

本切片允许的 Diagnoser（来自父方案 §6，其余只预留）：

| diagnoserId         | Target          | 解释什么                                               | 禁止                     |
| ------------------- | --------------- | ------------------------------------------------------ | ------------------------ |
| `trace-interaction` | `session`       | 用户消息、重试、取消                                   | 不读完整 transcript 正文 |
| `agent-runtime`     | `agent` / `run` | 本次 run 是否启动/失败；可 **引用** L1 health snapshot | 不把 L1 health 当 RCA    |
| `skill-runtime`     | `skill` / `run` | 是否触发、`attributionResolution`、outcome             | 不重算 Skill Health 窗口 |
| `tool-runtime`      | `tool` / `run`  | 超时、错误类别、循环                                   | 不重放写 Tool            |

本切片允许的 Evidence Source：

| source                 | authority                             | 一期状态                                               |
| ---------------------- | ------------------------------------- | ------------------------------------------------------ |
| `session_store`        | Session store / Session JSONL         | 可接入；只引 metadata                                  |
| `agent_runner`         | Agent runner / Plugin Hooks           | 可接入；Hook 本身非耐久库，completeness 可能 `partial` |
| `skill_invocation`     | `src/gateway/skill-invocation/`       | 已有 JSONL；必须带 `attributionResolution`             |
| `tool_runtime`         | before/after Tool Hooks               | 可接入；summary allowlist                              |
| `agent_runtime_health` | `src/gateway/agent-runtime-health.ts` | L1 snapshot only                                       |
| `route_resolution`     | `src/routing/resolve-route.ts`        | **RESERVED — 当前缺失**                                |
| `evolution_governance` | Evolution Governance receipts         | Verification 引用，不入库原始 baseline 时序            |

### 3.1 QUICK 计划（固定顺序，可提前停止）

```text
step-q1  diagnoser=trace-interaction
         evidence=session_store{messageReceived, retryCount, sessionKeyHash}
         stopWhen=messageReceived=false → BLOCKED / 超出切片
step-q2  diagnoser=agent-runtime
         evidence=agent_runner{agentStarted, agentCompleted, errorClass}
                  + optional agent_runtime_health{health} as L1 snapshot
         stopWhen=agentStarted=false 且 agent_runner 完整 → 场景 1 CONFIRMED
step-q3  diagnoser=skill-runtime
         evidence=skill_invocation{started, outcome, attributionResolution}
         stopWhen=skill.started=false 且 agent 已完成 → 场景 2 CONFIRMED（节点）
         stopWhen=attributionResolution ∉ {identity_tool_name} → 场景 5 PROBABLE
step-q4  diagnoser=tool-runtime   【仅当 skill.started=true 或 tool 候选仍活】
         evidence=tool_runtime{timeout, errorClass, latencyMs}
         stopWhen=tool.timeout=true → 场景 3 / 4
step-q5  若 agent 未启动且 agent_runner 不完整，同时缺少 route_resolution
         → 不进入 Tool；completion=INCONCLUSIVE（场景 6）
```

### 3.2 TARGETED 增量

在 QUICK 最小集之上：

1. 放大 `scope.timeRange` 以覆盖同 Case 的重试消息（场景 4 必需）。
2. 若调用方指定 `tool` Target，跳过“Tool 候选仍活”门禁，直接拉 Tool Evidence。
3. 仍 **不得** 假设 `route_resolution` 已存在；缺失则写入 `missingEvidence`。
4. 允许为 Attribution 再取一条 Skill Invocation 记录以区分 `unique_owner` 与 `prompt_named_use`，但两者都不能升为 `confirmed` identity。

---

## 4. Case 合并（重试）

合并键（`mergeKey`）由确定性规则计算，不由模型命名：

```text
tenantId
  + sessionKeyHash
  + primaryFingerprint
```

`primaryFingerprint` 一期使用 Finding `fingerprint`（稳定错误类别 + 目标类型 + 目标身份哈希），例如：

```text
skill_tool|tool_timeout|tool:tool-fixture-web-fetch|session:sha256:fixture-session-key-…
```

合并规则：

| 观察                                                                     | 行为                                                                                                |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 同一 `mergeKey` 的 tool timeout + agent failure + user retry             | **必须**落入同一 `caseId`                                                                           |
| 时间相邻的重试消息                                                       | 只生成 `correlated_with` 候选；升级为 `contributes_to` 需要规则（“超时后 N 秒内同 session 再发送”） |
| 把三次重试建成三个 Finding                                               | **禁止**                                                                                            |
| `causes` 指向三个并列根因                                                | **禁止**                                                                                            |
| 新会话、不同 `sessionKeyHash`                                            | 新 Case                                                                                             |
| 同一会话但不同稳定 fingerprint（例如随后出现独立的 skill-not-triggered） | 新 Finding，可 `correlated_with` 旧 Case，不自动吞并                                                |

场景 4 的规范图：

```text
obs.tool.timeout  --contributes_to--> obs.agent.failed
obs.agent.failed  --correlated_with--> obs.user.retry
obs.tool.timeout  --contributes_to--> obs.user.retry
obs.tool.timeout  --causes--> finding.tool_timeout_user_retry   (RULE_DERIVED, accepted)
```

只允许 **一条** `status=open` 的 primary Finding。

---

## 5. Verification 与 Evolution Governance

Diagnosis Verification **不是** 第二套 Skill 成功率仓库。

| 职责                     | 所有者                                                 | Diagnosis 允许做的事                                                   |
| ------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Skill 成功率 / 耗时窗口  | Skill Invocation 聚合、Skill lifecycle store           | 通过 Evidence 引用窗口摘要                                             |
| 治理动作、暂停、效果窗口 | Evolution Governance（`GovernanceEffectVerification`） | 保存 `governanceReceiptRef`                                            |
| 诊断是否改善             | Diagnosis Verification                                 | 用 **同一 metric 名与同一 authorityRecordId** 对比 expected / measured |
| 原始 baseline 时序       | Governance / Skill stores                              | **不复制**进 Diagnosis Journal                                         |

回执引用最低字段：`store = evolution_governance`、`receiptId`、`authority`。`measuredOutcome.value` 若出现在图中，必须同时带 `authorityRecordId`，表示该数字来自治理回执而非诊断器“重新统计”。

一期 Verification 只覆盖本切片已确认 Finding 的一次修复后窗口。`INCONCLUSIVE` Run 的 `verification` 必须为 `null`——没有根因就没有修复口径。

---

## 6. Route-resolution Evidence（预留，不假定存在）

当前源码：`resolveAgentRoute` 返回 `agentId`、`accountId`、`sessionKey`、`matchedBy`、可选 `redirectedFromAgentId`，用途是即时路由与 debug log。**没有** append-only route decision 事件，也没有稳定 locator。

因此本切片把 Adapter 定义为预留接口：

```text
RouteResolutionAdapter (RESERVED)
  evidenceType: event
  source: route_resolution
  authority: routing.resolve-route
  fields: matchedBy, agentId, accountId, sessionKeyHash, redirectedFromAgentId
  required for hypotheses: agent_not_routed, agent_misrouted
```

验收：

- Planner 可以 **请求** 该 Evidence。
- Adapter 未落地时不得生成伪造 `matchedBy` snapshot。
- 若区分 `agent_not_routed` 与 `agent_not_started` 必须依赖它，则 `completion = INCONCLUSIVE`，`missingEvidence` 含 `source: "route_resolution"`。
- 不得把 L1 `offline` 或“没有 Agent run 记录”解释成已证明未路由。

---

## 7. Phase 1 明确不包含

- `doctor-static`、`channel-delivery`、`security-posture`、`data-source`、`workflow-state` 的执行与 Fixture。
- `FULL` / `INCIDENT` 模式、跨租户编排、独立 Diagnosis 微服务。
- 图数据库、贝叶斯/无监督异常、模型生成任意 `causes`。
- Skill 触发 `openbot doctor --fix`、改配置、重启 Gateway、重放写 Tool。
- 完整 transcript / Prompt / Tool payload 入库。
- 将 `attributionResolution = unique_owner | prompt_named_use` 视为确认身份。
- 假定 `route_resolution` 事件已存在。
- 把 Verification 建成与 Evolution Governance 平行的事实库。
- UI 文案、页面路由、NLP 意图作为协议字段。

---

## 8. 场景目录

| #   | 名称                     | Fixture                                                           | mode     | completion     |
| --- | ------------------------ | ----------------------------------------------------------------- | -------- | -------------- |
| 1   | Agent 未启动             | `src/diagnosis/fixtures/agent-not-started.json`                   | QUICK    | `CONFIRMED`    |
| 2   | Skill 未触发             | `src/diagnosis/fixtures/skill-not-triggered.json`                 | QUICK    | `CONFIRMED`    |
| 3   | Skill 已触发但 Tool 超时 | `src/diagnosis/fixtures/skill-triggered-tool-timeout.json`        | QUICK    | `CONFIRMED`    |
| 4   | Tool 失败导致用户重试    | `src/diagnosis/fixtures/tool-timeout-user-retry.json`             | TARGETED | `CONFIRMED`    |
| 5   | Skill 归因不确定         | `src/diagnosis/fixtures/skill-attribution-uncertain.json`         | QUICK    | `PROBABLE`     |
| 6   | 缺少 Route Evidence      | `src/diagnosis/fixtures/inconclusive-missing-route-evidence.json` | QUICK    | `INCONCLUSIVE` |

场景 1–3、5–6 用 QUICK 即可定位节点。场景 4 必须用 TARGETED 以覆盖同 session 的重试时间窗；QUICK 可以创建 Case，但合并重试观察需要扩大 `timeRange`。

---

## 9. 场景卡片

### 9.1 场景 1 — Agent 未启动

| 项                    | 内容                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| input symptom         | 当前会话发出消息后无回复；调用方只知道 `sessionKeyHash`。                                                                                    |
| initial target        | `session` / `session-fixture-1`；parent 指向 `agent` / `agent-fixture-main`。                                                                |
| tenantId source       | 可信 `PlatformAuthSessionContext` / membership.enterpriseId。Fixture 固定 `tenant-fixture-a`。客户端提交只作意图，不得当权威。               |
| authority             | 初始 Target `session_store`；run 观察 `agent_runner`；L1 snapshot `agent_runtime_health`。                                                   |
| scope                 | `{ agentId: "agent-fixture-main", sessionKeyHash: "sha256:fixture-session-key-a…0001" }`                                                     |
| evidence requests     | `session_store`：`messageReceived`；`agent_runner`：`agentStarted`；可选 `agent_runtime_health` snapshot。                                   |
| diagnosers            | `trace-interaction` → `agent-runtime`。不调度 `tool-runtime`。                                                                               |
| expected observations | `session.message_received = true`；`agent.run.started = false`；`agent.l1_health = online`（证明 L1 ≠ RCA）。                                |
| expected assessment   | `expected_agent_not_started = anomalous`（规则 `rule.agent_run.started.v1`）。                                                               |
| confidence vector     | 四维必填：`evidence` / `assessment` / `rootCause` / `impact`。Finding 允许 `evidence` 高于 `rootCause`。                                     |
| possible hypotheses   | `agent_not_started`（supported→confirmed）。`agent_not_routed` 在缺少 Route Evidence 时 **只能 `unknown`**，禁止 `rejected` 或 `confirmed`。 |
| missing evidence      | 空。`route_resolution` 对本结论不是必需——节点已由 `agent_runner` 证明“本次未启动”。                                                          |
| completion state      | `CONFIRMED`                                                                                                                                  |
| expected finding      | `agent_not_started` / `P2` / `agent_model`；`evidenceIds` 非空；`confidence.rootCause` 可低于 `confidence.evidence`。                        |
| case merge behavior   | 新 Case；`mergedObservationPredicates` 不含 retry。同 session 再次“未启动”可按同一 fingerprint 合并，仍是一个 Finding。                      |
| verification metric   | `agent_start_rate`（治理回执口径）；修复后窗口 `gte 0.95`。                                                                                  |

### 9.2 场景 2 — Skill 未触发

| 项                    | 内容                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| input symptom         | Agent 已回复或已跑完，但期望的 Skill 没有执行痕迹。                                                                                                                                    |
| initial target        | `session` → child `run`（Agent run 存在）。                                                                                                                                            |
| tenantId source       | 可信 membership → `tenant-fixture-a`。Skill 行上的 tenant 必须与 session 对账。                                                                                                        |
| authority             | 初始 Target `session_store`；run `agent_runner`；空调用记录 `skill_invocation`。                                                                                                       |
| scope                 | `{ agentId: "agent-fixture-main", sessionKeyHash: "sha256:fixture-session-key-a…0002" }`                                                                                               |
| evidence requests     | `agent_runner`：`agentStarted, agentCompleted`；`skill_invocation`：invocation 计数与 `attributionResolution`。                                                                        |
| diagnosers            | `agent-runtime` → `skill-runtime`。                                                                                                                                                    |
| expected observations | `agent.run.started = true`；`agent.run.completed = true`；`skill.started = false`。                                                                                                    |
| expected assessment   | `expected_skill_not_started = anomalous`（`rule.skill.started.v1`）。                                                                                                                  |
| confidence vector     | 四维必填。节点 Finding：`evidence` 高、`rootCause` 可低于 evidence（未证 router 原因）。`impact` 必填。                                                                                |
| possible hypotheses   | **节点** `skill_not_triggered` 可 CONFIRMED；**原因** `skill_router_miss` / `model_did_not_select_skill` 保持 candidate（一期无独立 router 决策源；缺失字段挂在 `skill_invocation`）。 |
| missing evidence      | 可选列出 `skill_invocation` 的 `selectedSkillId` / `decisionCode` 字段（**不是**独立 catalog 源）；**不**把缺失 router 当成已证根因。                                                  |
| completion state      | `CONFIRMED`（确认“未触发”这一节点，不宣称路由规则错误）。                                                                                                                              |
| expected finding      | `skill_not_triggered` / `P2` / `skill_tool`；Attribution 指向 skill 选择域，`state = supported`，**不是** confirmed identity。                                                         |
| case merge behavior   | 新 Case。与场景 4 不同 fingerprint，不合并。                                                                                                                                           |
| verification metric   | `expected_skill_trigger_rate`（引用 Skill Invocation 窗口，不在 Diagnosis 内累加）。                                                                                                   |

### 9.3 场景 3 — Skill 已触发但 Tool 超时

| 项                    | 内容                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| input symptom         | Skill 开始了，会话仍失败 / 无最终业务结果。                                                                       |
| initial target        | `session`；QUICK 在 skill.started=true 后请求 Tool Evidence。                                                     |
| tenantId source       | 可信 membership → `tenant-fixture-a`。Skill Invocation 行上的 tenant 仅作对账。                                   |
| authority             | 初始 Target `session_store`；触发记录 `skill_invocation`；超时边界 `tool_runtime`。                               |
| scope                 | `{ agentId: "agent-fixture-main", sessionKeyHash: "sha256:fixture-session-key-a…0003" }`                          |
| evidence requests     | `skill_invocation`：`started, outcome, attributionResolution, latencyMs`；`tool_runtime`：`timeout, errorClass`。 |
| diagnosers            | `skill-runtime` → `tool-runtime`。                                                                                |
| expected observations | `skill.started = true`；`skill.attributionResolution = identity_tool_name`；`tool.timeout = true`。               |
| expected assessment   | `tool_invocation_timeout = anomalous`（`rule.tool.timeout.v1`）。                                                 |
| confidence vector     | 四维必填。`tool_timeout`：高 `evidence`/`assessment`/`rootCause`；`impact` 独立计分，不得省略。                   |
| possible hypotheses   | `tool_timeout` confirmed；`skill_logic_error` rejected（Skill 已按身份触发，失败在 Tool 边界）。                  |
| missing evidence      | 空（Tool Hook 摘要完整）。禁止写入 Tool args。                                                                    |
| completion state      | `CONFIRMED`                                                                                                       |
| expected finding      | `tool_timeout` / `P1` / `skill_tool`。                                                                            |
| case merge behavior   | 新 Case。若随后出现用户重试，**升级走场景 4 合并**，不另开根因。                                                  |
| verification metric   | `tool_timeout_rate`（同 tool 身份、同窗口口径）。                                                                 |

### 9.4 场景 4 — Tool 失败导致用户重试

| 项                    | 内容                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| input symptom         | 用户连续发送；表面上像“三次独立失败”。                                                                                                                                                                                          |
| initial target        | `session`（TARGETED，扩大 timeRange 覆盖全部重试）。                                                                                                                                                                            |
| tenantId source       | 可信 membership → `tenant-fixture-a`。重试合并键必须含同一 tenant。                                                                                                                                                             |
| authority             | 初始 Target `session_store`；失败 run `agent_runner`；超时 `tool_runtime`。                                                                                                                                                     |
| scope                 | `{ agentId: "agent-fixture-main", sessionKeyHash: "sha256:fixture-session-key-a…0004" }`；TARGETED 放大 `timeRange` 覆盖全部重试。                                                                                              |
| evidence requests     | QUICK 最小集 + `tool_runtime` + `trace-interaction.retryCount`。                                                                                                                                                                |
| diagnosers            | `trace-interaction`、`agent-runtime`、`skill-runtime`、`tool-runtime`。                                                                                                                                                         |
| expected observations | `tool.timeout = true`；`agent.run.failed = true`；`session.user_retry = true`（retryCount ≥ 2）。                                                                                                                               |
| expected assessment   | 三条观察分别评估为 anomalous，但 **只产出一个 primary Finding**。                                                                                                                                                               |
| confidence vector     | 四维必填。唯一 confirmed 假设与 Finding 必须同时给出 `evidence` / `assessment` / `rootCause` / `impact`。                                                                                                                       |
| possible hypotheses   | 唯一 confirmed：`tool_timeout_inducing_retry`。禁止并列 `user_impatience` / `agent_crash` 作为独立 RCA。                                                                                                                        |
| missing evidence      | 空。                                                                                                                                                                                                                            |
| completion state      | `CONFIRMED`                                                                                                                                                                                                                     |
| expected finding      | **恰好一条** `tool_timeout_user_retry`。                                                                                                                                                                                        |
| case merge behavior   | **一个** `caseId`；`mergedObservationPredicates` 必须同时包含 `tool.timeout`、`agent.run.failed`、`session.user_retry`。关系用 `contributes_to` / `correlated_with`，`causes` 只有一条 RULE_DERIVED accepted 边指向该 Finding。 |
| verification metric   | `user_retry_rate` **与** `tool_timeout_rate` 同一治理回执窗口；两者都改善才允许 `verdict = improved`。                                                                                                                          |

### 9.5 场景 5 — Skill 归因不确定

| 项                    | 内容                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| input symptom         | 有 Tool 调用，Skill 记录存在，但身份不是 `identity_tool_name`。                                                                                                |
| initial target        | `session` / `run`。                                                                                                                                            |
| tenantId source       | 可信 membership → `tenant-fixture-a`。两条 Skill 记录必须同一 tenant。                                                                                         |
| authority             | 初始 Target `session_store` / `run`；身份证据只认 `skill_invocation`。                                                                                         |
| scope                 | `{ agentId: "agent-fixture-main", sessionKeyHash: "sha256:fixture-session-key-a…0005" }`                                                                       |
| evidence requests     | `skill_invocation` 必须返回 `attributionResolution`（`unique_owner` 与可选 `prompt_named_use`）。                                                              |
| diagnosers            | `skill-runtime`。                                                                                                                                              |
| expected observations | `skill.started = true`；`skill.attributionResolution = unique_owner`（及一条 `prompt_named_use` 对照）。                                                       |
| expected assessment   | `skill_identity_unconfirmed = unknown`（不是 anomalous-as-confirmed）。                                                                                        |
| confidence vector     | 四维必填。`PROBABLE` Finding 的 `rootCause` 必须低于 `evidence`；`impact` 仍必填，不得省略。                                                                   |
| possible hypotheses   | `skill_owned_by_unique_owner` = supported；`skill_named_in_prompt` = candidate。**均不得 confirmed。**                                                         |
| missing evidence      | `identity_tool_name` 级身份（显式 tool 身份字段）。                                                                                                            |
| completion state      | `PROBABLE`                                                                                                                                                     |
| expected finding      | `skill_attribution_uncertain` / `P3` / `skill_tool`；Attribution `state = suspected`，`basis = ownership_map` 或 `model_suggestion`，禁止 `runtime_identity`。 |
| case merge behavior   | 新 Case。不得与“已确认 Skill X 失败”的 Case 合并。                                                                                                             |
| verification metric   | `skill_identity_confirmation_rate`（`identity_tool_name` 占比）；治理侧改善归因，不由 Diagnosis 重放 Tool。                                                    |

### 9.6 场景 6 — 缺少 Route Evidence → INCONCLUSIVE

| 项                    | 内容                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| input symptom         | 消息已进入会话，之后无 Agent 回复；调用方怀疑“没路由到 Agent”。                                                                                              |
| initial target        | `session`。                                                                                                                                                  |
| tenantId source       | 可信 membership → `tenant-fixture-a`。无 Route Evidence 时仍必须有可信 tenant，不得从客户端猜。                                                              |
| authority             | 初始 Target `session_store`。`route_resolution` 当前 **MISSING**，不得用 runner 空记录冒充。                                                                 |
| scope                 | `{ sessionKeyHash: "sha256:fixture-session-key-a…0006" }`                                                                                                    |
| evidence requests     | `session_store`；`agent_runner`（可能 partial / 缺失）；**请求** `route_resolution`。                                                                        |
| diagnosers            | `trace-interaction` → `agent-runtime`。**停止**，不调度 Skill/Tool。                                                                                         |
| expected observations | `session.message_received = true`；`agent.run.present = unknown` 或 runner 记录不完整。                                                                      |
| expected assessment   | `session_failure_locus = unknown`。                                                                                                                          |
| confidence vector     | 四维必填。两条未知假设 `rootCause = 0` 且 `impact` 仍必须给出（可为 0）。禁止编造 RCA 分数。                                                                 |
| possible hypotheses   | `agent_not_routed` = unknown；`agent_not_started` = unknown。二者无法区分。                                                                                  |
| missing evidence      | **必须**包含 `source: "route_resolution"` 的 required `EvidenceRequirement`。可并列 `agent_runner` completeness。                                            |
| completion state      | `INCONCLUSIVE`                                                                                                                                               |
| expected finding      | **禁止** primary RCA Finding；`findings` 为空，或仅存在 `primaryDomain = unknown` 且 `confidence.rootCause = 0` 的非根因记录。Fixture 选择 **空 findings**。 |
| case merge behavior   | 仍创建 Case 以便追踪缺失证据；不得把后续场景 1 的 CONFIRMED 结果在未补证据前合并成“已证未路由”。                                                             |
| verification metric   | **无。** `verification = null`。补齐 route Evidence 之前不允许修复验证。                                                                                     |

---

## 10. 关系与完成状态门禁（验收）

| 规则                                      | 测试锚点                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 缺 `route_resolution` 且无法区分路由/启动 | Fixture 6：`run.completion === "INCONCLUSIVE"`                                                                         |
| `MODEL_INFERRED` + `causes` + `accepted`  | validators 抛错（测试构造，不进 golden fixture）                                                                       |
| Finding 必须引用 Evidence                 | 场景 1–5 的每条 Finding `evidenceIds.length ≥ 1` 且 ID 存在                                                            |
| confidence 字段独立                       | 同一 Hypothesis/Finding 允许 `evidence=0.99` 且 `rootCause=0.71`                                                       |
| 过期 locator                              | 测试构造 `expiresAt` 过去 + `completeness∈{complete,partial,unknown}` → `source_expired`；只有 `source_expired` 可通过 |
| 诊断不写运行事实                          | `mutationPolicy ∈ {READ_ONLY, SUGGEST}`；`assertNoRuntimeFactMutation`（若导出）                                       |
| 无 UI/NLP 依赖                            | 图与协议字段不含页面/意图/Prompt；合同可在无 UI 进程运行                                                               |
| Case 合并                                 | Fixture 4：单一 `caseId` 覆盖 timeout + failure + retry                                                                |
| 归因不确定                                | Fixture 5：`unique_owner` / `prompt_named_use` 的 Attribution 不是 `confirmed` / `runtime_identity`                    |

---

## 11. 实现就绪说明（给 Phase 1）

**Phase 0 完成 ≠ Diagnosis Platform 完成。** 协议与 Fixture 只是一期输入，不是平台已交付。在验收团队复验通过之前，**不得**按“Phase 0 完成”开工一期 runtime：

1. Diagnoser Registry 先注册 `trace-interaction`、`agent-runtime`、`skill-runtime`、`tool-runtime`。
2. Evidence Catalog 必须包含 `route_resolution` 行，状态标记 reserved/unavailable。
3. Skill Adapter 透传 `attributionResolution`，禁止默认填 `identity_tool_name`。
4. Case merger 按 §4 `mergeKey` 实现；场景 4 是强制回归。
5. Verification writer 只写 `governanceReceiptRef`，读取 Evolution Governance 已持久化的 `GovernanceEffectVerification.id`。
6. `INCONCLUSIVE` 是成功完成态：`status=completed` 且 `completion=INCONCLUSIVE`。
7. 关闭诊断开关后，消息主链与 Skill Invocation 语义必须不变——本切片不修改那些模块。

阻塞：`src/diagnosis/types.ts` 由 Protocol Engineer 冻结 validators。本目录 Fixture 按父方案 §4 编写；`scenarios.test.ts` 从 `./types.js` 导入，不在测试文件内伪造类型实现。
