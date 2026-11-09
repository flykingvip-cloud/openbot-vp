# 执行与副作用入口清单（Phase A）

> 回答：「若只改 Pi 回合，哪些旁路仍在。」不改入口行为。
> 字段来自执行方案 §6.3。事实来自 PR #1249 差距评估，并在 Phase A 草案 `mainSha` 上复核路径仍在。
> **production-proven** 本轮一律不升格：未探测容器 `openbot-gateway-rc`。格子写 `unknown`。符号是否出现在当前账本生产 SHA（seq 97，`f1c7efece96d…`）上，只记在备注，那仍不是线上观测。

## 读表

| 字段              | 含义                                                                |
| ----------------- | ------------------------------------------------------------------- |
| 默认启用          | 默认配置或常量是否让该入口执行副作用。`code-present` 不等于默认执行 |
| Profile           | A = `personal_local`，B = `managed_enterprise`（`SECURITY.md`）     |
| 身份源            | 该入口消费的身份，不是宪法 Identity                                 |
| 授权点            | 可指出的门；没有则 `none`                                           |
| 工具过滤          | 工具被收窄的位置                                                    |
| 完成权威          | 谁可以写下该域终态。模型文本不是权威                                |
| 证据              | 回执、证明或审计落点。分级见权威文                                  |
| 失败语义          | 关闭、继续、或 `unknown`                                            |
| production-proven | 本文件全部为 `unknown`                                              |

热路径包络（不是裸执行）：`src/agents/pi-embedded-runner/run/attempt.ts` 在约 L1109 调用 `buildExecutionPreflight`。工具策略在 `src/agents/pi-tools.policy.ts`。这不覆盖下表旁路的强制收口。`/tools/invoke`、`node.invoke`、企业 capability invoke、ACP 进程内 dispatch（`tryDispatchAcpReply`）、ACP CLI 回合与 steer，以及 inter-agent bus（`sendAgentTask` / `sendAgentMention`）的观察态复用见 §10 注，默认不调用。AOR，以及 ACP 的 stdio 桥，预检关系仍是 `unknown`。已落地观察刀、明确非刀，以及 C10 仍不能 pass 的原因，见文末 FC-08。

Phase D 包与默认关闭的 Runtime façade / P8a 报告见文末「Phase D 后记」；它们当前是 `code-present`，热路径主决策仍未 import。

## 入口

### 1. CLI `src/runtime.ts`

| 字段              | 值                                                           |
| ----------------- | ------------------------------------------------------------ |
| 默认启用          | 是，但是 log/error/exit 包装（`defaultRuntime`），不跑 Agent |
| Profile           | 无分支                                                       |
| 身份源            | none                                                         |
| 授权点            | none                                                         |
| 工具过滤          | none                                                         |
| 完成权威          | none                                                         |
| 证据              | none                                                         |
| 失败语义          | 进程退出前恢复终端                                           |
| production-proven | `unknown`                                                    |

备注：禁止把它叫做宪法 Runtime 或 Agent OS runtime。符号在 seq 97 生产源 SHA 中存在。

### 2. CLI agent

| 字段              | 值                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 默认启用          | 是（用户命令 `openbot`）。`src/commands/agent.ts` 的 `agentCommandFromIngress`（约 L1426）进入与聊天相同的嵌入式回合             |
| Profile           | A 与 B 都可能；Fail Closed 语义不同                                                                                              |
| 身份源            | 本机操作者 + 配置里的 `agentId`。不是设备配对身份                                                                                |
| 授权点            | 与网关聊天回合相同的预检 / 工具策略（见 §3）                                                                                     |
| 工具过滤          | `buildExecutionPreflight` + `pi-tools.policy`                                                                                    |
| 完成权威          | 无单一聊天完成所有者。技能契约触发时交付门可改写完成宣称                                                                         |
| 证据              | 会话转录；有契约时 validation receipt。预检 trace 不跨进程                                                                       |
| 失败语义          | 预检拒绝执行与不可见是两条；无契约时差距评估称普通任务保持原样。#1255 之后的完成保持细节以 `completion-hold.ts` 为准，不在此升格 |
| production-proven | `unknown`                                                                                                                        |

### 3. Gateway 聊天热路径

| 字段              | 值                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 默认启用          | 是。通道 / Gateway RPC `agent` → `resolveAgentRoute` + sessionKey → `getReplyFromConfig`（`src/auto-reply/reply/get-reply.ts`）→ `runEmbeddedPiAgent` |
| Profile           | A 与 B。B 的缺上下文在启动 Gate 0（`src/gateway/security-profile.ts`）失败关闭；A 的沙箱默认关                                                        |
| 身份源            | Gateway 认证调用者；sessionKey 只做路由（`SECURITY.md`）                                                                                              |
| 授权点            | 方法 scope、工具策略、exec approval / allowlist、技能预检。不经过 Fabric `decide()`                                                                   |
| 工具过滤          | `src/agents/execution-preflight/` 与 `src/agents/tool-policy.ts`                                                                                      |
| 完成权威          | 分散。回合仍可由模型文本结束。交付预检只在技能契约要求时挡住一部分完成声明                                                                            |
| 证据              | 会话转录为主。不是宪法 Verify                                                                                                                         |
| 失败语义          | 局部门可拒绝工具；整段聊天不因 Fabric 未决而 DENY（Fabric 默认关）                                                                                    |
| production-proven | `unknown`                                                                                                                                             |

### 4. Fabric

| 字段              | 值                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| 默认启用          | 否。`src/fabric/feature.ts`：`OPENBOT_FABRIC_ENABLED` 或 `gateway.fabric.enabled` 才开，否则 fail-safe false |
| Profile           | 开关本身不分 Profile。未决审批 DENY 只在 `src/fabric/policy-runtime.ts` 的 `decide()` 内                     |
| 身份源            | 图编译期 ownership 元数据。不是聊天身份                                                                      |
| 授权点            | `decide()`（启用时）。风险只收紧不放宽                                                                       |
| 工具过滤          | Fabric `ToolRequest` / 图节点。不是默认工具约定                                                              |
| 完成权威          | 图内 `RunPhase`。不是全局完成机                                                                              |
| 证据              | 启用时的 `ExecutionEvent`。默认路径无此事件                                                                  |
| 失败语义          | 启用且审批未决 → DENY。默认关闭 = 聊天继续，不走这条 DENY                                                    |
| production-proven | `unknown`                                                                                                    |

备注：预检三态（FC-09）：**exemption+break-glass**。豁免的是预检三态**登记**（默认关不要求另挂 soft-observe），**不是**忽略旁路或授权启用。破玻璃 = `OPENBOT_FABRIC_ENABLED` / `gateway.fabric.enabled`——**不得为观察打开**。详见 `phase-c-83-allowed-entry-disposition.md`。

### 5. task-orchestration

| 字段              | 值                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| 默认启用          | 否（休眠）。`src/task-orchestration/types.ts:22` `ORCHESTRATION_LIVE_INVOKE = false`                                |
| Profile           | 影子观察不改变 A/B 合同                                                                                             |
| 身份源            | 派发输入上的身份字段；本阶段不把它升格为宪法 Identity                                                               |
| 授权点            | `dispatch.ts` 约 L161：即使常量被改成 true 也 fail-closed 返回 noop。影子路径强制 `invoke=false` 且 `enqueue=false` |
| 工具过滤          | 不调用工具。`surface-binding.ts` 只绑定符号名，`execute: false`                                                     |
| 完成权威          | none（`wroteLedger: false`，不创建 ConversationTask）                                                               |
| 证据              | 影子 reason code 日志。不是证明，v1 切片也不写生产 ledger                                                           |
| 失败语义          | 不抛错，返回 closed noop，避免拖垮聊天                                                                              |
| production-proven | `unknown`。常量在 seq 97 生产源 SHA 中已是 false                                                                    |

备注：预检三态（FC-09）：**exemption+break-glass**。豁免的是预检三态**登记**（休眠 / `ORCHESTRATION_LIVE_INVOKE=false` 不要求另挂 soft-observe），**不是**忽略旁路或授权 live invoke。破玻璃 = 翻 `ORCHESTRATION_LIVE_INVOKE` 或打开可使 live path 武装的 dispatch/node/browser 旗标——**仍未授权**。详见 `phase-c-83-allowed-entry-disposition.md`。

### 6. ConversationTask

| 字段              | 值                                                                                                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 默认启用          | code-present，默认不写任务。五个 `OPENBOT_CONVERSATION_TASK_*` 环境旗标 unset 为 false；配置库不能打开 activation / projection / authorization。激活与回复关闭都先看 `OPENBOT_CONVERSATION_TASK_ACTIVATION`。生产配置是否打开：`unknown`                                     |
| Profile           | `openTenantScopedDb` 闭合本库的租户文件隔离（一租户一文件，`meta.tenant_id` 失败关闭）。本目录不读安全 Profile / Gate 0。是否等于 Profile B：`unknown`。缺 tenant 且有 requester 时，激活路径使用字面量 `local`                                                              |
| 身份源            | task 记录上的租户 / 会话绑定。热路径取值来自 `dispatch-from-config` 的服务端 `sourceContext`，细节不在本清单重写                                                                                                                                                             |
| 授权点            | 焦点切换门仍在（`applyFocusSwitchGate`）。另有激活写前 ACL、影子观察 ACL、回复关闭与 `active.get` 的 requester/owner 过滤、焦点恢复 / 心跳 / 主会话 cron 的 `decideWake`。`resolveAuthorization` 与 authorization 旗标不是本轮读到的热路径门。未逐函数重读的门保持 `unknown` |
| 工具过滤          | 自身不替代 Pi 工具过滤                                                                                                                                                                                                                                                       |
| 完成权威          | 本域局部 FSM。不得假装已合成跨域写权威                                                                                                                                                                                                                                       |
| 证据              | 任务存储转移。不是演进 proof                                                                                                                                                                                                                                                 |
| 失败语义          | 按已读转移分列，见下方 FC-08b。开库与非法 `transitionTask` 抛错；激活钩子与回复关闭吞错，聊天继续；焦点冲突挡住该次 `chat.send`。未读转移保持 `unknown`                                                                                                                      |
| production-proven | `unknown`（未探测 `openbot-gateway-rc`）                                                                                                                                                                                                                                     |

跨域终态化握手（FC-02，A/C observe）：默认关闭。`OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT` 未设置时，关闭路径对 delivery-hold 的运行时咨询次数仍为 0，行为与「协议缺失 / 零咨询」基线相同。旗标打开后，关闭前只读咨询 `consultDeliveryHoldForClose`（hold、完成宣称裁决、validation receipt），记录观察结果，不推迟 `closed`。咨询抛错被吞掉，随后仍写本域 `closed`。这不是 Meta-Schema，不创建跨域写权威。Phase C 裁决保持 NO-GO。FC-08b 不改这条观察，不新开旗标，不把本行收成预检三态。

#### FC-08b 稀疏格复核（文档；不接线）

本注只记账已读源码。不改 `src/`，不新开环境旗标，不新增 `buildExecutionPreflight` 调用点，不调用 `applyPreflightToTools` / `armCompletionHold`，不打开 Phase D、enforce、live invoke 或 Fabric default-on。production-proven 保持 `unknown`。

**默认启用（code-present，生产未证）。** `src/conversation-task/feature.ts` 的 detection / qualification / activation / projection / authorization 只认环境变量 `1` / `true` / `yes` / `on`，unset 为 false。`ConversationTaskConfigStore.isFlagEnabled` 对后三个恒返回 false，`setFlag` 拒绝打开它们；detection / qualification 缺行或读失败也是 false。新的激活控制面行初始 `forced_off=1`（`control-plane.ts` 的 `ensureRow`）。`initActivationHookFromServerConfig` 只在环境旗标 `OPENBOT_CONVERSATION_TASK_ACTIVATION` 已开时，以 `confirmedByHuman: true`、actor `env-activation-flag`、`minReopenIntervalMs: 0` 调用 `attemptReopen`。旗标关则不重开，激活写路径保持 `shadow_frozen`。这仍是代码事实。生产配置是否把该环境变量打开：`unknown`。

**Profile。** `openTenantScopedDb`（`store.ts`）要求非空 `tenantId`，文件键是租户字节的全长 SHA-256，打开时核对 `meta.tenant_id`。不符抛 `TenantIsolationViolationError`（`meta_mismatch`）；有业务行却没有 meta 抛 `meta_missing_with_data`；WAL / foreign_keys / busy_timeout 自检失败抛 `pragma_failed`。这三者和缺 tenant 都会关掉这次连接。注释写明 open 函数本身没有 personal fallback。任务库与影子日志库共用该协议。

该函数不读 `OPENBOT_SECURITY_PROFILE`、`gateway.security.profile` 或 `src/gateway/security-profile.ts`，默认根是 `CONFIG_DIR/conversation-task`。本入口因此证明的是租户文件隔离。Profile B（`managed_enterprise` / Gate 0 专用租户卷）是否由此闭合：仍 `unknown`。

`resolveActivationTenantId` 在 tenant 为空且 requester 非空时返回字面量 `local`。`observeInboundTurnActivation` 与 `conversation-task.active.get` 会把这个值交给 `openTaskStore`。那是激活别名。它不读取 Gate 0 的专用租户卷。

**授权点（焦点切换之外，本轮读到的）。**

| 门               | 位置                                                                                                                                  | 读到的行为                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 焦点切换         | `applyFocusSwitchGate`，调用点 `src/gateway/server-methods/chat.ts`                                                                   | 冲突则 `status: focus_switch_blocked` 并 return。`focusSwitchProceed` / `focusSwitchCancel` 不调用此门。缺会话文件或函数内抛错记 `focus_state_unavailable`；空正文或以 `/` 开头记 `focus_clear`。外层 catch 只记 `focus_state_unavailable`。这些路径都继续这次发送                                                |
| 激活写前 ACL     | `runActivationGate` 在 `createTaskIfAbsent` 前调用 `assertConversationTaskAccess`、`assertTenantStoreBinding`、`assertDetectionScope` | 缺可信 tenant / requester / conversation、会话不在授权集、或 `employeeScopeAllowed` 为 false，抛 `ConversationTaskAccessError`，不写。钩子自己填 scope：`authorizedConversationIds` 缺省为仅含当前 conversationId 的集合；`employeeScopeAllowed` 取入参，或在 requester 非空时为 true。填入的是当前会话的自洽集合 |
| 影子观察 ACL     | `shadow-observer.ts` 的 `observe`                                                                                                     | 调用 `assertConversationTaskAccess` 与 `assertDetectionScope`，不调用 `assertTenantStoreBinding`。拒绝则 `skipped_scope_rejected`，不抛进回复。影子 allowlist 只用 `allowCache.isAllowed`（空名单则跳过）。激活名单在 `hasAnyEnabledTenant()` 为 false 时放行全部租户；读失败时该函数为 true，改走名单            |
| 回复关闭过滤     | `observeConversationTaskReplyCompleted`                                                                                               | 不调用 ACL 模块。只保留 `requesterId` 或 `ownerId` 等于本次 requester 的 active 任务                                                                                                                                                                                                                              |
| 进度读           | `conversation-task.active.get`                                                                                                        | `resolveTrustedAttribution`；无 ownerId 则返回空数组。打开的任务同样按 requester/owner 过滤。不调用 ACL 模块                                                                                                                                                                                                      |
| 焦点提示         | `buildActiveConversationTaskFocusPrompt`                                                                                              | activation 旗标关、身份缺失、无匹配任务、或抛错：返回 `undefined`，不注入。过滤规则与回复关闭相同，无额外 ACL                                                                                                                                                                                                     |
| 焦点恢复         | `conversation_send` 工具调用 `applyFocusResumeGate`                                                                                   | 会话文件不可读，或决定为 `require_user_choice`：工具 `ok: false`，不投送                                                                                                                                                                                                                                          |
| 心跳焦点         | `decideHeartbeatMainSessionRun`（`src/infra/heartbeat-runner.ts`）                                                                    | `run: false` 时这次心跳不打进当前 LLM 回合，状态 `skipped`。占用焦点的巡逻直接跳过；事件唤醒按 `decideWake` 得到 park / `reject_park_full` / `reject_identity_create`                                                                                                                                             |
| 主会话 cron 注入 | `decideCronMainSessionSurface`                                                                                                        | 只有 `acquire_focus` 注入全文。`park` / `reject_park_full` 改成 parked notice。其余 action 跳过这次注入                                                                                                                                                                                                           |

`resolveAuthorization` 只在离线 `evaluateTurn`（grant 恒为 false，有副作用则为 `human_gate_required`）和测试里出现。`OPENBOT_CONVERSATION_TASK_AUTHORIZATION` 被读进旗标对象；本轮读过的热路径不用它当门。

**失败语义（只列读过的转移）。**

| 转移                                    | 语义                                                                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `openTenantScopedDb` / `openTaskStore`  | 缺 tenant、meta 不符、有数据无 meta、pragma 失败：抛错并关掉这次库。关闭的是这次 open                                                                                                                                                      |
| `transitionTask`                        | 合法边只有 draft 到 active 或 cancelled、active 到 closed 或 cancelled。`closed` / `cancelled` 的出边为空。找不到行或非法边抛 `ConversationTaskStoreError`。终态不重开。这次写关闭                                                         |
| 激活钩子 `observeInboundTurnActivation` | 未初始化、旗标关、无 requester、无 conversation、无租户、租户不在允许集：返回跳过状态，不写。`not_eligible` 不写。ACL 或开库抛错被收成 `"error"`，不抛进 `dispatch-from-config`。聊天继续                                                  |
| 控制面                                  | 快照读失败：`forcedOff: true`（`failSafeSnapshot`），激活写停。`evaluateReopen` 在未降级、缺人工确认、缺 actor、冷却未过、或 RCA 未解时返回 `reopened: false`。降级 `evaluate` 越阈时 `forceOff`，已降级不再自行重开                       |
| 回复关闭                                | activation 关、身份或正文缺失、无匹配 active 任务、助手回复与 goal 不对齐：return，任务保持 active，回复继续。咨询旗标开时咨询失败被吞掉，仍尝试写 `closed`。ledger 或 `transitionTask` 抛错被外层吞掉，回复继续，该次 `closed` 可能没写上 |
| `chat.send` 焦点门                      | 冲突：这次发送关闭（`focus_switch_blocked`）。缺焦点状态或抛错：发送继续                                                                                                                                                                   |
| `conversation_send` 焦点恢复            | 不可读或需要主人选择：不投送                                                                                                                                                                                                               |
| 心跳 / 主会话 cron                      | 见上表。挡住的是这次心跳回合或全文注入，不是 ConversationTask 的 `closed`                                                                                                                                                                  |

未在本轮逐行读完的转移保持 `unknown`。包括 candidate 过期清理、`task_revisions` 写入（P2 保留表但不写）、以及 Progress Ledger 逐步状态机内部。

**仍 unknown。** Profile B 是否被本入口闭合；生产配置与 `openbot-gateway-rc`（production-proven）；上段未读转移；插件装载的 Profile B 与 production-proven（失败形态已由 FC-08c 复核）；本行的预检三态（FC-02 只覆盖关闭前的 delivery-hold 观察，不把整行收成 explicit reuse-observe）。Profile B / Cron·subagent 三态外状态的汇总见 FC-08d（`docs_phase_d_sparse_unknown.md`）。

### 7. Evolution（v1 与 v2 并列）

| 字段              | 值                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 默认启用          | 子系统 code-present。生产治理模式以发布记录为准，不在此宣称 global auto                                                                                |
| Profile           | 表面与外部凭证失败关闭写在 `packages/evolution-core`（`surfaces.ts`、`external-effect.ts`）。对 A 的冲击表尚未单列：保持 `unknown` 直至安全 Owner 补表 |
| 身份源            | proposal 的 surface 归属                                                                                                                               |
| 授权点            | `state-machine.ts` 转移表与 `authority-recheck.ts`                                                                                                     |
| 工具过滤          | 不经过 Pi 工具策略                                                                                                                                     |
| 完成权威          | v2 状态机终态冻结。v1 `src/diagnosis/evolution-proposal.ts` 仍并行。双权威是事实，不是待合并的全局机                                                   |
| 证据              | `lineage.ts`：receipt 与 proof 分开                                                                                                                    |
| 失败语义          | 禁止捷径；未支持 surface / 凭证解析失败关闭（演进对象内）                                                                                              |
| production-proven | `unknown`                                                                                                                                              |

### 8. 技能交付

| 字段              | 值                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| 默认启用          | 嵌在嵌入式 attempt 内。无技能契约时不另造一道全球门                                                            |
| Profile           | 随聊天回合的 A/B，不单独切换                                                                                   |
| 身份源            | 沿用回合身份。校验器由宿主代码 `registerTrustedValidator` 登记，模型文本不能自注册                             |
| 授权点            | `resolveAttemptDelivery`（`delivery.ts`）与契约要求的校验器                                                    |
| 工具过滤          | 预检按契约收窄工具                                                                                             |
| 完成权威          | 本域 near-conforming：校验回执约束完成宣称。不是聊天/演进/发布的写者                                           |
| 证据              | `issueValidationReceipt` 是回执，不是 proof                                                                    |
| 失败语义          | 缺必需回执时完成宣称可被挡住（#1255 在评审快照之后收紧了 receipt / artifact 要求）。精确用户可见文案以代码为准 |
| production-proven | `unknown`。#1255 不在 seq 97 生产源 SHA 内                                                                     |

### 9. 插件装载

| 字段              | 值                                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 默认启用          | 已配置插件随 Gateway 装载（`src/plugins/loader.ts`、`registry.ts`）                                                                                                                                                                                                       |
| Profile           | A：安装即受信基座。B：不得因此获得全部租户数据的无限制进程内访问                                                                                                                                                                                                          |
| 身份源            | 插件清单身份，不是操作者 grant                                                                                                                                                                                                                                            |
| 授权点            | 安装信任 ≠ 工具授权。工具仍要过策略与预检                                                                                                                                                                                                                                 |
| 工具过滤          | `registerTool` 之后仍进 Pi 策略过滤；插件表本身不是过滤器                                                                                                                                                                                                                 |
| 完成权威          | none                                                                                                                                                                                                                                                                      |
| 证据              | 清单登记。不是能力 grant 审计                                                                                                                                                                                                                                             |
| 失败语义          | 按已读装载门分列，见下方 FC-08c。未过 enable 的插件记 `disabled`，reason 在 `record.error`，不抛、不写 diagnostics，循环继续，不调用 `register`。空 `plugins.allow` 不是拒绝。完整性钉不符是该插件 `error`，仍不中止 Gateway。Profile B 与 production-proven 仍 `unknown` |
| production-proven | `unknown`                                                                                                                                                                                                                                                                 |

#### FC-08c 稀疏格复核（文档；不接线）

本注只记账已读源码。不改 `src/`，不新开环境旗标，不新增 `buildExecutionPreflight` 调用点，不调用 `applyPreflightToTools` / `armCompletionHold`，不打开 Phase D、enforce、live invoke 或 Fabric default-on。production-proven 保持 `unknown`（未探测 `openbot-gateway-rc`）。装载器不读安全 Profile / Gate 0。Profile B 是否被本入口闭合：仍 `unknown`。

**未授权 / 拒绝装载（enable 门）。** `loadOpenBotPlugins`（`src/plugins/loader.ts` 转到 `src/plugins/loader/load-orchestration.ts`）对每个已有清单记录的候选调用 `resolveEffectiveEnableState`（`src/plugins/config-state.ts` 的 `resolveEnableState`）。未启用时：`status = "disabled"`，`record.error` 为 reason，推入 registry 后 `continue`。不抛。不打日志。不向 `registry.diagnostics` 追加。不调用插件的 `register`，因此该插件不会 `registerTool`，不会进入 `registry.tools`。同一轮里其它已启用插件仍照常装载。`plugins.enabled !== false` 时缺省为开；全局关闭时 `resolvePluginTools`（`src/plugins/tools.ts`）直接返回空工具列表。

| 条件                                                                     | reason                          | 读到的行为                                                                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins.enabled === false`                                              | `plugins disabled`              | 每个已发现候选走上面的 disabled 跳过                                                                                                                     |
| `plugins.deny` 含该 id                                                   | `blocked by denylist`           | 先于 allow 与 memory slot。allow 里有它也禁用                                                                                                            |
| `entries[id].enabled === false`                                          | `disabled in config`            | 先于 memory slot 与 allow                                                                                                                                |
| memory slot 选中该 id                                                    | （启用，无 reason）             | 非空 allow 漏掉它仍启用，除非上面三门已拒绝                                                                                                              |
| 非空 allow 且不含该 id                                                   | `not in allowlist`              | disabled 跳过。这一门先于 bundled 默启，所以默启 bundled 也不例外                                                                                        |
| bundled 且不在 `BUNDLED_ENABLED_BY_DEFAULT`，并且没有被上面的 allow 拒绝 | `bundled (disabled by default)` | 仅此 reason 时，`channels.<id>.enabled === true` 会由 `resolveEffectiveEnableState` 改回启用。非空 allow 已写成 `not in allowlist` 的，通道开关改不回来  |
| 其余非 bundled，allow 为空                                               | （启用）                        | 不是拒绝。`warnWhenAllowlistIsOpen`（`src/plugins/loader/provenance.ts`）打 warn：`plugins.allow is empty; discovered non-bundled plugins may auto-load` |

**Gateway 是否继续。** `loadGatewayPlugins`（`src/gateway/server-plugins.ts`）只把已有 diagnostics 打进日志（error 级用 `log.error`），然后返回 registry。未授权的 disabled 记录没有 diagnostics，所以这条 reason 不出现在该启动日志。`src/gateway/server.impl.ts` 在 `loadGatewayPlugins` 返回后继续组装通道与运行时配置。本路径不因单个插件未授权而抛错退出。

**用户可见文本。** reason 写在 `PluginRecord.error`。非 verbose 的插件列表只显示 status `disabled`。verbose 列表印 `error: <reason>`，插件 info 印 `Error: <reason>`，`--json` 带上该字段（`src/cli/plugins-cli.ts`），尽管 status 不是 `error`。`plugins doctor` 只列 `status === "error"`，因此 allow / deny / 全局关闭不会出现在 doctor 的 Plugin errors。工作区 doctor 只计 Disabled 数量，不印 reason（`src/commands/doctor-workspace-status.ts`）。装载门没有面向聊天的拒绝文案。

**已放行之后的相邻失败（不是未授权）。**

| 情况                                                        | 形态                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 同一 manifest id 再次出现                                   | 后到的候选记 `disabled`，`record.error` 为 `overridden by <先到 origin> plugin`，不 `register`。发现顺序是 config、workspace、bundled、global。这不是 allow/deny                                                      |
| 清单打不开                                                  | `src/plugins/manifest-registry.ts` 记 error diagnostic 后跳过。该候选没有插件记录。循环继续                                                                                                                           |
| `plugins.allow` 对象项的 sha256 钉不符或钉格式非法          | `verifyPluginEntryIntegrity`（`src/plugins/integrity.ts`）失败后 `status = "error"`，`record.error` 以 `integrity check failed:` 开头，记 error diagnostic，不 `register`，循环继续。注释写明这是供应链绊线，不是沙箱 |
| 入口路径越界、缺 config schema、配置校验失败、缺 `register` | `status = "error"` 加 diagnostic。装载器不向外抛                                                                                                                                                                      |
| `jiti` 导入或 `register()` 抛错                             | `recordPluginError`（`src/plugins/loader/plugin-record.ts`）吞掉，记日志与 diagnostic，循环继续。导入失败时装载器不调用 `register`                                                                                    |
| `register()` 里已经 `registerTool` 再抛错                   | catch 不回滚 `registry.tools`。`resolvePluginTools` 按 `registry.tools` 枚举，不看插件 status。未授权路径到不了这里                                                                                                   |

**启用与安装不是这条失败。** `enablePluginInConfig`（`src/plugins/enable.ts`）在全局关闭或 denylist 时返回 `{enabled:false, reason}` 且不改配置；否则写入 enabled 并 `ensurePluginAllowlisted`。`src/plugins/install.ts` 不读 `plugins.allow` / `deny`。安装自己的 `{ok:false, error}` 或抛错不在本格升格。插件命令的发送者未授权是另一面：`executePluginCommand`（`src/plugins/commands.ts`）返回 `⚠️ This command requires authorization.`，不卸载已装载插件。

**仍 unknown。** Profile B；production-proven（未探测 `openbot-gateway-rc`）；本行的预检三态（插件装载不是预检刀）。已成功装载的插件，工具是否再被 Pi 策略挡住，仍以上表「安装信任 ≠ 工具授权」为准，本注不重写那一格。Profile B 汇总见 FC-08d（`docs_phase_d_sparse_unknown.md`）。

### 10. 其余旁路（同一九字段；未显式化的格子保持 unknown）

| 入口                                                                                    | 默认启用                                                                                                                                                      | Profile                                                                | 身份源                                                               | 授权点                                                                                                                                                          | 工具过滤                                                                                        | 完成权威                                                                                     | 证据                                                                                                                    | 失败语义                                                                                                                                                                                                             | production-proven |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `/tools/invoke` `src/gateway/tools-invoke-http.ts`                                      | code-present；预检 observe 默认关                                                                                                                             | A/B                                                                    | Gateway 认证                                                         | 方法 scope；预检三态：explicit reuse-observe                                                                                                                    | HTTP allow/deny 仍是唯一收窄源                                                                  | none（不挂 completion hold）                                                                 | 旗标开才有 preflight trace；不是 proof                                                                                  | 旗标关保持既有 HTTP 状态码；observe 失败不改写 200/4xx                                                                                                                                                               | `unknown`         |
| `node.invoke` / `NodeRegistry` `src/gateway/server-methods/nodes.ts`                    | 已配对设备才执行；预检 observe 默认关                                                                                                                         | A 下配对后接近操作者能力                                               | 设备配对 `src/infra/device-pairing.ts`                               | 节点命令策略；预检三态：explicit reuse-observe                                                                                                                  | 节点 allowlist 仍是唯一收窄源                                                                   | none（不挂 completion hold）                                                                 | 旗标开才有 preflight trace；不是 proof                                                                                  | 旗标关保持既有 ok/reason；observe 失败不改写结果                                                                                                                                                                     | `unknown`         |
| ACP `src/acp/` + 进程内 dispatch `src/auto-reply/reply/dispatch-acp.ts`                 | 策略默认开（`acp.enabled !== false`，dispatch 同理）；无已注册 backend 时 `ACP_BACKEND_MISSING`，不跑回合。进程内回合、CLI 回合与 steer 的预检 observe 默认关 | 本目录不分 A/B                                                         | runtime 会话身份，或 stdio 桥的 Gateway CLI 凭据                     | dispatch 门 + `allowedAgents`（空=不额外限制）。进程内 dispatch、CLI ACP 回合与 steer 预检三态：explicit reuse-observe。stdio 桥仍 unknown，且明确非刀（FC-08） | 进程内回合、CLI 回合与 steer 不经 Pi 工具策略；工具在外部 `AcpRuntime`。观察态丢弃预检 allow 集 | 会话局部 idle/running/error，不是全局完成机                                                  | 会话 meta / `lastError`；stdio provenance 默认 off。进程内 dispatch 与 CLI/steer 旗标开才有 preflight trace。不是 proof | 政策或 backend 缺失抛 `AcpRuntimeError`；dispatch 失败仍记 completed 并投递错误文本。stdio 把 gateway `error` 映射为 `end_turn`。旗标关与 observe 失败不改写该回合，也不改写 CLI payloads / 错误或 steer 回复 / 错误 | `unknown`         |
| Cron / subagent                                                                         | 隔离 Cron 直接调用 `runEmbeddedPiAgent`；主会话 Cron 经心跳回复路径；subagent spawn/announce 经网关 `method:"agent"`。见文末 FC-08                            | 随父会话                                                               | 父 agent + spawn 策略                                                | 子代理工具策略。预检三态未收成 reuse-observe、豁免+break-glass 或删除；不另挂观察旗标                                                                           | 子代理 allow/deny                                                                               | 子代理登记是局部状态，不是全局完成机                                                         | 投递回执 ≠ proof                                                                                                        | 超时不得报成成功（产品行为，见 changelog；本清单不重审）                                                                                                                                                             | `unknown`         |
| AOR `packages/aor-core`                                                                 | 库。热路径不构造 `Orchestrator`；执行只在注入 backend 之后（适配器 HTTP/RPC，或默认关的 Fabric kernel）                                                       | 无 A/B 分支。`tenantId` 才给会话键加前缀；是否等于 B 隔离：`unknown`   | `TenantContext`（包内计划身份，不是宪法 Identity）                   | selector / 注入的 backend；预检三态：unknown                                                                                                                    | 不是 Pi 过滤器。可选 `ToolInvoker` 由调用方打到 `/tools/invoke`                                 | 图内 `AorRunResult` + 可选 evaluator 分数。不是宪法 Path                                     | `buildAuditRecord` 内存记录。不是 proof                                                                                 | 缺 skill 或缺终态节点抛错；evaluator 不阻断返回。适配器 tool 失败返回 `{ok:false}`                                                                                                                                   | `unknown`         |
| 企业 capability invoke `src/gateway/enterprise-data/capability-agent-invoke-runtime.ts` | code-present；预检 observe 默认关                                                                                                                             | 面向 B 的企业数据面；A 是否可达：`unknown`                             | 服务端席位上下文                                                     | 企业 grant / quota；预检三态：explicit reuse-observe                                                                                                            | grant/quota 仍是唯一收窄源                                                                      | 企业域局部（不挂 completion hold）                                                           | 旗标开才有 preflight trace；不是 proof                                                                                  | 旗标关保持既有 ok/reason；observe 失败不改写结果。缺上下文在 B 仍失败关闭（Gate 0）                                                                                                                                  | `unknown`         |
| `knowledge.capability.invoke` `src/gateway/knowledge/capability-invoke-runtime.ts`（RPC：`src/gateway/server-methods/knowledge.ts`） | code-present；返回已物化 metadata；**无** live connector | 面向企业/知识面；A 是否可达：`unknown` | 服务端席位 / KnowledgeSourceContext | seat access + quota + audit；预检三态：**exemption+break-glass**（FC-09；非 soft-observe） | none（本入口不执行 Pi 工具；亦非 live connector） | 知识域局部（物化目录视图） | capability invocation audit；不是 proof | not-authorized / not-found / no-tenant / no-seat / quota-exceeded → `ok:false`；不抛进 RPC 成功壳 | `unknown`         |
| inter-agent bus `src/organization/inter-agent-bus.ts`                                   | 可调用，不是独立执行器。任务通知要 `notify===true`；带 mention 的 chat 才走 `sendAgentMention`。预检 observe 默认关                                           | 本文件不分 A/B。目标是组织作用域 agent 会话；B 隔离是否成立：`unknown` | `agent:<id>:main:space:<org>` + `inputProvenance.kind=inter_session` | 不在本文件（任务：协调者或 `assign_tasks`；mention：组织成员）。预检三态：explicit reuse-observe                                                                | none（本文件不执行工具）。观察态丢弃预检 allow 集                                               | none（不挂 completion hold）。`accepted` 只表示网关收下 run；任务终态在 `task-assignment.ts` | `runId` 与 provenance。旗标开才有 preflight trace。不是 proof                                                           | 捕获后返回 `{status:error}`，不抛。mention 错误不中止宿主回合。旗标关与 observe 失败不改写 status accepted / error 或 runId                                                                                          | `unknown`         |

**`/tools/invoke` 预检三态（FC-01 observe）**

旁路闭合目标三态是「复用预检 | 显式豁免+break-glass | 删除」。本入口已离开 `unknown`，当前态是 **explicit reuse-observe**（复用预检的观察态，不是 enforce）：

| 态                                                 | 含义                                                      | 本切片                                                                                                                                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unknown                                            | 未说明是否复用预检                                        | 已离开                                                                                                                                                                                                                     |
| explicit reuse-observe                             | 调用既有 `buildExecutionPreflight`，只记 trace / decision | **当前**。`OPENBOT_HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE` 为 `1` / `true` / `yes` / `on` 时，在既有策略与 HTTP deny 之后、`tool.execute` 之前调用。默认 unset 不调用，HTTP 200/4xx 与今日相同。不把预检 allow 集写回工具列表 |
| explicit reuse-enforce、显式豁免+break-glass、删除 | 用预检收窄或拒绝，或声明豁免，或移除入口                  | 未授权。不调用 `applyPreflightToTools`，不 `armCompletionHold`，不因预检改状态码，不打开 live invoke / Fabric / B1/B2 / toolkit phase2                                                                                     |

**企业 capability invoke 预检三态（FC-03a observe）**

旁路闭合目标三态是「复用预检 | 显式豁免+break-glass | 删除」。本入口已离开 `unknown`，当前态是 **explicit reuse-observe**（复用预检的观察态，不是 enforce）：

| 态                                                 | 含义                                                      | 本切片                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unknown                                            | 未说明是否复用预检                                        | 已离开                                                                                                                                                                                                                                                                                                                           |
| explicit reuse-observe                             | 调用既有 `buildExecutionPreflight`，只记 trace / decision | **当前**。`OPENBOT_ENTERPRISE_CAPABILITY_INVOKE_PREFLIGHT_OBSERVE` 为 `1` / `true` / `yes` / `on` 时，在席位、grant、quota 通过之后、`invokeEnterpriseDataAction` 之前调用。合成 taskId 为 `enterprise-capability-invoke:<tenantId>:<seatId>:<capabilityId>`。默认 unset 不调用，ok/reason 与今日相同。不把预检 allow 集写回授权 |
| explicit reuse-enforce、显式豁免+break-glass、删除 | 用预检收窄或拒绝，或声明豁免，或移除入口                  | 未授权。不调用 `applyPreflightToTools`，不 `armCompletionHold`，不因预检改 ok/reason，不打开 live invoke / Fabric / B1/B2                                                                                                                                                                                                        |

**node.invoke 预检三态（FC-03b observe）**

旁路闭合目标三态是「复用预检 | 显式豁免+break-glass | 删除」。本入口已离开 `unknown`，当前态是 **explicit reuse-observe**（复用预检的观察态，不是 enforce）：

| 态                                                 | 含义                                                      | 本切片                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unknown                                            | 未说明是否复用预检                                        | 已离开                                                                                                                                                                                                                                                                                                         |
| explicit reuse-observe                             | 调用既有 `buildExecutionPreflight`，只记 trace / decision | **当前**。`OPENBOT_NODE_INVOKE_PREFLIGHT_OBSERVE` 为 `1` / `true` / `yes` / `on` 时，在节点会话已连接、命令 allowlist、参数消毒通过之后、`nodeRegistry.invoke` 之前调用。合成 taskId 为 `node-invoke:<nodeId>:<command>`。默认 unset 不调用，ok/reason 与今日相同。不把预检 allow 集写回节点命令策略或配对结果 |
| explicit reuse-enforce、显式豁免+break-glass、删除 | 用预检收窄或拒绝，或声明豁免，或移除入口                  | 未授权。不调用 `applyPreflightToTools`，不 `armCompletionHold`，不因预检改 ok/reason，不打开 live invoke / Fabric / B1/B2                                                                                                                                                                                      |

**ACP 进程内回合预检三态（FC-05 observe）**

只覆盖 `tryDispatchAcpReply`：会话解析不是 `none`、dispatch 政策与 `allowedAgents` 已通过、且即将调用 `AcpSessionManager.runTurn`（其内才是 `runtime.runTurn`）。不是整个 `src/acp/`。旁路闭合目标三态是「复用预检 | 显式豁免+break-glass | 删除」。该进程内 dispatch 回合已离开 `unknown`，当前态是 **explicit reuse-observe**（复用预检的观察态，不是 enforce）。stdio 桥仍是 unknown。CLI ACP 回合与 steer 由 FC-07 覆盖，不挂本旗标。

四条缝，不要合成一条「整个 ACP 已复用预检」：

| 缝              | 代码                                                                                                                                                                                                             | 和预检的关系                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 进程内 dispatch | `src/auto-reply/reply/dispatch-acp.ts` 的 `tryDispatchAcpReply`：`resolveSession` 不是 `none` 时调用 `AcpSessionManager.runTurn`（`src/acp/control-plane/manager.core.ts`），再交给已注册的 `AcpRuntime.runTurn` | **explicit reuse-observe**。`OPENBOT_ACP_TURN_PREFLIGHT_OBSERVE` 默认关。离开 `attempt.ts`。工具在外部 backend（注册表见 `src/acp/runtime/registry.ts`），不经 `pi-tools.policy`。allow 集丢弃 |
| stdio 桥        | `src/acp/server.ts` 的 `serveAcpGateway`；`src/acp/translator.ts` 的 `prompt` 调 Gateway `chat.send`                                                                                                             | 仍 unknown，且明确非刀（FC-08）：不另挂软观察。桥自己不调用预检。目标若是普通会话，副作用在网关聊天热路径；目标若已是 ACP 会话，可能再进 FC-05。provenance 默认 `off`                          |
| CLI 回合        | `src/commands/agent.ts` 的 `agentCommandInternal`：ACP 会话 `ready`、dispatch 政策与 `allowedAgents` 通过之后、`runTurn`（`mode: "prompt"`）之前                                                                 | **explicit reuse-observe**（FC-07）。`OPENBOT_ACP_TURN_PREFLIGHT_OBSERVE` 不挂这里。见下一节                                                                                                   |
| steer           | `src/auto-reply/reply/commands-acp/lifecycle.ts` 的 `handleAcpSteerAction` → `runAcpSteer`，既有门通过之后、`runTurn`（`mode: "steer"`）之前                                                                     | **explicit reuse-observe**（FC-07）。`OPENBOT_ACP_TURN_PREFLIGHT_OBSERVE` 不挂这里。见下一节                                                                                                   |

策略事实（`src/acp/policy.ts`，测试断言默认开启）：`acp.enabled !== false` 且 `acp.dispatch.enabled !== false` 视为开启；`allowedAgents` 为空表示不再额外限制。这不是「无 backend 也会执行」：`requireAcpRuntimeBackend` 在没有健康 backend 时抛 `ACP_BACKEND_MISSING`。失败语义分两处：进程内 dispatch 把错误文本交给投递，并 `recordProcessed("completed", reason=acp_error:…)`（`dispatch-acp.ts`）；stdio 在 gateway 事件 `state==="error"` 时用 ACP `end_turn`，不把它当成拒绝（`translator.ts`）。完成权威是会话状态 `idle` / `running` / `error` 与 `lastError`，不是宪法完成机。旗标关与 observe 失败不改写该回合。

| 态                                                 | 含义                                                      | 本切片                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unknown                                            | 未说明是否复用预检                                        | 进程内 dispatch 回合已离开。stdio 桥（`src/acp/server.ts`）仍是 unknown，且明确非刀（FC-08）。CLI 回合与 steer 不在本旗标下，见 FC-07                                                                                                                                                                                                                                                   |
| explicit reuse-observe                             | 调用既有 `buildExecutionPreflight`，只记 trace / decision | **当前（仅进程内 dispatch）**。`OPENBOT_ACP_TURN_PREFLIGHT_OBSERVE` 为 `1` / `true` / `yes` / `on` 时，在政策与 allowlist 通过之后、`runTurn` 之前调用。合成 taskId 为 `acp-inprocess-turn:<sessionKey>:<agentId>`。默认 unset 不调用，回合文本、错误文本与 `recordProcessed` 与今日相同。不把预检 allow 集写回 runtime、backend 或派发结果。ACP runtime 工具目录不在本进程，本层看不到 |
| explicit reuse-enforce、显式豁免+break-glass、删除 | 用预检收窄或拒绝，或声明豁免，或移除入口                  | 未授权。不调用 `applyPreflightToTools`，不 `armCompletionHold`，不因预检改 stop reason、错误文本或 `recordProcessed`，不打开 live invoke / Fabric / Phase D                                                                                                                                                                                                                             |

**ACP CLI 回合与 steer 预检三态（FC-07 observe）**

只覆盖两处，共用默认关闭的旗标 `OPENBOT_ACP_CLI_STEER_PREFLIGHT_OBSERVE`（`1` / `true` / `yes` / `on`）。不是 stdio 桥，也不是 FC-05 的 `tryDispatchAcpReply`。旁路闭合目标三态是「复用预检 | 显式豁免+break-glass | 删除」。这两处已离开 `unknown`，当前态是 **explicit reuse-observe**（复用预检的观察态，不是 enforce）。stdio 桥仍不另挂一刀：它是网关客户端。目标普通会话已经走热路径；目标 ACP 会话可能再进 FC-05 进程内 observe。

| 缝       | 代码                                                                                                 | 和预检的关系                                                                                                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI 回合 | `src/commands/agent.ts` 的 `agentCommand` / `agentCommandFromIngress` → `agentCommandInternal`       | **explicit reuse-observe**。合成 taskId 为 `acp-cli-turn:<sessionKey>:<agentId>`。agentId 是政策刚核对过的规范化 ACP agent（`meta.agent`，否则会话键）。sessionId 是 sessionKey。policy / catalog 是已放行的 agent 名（空 allowlist 时为该 agent），只是观察标签 |
| steer    | `src/auto-reply/reply/commands-acp/lifecycle.ts` 的 `runAcpSteer`                                    | **explicit reuse-observe**。合成 taskId 为 `acp-steer:<sessionKey>:<agentId>`。agentId 来自 `resolveAcpAgentFromSessionKey(sessionKey)`，不再读一次会话。同一套观察标签                                                                                          |
| stdio 桥 | `src/acp/server.ts` 的 `serveAcpGateway`；`src/acp/translator.ts` 的 `prompt` 调 Gateway `chat.send` | 仍 unknown，且明确非刀（FC-08）。本旗标不挂这里。它是网关 `chat.send` 客户端                                                                                                                                                                                     |

旗标关与 observe 失败不改写 CLI 的 payloads、meta、错误码，也不改写 steer 的回复文本或错误文本。ACP runtime 工具目录不在本进程，本层看不到。

| 态                                                 | 含义                                                      | 本切片                                                                                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unknown                                            | 未说明是否复用预检                                        | CLI 回合与 steer 已离开。stdio 桥仍是 unknown，且明确非刀（FC-08）                                                                                                                                                            |
| explicit reuse-observe                             | 调用既有 `buildExecutionPreflight`，只记 trace / decision | **当前（CLI 回合与 steer）**。`OPENBOT_ACP_CLI_STEER_PREFLIGHT_OBSERVE` 为 `1` / `true` / `yes` / `on` 时，在既有门通过之后、`runTurn` 之前调用。默认 unset 不调用。不把预检 allow 集写回 runtime、backend、回合或 steer 结果 |
| explicit reuse-enforce、显式豁免+break-glass、删除 | 用预检收窄或拒绝，或声明豁免，或移除入口                  | 未授权。不调用 `applyPreflightToTools`，不 `armCompletionHold`，不因预检改 CLI 或 steer 的成功、错误或输出，不打开 live invoke / Fabric / Phase D                                                                             |

**AOR 预检三态（FC-04 文档；未接线）**

本入口**仍是 unknown**。`packages/aor-core` 不 import OpenBot，也没有 `buildExecutionPreflight`。`Orchestrator.run` 只在调用方注入 `ExecutionBackend`（以及可选 `ToolInvoker`）之后才有副作用。

| 事实                                          | 代码                                                                                                                                                                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/` 不 `new Orchestrator`                  | 聊天热路径不构造它。Fabric 只在已注入的窄端口上调用 `run`（`src/fabric/kernel.ts` 的 `runKernel`；`src/fabric/wiring.ts` 无 orchestrator 则不挂 runner），且 Fabric 默认关（`src/fabric/feature.ts`）。`new Orchestrator` 在 `packages/aor-sdk-node` |
| 选路不是执行                                  | `src/gateway/model-entitlement/aor-selection.ts` 只 `rankModels`，并写明 AOR 不做授权                                                                                                                                                                |
| OpenBot 适配器在包外                          | `packages/aor-backend-openbot`：`agent` RPC（`gateway-rpc.ts`）或 HTTP；`OpenBotToolsInvokeClient` 打 `POST /tools/invoke`                                                                                                                           |
| `/tools/invoke` 已经是 explicit reuse-observe | 那是 HTTP 入口自己的 FC-01，不是 AOR 图的预检声明                                                                                                                                                                                                    |

身份是 `TenantContext`（`packages/aor-core/src/audit.ts`）。有 `tenantId` 时 `resolveRunSessionKey` 加前缀；这不证明 Profile B 隔离，该格保持 `unknown`。完成权威是图内 `AorRunResult`；evaluator 分数写入 trace，不阻断返回。`buildAuditRecord` 是内存记录，不是 proof。缺 skill 或缺终态节点抛错。

保持 unknown 的代码缺口：核心没有预检调用，也没有豁免或删除。适配器打到的 `agent` / `/tools/invoke` 各自有没有预检，取决于那两个入口，不能回写成 AOR 已复用预检。FC-08 把它定为明确非刀：不推荐作为代码接线，不把预检 import 进 `aor-core`，也不为了观察 AOR 打开 Fabric。

**inter-agent bus 预检三态（FC-06 observe）**

只覆盖 `sendAgentTask` 与 `sendAgentMention`：函数里已经决定调用网关之后、`callGateway({ method: "agent" })` 之前。不是目标会话自己的回合。旁路闭合目标三态是「复用预检 | 显式豁免+break-glass | 删除」。本文件派发已离开 `unknown`，当前态是 **explicit reuse-observe**（复用预检的观察态，不是 enforce）。它不执行工具。

三条缝，不要合成一条「目标回合已由本文件收口」：

| 缝           | 代码                                                                          | 和预检的关系                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本文件派发   | `src/organization/inter-agent-bus.ts` 的 `sendAgentTask` / `sendAgentMention` | **explicit reuse-observe**。`OPENBOT_INTER_AGENT_BUS_PREFLIGHT_OBSERVE` 默认关。合成 taskId 为 `inter-agent-bus:<kind>:<targetSessionKey>`（kind 为 `task` 或 `mention`）。sessionId 是目标 sessionKey。`resourceScope` 只记 `kind:`、`lane:`（`AGENT_LANE_NESTED`）、`source:`（`organization_tasks` 或 `organization_mentions`）。policy / catalog 为空。allow 集丢弃 |
| 普通目标会话 | 网关 `method:"agent"` 落到 `attempt.ts`                                       | 热路径自己的预检，不在本文件。本观察不是那条预检的声明                                                                                                                                                                                                                                                                                                                  |
| ACP 目标会话 | 进程内 `tryDispatchAcpReply` 可能再进 FC-05                                   | 那是 FC-05 的声明。stdio 桥仍 unknown，且明确非刀（FC-08）。CLI 回合与 steer 是 FC-07，见 ACP 注                                                                                                                                                                                                                                                                        |

授权不在本文件。`organization_tasks` 的 create 先过协调者或 `assign_tasks`（`src/agents/tools/organization-tasks-tool.ts`），且只有 `notify===true` 才 `sendAgentTask`。mention 在 `src/gateway/server-methods/chat.ts` 有 mention 载荷时调用 `MentionDelivery.deliver`，成员校验在 `src/organization/mention-delivery.ts`，默认总线是 `sendAgentMention`。没有 mention 载荷则不调用总线。这些上游门仍在总线函数之外；总线函数一旦被调用就会 `callGateway`。

`status:"accepted"` 只表示网关返回了 run，不是任务完成。任务 FSM（`pending` / `accepted` / `running` / `completed` / `rejected`）在 `src/organization/task-assignment.ts`，由工具写入。总线捕获异常后返回 `{status:"error"}`，不抛；mention 错误记入 delivery errors，宿主回合继续。旗标关与 observe 失败不改写该结果。

| 态                                                 | 含义                                                      | 本切片                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unknown                                            | 未说明是否复用预检                                        | 本文件派发已离开。普通目标会话的热路径预检仍在 `attempt.ts`，不因本观察改写。ACP 的 stdio 桥仍是 unknown，且明确非刀（FC-08）。CLI 回合与 steer 是 FC-07                                                                                                                                             |
| explicit reuse-observe                             | 调用既有 `buildExecutionPreflight`，只记 trace / decision | **当前（仅本文件派发）**。`OPENBOT_INTER_AGENT_BUS_PREFLIGHT_OBSERVE` 为 `1` / `true` / `yes` / `on` 时，在 `callGateway` 之前调用。合成 taskId 为 `inter-agent-bus:<kind>:<targetSessionKey>`。默认 unset 不调用，status accepted / error、runId 与 error 与今日相同。不把预检 allow 集写回派发参数 |
| explicit reuse-enforce、显式豁免+break-glass、删除 | 用预检收窄或拒绝，或声明豁免，或移除入口                  | 未授权。不调用 `applyPreflightToTools`，不 `armCompletionHold`，不因预检拒绝、丢弃或改写派发，不打开 live invoke / Fabric / Phase D                                                                                                                                                                  |


**`knowledge.capability.invoke` 预检三态（FC-09 文档；未接线）**

旁路闭合目标三态是「复用预检 | 显式豁免+break-glass | 删除」。本入口**新登记**后当前态是 **exemption+break-glass**（文档处置，不是 soft-observe 旗标）：

| 态 | 含义 | 本切片 |
| --- | --- | --- |
| unknown | 未说明是否复用预检 | 已离开（FC-09 登记） |
| exemption+break-glass | 显式豁免预检复用登记；破玻璃另立 | **当前**。源码只读已物化 capability 元数据 + seat/quota/audit；注释写明 NEVER live connector。破玻璃 = 批准 boundary-opening live-connector 轨道（另立范围、显式签字）。**不是**忽略旁路。不新开 `OPENBOT_*_PREFLIGHT_OBSERVE` |
| explicit reuse-observe / enforce / 删除 | 观察接线、收窄拒绝、或移除入口 | 未授权。FC-03a 模式观察属另立范围备选，本刀默认不批 |

与企业 capability invoke（FC-03a，`capability-agent-invoke-runtime.ts` → `invokeEnterpriseDataAction`）不是同一入口，勿合成一行。

Bridge MVP（`docs/design/bridge-mvp.md`）B1/B2 未批准编码，不列入可执行入口。

## 若只改 Pi 回合仍绕过的面

FC-01 `/tools/invoke`、FC-03a 企业 capability invoke、FC-03b `node.invoke` 的预检关系已是 **explicit reuse-observe**：默认不调用；旗标开只记 trace，丢弃 allow 集，不 `applyPreflightToTools`，不 `armCompletionHold`。enforce 未授权。FC-02 只在 ConversationTask 关闭前做 delivery-hold 观察咨询，不把该入口整行收成预检三态。

inter-agent bus 本文件派发已是 explicit reuse-observe。普通目标会话仍进网关 `agent` / `attempt.ts` 热路径；ACP 目标可能再进 FC-05 进程内路径。那两处不是本文件观察的升级。完成登记仍不在本文件。

Fabric 默认关，不在热路径。task-orchestration 的 `ORCHESTRATION_LIVE_INVOKE` 仍为 false。

### FC-08 C10 / bypass 缺口注（文档；不接线）

本注只记账。不新开环境旗标，不新增 `buildExecutionPreflight` 调用点，不调用 `applyPreflightToTools` / `armCompletionHold`，不打开 Phase D、enforce、live invoke 或 Fabric default-on。production-proven 保持 `unknown`（未探测 `openbot-gateway-rc`）。排序页见 `fc-04-next-soft-observe.md`。

**已落地的观察刀。** FC-05、FC-06、FC-07 都是默认关闭的 explicit reuse-observe。旗标开只记 trace，allow 集丢弃。

| 刀    | 覆盖                                                   | 旗标                                        |
| ----- | ------------------------------------------------------ | ------------------------------------------- |
| FC-05 | ACP 进程内 `tryDispatchAcpReply`                       | `OPENBOT_ACP_TURN_PREFLIGHT_OBSERVE`        |
| FC-06 | inter-agent bus `sendAgentTask` / `sendAgentMention`   | `OPENBOT_INTER_AGENT_BUS_PREFLIGHT_OBSERVE` |
| FC-07 | ACP CLI 回合（`agentCommandInternal`）与 `runAcpSteer` | `OPENBOT_ACP_CLI_STEER_PREFLIGHT_OBSERVE`   |

**明确非刀。**

- **ACP stdio 桥**（`serveAcpGateway`；translator 的 `prompt` 调 Gateway `chat.send`）：清单上的预检关系仍是 `unknown`。不另挂软观察刀。它是网关 `chat.send` 客户端。目标普通会话已经走热路径；目标若已是 ACP 会话，可能再进 FC-05。
- **AOR**（`packages/aor-core`）：预检关系仍是 `unknown`。不推荐作为代码接线。不得把 OpenBot 预检 import 进 `aor-core`。不得为了观察 AOR 打开 `OPENBOT_FABRIC_ENABLED` 或 `gateway.fabric.enabled`。

**Cron / subagent：覆盖与缺口。** 本注不发明新的观察旗标。下面这些路径没有证明一条绕开热路径或回复路径、却仍执行工具的旁路。

- 覆盖：隔离 Cron（`payload.kind=agentTurn`）在 `src/cron/isolated-agent/run.ts` 的 `runCronIsolatedAgentTurn` 里调用 `runEmbeddedPiAgent`（`trigger: "cron"`）。`runEmbeddedPiAgent` 再进 `runEmbeddedAttempt`，热路径预检在 `attempt.ts`。主会话 Cron（`sessionTarget === "main"`）不直接调用 `runEmbeddedPiAgent`：它入队 system event，并可能 `runHeartbeatOnce` → `getReplyFromConfig`（`src/infra/heartbeat-runner.ts`）。那是回复路径（热路径或 ACP dispatch），本注不把它当成已证明的预检旁路。subagent 的 spawn（`src/agents/subagent-spawn.ts` 的 `spawnSubagentDirect`）与 announce（`src/agents/subagent-announce.ts`）走网关 `method: "agent"`，再进入同一条热路径。
- 缺口：这两处自己的清单行仍在闭合三态之外。闭合三态是「复用预检（reuse-observe）| 显式豁免+break-glass | 删除」。回到热路径只说明 Pi 回合自己的预检仍在 `attempt.ts`，不把这一行写成 explicit reuse-observe，也不写成豁免或删除。完成登记仍在子代理 / cron 自己的账上；投递回执不是 proof。

只审 `attempt.ts` 就宣称 Cron / subagent 已收口，正是 C10 的失败形态。本注记下覆盖，同时把行保持在三态之外。

**C10 仍不能 pass。** stdio 桥、AOR，以及 Cron / subagent 仍在闭合预检三态之外时，C10 不能标 pass。本页不打开 Phase D，不改写 `.kiro/specs/constitutional-governance-phase-c-decision/` 下的 freeze / acceptance。

**下一步（FC-08b / FC-08c；本页不展开格子）。** 下一件工作是稀疏 `unknown` 格子的文档复核，不是预检刀：

- ConversationTask 的 Profile 隔离、其余授权点、失败语义（§6）。FC-02 已覆盖关闭前的 delivery-hold 观察。
- 插件装载的未授权失败形态（§9）。

留给 FC-08b / FC-08c。本切片不改这些格子。

后记：FC-08b 已按源码复核 §6 的稀疏格（见该节「FC-08b 稀疏格复核」）。Profile B、production-proven、未读转移仍是 `unknown`。§9 插件装载仍留给 FC-08c。上面三句仍是 FC-08 自己的范围。

后记：FC-08c 已按源码复核 §9 未授权装载的失败形态（见该节「FC-08c 稀疏格复核」）。Profile B 与 production-proven 仍是 `unknown`。

后记：FC-08d（书面范围 `sparse_unknown_docs`；见 `docs_phase_d_sparse_unknown.md`）把 Cron / subagent 相对闭合预检三态、以及 Profile B 是否被 ConversationTask / 插件装载 / Cron·subagent 入口闭合的**仍 unknown** 收成一页。不新开旗标，不接线，不把「回到热路径」写成 explicit reuse-observe，不宣称 Profile B 已闭合。C10 仍不能 pass。


### Phase D 后记：contracts / P8a / Runtime façade / scaffold（`code-present`；热路径未 import）

> 本后记登记 monorepo 内已存在的宪法包与旁挂观察适配。它们**不是**新的副作用入口，也**不**闭合 C10。主张等级见 `docs_phase_d_claim_level.md`。书面范围：`inventory_refresh_post_d`（2026-09-25）。不接线、不开新旗标、不收成预检三态。

| 表面 | 位置 | 默认 | 热路径关系 | 主张等级 | 预检三态 |
| --- | --- | --- | --- | --- | --- |
| constitutional-contracts | `packages/constitutional-contracts`（#58） | 无默认热路径 hook | **未**被 gateway chat / tool invoke / ACP / AOR 主决策 import | `code-present` | N/A（不是执行入口） |
| P8a `no_valid_path` | 同包 `reportPathGap`（#59） | 报告默认关；合法 Path 集为空；`executed=false` | 无热路径接线 | `code-present`；缺口可命名 ≠ C5 pass | N/A |
| Runtime façade shadow | 同包 `runRuntimeFacadeShadow`（#60） | shadow 默认关 | 编排旁：`src/task-orchestration/constitutional-runtime-facade.ts`；预检旁：`src/agents/execution-preflight/constitutional-runtime-facade.ts`。二者**未**从 `dispatch` / `gateway-hook` / 预检 barrel / chat 热路径主决策被 import；打开后仍丢弃 allow、不选 Path、不 live-invoke、不默认开 Fabric | `code-present` | 非 reuse-observe 入口登记；**不**因存在适配文件宣称热路径已观察 |
| Registry / Conformance / Runtime scaffold | `packages/constitutional-{registry,conformance,runtime}`（#62） | 私有 `0.0.0`；re-export contracts | 热路径无 import；无独立部署/发版 | `code-present`；§9.2 推迟仍有效 | N/A |

**明确非升格：**

- 上表任何一行都不得写成 `runtime-enabled` 或 `production-proven`。
- #62 不得写成「§9.2 已拆独立产品」。
- 不得借本后记打开 Phase D 续刀、enforce、P8b、Gate 收紧。
- FC-08 明确非刀不变：ACP stdio 桥另挂预检；`packages/aor-core` 内预检；为观察开 Fabric。

**与 FC-08 / FC-08d 并存：**

- C10 仍不能 pass：stdio 桥、AOR、Cron/subagent 仍在闭合预检三态之外（见 FC-08 正文；FC-08d 复核后仍 unknown）。
- Profile B 是否被 ConversationTask / 插件装载闭合：仍 `unknown`（FC-08d）。
- 本后记只消除「D 包已存在却未在旁路可见面露面」的文档缺口，不消除上述 C10 / Profile B 缺口。

### Phase D 后记补：证明清单 / P8 站桩 / 有界收口（文档；2026-09-25）

> 书面范围：`phase_d_product_split_proof_plan`、`phase_d_p8b_p8c_deferred`、`docs_phase_d_bounded_closeout`。不接线、不开新旗标、不启动 P8b/P8c、不把 §9.2 写成已拆产品。

| 注 | 文件 | 结论 |
| --- | --- | --- |
| §9.2 证明清单 | `phase-d-product-split-proof-plan.md` | 部署边界 / 所有权 / 生命周期检查表**未勾选**；推迟仍有效 |
| P8b/P8c 站桩 | `phase-d-p8b-p8c-deferred.md` | P8b/P8c 不批准启动；stdio/AOR/再挂观察非刀或不发明旗标 |
| 有界 D 收口 | `docs_phase_d_bounded_closeout.md` | #58–#65 + 本批文档刀收口；整段 D 仍不批准；C10 仍不能 pass |


### Phase C §8.3 产品确认后记（文档；2026-09-26）

> 书面范围：`phase_c_83_convergence_scope`、`phase_c_83_product_confirmation`。docs-only。不接线、不开新旗标、不改写 Phase C 五份冻结正文、不重开有界 D #58–#66。

| 注 | 文件 | 结论 |
| --- | --- | --- |
| §8.3 书面范围 | `phase-c-83-convergence-scope.md` | 锁定 NO-GO；授权 Doc02 §8.3 运营路径；OUT 含 Meta-Schema 工程再开席 / 整段 D GO / stdio·AOR 软观察刀等 |
| 产品确认 | `phase-c-83-product-confirmation.md` | Owner（network-of-network 2026-09-26）确认 final-acceptance 外部立场；C10 门与 C11 另立；P8b/§9.2 未启动 |

**明确非升格：** 本后记不宣称 C10/C11 pass、整段 Phase D GO、或主张等级高于 `code-present`。

### Phase C §8.3 / FC-09 允许入口三态处置后记（文档；2026-09-26）

> 书面范围：`phase_c_83_allowed_entry_disposition`。docs-only。不接线、不开新观察旗标、不自行升格 stdio / AOR / Cron·subagent、不宣称 C10 pass。

| 注 | 文件 | 结论 |
| --- | --- | --- |
| 书面范围 | `phase-c-83-allowed-entry-disposition-scope.md` | IN：编排/Fabric/knowledge 处置账本 + inventory 最小补丁；OUT：soft-observe 新旗标 / enforce / P8b / #58–#66 重开 |
| 处置账本 | `phase-c-83-allowed-entry-disposition.md` | task-orchestration + Fabric + `knowledge.capability.invoke` → **exemption+break-glass**（登记豁免 ≠ 忽略旁路）；stdio/AOR/Cron·subagent 候选项已移交 `phase-c-83-nonknife-product-adjudication.md` |

**明确非升格：** 本后记不宣称 C10/C11 pass、整段 Phase D GO、runtime-enabled / production-proven，也不授权 live invoke 或为观察打开 Fabric。

### Phase C §8.3 — C10 进度 / 非刀裁决 / C11 stub 后记（文档；2026-09-26）

> 书面范围：`phase_c_83_c10_c11`。docs-only。不接线、不开新观察旗标、不宣称 C10 pass、不启动 C11 工程、不翻转 Phase C NO-GO。

| 注 | 文件 | 结论 |
| --- | --- | --- |
| 书面范围 | `phase-c-83-c10-c11-scope.md` | IN：C10 进度 + 非刀裁决 + C11 stub；OUT：soft-observe / enforce / P8b / #58–#66 重开 / C11 工程 |
| C10 进度 | `phase-c-83-c10-claim-gate-progress.md` | 三态内/外对照；登记迭代**未闭合**；**C10 仍不能 pass** |
| 非刀裁决 | `phase-c-83-nonknife-product-adjudication.md` | stdio / AOR / Cron·subagent → **exemption+break-glass**（Owner 确认，network-of-network 2026-09-26）；非忽略旁路 |
| C11 stub | `phase-c-83-c11-finalization-initiative.md` | 域内权威 + 显式终结；禁跨域单写；**工程未启动** |

**明确非升格：** 本后记不宣称 C10/C11 pass、整段 Phase D GO、runtime-enabled / production-proven，也不授权 live invoke、为观察打开 Fabric、或把「回到热路径」写成 reuse-observe。

### Phase C §8.3 — 旁路登记迭代证据后记（文档；2026-09-26）

> 书面范围：`phase_c_83_registration_iteration`。docs-only。不接线、不开新观察旗标、不宣称 C10 pass、不翻转 Phase C NO-GO。**迭代证据 ≠ C10 pass。**

| 注 | 文件 | 结论 |
| --- | --- | --- |
| 书面范围 | `phase-c-83-registration-iteration-scope.md` | IN：一轮登记迭代证据 + 进度/inventory 最小 xref；OUT：C10 pass / soft-observe / enforce / P8b / #58–#66 重开 |
| 迭代证据 | `phase-c-83-registration-iteration-evidence.md` | 2026-09-26 Asia/Shanghai；对照 #68+#69+inventory；允许入口复核；stdio/AOR/Cron = **exemption+break-glass**（非 soft-observe）；**C10 仍不能 pass** |
| C10 进度 xref | `phase-c-83-c10-claim-gate-progress.md` §5 | 登记迭代过程证据已记；主张门正式勾选仍未做 |

**明确非升格：** 本后记不宣称 C10/C11 pass、不发明 green C10、不翻转 Phase C NO-GO、不授权 live invoke / Fabric-on-for-observe，也不把 Doc01 / sparse_unknown 余项标成已闭合。


### Phase C — C11 倡议章程落地后记（文档；2026-09-26）

> 书面范围：`phase_c_c11_written_scope_acceptance_charter` + `phase_c_c11_start_order_charter`。docs-only。不接线、不开新观察旗标、不实现终结协议于 `src/`、不宣称 C11/C10 pass、不翻转 Phase C NO-GO。

| 注 | 文件 | 结论 |
| --- | --- | --- |
| 有界接受 | `phase-c-c11-written-scope-acceptance.md` | **仅**倡议章程落地；≠ C11 pass；≠ 跨域单写；≠ 工程开工 |
| 开工令 | `phase-c-c11-start-order.md` | 基线 `8babbd4c`；docs-only；可 docs-revert |
| 倡议章程 | `phase-c-c11-finalization-charter.md` | 域内权威 + 显式终态化（handshake/consult doc-level）；禁跨域单写；复用 CTR/ConversationTask/既有模块；非目标含 Meta-Schema GO / P8b enforce / soft-observe |
| stub 指针 | `phase-c-83-c11-finalization-initiative.md` | #69 stub → 指向章程 |

**明确非升格：** 本后记不宣称 C11/C10 pass、不授权跨域单写或协议工程实现、不翻转 Phase C NO-GO、不打开整段 Phase D。

## 治理收敛实施视图（governance closure v1.0 §5 / §4.8）

> 来源：`.codex-review/governance-closure/execution-plan-v1.0.md`（v1.0，基线 `bdcfc404`）§5、§5.2、§4.8、§7.4、Q11。本节扩展本清单，不另立第二份入口真源。
> 机器可读登记：`src/gateway/governance/execution-entry-registry.ts`（§5 / §5.2）与 `src/gateway/governance/model-caller-registry.ts`（§4.8）。契约测试 `src/gateway/governance/governance-contract.test.ts` 断言本节表格与登记一致；改状态须三处同改。
>
> §4.8 的覆盖规则是「统计 `runWithModelFallback` / `runWithImageModelFallback` 的生产调用点」。不经这两个辅助函数、直接触达模型 provider 的路径对该规则**结构上不可见** —— 它不是「漏登记的一行」，而是规则根本不会去找的一类。这类路径登记在 `src/gateway/governance/direct-model-invocation-registry.ts`，契约测试扫描生产源码、遇到未登记者即失败，使新增此类路径成为一次显式的契约变更而非静默缺口。
> 状态词只用 Governed / Shadow / Legacy / Exempt / Bypass。Bypass 写后续阶段，Exempt 写理由。「待符号核对」格保持保守状态，核对后只改状态，不删编号。
> 本节是实施视图，不改变上文 Phase A 九字段的 `unknown` 判定，也不升格 production-proven。

### 执行入口（E1–E18，Sprint 1 PR-1a（#134）合入后的状态）

| # | 入口 | 状态 | 维度 | 后续 / 理由 | 符号 | 待符号核对 |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | chat.send → agent-runner-execution | Governed | 商业 Governed；模型 Governed（显式 mode，默认 shadow；硬过滤来自 allowlistEnforcement preexisting，mode 为 legacy 时同样过滤；改成 enforced 不改变候选，分歧按构造为 D0，不能当作 §8.4 收紧证据）；agent 授权 Shadow（OPENBOT_GOVERNANCE_AGENT_INVOCATION_SHADOW 默认关） | agent 授权影子默认关 | `runAgentTurnWithFallback`、`authorizeCommercialRun` | — |
| E1f | followup-runner | Governed | 显式 mode，默认 shadow；硬过滤来自 allowlistEnforcement preexisting，mode 为 legacy 时同样过滤；改成 enforced 不改变候选，分歧按构造为 D0，不能当作 §8.4 收紧证据 | P3 enforced after §8.4 | `createFollowupRunner` | — |
| E1m | memory flush | Shadow | 默认 shadow、只记录、flag 不另设；allowlistEnforcement 缺省 governance-mode，不过滤；chat 路径上 flush 早于 rememberRunModelSet（runReplyAgent 先 runMemoryFlushIfNeeded，后 runAgentTurnWithFallback），父集合查找落空，信封为 skipped + parent-model-set-absent，拿不到父 allowlist | P3 enforced after §8.4 parity（default stays shadow） | `runMemoryFlushIfNeeded`、`resolveMemoryFlushModelGovernance`、`resolveModelFallbackOptions` | — |
| E2 | agent RPC | Shadow | 商业 Governed；模型 Shadow（有企业作用域；闸口 skipped → legacy + skipped） | P3 才讨论 enforced（§8.4）；无企业作用域保持 Legacy | `agentCommandFromIngress`、`acquireAgentCommandCommercialRun`、`resolveAgentCommandModelGovernance` | — |
| E3 | 本地 CLI `openbot agent` | Shadow | 商业 Governed；模型 Shadow（同 E2）；无企业作用域固定 Legacy | P3；改 enforced 需要显式配置（Q6） | `agentCommand`、`acquireAgentCommandCommercialRun`、`resolveAgentCommandModelGovernance` | — |
| E4 | cron isolated | Governed | 显式 mode，默认 shadow；硬过滤来自 allowlistEnforcement preexisting，mode 为 legacy 时同样过滤；改成 enforced 不改变候选，分歧按构造为 D0，不能当作 §8.4 收紧证据 | P3 enforced after §8.4 | `runCronIsolatedAgentTurn` | — |
| E5 | cron 主会话心跳 | Exempt | 经 E1（getReplyFromConfig → runReplyAgent → runAgentTurnWithFallback） | 理由：非独立治理面；P2-0 已核对，不新标 Governed | `runHeartbeatOnce`、`getReplyFromConfig` | — |
| E6a | subagent spawn | Shadow | spawn 查找父集合；缺快照记 skipped，不记 allow；用量归属默认仍只在影子里；只有进程环境把 OPENBOT_SUBAGENT_CREDIT_USAGE 设为真时，才按父授权入账，子 run 经 acquireAgentCommandCommercialRun（E6）占用配额与并发。 | P3；默认 shadow | `spawnSubagentDirect` | — |
| E6b | subagent steer | Shadow | 按子 runId 查找父集合；缺快照记 skipped，不记 allow；用量归属默认仍只在影子里；只有进程环境把 OPENBOT_SUBAGENT_CREDIT_USAGE 设为真时，才按父授权入账，子 run 经 acquireAgentCommandCommercialRun（E6）占用配额与并发。 | P3；默认 shadow | `steerControlledSubagentRun` | — |
| E6c | subagent 追发 | Shadow | 按子 runId 查找父集合；缺快照记 skipped，不记 allow；用量归属默认仍只在影子里；只有进程环境把 OPENBOT_SUBAGENT_CREDIT_USAGE 设为真时，才按父授权入账，子 run 经 acquireAgentCommandCommercialRun（E6）占用配额与并发。 | P3；默认 shadow | `sendControlledSubagentMessage` | — |
| E7 | inter-agent bus | Bypass | 商业 Governed（NESTED 不跳过）；模型 Shadow（PR-1a）；身份 Bypass | 身份暂存落地前不标 Governed | `sendAgentTask`、`sendAgentMention` | — |
| E8 | `/tools/invoke` | Shadow | P5-2/P5-4 策略可 allow/deny；无策略单次仍可 skipped，不得记 allow；MODE 默认 shadow | P3/P7：§8.4 后按租户 enforced；`OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE` 默认 shadow（代码从不默认 enforced）；`OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW` 默认关 | `handleToolsInvokeHttpRequest` | — |
| E9 | `node.invoke` | Shadow | scope 影子默认关，与 observe 预检独立 | 打开 NODE_INVOKE_SHADOW | `node.invoke` | — |
| E10 | 图像 fallback | Shadow | 按 runId 读取父模型集合；shadow 只记录不过滤 | P3；默认 shadow | `runWithImageModelFallback`、`runImagePrompt`、`runPdfPrompt` | — |
| E11 | enterprise data capability | Governed | 席位、授权、配额之后返回 knowledge-object-only（ok false） | P5-1 只消费已冻结映射；本行不改调用 | `invokeDataCapabilityForAgent`、`invokeDataCapabilityWithContext` | — |
| E12 | knowledge capability | Governed | handler `knowledge.capability.invoke` 调用 `invokeKnowledgeCapability` | P5-1 适配器 | `invokeKnowledgeCapability`、`knowledge.capability.invoke` | — |
| E13 | ACP 进程内 dispatch / steer | Exempt | 外部执行面 | 理由：外部 AcpRuntime；P5 只登记派发点 | `tryDispatchAcpReply` | — |
| E14 | ACP stdio 桥 → chat.send | Governed | 经 E1 | 登记 | `chat.send` | — |
| E15 | AOR | Exempt | 运行时经 E2/E8 | 理由：不改 `packages/aor-core` | `packages/aor-core` | — |
| E16 | CLI backend | Exempt | 凭证范围 + `recordCliBackendUsage`；另经 E3 商业闸口 | 理由：外部 CLI 进程；P2-0：`agentCommandInternal` 先 `acquireAgentCommandCommercialRun` 再 `runCliAgent`；信用仍走 `recordCliBackendUsage` | `runCliAgent`、`recordCliBackendUsage` | — |
| E17 | Fabric | Legacy | 默认关 | P2 只做适配器，不开启 | `OPENBOT_FABRIC_ENABLED` | — |
| E18 | task-orchestration | Exempt | `ORCHESTRATION_LIVE_INVOKE=false` | 理由：不打开 | `ORCHESTRATION_LIVE_INVOKE` | — |
| E19 | 入站媒体理解 | Shadow | 前置于 agent run：选模型并直连 provider，不经 `runWithModelFallback`/`runWithImageModelFallback`，故 §4.8 的覆盖规则结构上看不见它；权益 allowlist 在任何 mode 下都不被查询。信封恒为 `skipped` + `media-understanding-pre-agent`，无 `runId`，归属取自入站回合 | `OPENBOT_GOVERNANCE_MEDIA_UNDERSTANDING_SHADOW` 默认关；MODE 默认 shadow，`enforced` 未实现。要真正治理须先把入站管线接上租户权益解析 | `applyMediaUnderstanding`、`describeImageWithModel`、`runProviderEntry` | — |

PR-1a（#134）已落地：E2 / E3 为 Shadow（无企业作用域为 Legacy），E7 的模型维度为 Shadow，E7 整体仍为 Bypass（身份）。`OPENBOT_GOVERNANCE_AGENT_COMMAND_MODEL_MODE` 默认 shadow。

### Capability Entry Inventory（§5.2，三态）

| 能力类 | 入口 | 状态 | 后续 / 理由 |
| --- | --- | --- | --- |
| tool-pi | `pi-tools` + `tool-policy-pipeline` + preflight | REUSE | 租户级能力治理不在本层 |
| tool-http | `/tools/invoke` | REUSE | P5-3/P5-4：治理包络经 tools-invoke shadow / `evaluateToolsInvokeCapability`；unset 或查表失败继续 skipped，不得记 allow。`OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE` 默认 shadow；`OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW` 默认关 |
| skill | `skill-policy` / skill invocation | REUSE | P0/P5 按符号再核对 |
| MCP | 未定位 | BYPASS | P5-0 已搜 src/agents、server-methods、extensions：没有 MCP capability invoke。mcp-config 与企业能力目录只是绑定/目录，不是 allow。有 invoke 入口前保持 BYPASS |
| node | `node.invoke` | BYPASS | PR-3 |
| knowledge | `knowledge.capability.invoke` → `invokeKnowledgeCapability` | REUSE | — |
| enterprise-data | `invokeDataCapabilityForAgent` / `invokeDataCapabilityWithContext` | REUSE | — |
| browser | `browser.request` | BYPASS | P5-0 已定位 `server-methods/browser.ts` 的 `browser.request`。它代理 browser.proxy 或本地浏览器控制，没有租户能力策略，不进 CapabilityInvokeAdapter |
| workspace | `resolveAuthorizedToolCwd` | REUSE | — |
| ACP | 外部 AcpRuntime | EXEMPT | 外部执行面 |

### PR-P5-0 ADR：CapabilityInvokeAdapter 映射（冻结）

HTTP `/tools/invoke` 在 P5-2 已有 `(tenantId, toolName) → allow | deny | unset`（`evaluateToolsInvokeCapability` / `gateway.tools.tenantCapabilities`）。显式 allow/deny 可出现在影子包络上；`unset` 或查表失败继续 `skipped`（不得记 `allow`）。P5-3 将 E8 升为 Shadow、`tool-http` 升为 REUSE（治理包络经 tools-invoke shadow / capability policy）。无策略时单次运行仍可 `skipped`。P5-4 增加 `OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE=legacy|shadow|enforced`（代码默认 shadow，从不默认 enforced）。仅 `enforced`+明确 deny 才改变 HTTP（与网关 HTTP deny 表对齐的 404 `not_found`）。`shadow`/`legacy`/unset 下 HTTP 与既有路径一致。不改 `OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW`（默认关）或任何 `OPENBOT_GOVERNANCE_*_MODE` 的代码默认值为 enforced，也不打开 `OPENBOT_GOVERNANCE_SHADOW_LOG` 默认。

`invokeDataCapabilityForAgent` 委托 `invokeDataCapabilityWithContext`。后者仍检查席位、授权和配额，然后返回 `knowledge-object-only`（`ok: false`），不请求 ConnectorAction。因此 E11 今天没有 `ok === true` 的成功返回。`knowledge.capability.invoke` 调用 `invokeKnowledgeCapability`；授权且未超配额时可以 `ok: true`。`handler-error` 只出现在 `CapabilityDataInvocationReason` 类型上，这两条 invoke 都没有返回点；映射仍把它锁成 `skipped`，不计入 allow 覆盖率。`knowledge-object-only` 按本期产品锁记 `deny`（EDGSC 红线 5），不得记 `allow`。

机器可读表是 `CAPABILITY_INVOKE_ADAPTER_MAPPING`（`src/gateway/governance/execution-entry-registry.ts`）。P5-1 适配器只消费这张表；本 PR 不新增适配器，不改变 invoke 返回值。

| 源结果 | governance effect | reason | 计入 allow 覆盖率 |
| --- | --- | --- | --- |
| `ok` | allow | 可空 | 是 |
| `not-authorized` | deny | 原 reason | 否 |
| `not-found` | deny | 原 reason | 否 |
| `disabled` | deny | 原 reason | 否 |
| `no-tenant` | deny | 原 reason | 否 |
| `no-seat` | deny | 原 reason | 否 |
| `quota-exceeded` | deny | 原 reason | 否 |
| `handler-error` | skipped | 原 reason | 否 |
| `knowledge-object-only` | deny | 原 reason | 否 |

### 模型调用方登记（§4.8）

`registered-gap` = 未显式传 `governanceMode`，是已登记的已知缺口，不等于「未传 allowlist 即已治理」。

| 登记 id | 文件 | 函数 | 调用方 | 今天的模型治理 | 登记状态 | 入口 | 后续 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| auto-reply | `src/auto-reply/reply/agent-runner-execution.ts`（参数来自 `src/agents/embedded-model-governance.ts`） | `runWithModelFallback` | `runAgentTurnWithFallback` | 有企业闸口时传 allowlist（preexisting 硬过滤 + 显式 mode，默认 shadow） | explicit-mode | E1 / E14 | P3 enforced（§8.4） |
| followup | `src/auto-reply/reply/followup-runner.ts`（参数来自 `src/agents/embedded-model-governance.ts`） | `runWithModelFallback` | `createFollowupRunner` | 有企业闸口时传 allowlist（preexisting 硬过滤 + 显式 mode，默认 shadow） | explicit-mode | E1f | P3 enforced（§8.4） |
| cron-isolated | `src/cron/isolated-agent/run.ts`（参数来自 `src/agents/embedded-model-governance.ts`） | `runWithModelFallback` | `runCronIsolatedAgentTurn` | 有企业闸口时传 allowlist（preexisting 硬过滤 + 显式 mode，默认 shadow） | explicit-mode | E4 | P3 enforced（§8.4） |
| agent-command | `src/commands/agent.ts`（参数来自 `src/commands/agent/model-governance.ts`） | `runWithModelFallback` | `agentCommandInternal` | 有企业闸口时传 allowlist（shadow 只记录，不过滤） | explicit-mode | E2 / E3 / E7 | P3 enforced（§8.4） |
| memory-flush | `src/auto-reply/reply/agent-runner-memory.ts` | `runWithModelFallback` | `runMemoryFlushIfNeeded` | 按父 runId 查到 allowlist 才传入（shadow 只记录，不过滤；缺省 governance-mode） | explicit-mode | E1m | P3-2；P3 enforced（§8.4） |
| llm-slug-generator | `src/hooks/llm-slug-generator.ts`（参数来自 `src/agent-runtime/model/auxiliary-model-governance.ts`） | `runWithModelFallback` | `generateSlugViaLLM` | 辅助文件名推理继承父 run 模型集合；缺父集合时记录 absentAllowlistReason 并使用配置治理模式，不创建或推进任务 | explicit-mode | E1m | 默认配置模式；不声明生产已验证 |
| image-tool | `src/agents/tools/image-tool.ts` | `runWithImageModelFallback` | `runImagePrompt` | 按 runId 查到 allowlist 才传入 | explicit-mode | E10 | P3 default shadow |
| pdf-tool | `src/agents/tools/pdf-tool.ts` | `runWithImageModelFallback` | `runPdfPrompt` | 按 runId 查到 allowlist 才传入 | explicit-mode | E10 | P3 default shadow |

核对记录（2026-09-27，`bdcfc404`）：生产代码中这两个函数的调用点恰为上表七处；`src/agents/tools/tool-runtime.helpers.ts` 只 re-export `runWithImageModelFallback`，不是调用点。计划 §4.8 没有遗漏的调用方。

**明确非升格：** 本节不宣称任何入口 production-proven，不把 `registered-gap` 计入已治理覆盖率，不打开 Fabric 或 `ORCHESTRATION_LIVE_INVOKE`。
