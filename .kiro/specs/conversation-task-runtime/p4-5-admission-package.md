# ConversationTask Runtime — P4.5 Orchestration Plane 准入包

> Owner(本切片): Cursor cloud agent · Task: `conversation-task-runtime` / P4.5
> 关联: `./p4-5-orchestration-plane.md`(设计)、`./p2-5-admission-package.md`(休眠交付/AC 风格)、`./p2-design-freeze.md`(A1–A5 **不改**)、`./execution-plan.md`
> 状态: **`this grant = dormant code + spec` · orientation LANDED (#773) · P4.5d/e/f grayscale LANDED dormant (#789) · Gate C = ORCH_SHADOW observation APPROVED (this PR; host env later) · LIVE_INVOKE / DISPATCH / NODE / BROWSER / CTR activation still NOT APPROVED · `production enable of orchestration/node/browser = NOT APPROVED` · `CTR activation = NOT APPROVED` · `production rollout = NOT APPROVED`**

## 0. 结论摘要

本准入包批准的是：**合同冻结 + 默认关闭、可随主干二进制休眠随船的 Orchestrator 内核**，与 P2.5 shadow 同构（present, dormant, triple fail-closed）。

**明确不批准：**

- 生产启用 `conversationTask.orchestration.dispatchEnabled` / `nodeEnabled` / `browserEnabled` / `shadowEnabled`
- CTR `activation` / `projection` / `authorization` 开启
- live invoke（`web_search` / `web_fetch` / `browser` / `nodes` / `system.run` / `sessions_spawn`）
- gateway 每消息 choke-point（本 PR 选择 library-only，不插入 `dispatchReplyFromConfig`）
- P3 Revision、P7 Mission、打开 flag 的 cutover 脚本

下一次生产 cutover **可以**包含本二进制（flags OFF），**不可以**把本 PR 当成调度启用。

## 1. 本 grant 范围（即使合入也仅此）

**允许：**

- 规格：`p4-5-orchestration-plane.md`、本准入包、`execution-plan.md` 最小补丁（事实链插入 Orchestrator、§2 缺口、§5.4 执行面、§11 P4.5、个人 subagent ≠ Mission）
- 运行时：`src/task-orchestration/**` 纯函数路由、flag 门闩、invariants、ledger-bridge **类型**、skill-binder（无网络）
- 测试：阶梯 / node fail-closed / sandbox≠node / dormant no-op / 调度不能跑在 CTR 前面；既有 `src/conversation-task` 测试不削弱

**仍然禁止：**

- `runActivationGate`、`openTaskStore`、Candidate/Task 写入
- Progress Ledger writer 调用
- `createWebSearchTool` / `createWebFetchTool` / `createBrowserTool` / `createNodesTool` / `createSessionsSpawnTool` / `listNodes` 的生产路径 execute
- 把 `steps` / `progress` / `nodeId` 写入 ConversationTask / `conversation_tasks`
- 改 `chat.send` 内容/时序/错误语义
- 把 CTR 五开关当成 Orchestrator 启用
- UI 宣称任务已调度/已在用户电脑执行
- 生产灰度或 flag 打开

## 2. 验收测试要求（合入门槛）

实现必须随附可执行测试（fail 即不得合并）：

1. **阶梯：已有 connector 不得选 browser 刮会话。** `routeStep` 在 connector 已连接时选择 `connector`，不选择 `browser`；若请求跳到 browser ⇒ `blocked_policy`。
2. **Node fail-closed。** 零 node / 多个未绑定 node / `nodeEnabled` OFF ⇒ `human_gate` 或 `skip`，永不 `node_exec` / `node_fs_read`。
3. **Sandbox ≠ node。** workspace 相对路径不得路由为 `node_fs_read`。
4. **Dormant。** 四开关全 OFF ⇒ dispatch 入口 no-op（无 job、无 invoke）。
5. **不能跑在 CTR 前面。** `dispatchEnabled=1` 且 CTR `activation` OFF ⇒ 不创建任务、不 invoke。
6. **既有 CTR 测试仍通过。** 不削弱 CT2 / CT11 / shadow-only。
7. **CTR activation 不是 orch enable。** 仅 CTR `activation` ON、orch 四开关 OFF ⇒ 仍 dormant。
8. **Live invoke 类型冻结。** `considerDispatch` 返回 `invokedTool: false`；`ORCHESTRATION_LIVE_INVOKE === false`。
9. **Skill expand 不是 Evidence。** `bindSkillToStepDraft` 的 `evidenceEligible === false`。
10. **Ledger bridge 拒绝 forbidden evidence。** `assistant_text` / `model_claim` 不得作为 bridge 输出。

## 3. 验收记录（本切片）

| AC  | 门槛                                                                                                  | 本 PR                                                           |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| AC1 | 默认全 OFF；`isOrchestrationDormant()` 在 shadow+dispatch OFF 时为 true                               | `feature.ts` + `feature.test.ts`                                |
| AC2 | 无 live invoke；无 `runActivationGate` / `openTaskStore` / ledger writer                              | `dispatch.ts` 字面量 `false`；静态不引用这些符号的 execute 路径 |
| AC3 | 无新的每消息 gateway choke-point                                                                      | 不改 `src/gateway/**`、`src/auto-reply/**`                      |
| AC4 | 四开关不复用 CTR 五 flag 名/env                                                                       | `ORCHESTRATION_FLAG_NAMES` / `ORCHESTRATION_ENV`                |
| AC5 | CTR shadow-only ⇒ orch **dispatch** 写入 0 invoke 0；Gate C shadow-only 可打分/记 reason，仍 invoke 0 | `considerDispatch` + dispatch tests                             |
| AC6 | CT2：node 绑定不在 ConversationTask 行                                                                | orch invariants；不改 A1 schema                                 |
| AC7 | 不 mint Mission；`sessions_spawn` 仅类型/深度注释                                                     | `PERSONAL_SUBAGENT_MAX_DEPTH`；dispatch 不 spawn                |
| AC8 | **production enable of orchestration/node/browser = NOT APPROVED**；activation = NOT APPROVED         | 本文件 §0 / PR 描述                                             |

## 4. 声明

- 合入主干 ≠ 已上线 ≠ 调度批准 ≠ node/browser 批准 ≠ activation 批准。
- 下一次 cutover 可以带上本二进制，flags 必须保持 OFF，与 P2.5 shadow 同船策略一致。
- 任何打开 `OPENBOT_CONVERSATION_TASK_ORCH_*` 或 CTR forbidden flags 的行为需要**另一轮独立生产发布审批**。

## 5. P4.5b 增量（choke-point，仍 dormant）

P4.5 kernel（#775）AC3 是 library-only。本增量**刻意**把 `observeOrchestrationConsider` 插入 `dispatchReplyFromConfig`，紧挨 `observeInboundTurnShadow`。

合同（复制 shadow）：

- 同步、try/catch、永不 await 工具、永不抛进 `chat.send`
- 默认 OFF；空 allowlist 硬编码 fail-closed（本切片不读 CTR config store）
- `invokedTool` / `job` / `wroteLedger` 仍冻结 `false`
- 不打开任何 `OPENBOT_CONVERSATION_TASK_ORCH_*` 或 CTR activation

**生产启用 orchestration/node/browser 仍为 NOT APPROVED。** 插入 choke-point ≠ 打开调度。

## 6. P4.5c 增量（身份进入 choke-point，仍 dormant）

本增量把 server-derived 身份传入 `observeOrchestrationConsider`，字段与 shadow 同源。空 allowlist 仍硬编码；身份不打开调度、不 invoke。

**生产启用 orchestration/node/browser 仍为 NOT APPROVED。**

## 7. seq-45 B（历史记录；D 已完成）

独立部署前验收见 [`./p4-5-seq45-b-predeploy.md`](./p4-5-seq45-b-predeploy.md)（当时 **B = CONDITIONAL PASS**，休眠随船）。

事后（相对 B 当时；本包不申请新 cutover）：

- seq 45 **D 已完成**；ledger **#782 已在 main**
- **seq 46 已回滚**
- P4.5b **#783** 与 P4.5c **#785** 已在 `origin/main`（见 §5 / §6）
- LIVE 正在另行 recut（本文件不记录尚未合入的 recut SHA）。回滚后 LIVE 曾为 `21e1e839`
- **flags 保持 OFF**；**C 观测启用未打开**

**不是**编排 / activation 启用批准。

## 8. P4.5d 增量（dormant web_read grayscale，仍不 invoke）

本增量登记 `web_read` 为唯一灰度面，并按符号名绑定 `createWebSearchTool` / `createWebFetchTool`。观察/打分 only。

**明确不是生产启用：**

- 不打开任何 `OPENBOT_CONVERSATION_TASK_ORCH_*` 默认、部署或 env 示例
- `ORCHESTRATION_LIVE_INVOKE` 仍为 `false`；`DispatchResult.invokedTool` 仍为字面量 `false`
- 不 execute `createWebSearchTool` / `createWebFetchTool` / `createBrowserTool` / `createNodesTool` / `system.run` / `sessions_spawn`
- browser / `node_fs_read` / `node_exec` 不在本切片
- 不切 seq 46、不碰 `deploy/production` LIVE、不打开 Gate C

## 9. P4.5e 增量（dormant browser grayscale，仍不 invoke）

本增量登记 `browser` 为第二个灰度面，并按符号名绑定 `createBrowserTool`。仅 `interact_web` + 无 connector + 测试输入 `browserEnabled` 可 _select_；观察/打分 only。

**明确不是生产启用：**

- 不打开任何 `OPENBOT_CONVERSATION_TASK_ORCH_*` 默认、部署或 env 示例（`browserEnabled` 只作输入门闩，不默认 ON）
- `ORCHESTRATION_LIVE_INVOKE` 仍为 `false`；`DispatchResult.invokedTool` 仍为字面量 `false`
- 不 execute `createWebSearchTool` / `createWebFetchTool` / `createBrowserTool` / `createNodesTool` / `system.run` / `sessions_spawn`
- `web_read` 灰度保持（公开可读仍优先 web_read；`read_web` 请求 browser 仍 skip-ahead blocked）
- `node_fs_read` / `node_exec` 在 P4.5f 按符号绑定；本切片仍不 execute node
- 不切 seq 46、不碰 `deploy/production` LIVE、不打开 Gate C

## 10. P4.5f 增量（dormant node surfaces + explicit human gate，仍不 invoke）

本增量登记 `node_fs_read` / `node_exec` 为灰度面，并按符号名绑定 `createNodesTool` / `listNodes` / `system.run`。Human gate 强制，除非测试输入恰好一个已绑定 node 且 `nodeEnabled` ON。观察/打分 only。

**明确不是生产启用：**

- 不打开任何 `OPENBOT_CONVERSATION_TASK_ORCH_*` 默认、部署或 env 示例（`nodeEnabled` 只作输入门闩，不默认 ON）
- `ORCHESTRATION_LIVE_INVOKE` 仍为 `false`；`DispatchResult.invokedTool` 仍为字面量 `false`
- 不 execute `createWebSearchTool` / `createWebFetchTool` / `createBrowserTool` / `createNodesTool` / `listNodes` / `system.run` / `sessions_spawn`
- 零 node / 多个未绑定 node → `human_gate`；workspace 路径不得路由为 node；`nodeEnabled` OFF → skip
- `web_read` / `browser` 灰度保持（公开可读仍优先 web_read；skip-ahead 到 browser 仍 blocked）
- 不切 CTR 口头「seq 46」、不碰 `deploy/production` LIVE、不写 ledger 行

## 11. Gate C（ORCH_SHADOW 观察 only；本 PR）

**Gate C APPROVED，且仅此：** 生产可在 **host env**（稍后，本 PR 不改 source defaults）打开 `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW`，让 `considerDispatch` 在 `shadowEnabled && !dispatchEnabled` 时真正调用 `routeStep` 并记录 reason codes。

**仍然 NOT APPROVED：**

- `ORCHESTRATION_LIVE_INVOKE`（保持 `false`）
- `OPENBOT_CONVERSATION_TASK_ORCH_DISPATCH` / `ORCH_NODE` / `ORCH_BROWSER`
- CTR `activation` / `projection` / `authorization`
- 本 PR 打开 `feature.ts` 的 `ORCH_SHADOW` 默认值（**禁止**；缺 env 仍 OFF）
- 把 orch flags 写进 `.env.example` / compose / CI / deploy overlay 为 true
- 本 PR 当 ledger 行、当 host swap、当 cutover SHA

**seq 号不要混：**

- **#796 seq 46 / 47** = Aliyun ledger **重建**，**不是** 本次 CTR cut
- CTR 口头「seq 46」= **下一次前向 LIVE host cut**（本 PR 之后、GHCR 镜像存在之后，由操作者执行）
- 那次 host cut 之后，Aliyun ledger 下一行是 **seq 48**（经 `pnpm delivery:cutover:record`），不是 46

独立说明见 [`./p4-5-gate-c-orch-shadow.md`](./p4-5-gate-c-orch-shadow.md)。**本文件不是 ledger 行。**
