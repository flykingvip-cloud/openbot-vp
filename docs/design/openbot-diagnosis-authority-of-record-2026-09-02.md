# OpenBot Diagnosis Platform — Authority of Record 矩阵

Date: 2026-09-02

Status: **Phase 0 inventory — 事实盘点，不是实现批准。Phase 0 完成 ≠ Diagnosis Platform 完成。**

Audience: Platform Architecture、Gateway、Agent Runtime、Skill Governance、Enterprise、Security、SRE、Data Governance、QA

Task: `openbot-diagnosis-platform`

Related:

- [Diagnosis Platform 实施方案](/design/openbot-diagnosis-platform-implementation-plan-2026-09-02)
- [P3.7 生产接入评审](/design/openbot-diagnosis-p3.7-production-integration-review-2026-09-02)
- [P3.8 生产适配器](/design/openbot-diagnosis-p3.8-production-adapters-2026-09-02)
- [四端信息架构](/design/openbot-four-port-ia-and-reorg-plan-2026-04-12)
- [云端多租户架构评审](/design/agent-growth-cloud-multitenant-architecture-review-2026-07-30)
- [Doctor CLI](/cli/doctor)

---

## 0. 审计结论

Diagnosis Platform **不拥有** OpenBot 的运行事实。本清单只回答：每个数据域今天的权威模块在哪、是否耐久、能否关联 Session/Run、Diagnosis 可以引用什么、禁止做什么。

硬约束（已在源码核验，不是理论推断）：

1. `src/infra/diagnostic-events.ts` 是进程内 listener + `seq`。重启丢失。**最多 PARTIAL 采集入口，永远不是耐久 Evidence Store。**
2. `src/gateway/skill-invocation/event-store.ts` **只负责** `CONFIG_DIR/skill-invocation-events/events.jsonl` 的 append / read。started/completed **幂等与 best-effort `try/catch` 写在 `src/gateway/skill-invocation/record.ts`**（`seen-invocation-ids.json` / `open-started.json`），不是 `event-store.ts`。**PARTIAL；一期 Skill 事实源可用，但必须携带归因与完整性 caveat。**
3. `src/routing/resolve-route.ts` 返回 `ResolvedAgentRoute`（含 `matchedBy`），仅即时返回 + `logDebug`。**今天没有耐久 route-resolution Evidence。状态 = MISSING。必须预留接口，不得宣称已有。**
4. Doctor 检查与 `--repair` / `--fix` 已拆分入口。**PARTIAL。** 只读证据源是 `runDoctorChecks`（`src/diagnosis/doctor-check-contract.ts`）。`--fix` / `--repair` / `--yes` 仍只走 CLI doctor 入口，不是 Diagnosis 能力。4.4 跨 Target 聚合与 Graph 为只读、进程内引用（`src/diagnosis/cross-target.ts` / `graph.ts`），不接生产主链。
5. OTEL（`extensions/diagnostics-otel`）是导出与引用。**PARTIAL 作为 Trace 引用，禁止复制完整数据集。**
6. Evolution Governance `persistent-store.ts` 是 `CONFIG_DIR/evolution-governance/state.json`。**可作为 Verification 消费者（PARTIAL），禁止当作 Diagnosis 事实总库（BLOCKED）。**
7. 业务 / Workflow 域事件契约不完整。**Phase 1 = MISSING / BLOCKED。**
8. Channel health monitor 会 `stopChannel` / `startChannel`。**Diagnosis 不得继承重启权限。**
9. Agent runtime health 只回答模型配置 + 渠道连通性。**PARTIAL，L1 Health only，不是单次 Run RCA。**
10. Skill Health 是 Skill Invocation 的滚动窗口派生统计。**不是独立事件权威。**

本清单 **没有 SUPPORTED 行**。没有任何数据域同时满足：耐久权威记录、稳定 locator、完整 Session/Run 关联、只读无副作用、归因可信度可声明。一期只能在 PARTIAL 上做引用式 Evidence，并诚实标记 `partial` / `unknown` / `source_expired`。

状态计数（§2 的 14 行）：

| 状态      | 行数 | 行                                                                                                                                                              |
| --------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SUPPORTED | 0    | —                                                                                                                                                               |
| PARTIAL   | 11   | Message Session, Agent Run, LLM I/O, Skill Invocation, Skill Health, Tool Invocation, Runtime Health, Channel Health, Doctor Checks, Security Audit, OTEL Trace |
| MISSING   | 2    | Route Resolution, Business Event                                                                                                                                |
| BLOCKED   | 1    | Governance 作为 Diagnosis 事实总库（Verification 消费仍为 PARTIAL，见该行）                                                                                     |

Governance 行在矩阵中记为 **PARTIAL（Verification 消费）+ BLOCKED（仓库）**，计数时仓库角色计入 BLOCKED，消费角色不另占 PARTIAL 以免双计。Business Event 计入 MISSING（权威不存在）；Phase 1 实施额外 BLOCKED。

---

## 1. 标识与租户规则

### 1.1 规范标识（冻结给协议，不在本期实现）

| 对象             | 权威标识                                                                                                                   | 禁止当作 ID                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Tenant           | 服务端 `PlatformAuthSessionContext.tenantId` = `membership.enterpriseId`（`src/gateway/platform-auth/session-context.ts`） | 客户端提交的 `tenantId`、UI hint            |
| Session          | `sessionKey`（路由/并发）+ `sessionId`（JSONL 文件名，`/new` `/reset` 会换）                                               | 显示名、`label`                             |
| Session file     | `resolveSessionFilePath` → `$STATE_DIR/agents/<agentId>/sessions/<sessionId>.jsonl`（`src/config/sessions/paths.ts`）      | 任意绝对路径、跨 agent 猜测                 |
| Agent            | 配置 / roster 中的 `agentId`（经 `normalizeAgentId` / `sanitizeAgentId`）                                                  | 显示名                                      |
| Agent run        | 运行时 `runId`（Plugin Hook `PluginHookLlmInputEvent.runId`、`PluginHookToolContext.runId`）                               | Diagnosis `DiagnosticRun.runId`（必须分家） |
| Skill invocation | `invocationId`（`skill-invocation/types.ts`）                                                                              | Skill 显示名                                |
| Tool call        | `toolCallId` + `runId` + `toolName`                                                                                        | 仅 `toolName`                               |
| Route            | **今天没有 durable record id**                                                                                             | `matchedBy` 字符串、debug log 行            |

`sessionId` 与 `sessionKey` 不是同一对象：`sessionKey` 是路由与 store 索引键；`sessionId` 是 transcript 文件身份，重置后变化。Evidence 必须同时能指向两者，缺一则 `completeness=partial`。

### 1.2 租户

- 只信已验证 session / membership / service principal。
- `toTrustedProxySession` 把 `tenantId` 写成 `membership.enterpriseId`（`src/gateway/platform-auth/session-context.ts`）。
- 云端共享 Identity / ACL / 多写实例尚未成为生产能力（见多租户评审）。一期 Diagnosis 必须按单 Gateway、本地 JSON 运行，不得私建第二套租户身份。

### 1.3 存储根

| 根           | 解析                                                                         | 典型内容                                                             |
| ------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `CONFIG_DIR` | `src/utils.ts` `resolveConfigDir()`                                          | `skill-invocation-events/`、`skill-assets/`、`evolution-governance/` |
| `STATE_DIR`  | `src/config/paths.ts` `resolveStateDir()`，可用 `OPENBOT_STATE_DIR` 覆盖     | `agents/<agentId>/sessions/`                                         |
| 进程内存     | `globalThis.__openclawDiagnosticEventsState`、`SESSION_TRANSCRIPT_LISTENERS` | diagnostic-events、transcript-events                                 |

文档用 `CONFIG_DIR` / `STATE_DIR` 占位，不写主机绝对路径或生产 URL。

---

## 2. Authority of Record 矩阵

每行字段含义：

- **Diagnosis MAY**：引用、索引、脱敏摘要、关联。
- **Diagnosis MUST NOT**：复制权威、更新原事实、继承副作用、伪造 locator。
- **attribution confidence**：该源自身能声明的归因质量，不是 Finding 的 root-cause 分数。
- **failure behavior**：源模块今天如何失败；Diagnosis 不得把 fail-silent 写成“已采集”。

### 2.1 Message Session

| 字段                        | 现状                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| data domain                 | Message Session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| authority module            | Transcript：`$STATE_DIR/agents/<agentId>/sessions/<sessionId>.jsonl`，路径 `src/config/sessions/paths.ts`（`resolveSessionTranscriptsDirForAgent`、`resolveSessionFilePath`）。索引：同目录 `sessions.json`，条目类型 `SessionEntry`（`src/config/sessions/types.ts`）。更新通知：`src/sessions/transcript-events.ts`（**仅进程内**）。Plugin 侧：`message_received` / `message_sending` / `message_sent` / `session_start` / `session_end` / `before_message_write`（`src/plugins/types.ts`）。 |
| current storage             | **耐久（transcript + index）**：JSONL 消息 + `sessions.json`。**不耐久**：`emitSessionTranscriptUpdate` 只广播 `{ sessionFile }`，listener 异常被吞。Inbound / last-route 等 metadata 在 `SessionEntry` 上是可选字段，实施计划已标明 inbound metadata 为 best-effort，不能假定每次 inbound 完整落盘。                                                                                                                                                                                            |
| correlatable to Session/Run | Session：`sessionId` + `sessionKey` + `sessionFile`。Run：JSONL 内 tool/assistant 消息可能带运行时 id，但 **没有统一的 durable `runId` 列**；需经 Agent Hook / Skill Invocation 回填。缺 `runId` 时不得假装完整 Trace。                                                                                                                                                                                                                                                                          |
| Diagnosis MAY               | 只读打开 `sessionFile`；保存路径/哈希/行号 locator；按 allowlist 做摘要；标记 metadata 缺失。                                                                                                                                                                                                                                                                                                                                                                                                    |
| Diagnosis MUST NOT          | 复制完整 transcript 到 Diagnosis Store；把 `transcript-events` 当 Evidence Store；写 JSONL；调用 `before_message_write` 的 block/改写能力。                                                                                                                                                                                                                                                                                                                                                      |
| authority locator           | `store=session-jsonl; agentId; sessionId; sessionFile; byteOffset? ; contentHash?`。文件被 archive（`.deleted.` / `.reset.` / `.bak.`，见 `src/config/sessions/artifacts.ts`）后必须 `source_expired`。                                                                                                                                                                                                                                                                                          |
| retention                   | 跟随 Session store / doctor orphan archive / 用户 `/reset`。Diagnosis 无独立保留权。                                                                                                                                                                                                                                                                                                                                                                                                             |
| privacy classification      | **restricted**（用户消息、渠道身份、`lastTo`）。摘要默认 `internal` 且 `redacted=true`。                                                                                                                                                                                                                                                                                                                                                                                                         |
| tenant scope                | 个人本地：单用户 state dir。企业：必须从可信 session 解析 tenant，再映射到该 Agent 的 sessions dir。禁止跨 `STATE_DIR` 扫描。                                                                                                                                                                                                                                                                                                                                                                    |
| failure behavior            | `resolveSessionFilePath` 在 stale `sessionFile` 上 catch 后回退默认路径（`paths.ts` 注释：Keep handlers alive）。读失败 = `completeness=unknown`，不是空会话。`transcript-events` listener 失败被忽略。                                                                                                                                                                                                                                                                                          |
| attribution confidence      | 文件存在且路径可解析：**高（记录存在）**。消息是否属于某次 Agent run：**中/低**，缺 `runId` 关联。                                                                                                                                                                                                                                                                                                                                                                                               |
| status                      | **PARTIAL**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| side effects                | `/reset` 换 `sessionId`；doctor 可把孤儿 transcript archive 为 `.deleted.<timestamp>`（`docs/cli/doctor.md`）。`before_message_write.block=true` 会阻止写入。Diagnosis 不得触发这些写路径。                                                                                                                                                                                                                                                                                                      |

### 2.2 Route Resolution

| 字段                        | 现状                                                                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| data domain                 | Route Resolution                                                                                                                                                                                                                       |
| authority module            | `src/routing/resolve-route.ts`：`resolveAgentRoute(input: ResolveAgentRouteInput): ResolvedAgentRoute`。治理改写：`src/gateway/evolution-governance/route-redirect.ts`（`redirectedFromAgentId`）。绑定表：`src/routing/bindings.ts`。 |
| current storage             | **无耐久 Evidence。** 返回值用于热路径；verbose 时 `logDebug(\`[routing] match: matchedBy=...\`)`。进程内 WeakMap 缓存（按 config 对象），不是审计日志。                                                                               |
| correlatable to Session/Run | 返回值含 `agentId`、`sessionKey`、`accountId`、`matchedBy`。**没有** `runId`、没有 event id、没有落盘记录可回指。事后无法证明“未路由 / 错路由”。                                                                                       |
| Diagnosis MAY               | 预留 `route_resolution` Evidence 接口与类型；一期缺失时输出 `INCONCLUSIVE` + `missingEvidence=[route_resolution_event]`。                                                                                                              |
| Diagnosis MUST NOT          | 宣称已有 route Evidence；从日志正则“恢复”决策；把 Governance redirect 缓存当路由权威。                                                                                                                                                 |
| authority locator           | **不存在。** 预留：`store=route-resolution; routeDecisionId; sessionKey; observedAt`。在主链补点之前 locator 必须保持未实现。                                                                                                          |
| retention                   | 无。                                                                                                                                                                                                                                   |
| privacy classification      | `internal`（`peer.id`、`guildId`、`memberRoleIds` 升为 **restricted**）。                                                                                                                                                              |
| tenant scope                | 路由输入无 tenant 字段。租户必须从可信 session 另解，不能从 `ResolveAgentRouteInput` 推断。                                                                                                                                            |
| failure behavior            | 函数总是返回一条 `ResolvedAgentRoute`（至少 `matchedBy: "default"`）。失败被折叠成默认 Agent，**不是**“未路由”事件。                                                                                                                   |
| attribution confidence      | 实时调用：**高（当次返回值）**。历史回放：**无**。                                                                                                                                                                                     |
| status                      | **MISSING**                                                                                                                                                                                                                            |
| side effects                | 只读解析 + 可选 Governance redirect 读缓存。`applyGovernanceRuntimeAction({ action: "redirect" })` 会改 binding，那是 Governance 副作用，不是本模块写入。Diagnosis 不得调用 redirect。                                                 |

一期垂直切片若要区分“收到消息但未路由”，**必须在主链补结构化 route decision**（见文档 2 与文末发现）。Phase 0 只预留接口，不改 `resolveAgentRoute` 调用方。

### 2.3 Agent Run

| 字段                        | 现状                                                                                                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| data domain                 | Agent Run                                                                                                                                                                                                                                                            |
| authority module            | 生命周期 Hook：`before_agent_start`、`agent_end`、`before_model_resolve`、`before_prompt_build`（`src/plugins/types.ts`）。进程内诊断：`run.attempt`（`DiagnosticRunAttemptEvent`，`src/infra/diagnostic-events.ts`）。                                              |
| current storage             | Hook **不落盘**。`run.attempt` **不落盘**。部分结果进入 Session JSONL（assistant/tool 消息），但不是 Run 权威信封。                                                                                                                                                  |
| correlatable to Session/Run | Hook 上下文：`PluginHookAgentContext.sessionKey` / `sessionId` / `agentId`。`llm_input` / tool ctx 有 `runId`。`agent_end` **没有 `runId` 字段**（只有 `success` / `error` / `durationMs` / `messages`）。`run.attempt` 有 `runId` + 可选 `sessionKey`/`sessionId`。 |
| Diagnosis MAY               | 只读订阅 Hook / diagnostic-events（3.9：注入 observation JSONL，不调用 `emitDiagnosticEvent`），或读 Session JSONL 角色元数据。写入 Diagnosis Journal 摘要。关联 Skill/Tool 的 `runId`。                                                                             |
| Diagnosis MUST NOT          | 把 diagnostic-events 当耐久权威；在 `before_agent_start` 里改 `modelOverride` / prompt；把 `agent_end.success` 直接当 Root Cause。                                                                                                                                   |
| authority locator           | 实时：`runId` + `sessionKey`。耐久：仅当 Journal adapter 已写成功。否则 `completeness=partial`。                                                                                                                                                                     |
| retention                   | 进程内：进程寿命。JSONL：跟随 Session。Journal：Diagnosis 自己的保留策略（尚未实现）。                                                                                                                                                                               |
| privacy classification      | **restricted**（prompt、messages）。摘要只保留 outcome / duration / provider / model。                                                                                                                                                                               |
| tenant scope                | Hook 无 tenant。必须从可信 session 或 Skill Invocation 行上的 `tenantId`（可为 null）回填，null 必须保留。                                                                                                                                                           |
| failure behavior            | Hook 失败策略由 runtime 决定；diagnostic-events listener 异常只打日志后忽略。Diagnosis 订阅失败不得阻断聊天，也不得假装已记录。                                                                                                                                      |
| attribution confidence      | 有 `runId` 的 llm/tool 段：**高**。仅有 `agent_end`：**中**（缺 run 键）。仅有 `run.attempt`：**中**（无完成态）。                                                                                                                                                   |
| status                      | **PARTIAL**                                                                                                                                                                                                                                                          |
| side effects                | `before_agent_start` / `before_prompt_build` 可改 system prompt 与模型。Diagnosis adapter 必须纯观察。                                                                                                                                                               |

### 2.4 LLM Input / Output

| 字段                        | 现状                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| data domain                 | LLM Input/Output                                                                                                                                                                                                                                               |
| authority module            | `llm_input` → `PluginHookLlmInputEvent`；`llm_output` → `PluginHookLlmOutputEvent`（`src/plugins/types.ts`）。用量旁路：`model.usage`（`DiagnosticUsageEvent`）。OTEL 再从 diagnostic-events 导出 token/cost（`extensions/diagnostics-otel/src/service.ts`）。 |
| current storage             | Hook **不耐久**。`model.usage` **不耐久**。Prompt / `assistantTexts` / `historyMessages` 默认不落诊断库。Session JSONL 可能有 assistant 文本，那是 Session 权威的一部分，不是 LLM envelope。                                                                   |
| correlatable to Session/Run | `runId` + `sessionId` 在 llm hooks 上存在。`sessionKey` 在 `PluginHookAgentContext`，不在 event 本体。`model.usage` 的 `sessionKey`/`sessionId` 可选。                                                                                                         |
| Diagnosis MAY               | 记录 provider/model/usage/imagesCount/duration 摘要；引用 transcript 行。                                                                                                                                                                                      |
| Diagnosis MUST NOT          | 默认持久化完整 `prompt`、`systemPrompt`、`historyMessages`、`assistantTexts`；把 OTEL 指标当 LLM 权威。                                                                                                                                                        |
| authority locator           | `runId` + `sessionId` + `observedAt`。完整正文 locator 指向 session JSONL，不指向 Hook。                                                                                                                                                                       |
| retention                   | 进程内。完整正文跟随 Session 保留。                                                                                                                                                                                                                            |
| privacy classification      | **restricted**。Evidence `privacy.redacted` 必须为 true。                                                                                                                                                                                                      |
| tenant scope                | 同 Agent Run。                                                                                                                                                                                                                                                 |
| failure behavior            | 同 Hook：非耐久，listener 可被忽略。                                                                                                                                                                                                                           |
| attribution confidence      | 信封字段（run/session/model）：**高**。内容是否完整进入诊断：**低**（设计上不复制）。                                                                                                                                                                          |
| status                      | **PARTIAL**                                                                                                                                                                                                                                                    |
| side effects                | 无（llm hooks 返回 `void`）。旁路 `model.usage` 无副作用。                                                                                                                                                                                                     |

### 2.5 Skill Invocation

| 字段                        | 现状                                                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| data domain                 | Skill Invocation                                                                                                                                                                                                                                               |
| authority module            | `src/gateway/skill-invocation/types.ts`、`event-store.ts`、`record.ts`。归因：`resolveSelectedSkillForToolCall` / `recordLifecycleSkillToolResult` / `recordLifecycleSkillsLoadedOnRun`。                                                                      |
| current storage             | **耐久 JSONL**：`CONFIG_DIR/skill-invocation-events/events.jsonl`（`appendFileSync`）。幂等：`seen-invocation-ids.json`、`open-started.json`。Gateway RPC：`skill-invocation.record-completed`（`src/gateway/server-methods-list.ts`）。                       |
| correlatable to Session/Run | 事件字段：`runId`、`sessionKey`、`toolCallId`、`toolName`、`agentId`、`tenantId`、`invocationId`。均为 `string \| null`（除 id/skill/agent）。null 必须保留，不得填默认成功。                                                                                  |
| Diagnosis MAY               | 作为 **Phase 1 Skill 事实源**：读 JSONL、按 `invocationId` 去重、展示 `attributionResolution`、聚合成功率（不要另建计数器）。                                                                                                                                  |
| Diagnosis MUST NOT          | 新建平行 Skill event DB；把 `prompt_named_use` 当成已确认选择；忽略 `attributionResolution` 缺失；把写入失败当“未发生调用”。                                                                                                                                   |
| authority locator           | `store=skill-invocation-jsonl; invocationId; file=skill-invocation-events/events.jsonl`。                                                                                                                                                                      |
| retention                   | 无代码级 TTL；文件随 `CONFIG_DIR` 增长。`seen` 只保留最近 5000 id（`record.ts` `slice(-5_000)`），不影响 JSONL 正文。                                                                                                                                          |
| privacy classification      | `internal`。默认无 prompt/tool payload。`userId` / `tenantId` 按租户隔离。                                                                                                                                                                                     |
| tenant scope                | `tenantId: string \| null`。null = 未绑定，不是“全局可见”。                                                                                                                                                                                                    |
| failure behavior            | `appendSkillInvocationEvent` 同步写，失败会抛。`recordLifecycleSkillToolResult` / prompt-named-use 用 `try/catch` **best-effort 吞掉**，聊天主链继续。读侧 skip 坏行。因此：**JSONL 不是 100% 完整**。`completeness` 不得标 `complete`，除非有独立完整性证明。 |
| attribution confidence      | 见 §3。`identity_tool_name` / `selectedSkillId` / `tool_args` 高于 `unique_owner`。`prompt_named_use` 更弱且默认关闭。`none` = 不计次。                                                                                                                        |
| status                      | **PARTIAL**（一期 Skill 权威，带 caveat；**不是**无条件 SUPPORTED）                                                                                                                                                                                            |
| side effects                | completed 后 best-effort 调用 `recordRobotSkillInvocationStats` 与 `recordSkillHealthSample`（`skill-lifecycle-store.ts`）。Diagnosis 只读 JSONL，不重放这两次写入。                                                                                           |

### 2.6 Skill Health

| 字段                        | 现状                                                                                                                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| data domain                 | Skill Health                                                                                                                                                                                                                                                                            |
| authority module            | `src/gateway/skill-lifecycle-store.ts`：`SkillHealth`（`successRate` / `avgLatency` / `failureReasons` / `status`）。窗口：`CONFIG_DIR/skill-assets/health-windows.json`。资产卡：`CONFIG_DIR/skill-assets/store.json`。RPC：`skill-health.sample`、`skill-health.repair-suggestions`。 |
| current storage             | **派生耐久 JSON**，不是事件日志。`recordSkillHealthSample` 把窗口折进 `recordSkillHealthTelemetry`。写盘 best-effort（catch 空）。无 P95/P99。                                                                                                                                          |
| correlatable to Session/Run | **不能**按 session/run 回放。窗口键 `agent:<agentId>\|skill:<skillId>` 或全局 `skillId`。                                                                                                                                                                                               |
| Diagnosis MAY               | 引用窗口快照作 L1 / baseline 输入；与 Skill Invocation 对账。                                                                                                                                                                                                                           |
| Diagnosis MUST NOT          | 再累计第二套成功率；用 Health 状态当单次失败根因；把 `suggestSkillHealthRepair` 当 Remediation execute。                                                                                                                                                                                |
| authority locator           | `store=skill-assets-health; skillId; agentId?; windowFile=skill-assets/health-windows.json`。单次失败 locator 必须回到 Skill Invocation `invocationId`。                                                                                                                                |
| retention                   | 滚动窗口（`HEALTH_WINDOW_MS` + `HEALTH_WINDOW_MAX_SAMPLES`）。过期样本丢弃。                                                                                                                                                                                                            |
| privacy classification      | `internal`。                                                                                                                                                                                                                                                                            |
| tenant scope                | 按 `skillId` / 可选 `agentId` 分区，**不是** tenant 主键。跨租户聚合禁止。                                                                                                                                                                                                              |
| failure behavior            | 磁盘写失败静默。默认 `successRate=1`（`defaultHealth()`）在零样本时会出现——**零样本健康 ≠ 真实健康**。                                                                                                                                                                                  |
| attribution confidence      | 统计本身：**中**（派生）。因果：**低**。                                                                                                                                                                                                                                                |
| status                      | **PARTIAL**                                                                                                                                                                                                                                                                             |
| side effects                | 更新 store 健康字段与窗口文件。不重启、不改绑定。                                                                                                                                                                                                                                       |

### 2.7 Tool Invocation

| 字段                        | 现状                                                                                                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| data domain                 | Tool Invocation                                                                                                                                                                                                       |
| authority module            | `before_tool_call` / `after_tool_call` / `tool_result_persist`（`src/plugins/types.ts`）。循环：`tool.loop`（`DiagnosticToolLoopEvent`）。结果也可能写入 Session JSONL。Skill 归因消费同一 tool 身份（`record.ts`）。 |
| current storage             | Hook **不耐久**。`tool.loop` **不耐久**。JSONL 中的 tool 消息是 Session 权威的一部分。                                                                                                                                |
| correlatable to Session/Run | `PluginHookToolContext`：`runId`、`sessionKey`、`sessionId`、`toolCallId`、`toolName`、`agentId`。`after_tool_call` 另有 `params`、`result`、`error`、`durationMs`。                                                  |
| Diagnosis MAY               | 摘要 toolName / duration / error class / blocked（3.9：after_tool_call / tool.loop observation JSONL，或 Session JSONL 工具名；不复制 params/result）。引用 JSONL tool 行。                                           |
| Diagnosis MUST NOT          | 默认存完整 `params` / `result`；重放写 Tool；把 `before_tool_call.block` 当诊断动作。                                                                                                                                 |
| authority locator           | `runId` + `toolCallId` + `toolName`；或 session JSONL 行。                                                                                                                                                            |
| retention                   | Hook：进程寿命。JSONL：跟随 Session。                                                                                                                                                                                 |
| privacy classification      | **restricted**（参数/结果常含路径、账号、秘密）。                                                                                                                                                                     |
| tenant scope                | 同 Agent Run。                                                                                                                                                                                                        |
| failure behavior            | Hook 可修改或阻断调用。`tool.loop` 的 `action: "warn" \| "block"` 已是运行时副作用。Diagnosis 只观察，不触发 block。                                                                                                  |
| attribution confidence      | 身份字段：**高**。结果正文：**不进入诊断权威**。                                                                                                                                                                      |
| status                      | **PARTIAL**                                                                                                                                                                                                           |
| side effects                | `before_tool_call` 可改 params / `block`。`tool_result_persist` 可改写入 JSONL 的 message。`tool.loop` 可 block 后续调用。                                                                                            |

### 2.8 Runtime Health

| 字段                        | 现状                                                                                                                                                                                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| data domain                 | Runtime Health                                                                                                                                                                                                                                                                                            |
| authority module            | 判定：`src/gateway/agent-runtime-health.ts`（`computeAgentRuntimeHealth`，纯函数）。采集：`src/gateway/agent-runtime-health-collect.ts`（读有效模型、bindings、`ChannelRuntimeSnapshot`）。RPC：`agent-runtime.get-health-summary`、`health`。Heartbeat / queue / session stuck：`diagnostic-events.ts`。 |
| current storage             | **实时快照，无 per-run 历史库。** 判定结果不作为独立 JSONL 权威。                                                                                                                                                                                                                                         |
| correlatable to Session/Run | **不能**解释单次任务失败。`session.stuck` 带可选 `sessionKey`，但是进程内事件。                                                                                                                                                                                                                           |
| Diagnosis MAY               | 作 L1 Health snapshot Evidence；与 Channel 连通性交叉验证。                                                                                                                                                                                                                                               |
| Diagnosis MUST NOT          | 把 `offline` / `unconfigured` 升级为某次 Run 的 Root Cause；为做健康检查而重启任何东西。                                                                                                                                                                                                                  |
| authority locator           | `agentId` + `observedAt` + 输入 facts 哈希。历史 locator 不存在。                                                                                                                                                                                                                                         |
| retention                   | 无。                                                                                                                                                                                                                                                                                                      |
| privacy classification      | `internal`。                                                                                                                                                                                                                                                                                              |
| tenant scope                | 按 `agentId`。跨租户汇总仅 Platform，且必须先有可信 membership。                                                                                                                                                                                                                                          |
| failure behavior            | 采集依赖 config + runtime snapshot。snapshot 缺失 → 渠道视为未连接。无 throw 成“未知”的独立枚举。                                                                                                                                                                                                         |
| attribution confidence      | L1 连通性：**高**。RCA：**不适用**。                                                                                                                                                                                                                                                                      |
| status                      | **PARTIAL**（L1 only）                                                                                                                                                                                                                                                                                    |
| side effects                | 只读。                                                                                                                                                                                                                                                                                                    |

### 2.9 Channel Health

| 字段                        | 现状                                                                                                                                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| data domain                 | Channel Health                                                                                                                                                                                                                                                                     |
| authority module            | 评估：`src/gateway/channel-health-policy.ts`（`evaluateChannelHealth`、`ChannelHealthEvaluation`）。监视与重启：`src/gateway/channel-health-monitor.ts`（`startChannelHealthMonitor`）。快照：`ChannelManager.getRuntimeSnapshot()`。Webhook 旁路：`webhook.*` diagnostic events。 |
| current storage             | 运行时 snapshot + 监视器内存中的 `restartRecords`。**无**与用户会话关联的耐久健康事件。                                                                                                                                                                                            |
| correlatable to Session/Run | **今天不能**可靠关联投递失败到某条用户消息。`webhook.*` 有 `channel`/`chatId`，无 `sessionKey` 保证。                                                                                                                                                                              |
| Diagnosis MAY               | 只读调用 `evaluateChannelHealth`；引用 snapshot 字段（running/connected/lastEventAt）。                                                                                                                                                                                            |
| Diagnosis MUST NOT          | 调用 `stopChannel` / `startChannel` / `resetRestartAttempts`；继承 monitor 的重启预算；把断线当会话根因（除非另有投递 Evidence）。                                                                                                                                                 |
| authority locator           | `channelId` + `accountId` + `observedAt`。重启动作无 Diagnosis 级 receipt。                                                                                                                                                                                                        |
| retention                   | 无（restartRecords 随进程）。                                                                                                                                                                                                                                                      |
| privacy classification      | `internal`（`chatId` 升 restricted）。                                                                                                                                                                                                                                             |
| tenant scope                | 渠道账号级，不是 tenant 主键。                                                                                                                                                                                                                                                     |
| failure behavior            | 重启失败只打日志。达 `maxRestartsPerHour`（默认 10）则 skip。startup grace 内不检查。                                                                                                                                                                                              |
| attribution confidence      | 当前连通性：**高**。与 Session 因果：**低**。                                                                                                                                                                                                                                      |
| status                      | **PARTIAL**                                                                                                                                                                                                                                                                        |
| side effects                | **会变更运行态**：`channelManager.stopChannel` + `startChannel`。这是本矩阵最危险的副作用之一。Diagnosis **零重启权**。                                                                                                                                                            |

### 2.10 Doctor Checks

| 字段                        | 现状                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| data domain                 | Doctor Checks                                                                                                                                                                                                                                                                                                                                                            |
| authority module            | **只读检查入口：** `src/diagnosis/doctor-check-contract.ts`（`runDoctorChecks`）。输入：配置 + `env`；输出：结构化 `DoctorCheckRow[]`。**修复入口（非 Diagnosis）：** `src/commands/doctor.ts` + CLI `--fix`/`--repair`/`--yes`（`src/cli/program/register.maintenance.ts`）。配置流 / 守护进程 / `doctor.memory.*` RPC 仍属 CLI/运维，不给 Diagnosis。                  |
| current storage             | **无 Finding store。** 只读合同输出结构化 check rows。CLI 仍输出终端 note，并可在修复路径写回 config。检查入口与修复入口分离。                                                                                                                                                                                                                                           |
| correlatable to Session/Run | **否。** 安装/配置态，不是会话态。                                                                                                                                                                                                                                                                                                                                       |
| Diagnosis MAY               | 只调用 `runDoctorChecks`；把 `DoctorCheckRow` 映射为 `source="doctor_check"` 的 `config_check` Evidence。                                                                                                                                                                                                                                                                |
| Diagnosis MUST NOT          | 导入或调用 CLI doctor 入口 / repair executor / `writeConfigFile` / Gateway 或 Channel restart；解析 CLI 文本；从 Skill 执行 `openbot doctor` / `--fix`。                                                                                                                                                                                                                 |
| authority locator           | 无稳定 record id。预留：`checkId` + config snapshot hash + `observedAt`（拆分后）。                                                                                                                                                                                                                                                                                      |
| retention                   | 无。config 备份：`--fix` 可写 `*.json.bak`（见 doctor 文档）。                                                                                                                                                                                                                                                                                                           |
| privacy classification      | `internal`；凭据路径 / allowFrom **restricted**。                                                                                                                                                                                                                                                                                                                        |
| tenant scope                | 主机 / 单 Gateway。                                                                                                                                                                                                                                                                                                                                                      |
| failure behavior            | **无 `--repair` / `--fix` 仍可能写入。** `doctor.ts` 在 `options.nonInteractive === true` 时把 legacy migrate **默认设为 true** 并调用 `runLegacyStateMigrations`（不看 repair 开关）。`configResult.shouldWriteConfig` 或 cfg 变更时还会 `writeConfigFile`。TTY 会 prompt。`--yes` 视为同意 repair（`shouldRepair = repair \|\| yes`）。不得把“没带 --repair”读成只读。 |
| attribution confidence      | 单次检查观察：**高**（若只读函数被抽出）。今天混在 CLI 里：**中**。                                                                                                                                                                                                                                                                                                      |
| status                      | **PARTIAL**                                                                                                                                                                                                                                                                                                                                                              |
| side effects                | **高。** 可写 config、删 unknown keys、改 Telegram/Discord allowFrom、从 pairing store 回填、修 launchd、改 cron store、删 stale locks、删已下线功能凭据文件、修 gateway service token、sandbox image、legacy state migration、OAuth profile id。`maybeRepairGatewayDaemon` 会 `repairLaunchAgentBootstrap`。Diagnosis 禁止这些路径。                                    |

### 2.11 Security Audit

| 字段                        | 现状                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| data domain                 | Security Audit                                                                                                                                                                                                                                                                                                                                                                              |
| authority module            | 审计：`src/security/audit.ts`（`runSecurityAudit` → `SecurityAuditReport` / `SecurityAuditFinding`）。CLI：`src/cli/security-cli.ts`（`openbot security audit`）。修复：`src/security/fix.ts`（`fixSecurityFootguns`）。Doctor 叠加：`src/commands/doctor-security.ts`（`noteSecurityWarnings`）。配置姿态：`src/gateway/security-profile.ts`。主机环境：`src/infra/host-env-security.ts`。 |
| current storage             | **按需扫描，无耐久 Finding 库。** `--json` 打到 stdout。`--fix` 先跑 `fixSecurityFootguns` 再扫描。                                                                                                                                                                                                                                                                                         |
| correlatable to Session/Run | **否。**                                                                                                                                                                                                                                                                                                                                                                                    |
| Diagnosis MAY               | 适配已有 `checkId` / severity / remediation 文本为 Finding draft（Phase 2+）；不复制规则引擎。                                                                                                                                                                                                                                                                                              |
| Diagnosis MUST NOT          | 调用 `--fix`；改 chmod/icacls/config；把 Doctor 安全 note 与 audit Finding 重复计数成两个根因。                                                                                                                                                                                                                                                                                             |
| authority locator           | `checkId` + `ts`（报告时刻）。同一 `checkId` 再次扫描是新观察，不是同一权威行更新。                                                                                                                                                                                                                                                                                                         |
| retention                   | 无。                                                                                                                                                                                                                                                                                                                                                                                        |
| privacy classification      | `internal`；路径与暴露面细节可能 **restricted**。Finding 文案已要求避免凭据（security-profile 注释）。                                                                                                                                                                                                                                                                                      |
| tenant scope                | 主机。`managed_enterprise` 姿态来自 env/config，禁止客户端覆盖（`SECURITY_PROFILE_CLIENT_OVERRIDE_REJECTED`）。                                                                                                                                                                                                                                                                             |
| failure behavior            | `--deep` 的 gateway probe 为 best-effort。`--fix` catch 后可为 null，审计仍继续。                                                                                                                                                                                                                                                                                                           |
| attribution confidence      | 确定性规则 Finding：**高**。与运行失败因果：**低**。                                                                                                                                                                                                                                                                                                                                        |
| status                      | **PARTIAL**                                                                                                                                                                                                                                                                                                                                                                                 |
| side effects                | `--fix`：chmod / icacls / 可能写 config（`SecurityFixResult.configWritten`）。Doctor 安全路径会提示 `doctor --fix` 生成 token。                                                                                                                                                                                                                                                             |

### 2.12 OTEL Trace

| 字段                        | 现状                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| data domain                 | OTEL Trace                                                                                                                                                                                                                                             |
| authority module            | `extensions/diagnostics-otel/src/service.ts`：`createDiagnosticsOtelService`。订阅 `onDiagnosticEvent`，导出 traces/metrics；可选 logs。脱敏：`redactSensitiveText` / `redactOtelAttributes`。需 `diagnostics.enabled` 且 `diagnostics.otel.enabled`。 |
| current storage             | **外部后端**（OTLP HTTP/protobuf）。OpenBot 进程内 **不** 存完整 Trace 库。采样：`TraceIdRatioBasedSampler`。`tool.loop` **没有** 被 switch 处理（导出覆盖子集）。                                                                                     |
| correlatable to Session/Run | 属性里尽量加 session 身份（`addSessionIdentityAttrs`）。**不保证** 每个 Agent `runId` 都有 span。依赖外部 backend 保留。                                                                                                                               |
| Diagnosis MAY               | 保存 `traceId` / `spanId` / backend locator；作 `payloadRef`。                                                                                                                                                                                         |
| Diagnosis MUST NOT          | 复制 OTEL 全量数据集进 Diagnosis Store；把 OTEL 当 Case/Finding Store；在未配置 otel 时假装有 Trace。                                                                                                                                                  |
| authority locator           | `store=otel; endpoint-ref; traceId; spanId`（endpoint 用配置键，不写生产 URL）。无 traceId 则不可做 Trace Evidence。                                                                                                                                   |
| retention                   | 外部后端策略。本地无副本。                                                                                                                                                                                                                             |
| privacy classification      | 导出前脱敏；仍按 **restricted** 处理原文。                                                                                                                                                                                                             |
| tenant scope                | Resource 默认 `service.name`（默认 `"openclaw"`）。**无** 一等 tenant 属性保证。                                                                                                                                                                       |
| failure behavior            | SDK start 失败 throw（插件 start）。单条 event handler catch 后打日志。主链不依赖 OTEL。                                                                                                                                                               |
| attribution confidence      | 有 traceId 的引用：**中**。无 backend：**无**。                                                                                                                                                                                                        |
| status                      | **PARTIAL**（引用 only）                                                                                                                                                                                                                               |
| side effects                | 网络导出。不改 Gateway 状态。                                                                                                                                                                                                                          |

### 2.13 Governance Action / Verification

| 字段                        | 现状                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| data domain                 | Governance Action/Verification                                                                                                                                                                                                                                                                                                                                           |
| authority module            | 持久化：`src/gateway/evolution-governance/persistent-store.ts`（`GovernancePersistedState`、`GovernanceEffectVerification`）。Tick：`src/gateway/evolution-governance/tick-pipeline.ts`（读 Skill Invocation + Skill Health，执行 pause/resume/hold/limit/redirect）。动作：`src/gateway/evolution-governance/runtime-actions.ts`（改 `agent-runtime-store` bindings）。 |
| current storage             | **耐久本地 JSON**：`CONFIG_DIR/evolution-governance/state.json`（assets/anomalies/actions/metrics/`effectVerifications`/limits/redirects/pauses/skillAutoJobs）。读失败回默认空状态。                                                                                                                                                                                    |
| correlatable to Session/Run | Verification 窗口按 `runtimeAgentId` / `assetId` + 时间窗，**不是** session/run。Tick **消费** Skill Invocation 聚合，不拥有这些事件。                                                                                                                                                                                                                                   |
| Diagnosis MAY               | 引用 `effectVerifications[]` 与 action receipt，作为 **Verification 消费者**；对比同一口径的 Skill Invocation 指标。                                                                                                                                                                                                                                                     |
| Diagnosis MUST NOT          | 把该 store 当 Diagnosis 事实总库；复制 anomalies 为第二套 Skill 健康源；调用 `applyGovernanceRuntimeAction`；在 tick 里为诊断而 pause/redirect。                                                                                                                                                                                                                         |
| authority locator           | `store=evolution-governance; effectId=GovernanceEffectVerification.id; actionId?`。                                                                                                                                                                                                                                                                                      |
| retention                   | 文件覆盖写；无独立 TTL。                                                                                                                                                                                                                                                                                                                                                 |
| privacy classification      | `internal`。                                                                                                                                                                                                                                                                                                                                                             |
| tenant scope                | Skill auto job 有 `tenantId` 快照。多数 pause/redirect 按 `runtimeAgentId`。                                                                                                                                                                                                                                                                                             |
| failure behavior            | kill-switch 时动作返回 `kill-switch-active`。读损坏文件 → 空默认（可能丢失历史 verification）。                                                                                                                                                                                                                                                                          |
| attribution confidence      | “某次 pause 已执行”：**高**（若 record 存在）。“pause 证明 Skill 是根因”：**低**（Governance 是消费者）。                                                                                                                                                                                                                                                                |
| status                      | **PARTIAL**（Verification 消费） / **BLOCKED**（当作 Diagnosis 仓库或 Skill 事实源）                                                                                                                                                                                                                                                                                     |
| side effects                | **高。** `pause`/`resume`/`limit`/`redirect` 改变 binding state/priority；redirect 进入热路径缓存（`redirect-cache.ts`），`resolveAgentRoute` 可读到 `redirectedFromAgentId`。                                                                                                                                                                                           |

### 2.14 Business Event

| 字段                        | 现状                                                                                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| data domain                 | Business Event                                                                                                                                                                                                                                                          |
| authority module            | **没有** 企业 Workflow / 业务状态权威事件总线。存在的相近物：`src/gateway/billing/types.ts` `BillingDomainEvent` + `event-log-store.ts`（**计费域**，不是业务流程）。Skill 字段 `businessOutcome` 今天被写成归因标签（如 `unique_owner`），**不是** 业务成功/失败契约。 |
| current storage             | 业务域：**不存在。** 计费：本地耐久（与 Diagnosis Phase 1 无关）。                                                                                                                                                                                                      |
| correlatable to Session/Run | 无业务契约。                                                                                                                                                                                                                                                            |
| Diagnosis MAY               | 协议预留 `workflow` Target。                                                                                                                                                                                                                                            |
| Diagnosis MUST NOT          | 发明业务事件库；把 billing 或 `businessOutcome` 当 Workflow Evidence；Phase 1 实现 `workflow-state` Diagnoser。                                                                                                                                                         |
| authority locator           | 无。                                                                                                                                                                                                                                                                    |
| retention                   | 无。                                                                                                                                                                                                                                                                    |
| privacy classification      | 将来至少 **restricted**。                                                                                                                                                                                                                                               |
| tenant scope                | 将来必须来自可信 membership。                                                                                                                                                                                                                                           |
| failure behavior            | 无源。                                                                                                                                                                                                                                                                  |
| attribution confidence      | 无。                                                                                                                                                                                                                                                                    |
| status                      | **MISSING**（权威不存在）；Phase 1 实施 **BLOCKED**                                                                                                                                                                                                                     |
| side effects                | 无。                                                                                                                                                                                                                                                                    |

---

## 3. Skill 归因可信度（核验自 `record.ts`）

`SkillSelectionResolution`（约 248 行）实际联合为：

```text
"selectedSkillId" | "tool_args" | "identity_tool_name" | "unique_owner"
```

**`prompt_named_use` 不在该联合里。** 它走 `recordLifecycleSkillsLoadedOnRun` 末尾：仅当 `OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION=1`（或 `true`）时，对 **无声明 tools** 的 prompt-only skill 做文本命中；`` invocationId = `${runId}:${skillId}:prompt_named_use` ``；`businessOutcome`写成`"prompt_named_use"`；\*\*该路径调用 `recordSkillInvocationCompleted`时未传`attributionResolution`\*\*。注释写明：partial / unreliable；默认关闭。

解析顺序（`resolveSelectedSkillForToolCall`）：

1. 显式 `selectedSkillId` → `"selectedSkillId"`
2. tool args `openbotSkillId` / `selectedSkillId` / `skillId` → `"tool_args"`
3. identity tool 名 `ob_sk_<skillId>__<base>` 或 binding/skill id 当 tool → `"identity_tool_name"`
4. 当前 loaded/enabled 集合中唯一声明该 tool 的 skill → `"unique_owner"`
5. 0 或多个 owner → `null`（不计次，防交叉污染）

Evidence 规则：

- 100% Skill Evidence 必须展示 `attributionResolution`，或显式 `unknown` / `prompt_named_use`。
- 不得把 `unique_owner` 与 `identity_tool_name` 写成同一置信度。
- `businessOutcome` 在现网常被复用为 resolution 字符串；**不能**当作企业业务结果。

---

## 4. 重叠与权威唯一性

| 重叠            | 唯一权威                                                     | 派生 / 消费者                                    | 禁止                       |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------ | -------------------------- |
| Skill 成功/失败 | Skill Invocation JSONL                                       | Skill Health 窗口；Governance tick 聚合          | 第三套计数器               |
| Skill 健康色    | Skill Health（派生）                                         | UI / repair-suggestions                          | 当单次 RCA                 |
| Agent 是否在线  | Agent runtime health                                         | Channel snapshot 输入                            | 当单次 Run 失败原因        |
| 渠道是否连通    | Channel policy 评估                                          | Agent health 的 binding facts；monitor 重启      | Diagnosis 重启             |
| 配置/安装问题   | 未来抽出的 Doctor **只读** check                             | Doctor CLI 修复；Security audit 部分重叠         | 诊断进程写配置             |
| 安全姿态        | `runSecurityAudit`                                           | Doctor `noteSecurityWarnings`                    | 两套 Finding 当两个根因    |
| 路由结果        | **尚不存在的** route-resolution 记录                         | `ResolvedAgentRoute` 热路径；Governance redirect | 用日志或 redirect 缓存冒充 |
| LLM/Tool 正文   | Session JSONL                                                | Hook 实时观察                                    | Diagnosis 复制全文         |
| 运行诊断信号    | 各权威模块                                                   | `diagnostic-events` 扇出；OTEL 导出              | diagnostic-events 当 Store |
| 修复是否生效    | Skill Invocation 同一口径 + Governance `effectVerifications` | Diagnosis Verification 协议对象                  | Governance store 当仓库    |

---

## 5. 与端投影的关系（不恢复独立 Ops）

四端计划曾定义独立 Ops。实施方案已裁决：旧 `/ops/incidents`、`/ops/diagnostics`（`ui/src/ui/navigation.ts`）只做兼容，映射到 Platform。`src/gateway/server-methods-list.ts` **没有** `diagnosis.*` RPC。

| 端         | 可读权威                                                   | 不可继承的副作用                                 |
| ---------- | ---------------------------------------------------------- | ------------------------------------------------ |
| Employee   | 自己的 Session JSONL、与该 session 关联的 Skill Invocation | doctor --fix、channel restart、governance action |
| Enterprise | 当前可信 tenant 下的 Agent/Skill/Session 引用              | 跨租户扫描、写 config                            |
| Platform   | 聚合索引 + 主机 Doctor/Security 只读结果                   | 不重建 Ops 主工作台                              |

---

## 6. Phase 0 允许 vs 禁止（本审计角色）

允许（给协议 / Scenario / 后续实现，**本文不写 TypeScript**）：

- 引用式 Evidence 类型与 `authorityRecordId` 规则
- 预留 route-resolution Evidence 接口
- 脱敏 fixture 指向真实路径形状
- 只读 adapter 接口描述（见配套 adapter 矩阵）

禁止：

- 把 `diagnostic-events.ts` 描述成耐久 Evidence Store
- 发明不存在的 PostgreSQL / 图库 / 业务事件湖
- 复制 OTEL 数据集
- 把 Evolution Governance 当 Diagnosis 仓库
- 宣称 route-resolution Evidence 已存在
- 修改生产运行时或他人脏文件

---

## 7. 需要主链才能补齐的缺口（只报告，不实现）

1. **Route decision 耐久化**：`resolveAgentRoute` 调用点需要结构化记录（或等价耐久引用），否则“未路由/错路由”只能 `INCONCLUSIVE`。
2. **Doctor 只读库拆分**：在抽出 `check*` 之前，Doctor Adapter 不安全。
3. **Hook / diagnostic-events → Journal**：若一期要在重启后回放 Agent/Tool，必须有 Diagnosis 自有 Journal；这不是第二套运行总线，也 **不能** 把 `diagnostic-events` 升级成 Store。
4. **`agent_end` 缺少 `runId`**：若要闭合 Agent Run，主链或 adapter 约定需要补齐关联（报告给 Protocol Engineer）。
5. **`prompt_named_use` 未写入 `attributionResolution`**：若开启该环境变量，Evidence 必须从 `businessOutcome` 或 invocationId 后缀识别，并标弱归因。

以上均超出 Authority Auditor 的文件范围。
