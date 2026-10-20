# OpenBot Diagnosis Platform — Evidence Adapter 矩阵

Date: 2026-09-02

Status: **Phase 0 设计 — 只读接口与映射，不实现 adapter，不改主链。Phase 0 完成 ≠ Diagnosis Platform 完成。**

Audience: Gateway、Agent Runtime、Skill Governance、Security、Protocol Engineer、Scenario Designer

Task: `openbot-diagnosis-platform`

Related:

- [Authority of Record](/design/openbot-diagnosis-authority-of-record-2026-09-02)
- [Diagnosis Platform 实施方案](/design/openbot-diagnosis-platform-implementation-plan-2026-09-02)

---

## 0. 设计不变量

Adapter **不拥有**事实。每个 adapter 把既有权威记录映射为 `DiagnosticEvidence` 摘要 + locator。禁止：

- 新建平行事件总线或 Skill 成功率库
- 把 `src/infra/diagnostic-events.ts` 当成耐久 Evidence Store
- 复制 OTEL / transcript / Tool payload 全文
- 继承 Doctor `--fix`、Channel restart、Governance pause/redirect
- 信任客户端 `tenantId`
- Phase 0 改聊天主链（允许范围见 §0.1）

失败语义（协议层，Phase 0 只设计）：

- Adapter 失败 **不得** 阻塞聊天主链（fail-open）。
- Diagnosis Journal 写失败 **禁止 fail-silent**：必须计数、可观测、有界重试。
- 现有模块里 listener `catch` 后忽略（`diagnostic-events.ts`、`transcript-events.ts`、skill-invocation 多处 best-effort）**不得**被 Diagnosis 解释为“已采集”。

### 0.1 Phase 0 允许的代码形态（本角色不写）

Protocol Engineer 可以在 `src/diagnosis/**` 落地：新类型 / 校验、脱敏 fixture、只读 adapter **接口**、预留 route-resolution Evidence 接口。

**不允许**：改 `resolveAgentRoute` 调用方、改 doctor 修复路径、改 channel monitor、改 plugin hook 热路径、改 skill-invocation 写入。

若发现必须改主链才能诚实诊断，见 §5——只报告。

### 0.2 Evidence 输出公共形状

映射目标对齐实施方案 `DiagnosticEvidence`：

```text
evidenceType, source, authorityRecordId, observedAt, target,
trace?, summary, payloadRef?, integrity?, collection, privacy
```

`collection.method` 对本矩阵：`event_adapter` | `query` | `snapshot`。  
`collection.completeness`：现网绝大多数为 `partial` 或 `unknown`，禁止默认 `complete`。  
`collection.attributionResolution`：Skill 行必填或显式 `unknown`。

---

## 1. Adapter 逐项

### 1.1 Diagnostic Event Adapter

| 字段                    | 设计                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source module           | `src/infra/diagnostic-events.ts`：`emitDiagnosticEvent` / `onDiagnosticEvent` / `DiagnosticEventPayload`。**不是**权威库。OTEL 已是一个 listener（`extensions/diagnostics-otel/src/service.ts`）。                                                                                                                                                                                |
| input shape             | 联合：`model.usage`、`webhook.received`/`processed`/`error`、`message.queued`/`processed`、`session.state`/`session.stuck`、`queue.lane.enqueue`/`dequeue`、`run.attempt`、`diagnostic.heartbeat`、`tool.loop`。公共字段：`ts`、`seq`（进程内单调，重启归零）。                                                                                                                   |
| evidence output mapping | `source="diagnostic-events"`。`evidenceType`：`run.attempt`→`event`；`session.stuck`/`session.state`→`event`；`model.usage`→`metric`；`tool.loop`→`event`；heartbeat/queue→`metric`。`summary` 只留 type、sessionKey/sessionId（若有）、runId、outcome、durationMs、toolName、detector。`collection.method="event_adapter"`。`completeness="unknown"`（重启即丢，且无持久 seq）。 |
| stable locator          | **没有跨进程稳定 locator。** 进程内可用 `seq@pid@startedAt` 作调试，**不得**写入需要重启后验证的 `authorityRecordId`。重启后相关 Evidence 必须 `source_expired` 或根本不声明权威。                                                                                                                                                                                                |
| redaction strategy      | 不复制 `error` 原文以外的自由文本；`chatId` 哈希或省略。`tool.loop.message` 截断并脱敏。                                                                                                                                                                                                                                                                                          |
| failure semantics       | 现网 listener 异常被模块吞掉。Adapter 若接入：自己的错误记 Diagnosis 可观测计数；**不得** throw 回 `emitDiagnosticEvent`。不得把“listener 没挂上”当成无事件。                                                                                                                                                                                                                     |
| Phase 1 safe?           | **有条件。** 可作 **采集入口**（尤其 `run.attempt`、`session.stuck`、`tool.loop`），但必须立刻写入 Diagnosis Journal 才可能回放。关闭诊断后不得改变 emit 行为。                                                                                                                                                                                                                   |
| required code change    | Phase 0：只读接口 + 类型映射。Phase 1：Journal 订阅（Diagnosis 进程内），**禁止**把 durability 补进 `diagnostic-events.ts`（那会变成第二权威）。 Phase 0 完成 ≠ Diagnosis Platform 完成。                                                                                                                                                                                         |

### 1.2 Plugin Hook Adapter

| 字段                    | 设计                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source module           | `src/plugins/types.ts`：`PluginHookName` / `PluginHookHandlerMap`。一期相关：`before_agent_start`、`llm_input`、`llm_output`、`agent_end`、`before_tool_call`、`after_tool_call`、`session_start`、`session_end`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| input shape             | `PluginHookBeforeAgentStartEvent` `{ prompt, messages? }` + `PluginHookAgentContext` `{ agentId?, sessionKey?, sessionId?, trigger?, channelId? }`。`PluginHookLlmInputEvent` `{ runId, sessionId, provider, model, systemPrompt?, prompt, historyMessages, imagesCount }`。`PluginHookLlmOutputEvent` `{ runId, sessionId, provider, model, assistantTexts, lastAssistant?, usage? }`。`PluginHookAgentEndEvent` `{ messages, success, error?, durationMs? }`（**无 runId**）。`PluginHookBeforeToolCallEvent` `{ toolName, params, runId?, toolCallId? }`。`PluginHookAfterToolCallEvent` 另加 `result?`、`error?`、`durationMs?`。`PluginHookToolContext` 含 `agentId?`、`sessionKey?`、`sessionId?`、`runId?`。 |
| evidence output mapping | Agent：`source="plugin-hook"`，`summary` = `{ hook, agentId, sessionKey, sessionId, runId, success, durationMs, provider, model, imagesCount, usageTotal }`。Tool：`summary` = `{ hook, toolName, runId, toolCallId, durationMs, blocked?, errorClass }`。**不**映射 prompt / messages / params / result 全文。`agent_end` 缺 `runId` → `completeness="partial"`，用 sessionKey+时间窗弱关联。                                                                                                                                                                                                                                                                                                                      |
| stable locator          | `runId` + `toolCallId`（优先）；否则 `sessionId` + `hook` + `observedAt`。Hook 本身无 durable id。Journal 成功后 locator 指向 Journal `evidenceId`，`payloadRef` 仍指向 Session/Skill 权威（若有）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| redaction strategy      | Drop：`prompt`、`systemPrompt`、`historyMessages`、`assistantTexts`、`messages`、`params`、`result`。Allowlist 参数键（例如 skill id 字段名）可进 summary，值需截断。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| failure semantics       | Adapter 必须注册为 **只观察** handler：不返回 `modelOverride` / `block` / `params` 改写。自身异常不得传播到 agent 主链。未订阅 ≠ 无 LLM/Tool 发生。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Phase 1 safe?           | **是（只读订阅 + Journal）。** 对应一期 `Session → Agent → Skill → Tool` 的 Agent/Tool 边。关闭诊断 = 不注册 handler。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| required code change    | Phase 0：接口。Phase 1：在现有 plugin hook 分发点 **追加** 只读 listener（若当前没有稳定的全局 tap，属于主链发现，见 §5）。不得为了诊断去改 prompt/tool 语义。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### 1.3 Session Transcript Adapter

| 字段                    | 设计                                                                                                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source module           | 权威文件：`src/config/sessions/paths.ts`（`resolveSessionFilePath`、`resolveSessionTranscriptsDirForAgent`）。索引：`SessionEntry`（`src/config/sessions/types.ts`），`sessions.json`。通知：`src/sessions/transcript-events.ts` `{ sessionFile }`。                                    |
| input shape             | JSONL 行（Pi/`AgentMessage` 形态，经 `before_message_write` 可能被改/阻断）。`SessionEntry`：`sessionId`、`sessionFile?`、`updatedAt`、`channel?`、`lastChannel?`、`lastTo?`、`lastAccountId?`、`deliveryContext?`、token 字段等。通知事件 **只有路径**。                               |
| evidence output mapping | `evidenceType="transcript_ref"`。`source="session-jsonl"`。`summary`：`{ sessionId, agentId, messageCount?, lastRole?, hasToolMessages?, abortedLastRun? }`。正文走 `payloadRef` 指向文件，不进 Diagnosis Store。`transcript-events` 只触发 **invalidate/reindex**，不单独当 Evidence。 |
| stable locator          | `store=session-jsonl; agentId; sessionId; sessionFile; line=N \| byteOffset; contentHash`。路径必须经 `resolveSessionFilePath`，禁止调用方拼绝对路径。archive 后缀（`src/config/sessions/artifacts.ts`）→ `source_expired`。                                                            |
| redaction strategy      | 默认不读全文。QUICK 模式先读 metadata（`SessionEntry`）。需要消息摘要时：strip inbound 身份、电话、token、工具参数；只保留 role + 长度 + 时间。                                                                                                                                         |
| failure semantics       | 文件缺失 / 权限错误 → `completeness="unknown"`，不合成空会话成功。`sessionFile` stale 时 resolver 会静默回退——Adapter 必须记录“used fallback path”。读失败不阻断聊天（聊天不走这条 query）。                                                                                            |
| Phase 1 safe?           | **是（只读 query）。** 一期 Session Target 的主权威。                                                                                                                                                                                                                                   |
| required code change    | Phase 0：locator 类型 + 脱敏 fixture。Phase 1：只读打开已有路径。**不要**给 `transcript-events` 加持久化。                                                                                                                                                                              |

### 1.4 Skill Invocation Adapter

| 字段                    | 设计                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source module           | 读取：`src/gateway/skill-invocation/event-store.ts`（`readSkillInvocationEvents`、`appendSkillInvocationEvent`）。类型：`SkillInvocationStartedEvent` / `SkillInvocationCompletedEvent`（`types.ts`）。**幂等、归因、best-effort `try/catch`：`record.ts`**（`seen-invocation-ids.json` / `open-started.json`）。`event-store.ts` 只 append/read JSONL，不实现幂等。                                                                                                                                          |
| input shape             | 公共：`invocationId`、`skillId`、`skillVersion`、`agentId`、`tenantId`、`userId`、`startedAt`、`runId`、`sessionKey`、`toolCallId?`、`toolName?`、`attributionResolution?`。Completed 另加 `completedAt`、`outcome`、`latencyMs`、`failureCategory`、`businessOutcome`。                                                                                                                                                                                                                                      |
| evidence output mapping | `source="skill_invocation"`（snake_case catalog id，禁止 `skill-invocation`）。`evidenceType="event"`。`authorityRecordId=invocationId`。`summary`：skillId、skillVersion、outcome、latencyMs、failureCategory、toolName、runId、sessionKey、attributionResolution。`businessOutcome` **映射为 `attributionHint` 或忽略**，禁止写成业务成功。`collection.attributionResolution` 原样或 `unknown`；skill 源禁止 `not_applicable`。started 无 completed → 观察 `skill.started` 仍为 open，不得 invent failure。 |
| stable locator          | `store=skill_invocation_jsonl; invocationId`。文件：`CONFIG_DIR/skill-invocation-events/events.jsonl`。幂等键同一 `invocationId`，由 **`record.ts`** 维护（seen/open 文件只服务写入，不当时序权威）。                                                                                                                                                                                                                                                                                                         |
| redaction strategy      | 事件默认已无 payload。`userId` 仅在授权 scope 内进入 summary。                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| failure semantics       | 读：坏行 skip。写：主链 best-effort catch → Adapter **查询时**把“应有 invocation 但 JSONL 无行”标为 `missingEvidence` / `completeness=partial`，不得补写权威文件。Journal 索引失败走 Diagnosis 可观测通道。                                                                                                                                                                                                                                                                                                   |
| Phase 1 safe?           | **是。** 一期 Skill 事实源。必须展示归因 caveat。                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| required code change    | Phase 0：无主链。Phase 1：只读 `readSkillInvocationEvents`（可加过滤参数，但不改 JSONL schema）。禁止“为了完整率”去掉 best-effort catch（那是主链策略，另案）。                                                                                                                                                                                                                                                                                                                                               |

### 1.5 Agent Health Adapter

| 字段                    | 设计                                                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source module           | `src/gateway/agent-runtime-health.ts`（`AgentRuntimeHealthFacts`、`AgentRuntimeHealthReport`、`computeAgentRuntimeHealth`）。采集：`src/gateway/agent-runtime-health-collect.ts`。                                                      |
| input shape             | Facts：`{ agentId, modelConfigured, boundChannels: [{ channelId, accountId, connected }] }`。Report：`health: "online"\|"degraded"\|"offline"\|"unconfigured"` + `reasons[]`。                                                          |
| evidence output mapping | `evidenceType="snapshot"`。`source="agent-runtime-health"`。`summary`：health、modelConfigured、boundChannelCount、connectedChannelCount、reasons。`collection.method="snapshot"`。明确 **L1 only**：不产生 `causes` 到某次 Tool 失败。 |
| stable locator          | `agentId` + `observedAt` + facts hash。无历史 store。                                                                                                                                                                                   |
| redaction strategy      | 不需要账号密钥；`accountId` 保持内部 id。                                                                                                                                                                                               |
| failure semantics       | 采集 IO 失败应产出 `health` 未知类 Observation，而不是沿用过期 snapshot 当新事实。不阻断聊天。                                                                                                                                          |
| Phase 1 safe?           | **只读安全，但不在一期垂直切片必选。** 实施方案 Phase 1 不含 Runtime Diagnoser。可作可选 L1 背景，不得单独结案。                                                                                                                        |
| required code change    | 无主链。Phase 2 再接 `runtime-health` Diagnoser。                                                                                                                                                                                       |

### 1.6 Channel Health Adapter

| 字段                    | 设计                                                                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source module           | 评估：`src/gateway/channel-health-policy.ts`（`evaluateChannelHealth` → `ChannelHealthEvaluation`）。监视器：`src/gateway/channel-health-monitor.ts`（**含重启**）。快照：`ChannelHealthSnapshot`。                                                                              |
| input shape             | Snapshot：`running`、`connected`、`enabled`、`lastEventAt`、`busy`、`activeRuns` 等。Evaluation：`{ healthy, reason }`，reason 含 `stale-socket` / `disconnected` / `stuck` / `not-running` 等。                                                                                 |
| evidence output mapping | **只映射 `evaluateChannelHealth` 的只读结果 + snapshot 时间戳。** `source="channel-health-policy"`。`summary`：channelId、accountId、healthy、reason、running、connected、lastEventAt。**禁止**映射 monitor 的 restartRecords 为“修复已执行”，除非另有独立 receipt（今天没有）。 |
| stable locator          | `channelId` + `accountId` + `observedAt`。                                                                                                                                                                                                                                       |
| redaction strategy      | `chatId` 不从 webhook 旁路默认带入。                                                                                                                                                                                                                                             |
| failure semantics       | Adapter **不得**调用 `startChannel`/`stopChannel`。评估函数纯；snapshot 缺失按 policy 视为不健康，需在 Evidence 标明 `snapshotMissing`。                                                                                                                                         |
| Phase 1 safe?           | **只读评估：安全。Monitor 路径：BLOCKED。** 一期不交付 Channel Diagnoser。                                                                                                                                                                                                       |
| required code change    | 无。若未来要“重启回执”，那是 Channel 域的 receipt，不是 Diagnosis 执行。                                                                                                                                                                                                         |

### 1.7 Route Resolution Adapter

| 字段                    | 设计                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source module           | `src/routing/resolve-route.ts`：`ResolveAgentRouteInput`、`ResolvedAgentRoute`（`matchedBy`、`agentId`、`sessionKey`、`accountId`、`redirectedFromAgentId?`）。                                                                                                                                                                                                                                                                           |
| input shape             | 今天只有 **函数返回值**。没有 event type、没有 JSONL、没有 `routeDecisionId`。                                                                                                                                                                                                                                                                                                                                                            |
| evidence output mapping | **预留接口，不得对现网数据宣称 Evidence 完整。** 预留 `evidenceType="event"`，`source="route_resolution"`（snake_case catalog id，禁止 `route-resolution`），`summary`：`{ matchedBy, agentId, accountId, sessionKey, redirectedFromAgentId, channel }`。在耐久记录出现前，Adapter 的 query 必须返回 **empty + missing requirement** `route_resolution`，而不是把当次热路径调用结果写进历史 Case（热路径调用会改变“回放”语义，且无 id）。 |
| stable locator          | 预留 `routeDecisionId`。**当前实现：无。**                                                                                                                                                                                                                                                                                                                                                                                                |
| redaction strategy      | `peer.id` / `memberRoleIds` / `guildId` 默认不进 summary；需要时哈希。                                                                                                                                                                                                                                                                                                                                                                    |
| failure semantics       | `resolveAgentRoute` 总返回 default 匹配——Adapter 不得把 default 解释为“路由成功且用户意图已满足”。无记录时 completion 走 `INCONCLUSIVE`。                                                                                                                                                                                                                                                                                                 |
| Phase 1 safe?           | **接口预留：是。宣称有 Evidence：否。** 一期规则“收到消息但未路由”依赖主链补点（§5）。                                                                                                                                                                                                                                                                                                                                                    |
| required code change    | Phase 0：**仅类型/接口**。任何在 `resolveAgentRoute` 成功路径上的 emit/append 都是 **主链变更**，本阶段不实施。                                                                                                                                                                                                                                                                                                                           |

### 1.8 Doctor Check Adapter

| 字段                    | 设计                                                                                                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source module           | **只读：** `src/diagnosis/doctor-check-contract.ts`（`runDoctorChecks`）。**修复（非 Diagnosis）：** `src/commands/doctor.ts` + `--fix`/`--repair`/`--yes`。4.4 Case 聚合 / Graph 在 `src/diagnosis/cross-target.ts` 与 `graph.ts`（只读、进程内）。 |
| input shape             | 只读合同：`DoctorCheckInput`（`config` + 可选 `env` / `configPath`）。禁止 `repair`/`fix`/`yes`。CLI 仍用 `DoctorOptions`；`shouldRepair = repair \|\| yes`。                                                                                        |
| evidence output mapping | `evidenceType="config_check"`，`source="doctor_check"`，`summary`：`{ checkId, verdict, pathLabel }`。禁止把 CLI doctor 入口的执行结果当 Evidence。                                                                                                  |
| stable locator          | `checkId` + `pathLabel`。凭据与 allowFrom 不得进 summary。                                                                                                                                                                                           |
| redaction strategy      | 禁止把 allowFrom 列表、token、凭据路径写入 Evidence。                                                                                                                                                                                                |
| failure semantics       | Adapter 若收到 `repair`/`fix`/`yes` 必须抛错。不得 import 修复执行器或写 Config Store。                                                                                                                                                              |
| Phase 1 safe?           | **否（一期切片不含 Doctor）。** Phase 2 只读 Diagnoser `doctor-static` 不得进入 QUICK。                                                                                                                                                              |
| required code change    | **4.3 已拆分并集成。4.4 已落地只读聚合/Graph。** 不改 `doctor --fix` 语义。不接生产主链。                                                                                                                                                            |

### 1.9 OTEL Reference Adapter

| 字段                    | 设计                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source module           | `extensions/diagnostics-otel/src/service.ts`。输入是 `DiagnosticEventPayload` 子集（无 `tool.loop` 分支）。导出 OTLP。                                                                  |
| input shape             | 无本地 Trace 查询 API。最多有外部 `traceId`/`spanId`（若 SDK 与采样产生了 span）。配置：`diagnostics.otel.endpoint` 等。                                                                |
| evidence output mapping | `evidenceType="event"` 或 trace 引用。`source="otel-reference"`。`trace={ traceId, spanId }`。`payloadRef.store="otel"`。`summary` 仅资源名与时间。**禁止**批量 pull 后写入 Diagnosis。 |
| stable locator          | `traceId` + `spanId` + backend 配置键。无 id → 不生成 Trace Evidence。                                                                                                                  |
| redaction strategy      | 已有 `redactSensitiveText`；Diagnosis 仍不得存未红acted 属性。                                                                                                                          |
| failure semantics       | OTEL 未启用 = 无 Trace Evidence，不是系统故障。导出失败不影响聊天。                                                                                                                     |
| Phase 1 safe?           | **引用形态安全，但不在一期必选。** 一期不复制、不依赖外部 backend 可用性结案。                                                                                                          |
| required code change    | 无。禁止为 Diagnosis 打开“全量导出入库”。                                                                                                                                               |

### 1.10 Evolution Governance Verification Adapter

| 字段                    | 设计                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| source module           | `src/gateway/evolution-governance/persistent-store.ts`：`GovernanceEffectVerification`、`readGovernancePersistedState`。Tick 消费者：`tick-pipeline.ts`（读 Skill Invocation / Skill Health）。动作执行：`runtime-actions.ts`（**不要**从 Diagnosis 调用）。                                                 |
| input shape             | `GovernanceEffectVerification`：`id`、`assetId`、`runtimeAgentId`、`reason`、`pausedAt`、`verifyAfterAt`、`baseline`（skillSuccessRate、invocationCount7d 等）、`status` `"open"\|"resumed"\|"held"\|"escalated"`、`outcomeNote?`。                                                                          |
| evidence output mapping | `source="evolution-governance-verification"`。`evidenceType="snapshot"`。`summary`：id、runtimeAgentId、status、baseline 数字、verifyAfterAt。Diagnosis Verification 对象 **引用** 该 id，自己保留 expected/measured/verdict。measured 必须再查 Skill Invocation，**不要**信 Governance 自己重算的第二口径。 |
| stable locator          | `store=evolution-governance; id`（`CONFIG_DIR/evolution-governance/state.json`）。                                                                                                                                                                                                                           |
| redaction strategy      | 无用户正文。`reason` 截断。                                                                                                                                                                                                                                                                                  |
| failure semantics       | 读文件失败模块返回默认空——Adapter 必须区分“无 verification”与“store 不可读”（后者 `completeness=unknown`）。禁止为了补数据去跑 tick。                                                                                                                                                                        |
| Phase 1 safe?           | **只读 verification 引用：有条件可用**（一期闭环需要一次 Verification 时）。当作事实仓库或触发 pause：**BLOCKED**。                                                                                                                                                                                          |
| required code change    | 无主链。禁止 Diagnosis 调 `applyGovernanceRuntimeAction`。                                                                                                                                                                                                                                                   |

---

## 2. Phase 1 安全性总表

| Adapter                                   | Phase 1                | 条件                                            |
| ----------------------------------------- | ---------------------- | ----------------------------------------------- |
| Skill Invocation Adapter                  | **安全**               | 只读 JSONL；展示归因                            |
| Session Transcript Adapter                | **安全**               | 只读路径解析；引用式；脱敏                      |
| Plugin Hook Adapter                       | **安全（只读）**       | 不返回 mutation 字段；Journal 可观测            |
| Diagnostic Event Adapter                  | **有条件**             | 仅 ingress + Journal；不当 Store                |
| Evolution Governance Verification Adapter | **有条件**             | 只读 effect 行；指标回 Skill Invocation         |
| Agent Health Adapter                      | 可选 L1，非切片必须    | 只读 snapshot                                   |
| Channel Health Adapter                    | 只读评估可，切片不交付 | **禁止** monitor 重启                           |
| Route Resolution Adapter                  | 仅预留接口             | 无耐久记录则 missing                            |
| OTEL Reference Adapter                    | 非必须                 | 只引用，不复制                                  |
| Doctor Check Adapter                      | **只读合同安全**       | 仅 `runDoctorChecks`；repair/fix 不是 Diagnosis |

---

## 3. 重叠与副作用矩阵

### 3.1 数据重叠（谁读谁，谁不准写）

| 模块 A                 | 模块 B                   | 重叠内容                   | Adapter 规则                                                                                                              |
| ---------------------- | ------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Skill Invocation       | Skill Health             | 成功/失败/耗时             | 事件权威 = Invocation；Health 只作窗口 snapshot。禁止双计。                                                               |
| Skill Invocation       | Evolution Governance     | 同一 JSONL 被 tick 聚合    | Governance 是消费者。Verification Adapter 引用 receipt，不复制 anomalies 当 Skill Evidence。                              |
| Skill Health           | Governance tick          | successRate / latency 阈值 | 两者都是派生。Diagnosis baseline 以 Invocation 重聚为准，Health 仅交叉检查。                                              |
| Plugin Tool hooks      | Skill Invocation         | 同一次 tool 调用           | Tool Evidence 来自 Hook/JSONL 摘要；Skill Evidence 来自 invocation 行。用 `toolCallId`+`runId` 关联，不要变两个无关根因。 |
| Plugin LLM hooks       | diagnostic `model.usage` | token / duration           | 权威观察优先 Hook 信封或 Session；usage 事件作 metric 旁路。                                                              |
| Session JSONL          | transcript-events        | 同一文件                   | 权威是文件；events 只是 dirty 通知。                                                                                      |
| Session JSONL          | Agent/Tool hooks         | 消息正文                   | 正文权威是 JSONL；Hook 提供 runId 关联。                                                                                  |
| Agent Health           | Channel Health           | 渠道 connected             | Agent 用 binding×snapshot 做 L1；Channel 用 policy reason。可 `correlated_with`，不得自动 `causes`。                      |
| Channel webhook events | Channel Health           | 收包/错误                  | webhook 事件无稳定 session 关联。不要当投递 RCA。                                                                         |
| Doctor                 | Security audit           | 网关暴露、token、权限      | 同一姿态最多一个 Finding fingerprint。Doctor Adapter 未拆分前两者都不要进一期。                                           |
| Doctor `--fix`         | Security `--fix`         | 写 config / chmod          | 都是 Remediation 执行域，不是 Adapter。                                                                                   |
| Route resolve          | Governance redirect      | `redirectedFromAgentId`    | 路由权威仍 MISSING。redirect 是治理动作副作用。                                                                           |
| diagnostic-events      | OTEL                     | 同一进程内扇出             | 一个 emit，两个消费者。Diagnosis 可再订一份，但三人不得各建 Store。                                                       |
| Billing domain events  | （无工作流事件）         | 不重叠                     | 禁止当 Business Event Adapter。                                                                                           |

### 3.2 现网副作用（Adapter 禁入）

| 模块                                         | 变异                                                                                                  | Diagnosis            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------- |
| `channel-health-monitor.ts`                  | `stopChannel` + `startChannel`，小时重启上限                                                          | 禁止调用             |
| `doctorCommand` + `--repair`/`--fix`/`--yes` | 写 config、bak、allowFrom、pairing、launchd、cron、locks、凭据删除、service token、sandbox、migration | 禁止调用             |
| `doctor-gateway-daemon-flow.ts`              | `repairLaunchAgentBootstrap`                                                                          | 禁止                 |
| `src/security/fix.ts`                        | chmod / icacls / configWritten                                                                        | 禁止                 |
| `applyGovernanceRuntimeAction`               | pause / resume / limit / redirect bindings                                                            | 禁止                 |
| `before_tool_call` 返回值                    | 改 params / block                                                                                     | Adapter 不返回       |
| `before_agent_start` 返回值                  | model/prompt override                                                                                 | Adapter 不返回       |
| `message_sending`                            | cancel / 改 content                                                                                   | Adapter 不返回       |
| `before_message_write`                       | block 写 JSONL                                                                                        | Adapter 不返回       |
| `tool.loop` action=block                     | 运行时熔断                                                                                            | 只观察               |
| `recordSkillInvocationCompleted`             | 写 JSONL + health/stats                                                                               | Adapter 只读；不补写 |
| OTEL exporter                                | 出站网络                                                                                              | 可并存，不入库复制   |

---

## 4. 标识映射（Adapter 必须遵守）

| 字段                    | 来源                                                 | 规则                                                                                                         |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `tenantId`              | `PlatformAuthSessionContext`（`session-context.ts`） | 只从可信 session 填。Skill 行上的 `tenantId` 可引用但要与 session 对账；不一致 → partial。客户端请求体忽略。 |
| `sessionKey`            | Route 返回值 / Hook ctx / Skill 行                   | 与 `sessionId` 同时记录。                                                                                    |
| `sessionId`             | Hook / SessionEntry / JSONL 文件名                   | `/reset` 后旧 locator `source_expired`。                                                                     |
| `runId`                 | LLM/Tool hooks、Skill 行、`run.attempt`              | 与 `DiagnosticRun.runId` 分家。`agent_end` 无此字段。                                                        |
| `invocationId`          | Skill JSONL                                          | 幂等键。                                                                                                     |
| `toolCallId`            | Hook + Skill 行                                      | 关联 Tool↔Skill。                                                                                            |
| `attributionResolution` | Skill 行或 `unknown`                                 | `prompt_named_use` 可能只在 `businessOutcome` / id 后缀。                                                    |
| `routeDecisionId`       | **不存在**                                           | 预留。                                                                                                       |

---

## 5. 需要主链才能诚实工作的发现（报告，不实现）

1. **Route-resolution Evidence 不存在。** 一期“消息已收到但未路由”规则无法被 Evidence 证明，只能 `INCONCLUSIVE`，除非在 `resolveAgentRoute` 热路径增加结构化耐久记录。这是主链变更。
2. **`agent_end` 无 `runId`。** Plugin Hook Adapter 无法把结束事件与 `llm_input` 严格对齐，除非主链补字段或保证同一 context 对象。
3. **Hook 没有官方“只观察总线”。** 若只能通过 `api.on(hook)` 插件注册，Diagnosis 需要一个稳定、可关闭、不改返回值的 tap。若现有分发不允许无返回 listener 安全失败，属于主链/插件运行时工作。
4. **Doctor 检查与修复未拆分。** Doctor Check Adapter 在抽出只读函数前不能接。拆分是 CLI 主链。
5. **diagnostic-events / transcript-events fail-silent。** Diagnosis 若只挂 listener 而不写 Journal，重启与 listener 异常都会丢证据。补 Journal 是 Diagnosis 范围；把这两文件改成耐久总线 **不批准**。
6. **Skill 写入 best-effort。** 提高 Skill JSONL 完整率要改 `record.ts` 的 catch 策略，属主链，不在 Phase 0。
7. **`prompt_named_use` 不写 `attributionResolution`。** 若产品打开该环境变量，要么主链补字段，要么 Adapter 用约定解析并标弱归因。
8. **Channel 重启无 receipt。** 若 Verification 要证明“重启后恢复”，Channel 域需动作回执；今天没有。不要用 monitor 内存 map 冒充。

---

## 6. Phase 0 交付边界

**Phase 0 完成 ≠ Diagnosis Platform 完成。** 本文 + Authority 矩阵只完成事实源与 adapter 契约盘点，不是平台已交付。

不包含：生产 adapter 实现、Journal 实现、主链 emit、自动修复、一期 runtime。TypeScript 只读接口与协议类型属于 Phase 0 契约，不等于平台上线。

Blocked 项：Governance 仓库化、Business Event、Doctor Adapter、Channel 重启继承、OTEL 数据集复制、route Evidence 已存在之宣称。
