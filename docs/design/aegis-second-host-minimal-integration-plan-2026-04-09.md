# Aegis 第二宿主最小接入方案

## 0. 当前状态

本方案对应的最小接入骨架已经完成，当前已验证的事实如下：

1. Aegis 已新增 `server/collaboration-host/` 目录，形成第二宿主最小接入层。
2. Aegis 已通过真实包依赖消费 `@openbot/collaboration-core` 与 `@openbot/collaboration-runtime`，不再依赖相邻源码路径。
3. Aegis 已形成显式映射层与正式 adapter 边界：
   - `server/collaboration-host/mappers/`
   - `server/collaboration-host/aegis-adapter.ts`
   - `server/collaboration-host/external-sdk.ts`
4. Aegis 已具备可重复执行的第二宿主测试入口：
   - `package.json` 中的 `test:collaboration-host`
5. 当前已验证通过的定向测试为：
   - `server/collaboration-host/__tests__/collaboration-host-smoke.test.ts`
   - `server/collaboration-host/__tests__/collaboration-host-runtime.test.ts`
   - `server/collaboration-host/__tests__/collaboration-host-core-compat.test.ts`
   - `server/collaboration-host/__tests__/collaboration-host-adapter.test.ts`
   - `server/collaboration-host/__tests__/collaboration-host-review-flow.test.ts`
   - `server/collaboration-host/__tests__/collaboration-host-decision-flow.test.ts`
   - `server/collaboration-host/__tests__/collaboration-host-memory-flow.test.ts`
   - `server/collaboration-aegis-adapter/__tests__/boundary.test.ts`
6. Aegis 全仓 `build` 已通过。

当前结论：

1. 第二宿主验证已从“方案阶段”进入“深链路验证通过”的阶段。
2. 这证明 SDK 现阶段继续留在 OpenBot 仓库 `packages/` 下是合理的。
3. 但这还不等于已经可以推动 Aegis 主链路接入，更不等于 SDK 已适合独立拆仓。

## 1. 目标

本阶段不把 Aegis 改造成协作群产品，也不替换其现有 `workbench/session/governance` 主链路。

本阶段唯一目标是验证：

1. `@openbot/collaboration-core` 是否能作为跨仓库纯领域包被 Aegis 消费。
2. `@openbot/collaboration-runtime` 是否能在 Aegis 中作为纯运行时规则库被安全消费。
3. Aegis 是否能够通过一层显式映射，把现有模型投影到协作 SDK，而不破坏现网行为。

## 2. 结论

当前不应迁出 `packages/`，也不应先拆成独立仓库。

当前正确路径是：

1. 保持 SDK 继续留在 OpenBot 仓库 `packages/` 下。
2. 让 Aegis 以第二宿主身份从仓库外部接入 `core` 和 `runtime`。
3. 在 Aegis 内新增一层最小适配层，完成模型映射和 smoke 验证。
4. 验证通过后，再决定是否推进共享发布、独立仓库、或新的 adapter 包。

## 3. 不做什么

当前阶段明确不做：

1. 不修改 Aegis 现有 `workbench-v2` 主链路。
2. 不替换 Aegis 现有 `TaskSessionV2`、`DeliverableV1`、`DecisionContract` 真相结构。
3. 不直接复用 `@openbot/collaboration-openbot-adapter`。
4. 不把 SDK 提前迁出 OpenBot 仓库。
5. 不引入生产切流。

## 4. Aegis 现状判断

Aegis 已具备适合作为第二宿主的条件：

1. 是独立 TypeScript/PNPM 项目，有明确 `server/`、`client/`、`shared/` 分层。
2. 已存在 workbench、governance、deliverable、decision 等对象和状态机。
3. 已有较多测试基础，适合先做最小只读验证。

同时，Aegis 与协作 SDK 的模型并不一一对应：

1. `shared/workbench-v2-types.ts` 以 session 为中心。
2. `shared/deliverable-v1-types.ts` 有自己的交付协议。
3. `shared/decision-contract-types.ts` 有自己的 decision contract。
4. `shared/ui-projection-state-machine.ts` 是 UI 投影状态机，不等同于 collaboration runtime projection。

因此，接入方式必须是：

`Aegis Existing Model -> Mapping Layer -> Collaboration SDK`

而不是：

`Aegis Existing Model -> Direct Replace -> Collaboration SDK`

## 5. 最小接入范围

第一阶段只接两层：

1. `@openbot/collaboration-core`
2. `@openbot/collaboration-runtime`

明确不接：

1. `@openbot/collaboration-openbot-adapter`

原因：

1. `core` 是纯领域逻辑，适合跨宿主验证。
2. `runtime` 是纯规则和投影逻辑，适合做宿主无关验证。
3. `openbot-adapter` 是 OpenBot 宿主适配层，对 Aegis 没有直接复用价值。

## 6. Aegis 最小映射层设计

建议在 Aegis 中新增目录：

`server/collaboration-host/`

目录结构建议：

1. `server/collaboration-host/mappers/task-session-to-collaboration.ts`
2. `server/collaboration-host/mappers/deliverable-to-collaboration.ts`
3. `server/collaboration-host/mappers/decision-to-collaboration.ts`
4. `server/collaboration-host/mappers/runtime-context-to-collaboration.ts`
5. `server/collaboration-host/checks/collaboration-host-smoke.ts`
6. `server/collaboration-host/__tests__/collaboration-host-smoke.test.ts`

### 6.1 Task 映射

将 Aegis 的 `TaskSessionV2` 投影为 collaboration `Task`：

1. `session.id -> task.taskId`
2. `session.taskGoal -> task.title`
3. `session.status -> task.status`
4. `session.updatedAt -> task.updatedAtMs`
5. `session.createdAt -> task.createdAtMs`

注意：

1. 这里只做最小投影，不尝试保留 Aegis 的全部语义。
2. 若 Aegis 状态无法直接映射，统一落到受控 fallback。

### 6.2 Deliverable 映射

将 Aegis 的 `DeliverableV1` 或 artifact 投影为 collaboration `Deliverable`：

1. `artifact/session derived id -> deliverableId`
2. `deliverable.title -> title`
3. `deliverable content -> content`
4. `execution quality / delivery phase -> status`

### 6.3 Decision 映射

将 Aegis 的 `DecisionContract` 投影为 collaboration `Decision`：

1. `decision_id -> decisionId`
2. `trace_id -> metadata trace`
3. `status -> decision.status`
4. `human_readable_reason / evidence -> rationale/context`

### 6.4 Runtime Context 映射

将 Aegis 当前 workbench/runtime 上下文投影为 collaboration runtime `RuntimeContext`：

1. `session id -> sessionId`
2. `user/actor id -> actor.id`
3. `message/input -> message`
4. `session metadata -> metadata`

## 7. 首批验证点

首批验证只做 4 个点：

1. `TaskStateMachine`
2. `DeliverableStateMachine`
3. `canPublishFinalDecision / canRuntimeNodePublishProposal`
4. `createRuntimeProjection / resolveMessageRoute`

原因：

1. 这四类能力最接近 Aegis 当前已有结构。
2. 都能通过映射层验证，不需要数据库或生产切流。
3. 这足以验证第二宿主是否成立。

## 8. 接入方式

### 8.1 当前阶段推荐方式

在 Aegis 中先使用本地 `file:` 依赖接入：

1. `@openbot/collaboration-core`
2. `@openbot/collaboration-runtime`

推荐原因：

1. 便于快速验证跨仓库消费。
2. 不需要立即引入发布流程。
3. 不会要求 SDK 现在就拆仓。

### 8.2 当前阶段不推荐方式

1. 不建议复制源码到 Aegis。
2. 不建议直接把 `packages/` 整体搬到 Aegis。
3. 不建议现在发 npm prerelease 只为第二宿主验证。

## 9. 实施顺序

### Step 1

在 Aegis 中新增最小接入目录和 smoke test。

### Step 2

接入 `@openbot/collaboration-core`，验证状态机和策略函数。

### Step 3

接入 `@openbot/collaboration-runtime`，验证 route/projection/gate。

### Step 4

补 Aegis 侧映射测试，确保映射结果稳定。

### Step 5

形成第二宿主验证报告，判断：

1. 是否继续做 `collaboration-aegis-adapter`
2. 是否准备 SDK 对外发布
3. 是否需要拆仓

当前进度：

1. Step 1-4 已完成。
2. Step 5 已进入报告与下一阶段决策。

## 10. 验收标准

第二宿主最小验证通过，至少满足：

1. Aegis 可从仓库外正确解析 `@openbot/collaboration-core`
2. Aegis 可从仓库外正确解析 `@openbot/collaboration-runtime`
3. 映射层 smoke tests 全通过
4. Aegis 宿主侧最小接入测试稳定通过
5. 未修改 Aegis 现有主链路行为

当前已满足：

1. `Aegis` 可从仓库外正确解析 `@openbot/collaboration-core`
2. `Aegis` 可从仓库外正确解析 `@openbot/collaboration-runtime`
3. 宿主侧 smoke/runtime/core-compat/adapter/review/decision/memory 测试通过
4. Aegis 全仓 `build` 通过
5. 未修改 Aegis 现有主链路行为

当前未完成或未正式复核：

1. 尚未形成 `collaboration-aegis-adapter` 的正式包化方案
2. 尚未形成是否拆仓或对外发布的 Go/No-Go 结论
3. 尚未引入第三宿主验证

## 11. 下一步执行建议

下一步不再是重复搭骨架，而应进入：

`第二宿主验证成果固化与下一阶段决策`

建议动作：

1. 形成正式第二宿主验证报告，冻结当前已验证事实与边界。
2. 评估是否把 `server/collaboration-host/` 提升为正式 `collaboration-aegis-adapter` 边界。
3. 在 OpenBot 主仓内补一份基于事实的 Go/No-Go 结论，判断是否进入第三宿主准备。
4. 在第三宿主验证前，不进入拆仓或公开发布讨论。

这是当前最小、最稳、风险最低的下一阶段推进方式。
