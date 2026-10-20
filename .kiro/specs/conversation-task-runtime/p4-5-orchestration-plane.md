# ConversationTask Runtime — P4.5 Orchestration Plane

> Owner(本切片): Cursor cloud agent · Task: `conversation-task-runtime` / P4.5
> 关联: `./execution-plan.md`(§1 事实链、§5.4 授权、§9 Ledger、§10 UX、§11 阶段)、`./p2-design-freeze.md`(A1–A5 **不改**)、`./p2-5-production-integration.md`、`./p2-5-admission-package.md`、`./p4-5-admission-package.md`
> 状态: **`P4.5 design = FROZEN` · `P4.5 dormant kernel = LANDED (#775)` · `P4.5b choke-point = LANDED (#783)` · `P4.5c identity = LANDED (#785)` · `P4.5d/e/f grayscale = LANDED (#789, flags OFF, no invoke)` · `Gate C observation = APPROVED`（ORCH_SHADOW 打分/记 reason；host env later） · `invoke = FROZEN` · `production enable of dispatch/node/browser = NOT APPROVED` · `CTR activation = NOT APPROVED`**
> 本文件冻结 Orchestrator 合同。实现必须默认关闭。Gate C 只批准 shadow **观察**：`shadowEnabled && !dispatchEnabled` 时可 `routeStep` + 记 reason，仍写入 0、invoke 0。DISPATCH / NODE / BROWSER / `ORCHESTRATION_LIVE_INVOKE` 仍 fail-closed。不得把本切片当成调度、node、browser 或 activation 的生产启用。

## 0. 问题与边界

OpenBot 已有执行面：`web_search` / `web_fetch` / `browser`、配对 node-host（`nodes` / `system.run`）、workspace skills、`sessions_spawn` 子代理、Progress Ledger。CTR 在 P2.5 只影子观测 detect/qualify，**不得执行**。

缺口：ConversationTask（身份）与 Progress Ledger（事实）之间没有 dispatcher，无法在 fail-closed 授权下选择这些执行面。

本切片冻结该合同，并落地 **default-off** 运行时内核，使下一次生产 cutover 可以像 seq 44 纳入 P2.5 shadow 一样纳入二进制：代码在、开关关、零 invoke。

**不在本切片启用：** activation、projection、authorization、dispatch、node、browser、任何 live tool invoke。

## 1. 架构：Orchestrator 是 dispatcher，不是 workhorse

冻结事实链（相对 `./execution-plan.md` §1，插入 Orchestrator）：

```text
Conversation
  -> Detection
  -> Qualification
  -> Activation
  -> ConversationTask          // 身份内核；无 steps/progress/running/nodeId
  -> Orchestrator (dispatcher) // 本切片：选面、ack/enqueue/return
  -> Execution Events
  -> Progress Ledger           // 事实权威
  -> Evidence / Acceptance
  -> Projection
```

| 模块                                        | 唯一职责                                     | 禁止                                                            |
| ------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| ConversationTask (`src/conversation-task/`) | 身份、归属、目标、生命周期、会话绑定         | `steps` / `progress` / `evidence` / `running` / `nodeId`（CT2） |
| Orchestrator (`src/task-orchestration/`)    | 执行面路由与调度门闩                         | 第二套进度状态机；在 `chat.send` 上 await 长任务                |
| Progress Ledger (`src/progress-ledger/`)    | 执行事实、步骤、Evidence、Acceptance、Replan | assistant_text / model_claim 当 Evidence（I1）                  |

Orchestrator 分区独立，**不**放进 `src/conversation-task/`。CT2 继续成立。

### 1.1 Chat 路径合同

```text
chat.send
  -> fire-and-forget considerDispatch   (P4.5b choke-point, present, dormant)
  -> ack / enqueue / return
  -> NEVER await browser, nodes/system.run, web_search, sessions_spawn
```

P4.5b 已插入 choke-point；P4.5c 把 server-derived 身份（tenantId / requesterId / conversationId / messageId）传入 `observeOrchestrationConsider`，与 `observeInboundTurnShadow` 同源。合同不变：同步、try/catch、不抛进 `chat.send`、不 await 任何工具。身份不用来 invoke；空 allowlist 仍硬编码 fail-closed。flag OFF 时 no-op。**生产启用 orchestration/node/browser 仍为 NOT APPROVED。** Live invoke 仍冻结（`ORCHESTRATION_LIVE_INVOKE === false`）。

Ack ≠ delivery。Ledger I1 仍成立：assistant 自述、planner claim、run summary **不是** Evidence。工具结果才是。

### 1.2 三拍 UX（合同，本 PR 不接线）

| Beat                | 含义                                         | 不是                                             |
| ------------------- | -------------------------------------------- | ------------------------------------------------ |
| Ack                 | 已接受工作、将持续推进                       | 不是完成、不是已发送、不是已在用户电脑上找到文件 |
| Meaningful progress | Ledger `MEANINGFUL_PROGRESS` / 合法 Evidence | 不是模型“正在处理”的口头进度                     |
| Evidenced delivery  | Acceptance `met` 且有允许的 Evidence         | 不是 ack、不是 skill expand、不是 UI 文案        |

低风险 ack 示例（沿用 §10）：“好的，我会持续跟进这项工作。”高风险副作用仍须 Human Gate，不得把自动升级伪装成授权。

## 2. ExecutionSurface

`SideEffectClass`（CTR `types.ts`：`none | outbound_message | external_write | broadcast`）对**授权**仍然有效，且与持续时间正交。它对**路由**过粗。Orchestrator 用 `ExecutionSurface` 选面；**不**修改 CTR A1–A5 / `SideEffectClass`。

```ts
type ExecutionSurface =
  | "memory"
  | "skill"
  | "connector"
  | "web_read"
  | "browser"
  | "node_fs_read"
  | "node_exec"
  | "outbound_message"
  | "external_write"
  | "broadcast";
```

时长判定 vs 授权 vs 执行面选择三者正交：

- 工作是否 L2 → Detection / Qualification / Activation（CTR）
- 能否发消息/写外部/广播 → Authorization + Human Gate（CTR §5.4，P5）
- 用哪一个已有工具面 → Orchestrator `routeStep`（本切片）

`outbound_message` / `external_write` / `broadcast` 在阶梯上不是能力跃迁，P4.5 一律 `human_gate`（outbound 授权未批）。

## 3. 能力阶梯（不得跳级）

必须按最低充分面选择。跳到更高 rung 而更低 rung 已充分 = `blocked_policy`。

```text
memory / evidence
  -> skill recipe
  -> connected connector
  -> web_read
  -> browser          // 仅当需要交互 / 登录 / 点击
  -> node_fs_read / node_exec  // 仅当目标是用户机器
  -> human_gate
```

硬规则：

1. **已有 connector 不得改用 browser 去刮会话。** 例如 Gmail 已连接时，不得 `browser` 登录网页版邮箱。
2. **公开可读网页用 `web_read`，不用 browser。** browser 仅交互/登录。
3. **Skill 是配方**（seed step 上的 `skillId`），不是 agent。Skill expand **不是** Evidence；工具结果才是。
4. **Sandbox ≠ node。** Gateway workspace 相对路径不得路由为 `node_fs_read` / `node_exec`。
5. **用户机器 = 已配对 `nodeId`。** 来源：`listNodes`（`src/agents/tools/nodes-utils.ts`）/ `nodes` tool。零 node、或多个未绑定 node → Human Gate，零 invoke。不得静默回退 sandbox 并声称“在你的电脑上找到了”。
6. **`nodeEnabled` / `browserEnabled` 是面级总闸。** `dispatchEnabled` 不能在总闸 OFF 时强行选中 node/browser。

## 4. 映射到现有 OpenBot 工具（供后续 invoke PR 对照）

本 PR **只引用符号，不调用**。Live path 不得 `execute` 这些 tool。

| Surface                                             | 现有符号                                                                             | 路径                                                                                          | P4.5                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `web_read`                                          | `createWebSearchTool`（tool name `web_search`）、`createWebFetchTool`（`web_fetch`） | `src/agents/tools/web-search.ts`、`web-fetch.ts`、`web-tools.ts`                              | **dormant grayscale**：按符号名绑定，不 execute；非生产启用                                           |
| `browser`                                           | `createBrowserTool`（tool name `browser`）                                           | `src/agents/tools/browser-tool.ts`                                                            | **dormant grayscale**：按符号名绑定，不 execute；总闸默认 OFF；仅交互/登录                            |
| `node_fs_read` / `node_exec`                        | `createNodesTool`（`nodes`）、`listNodes`、`system.run` / `system.run.prepare`       | `src/agents/tools/nodes-tool.ts`、`nodes-utils.ts`、`src/agents/bash-tools.exec-host-node.ts` | **dormant grayscale**：按符号名绑定，不 execute；总闸默认 OFF；需唯一已绑定 node；否则显式 human_gate |
| `skill`                                             | `SkillEntry` / `loadWorkspaceSkillEntries` / `buildWorkspaceSkillSnapshot`           | `src/agents/skills.ts`、`src/agents/skills/workspace.ts`                                      | `skill-binder` 只把 `skillId` 映到 step draft，不网络、不 install                                     |
| 个人 worker（非 Mission）                           | `createSessionsSpawnTool`（`sessions_spawn`）                                        | `src/agents/tools/sessions-spawn-tool.ts`                                                     | 类型/深度上限注释 only；不 spawn                                                                      |
| `memory`                                            | 既有会话/记忆上下文                                                                  | `src/memory/**`                                                                               | 不新增 tool                                                                                           |
| `connector`                                         | 已连接渠道/插件                                                                      | `src/channels/**`、`extensions/*`                                                             | 已连接则优先于 browser                                                                                |
| `outbound_message` / `external_write` / `broadcast` | 既有消息渠道                                                                         | `src/telegram` 等                                                                             | P4.5 → human_gate                                                                                     |

个人 `sessions_spawn` workers **以后可以用**，且 **不是 P7 Mission**。深度上限写在类型上（`PERSONAL_SUBAGENT_MAX_DEPTH`）。本 PR 不 mint Mission，不在 live path spawn。

## 5. Feature flags（新的四个，全部默认 OFF）

**不得**复用 CTR 五开关（`detection` / `qualification` / `activation` / `projection` / `authorization`）。CTR `activation` ON **不等于** Orchestrator 启用。

| Config key                                       | Env                                       | 含义                                                     |
| ------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------- |
| `conversationTask.orchestration.shadowEnabled`   | `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW`   | 跑纯路由，不 invoke、不落任务                            |
| `conversationTask.orchestration.dispatchEnabled` | `OPENBOT_CONVERSATION_TASK_ORCH_DISPATCH` | 允许 enqueue（仍要求 CTR activation + Ledger；保持 OFF） |
| `conversationTask.orchestration.nodeEnabled`     | `OPENBOT_CONVERSATION_TASK_ORCH_NODE`     | node 面总闸，默认 OFF                                    |
| `conversationTask.orchestration.browserEnabled`  | `OPENBOT_CONVERSATION_TASK_ORCH_BROWSER`  | browser 面总闸，默认 OFF                                 |

Fail-closed：

- 缺 flag / 未设 env ⇒ OFF。**禁止**把 `ORCH_SHADOW` 的 source default 翻成 ON（`feature.ts` `envEnabled` 保持 fail-closed）。
- Gate C：**仅** `shadowEnabled && !dispatchEnabled` 时，空 allowlist + CTR `activation` OFF 仍可 `routeStep` + 记 reason；`enqueue` / `invoke` / `invokedTool` / `wroteLedger` 仍为 false。
- `dispatchEnabled` / `nodeEnabled` / `browserEnabled` / `ORCHESTRATION_LIVE_INVOKE` 任一为 true ⇒ 仍 fail-closed，不得 invoke。
- CTR 仍 shadow-only（`activation` OFF，P2.5 合同）⇒ Orchestrator **不得调度/invoke**。调度不能跑在 CTR 前面。
- `dispatchEnabled=1` 且 CTR `activation` OFF ⇒ 不得创建 ConversationTask、不得 invoke。
- `isOrchestrationDormant()` 在 shadow+dispatch 均 OFF 时为 true（node/browser 总闸单独为 ON 也不能唤醒内核）。

P4.5 实现不读、不写 CTR 持久 allowlist；dispatch 入口在 `allowlistEmpty` 缺省或 true 时 no-op（调用方未证明非空 ⇒ 空）。

## 6. 运行时内核（`src/task-orchestration/`）

| 文件                 | 职责                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`           | `ExecutionSurface`、`SurfaceDecision`、`OrchestratorJob`、flags、node 库存、个人 subagent 深度上限                                   |
| `feature.ts`         | 四开关、env 名、`isOrchestrationDormant()`；拒绝把 CTR activation 当 orch enable                                                     |
| `surface-router.ts`  | 纯函数 `routeStep(input) → SurfaceDecision`；无 IO                                                                                   |
| `dispatch.ts`        | `considerDispatch`：门闩 + Gate C shadow-observe（`routeStep` + 记 reason）；永不 invoke、永不 `openTaskStore` / `runActivationGate` |
| `invariants.ts`      | 不跳级；sandbox≠node；dispatch 不能在总闸 OFF 时强制 node/browser；休眠时零 tool call                                                |
| `ledger-bridge.ts`   | 输出类型仅允许 Progress Ledger `ExecutionEventType` / 允许的 EvidenceType；本 PR 不调用 writer                                       |
| `skill-binder.ts`    | `skillId` → seed step draft；不加载网络/install                                                                                      |
| `surface-binding.ts` | P4.5d/e/f：`web_read` + `browser` + `node_fs_read` + `node_exec` 灰度 allowlist + 符号名绑定；不 import / execute 工厂               |
| `index.ts`           | 公共导出；注释标明 P4.5 dormant                                                                                                      |

`OrchestratorJob` 可承载 `taskId` + 可选 `nodeId`。这是编排分区的绑定形状；**sqlite 表本 PR 不做**。不得把 `nodeId` 写进 `conversation_tasks`（A1 冻结）。

`ORCHESTRATION_LIVE_INVOKE = false` 与 `DispatchResult.invokedTool: false` 使 live invoke 在类型上不可能。

## 7. 与 A1–A5 / P2.5 的关系（矛盾则收紧，不放宽 CTR）

- **A1** `conversation_tasks` 无 `nodeId` 列。本切片不改 schema、不加列。绑定留在 Orchestrator 类型注释。
- **A2** tenant-only、无 personal fallback。本切片无新 DB；未来若存绑定必须复制 A1 tenant-only + `meta.tenant_id` 核对，不得 `ownerId` 分区。
- **CT2 / CT11** 不削弱。Orchestrator 不往 ConversationTask 行写执行态；不 mint Mission。
- **P2.5** shadow-only：detect/qualify 之外 stop。Orchestrator 不得调用 `runActivationGate`、`openTaskStore`、Ledger writer、或改 `chat.send`。
- 若 CTR 仍 shadow-only，即使误开 orch env，dispatch 入口仍必须 no-op（不能跑在 activation 前面）。

## 8. 非目标

- 不打开 `OPENBOT_CONVERSATION_TASK_ACTIVATION` 或 CTR forbidden flags。
- 不在生产/默认路径调用 `runActivationGate`、`openTaskStore`、node.invoke、browser、web_search、sessions_spawn。
- 不把 node 路径或用户原文写入 shadow 日志（本 PR 无 shadow 落盘）。
- 不把 `steps` / `progress` / `nodeId` 放到 ConversationTask / `conversation_tasks`。
- 不实施 P3 Revision、P7 Mission、或打开 flag 的 cutover 脚本。
- 不新增第二套进度状态机。Orchestrator 内存 todos 不是权威；Ledger 才是（本 PR 只类型化 bridge）。
- 不在 `chat.send` 上 await 执行面。

## 9. 后续切片（不是本 PR）

1. 在 CTR activation **已单独批准**之后，才允许考虑 `dispatchEnabled`。
2. Invoke PR：按 SurfaceDecision 调用上表符号；仍须 node/browser 总闸；仍须 ack/enqueue/return。`ORCHESTRATION_LIVE_INVOKE` 仍为 false，直到该 PR。
3. 若需要持久 `taskId → nodeId`，在编排分区复制 A1 tenant-only sqlite，不改 `conversation_tasks`。
4. 个人 `sessions_spawn` helper（非 Mission）另批；遵守深度上限。

## 10. P4.5d 增量（dormant web_read grayscale）

本增量把 `web_read` 登记为**唯一**灰度面（shadow 观察 allowlist），并把该面按符号名绑到 `createWebSearchTool` / `createWebFetchTool`。只观察、只打分，**不 execute**。

- `DORMANT_GRAYSCALE_SURFACES = ["web_read"]`
- `DispatchResult.surfaceBindings` 在选中 `web_read` 时带上名称绑定；`invokedTool` 仍为字面量 `false`
- `ORCHESTRATION_LIVE_INVOKE` 仍为 `false`；四个 `ORCH_*` env 默认仍 OFF，本增量不改任何生产/部署默认
- browser / node 面不在本切片；请求 browser 处理 `read_web` 仍 `skip-ahead blocked`

**这不是生产启用。** 打开 `OPENBOT_CONVERSATION_TASK_ORCH_*` 或 live invoke 需要另一轮独立批准。

## 11. P4.5e 增量（dormant browser grayscale）

本增量把 `browser` 登记为第二个灰度面（shadow 观察 allowlist），并把该面按符号名绑到 `createBrowserTool`。只观察、只打分，**不 execute**。仅当步骤真正需要交互/登录/点击（`intent === interact_web`、无已连接 connector）且输入 flags 上 `browserEnabled` 为 ON 时才 _select_；不把 `OPENBOT_CONVERSATION_TASK_ORCH_BROWSER` 默认打开。

- `DORMANT_GRAYSCALE_SURFACES = ["web_read", "browser"]`
- `DispatchResult.surfaceBindings` 在选中 `browser` 时带上名称绑定；`invokedTool` 仍为字面量 `false`
- `ORCHESTRATION_LIVE_INVOKE` 仍为 `false`；四个 `ORCH_*` env 默认仍 OFF
- `web_read` 灰度保持：公开可读仍优先 `web_read`；`read_web` 请求 browser 仍 `skip-ahead blocked`
- 已连接 connector 时请求 browser 仍 `skip-ahead blocked`
- `node_fs_read` / `node_exec` 在 P4.5f 按符号绑定；本切片仍不 execute node

**这不是生产启用。** 打开 `OPENBOT_CONVERSATION_TASK_ORCH_*` 或 live invoke 需要另一轮独立批准。

## 12. P4.5f 增量（dormant node surfaces + explicit human gate）

本增量把 `node_fs_read` / `node_exec` 登记为灰度面（shadow 观察 allowlist），并把它们按符号名绑到 `createNodesTool` / `listNodes` / `system.run`。只观察、只打分，**不 execute**。Human gate 是强制的，除非测试输入 flags 上恰好有一个已绑定 node **且** `nodeEnabled` 为 ON；不把 `OPENBOT_CONVERSATION_TASK_ORCH_NODE` 默认打开。

- `DORMANT_GRAYSCALE_SURFACES = ["web_read", "browser", "node_fs_read", "node_exec"]`
- `DispatchResult.surfaceBindings` 在选中 node 面时带上名称绑定；`invokedTool` 仍为字面量 `false`；`enqueue` 仍为 `false`
- `ORCHESTRATION_LIVE_INVOKE` 仍为 `false`；四个 `ORCH_*` env 默认仍 OFF
- 零 node / 多个未绑定 node / 单个未绑定 node → `human_gate`
- workspace `pathKind` 不得路由为 node（sandbox ≠ node）
- 输入 `nodeEnabled` OFF → `skip` / 不 selected
- `web_read` / `browser` 灰度保持：公开可读仍优先 `web_read`；skip-ahead 到 browser 仍 blocked；browser 仅 `interact_web` 且无 connector

**这不是生产启用。** 打开 `OPENBOT_CONVERSATION_TASK_ORCH_*` 或 live invoke 需要另一轮独立批准。

## 13. Gate C 增量（ORCH_SHADOW 观察；invoke 仍冻结）

Gate C **只批准观察**：`shadowEnabled && !dispatchEnabled` 时 `considerDispatch` 调用 `routeStep` 并记录 reason codes（`orch_shadow_observe`）。空 allowlist + CTR `activation` OFF **不再**挡住这条观察路径。

仍冻结：

- `ORCHESTRATION_LIVE_INVOKE === false`；`invokedTool` / `enqueue` / `wroteLedger` 仍为字面量 `false`
- `dispatchEnabled` / `nodeEnabled` / `browserEnabled` 为 true ⇒ `orch_live_path_armed_fail_closed`，不 invoke
- source default 仍 OFF；host 稍后才设 `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW`；禁止在 `feature.ts` 把该 flag 默认打开
- 不 execute `createWebSearchTool` / `createWebFetchTool` / `createBrowserTool` / `createNodesTool` / `listNodes` / `system.run` / `sessions_spawn`
- 本增量不是 host swap、不是 ledger 行。#796 seq 46 ≠ 本次 cut；CTR 口头「seq 46」= 下一次前向 LIVE host cut；Aliyun ledger 下一行是 seq 48

见 [`./p4-5-gate-c-orch-shadow.md`](./p4-5-gate-c-orch-shadow.md)。
