# FC-04 下一刀：软观察候选（排序；第 3 刀仍不接线）

> 依据：`execution-entry-inventory.md` §10（FC-04 补了 ACP / AOR / inter-agent bus 的九字段）。FC-08 缺口注在同文件文末。
> 本页不是 Phase C 裁决，不改写 freeze / acceptance 文档，不授权 enforce、Phase D、Path、Gate 收紧。
> 第 1 刀（ACP 进程内 dispatch）已由 FC-05 以默认关闭的 observe 落地：`OPENBOT_ACP_TURN_PREFLIGHT_OBSERVE`。只记 trace，丢弃 allow 集。
> 第 2 刀（inter-agent bus）已由 FC-06 以默认关闭的 observe 落地：`OPENBOT_INTER_AGENT_BUS_PREFLIGHT_OBSERVE`。只记 trace，丢弃 allow 集。不改 `{status:accepted|error}`。
> CLI ACP 回合与 steer 已由 FC-07 以默认关闭的 observe 落地：`OPENBOT_ACP_CLI_STEER_PREFLIGHT_OBSERVE`。只记 trace，丢弃 allow 集。合成 taskId 分别为 `acp-cli-turn:<sessionKey>:<agentId>` 与 `acp-steer:<sessionKey>:<agentId>`。
> FC-08 是文档缺口注，不是第 4 刀。stdio 桥与 AOR 是明确非刀。第 3 刀（AOR）仍未接线，也不推荐作为代码。

## 排序

1. **ACP 进程内回合（已由 FC-05 落地）**
   - 位置：`src/auto-reply/reply/dispatch-acp.ts` 的 `tryDispatchAcpReply`，在 dispatch 政策与 `allowedAgents` 通过之后、`AcpSessionManager.runTurn` → `runtime.runTurn` 之前。
   - 为什么当时排第一：`resolveSession` 不是 `none` 时离开 `attempt.ts` 的副作用回合。现已是 explicit reuse-observe。工具在外部 `AcpRuntime`，不经 `pi-tools.policy`。
   - 建议旗标：`OPENBOT_ACP_TURN_PREFLIGHT_OBSERVE`，取值与既有观察旗标相同（`1` / `true` / `yes` / `on`）。默认 unset 不调用 `buildExecutionPreflight`。
   - 只记 trace / decision。丢弃预检 allow 集。不调用 `applyPreflightToTools`，不 `armCompletionHold`，不改 ACP stop reason、错误文本或 `recordProcessed` 结果。
   - stdio 桥（`src/acp/server.ts` + `translator.ts` 的 `chat.send`）不要另挂一刀：它是网关客户端。目标普通会话已经走热路径；目标 ACP 会话会回到本刀。CLI 回合与 steer 已由 FC-07 另旗标观察，不并进本刀。

2. **inter-agent bus（已落地，默认关闭的 observe）**
   - 位置：`src/organization/inter-agent-bus.ts` 的 `sendAgentTask` / `sendAgentMention`，在已经决定调用网关之后、`callGateway({ method: "agent" })` 之前。
   - 旗标：`OPENBOT_INTER_AGENT_BUS_PREFLIGHT_OBSERVE`，取值与既有观察旗标相同（`1` / `true` / `yes` / `on`）。默认 unset 不调用 `buildExecutionPreflight`。
   - 只记 trace / decision。合成 taskId 为 `inter-agent-bus:<kind>:<targetSessionKey>`（`task` 或 `mention`）。`resourceScope` 记 kind、lane（`AGENT_LANE_NESTED`）、来源工具（`organization_tasks` 或 `organization_mentions`）。丢弃预检 allow 集。不调用 `applyPreflightToTools`，不 `armCompletionHold`，不拒绝、丢弃或改写 `callGateway` 的 accepted/error、runId 或 error。
   - 为什么它不是目标回合的收口：本文件不执行工具。普通目标会话仍进网关 `agent` 热路径（`attempt.ts` 已有预检）。目标若是 ACP 会话，进程内缺口在第 1 刀，不在总线文件。

3. **AOR（仍不推荐作为代码）**
   - `packages/aor-core` 不得 import OpenBot 内部模块，不能在核心里调用 `buildExecutionPreflight`。
   - 产品内 `Orchestrator.run` 在 `src/fabric/kernel.ts`，而 Fabric 必须保持默认关。不要为了观察 AOR 打开 `OPENBOT_FABRIC_ENABLED` 或 `gateway.fabric.enabled`。
   - 包外适配器的 `POST /tools/invoke` 已是 FC-01 observe；`agent` RPC 落到网关热路径。在适配器再挂预检会和那两个入口重复计数，也不能把 AOR 图收成三态。

## FC-07（已落地，默认关闭的 observe）

- CLI：`src/commands/agent.ts` 的 `agentCommandInternal`，ACP 会话 ready、dispatch 政策与 `allowedAgents` 通过之后、`runTurn` 之前。taskId `acp-cli-turn:<sessionKey>:<agentId>`。
- steer：`src/auto-reply/reply/commands-acp/lifecycle.ts` 的 `runAcpSteer`，既有门通过之后、`runTurn` 之前。taskId `acp-steer:<sessionKey>:<agentId>`。
- 同一旗标 `OPENBOT_ACP_CLI_STEER_PREFLIGHT_OBSERVE`。默认 unset 不调用。observe 失败吞掉。不改 CLI payloads / 错误，不改 steer 回复 / 错误。
- 不调用 `applyPreflightToTools`，不 `armCompletionHold`。allow 集丢弃。
- stdio 桥仍不挂。AOR 仍是第 3 刀，不作为代码。

## 硬约束（含 FC-07 与 FC-08）

- 环境旗标默认关；unset 时行为与今天相同。FC-08 不新开旗标，不新增 `buildExecutionPreflight` 调用点。
- observe-only：不把预检 allow 集写回工具列表、节点策略、ACP backend 或派发结果。不调用 `applyPreflightToTools`，不 `armCompletionHold`。
- 不设置 `ORCHESTRATION_LIVE_INVOKE=true`（常量保持 false）。
- 不 Fabric default-on。不为了观察 AOR 打开 Fabric。
- 不改写 Phase C 冻结裁决（`.kiro/specs/constitutional-governance-phase-c-decision/` 与 acceptance / freeze 树）。不打开 Phase D、enforce、live invoke，不收紧 Path / Gate。
- 不改 `packages/aor-core`。
- production-proven 保持 `unknown`，除非另有 `openbot-gateway-rc` 探测。

## FC-08（文档；不接线）

FC-05 / FC-06 / FC-07 落地之后，剩下的软观察工作是缺口注，不是再挂一刀。清单正文在 `execution-entry-inventory.md` 文末「FC-08 C10 / bypass 缺口注」。

已落地观察刀（默认关，explicit reuse-observe，allow 集丢弃）：

- FC-05 ACP 进程内 `tryDispatchAcpReply`
- FC-06 inter-agent bus `sendAgentTask` / `sendAgentMention`
- FC-07 ACP CLI 回合与 steer

明确非刀：

- ACP stdio 桥（`serveAcpGateway`；translator `chat.send`）预检关系仍是 `unknown`。不另挂软观察刀。它是网关 `chat.send` 客户端。目标普通会话已经走热路径；目标 ACP 会话可能再进 FC-05。
- AOR（`packages/aor-core`）仍是 `unknown`。不推荐作为代码接线。不得把 OpenBot 预检 import 进 `aor-core`。不得为了观察 AOR 把 Fabric 默认打开。

C10 不能 pass：stdio 桥、AOR，以及 Cron / subagent 仍在闭合预检三态之外。闭合三态是「复用预检（reuse-observe）| 显式豁免+break-glass | 删除」。本页不因此打开 Phase D。

Cron / subagent：隔离 Cron（`agentTurn`）直接调用 `runEmbeddedPiAgent`。主会话 Cron 入队 system event，并可能经 `runHeartbeatOnce` → `getReplyFromConfig` 回到回复路径，不另挂旗标。subagent spawn / announce 经网关 `method: "agent"` 再进同一热路径（`runEmbeddedAttempt` → `attempt.ts`）。这些路径没有证明一条绕开热路径或回复路径、却仍执行工具的旁路，所以不发明新的观察旗标。覆盖的是回合自己的预检；清单行本身仍未收成三态。完成登记仍在子代理 / cron 自己的账上。

## 稀疏 unknown（FC-08b 已复核 ConversationTask；FC-08c 已复核插件装载失败形态）

FC-08b 是文档复核，不是预检刀。格子正文在 `execution-entry-inventory.md` §6「FC-08b 稀疏格复核」。

源码已证明的部分：

- `openTenantScopedDb` 闭合本库租户文件隔离。它不读安全 Profile / Gate 0。是否等于 Profile B：仍 `unknown`。缺 tenant 且有 requester 时，激活路径使用字面量 `local`。
- 焦点切换之外，激活写前 ACL、影子观察 ACL、回复关闭与 `active.get` 的 requester/owner 过滤、焦点恢复、心跳焦点、主会话 cron 注入都有具体调用点。`resolveAuthorization` 与 `OPENBOT_CONVERSATION_TASK_AUTHORIZATION` 不是这些热路径的门。
- 失败语义按转移分列：开库与非法 `transitionTask` 抛错；激活钩子与回复关闭吞错，聊天继续；焦点冲突挡住该次 `chat.send`。未读转移保持 `unknown`。
- 五个 ConversationTask 环境旗标默认关。配置库不能打开 activation / projection / authorization。production-proven 仍 `unknown`（未探测 `openbot-gateway-rc`）。

FC-02 的关闭前 delivery-hold 观察保持原样：旗标 `OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT` 默认关，打开后只记咨询，不推迟 `closed`。FC-08b 不重接它，不新开旗标，不把 §6 收成预检三态。

FC-08c 是文档复核，不是预检刀。格子正文在 `execution-entry-inventory.md` §9「FC-08c 稀疏格复核」。

源码已证明的部分：

- 未过 `resolveEffectiveEnableState` 的插件记 `disabled`，reason 在 `record.error`（`plugins disabled` / `blocked by denylist` / `disabled in config` / `not in allowlist` / `bundled (disabled by default)`）。不抛，不写 diagnostics，不调用 `register`，该插件的工具不进入 `registry.tools`。装载循环继续。`loadGatewayPlugins` 返回后 Gateway 继续启动（`src/gateway/server.impl.ts`）。
- 空 `plugins.allow` 不是拒绝：非 bundled 默启，并打 allow 为空的 warn（`src/plugins/loader/provenance.ts`）。memory slot 选中的 id 可以不在非空 allow 里仍启用；denylist、显式 `enabled: false`、全局关闭先于这一例外。
- 已放行后的完整性钉不符是该插件 `status = "error"`（`integrity check failed:`），记 diagnostic，仍不 `register`，也不中止 Gateway。`jiti` / `register()` 抛错被 `recordPluginError` 吞掉。`register()` 中途已 `registerTool` 再抛错时，`registry.tools` 不回滚。
- 用户可见：verbose / info / `--json` 能看到 `record.error`。`plugins doctor` 只列 `status === "error"`，所以 allow / deny 拒绝不进 doctor 的错误列表。装载门没有聊天拒绝文案。
- 路径：`src/plugins/loader.ts`、`src/plugins/loader/load-orchestration.ts`、`src/plugins/config-state.ts`、`src/plugins/integrity.ts`、`src/plugins/loader/plugin-record.ts`、`src/plugins/tools.ts`、`src/gateway/server-plugins.ts`。

仍 unknown：

- Profile B 是否被插件装载闭合。装载器不读安全 Profile / Gate 0。
- production-proven（未探测 `openbot-gateway-rc`）。
- 本行的预检三态。FC-08c 不新开旗标，不把 §9 收成 explicit reuse-observe。
- `src/plugins/install.ts` 不读 allow / deny。安装返回值的失败形态不在本格升格。

## §8.3 之后：FC-09 处置账本（不是第 4 软观察刀）

书面范围：`phase_c_83_allowed_entry_disposition`（`phase-c-83-allowed-entry-disposition-scope.md` / `phase-c-83-allowed-entry-disposition.md`）。

在 Phase C §8.3 产品确认之后，下一份**允许**的 discovery 刀是允许入口三态**处置账本**（docs-only）：为 task-orchestration、Fabric、以及新登记的 `knowledge.capability.invoke` 写入 **exemption+break-glass**；汇总已落地 reuse-observe；stdio / AOR / Cron·subagent 仍只列 Owner 候选项。

这**不是**第 4 软观察刀。不新开 `OPENBOT_*_PREFLIGHT_OBSERVE`。不把「回到热路径」写成 reuse-observe。C10 仍不能 pass。
