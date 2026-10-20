# Implementation Plan — Agent Data Planner + Context Broker（合一）

> 依赖：语义对象目录（`.kiro/specs/semantic-object-catalog/`，已落地）+ enterprise-data
> 既有 store/授权/执行桥范式。
> 后继：企业数据事件总线（P1）可复用 `planDataAccess` 做事件驱动重规划；术语对照文档（P3）。
>
> **状态（2026-07-12，— kiro-data-planner）**：全部任务落地并验证。
> 19 个本任务单测全绿（planner 核心 8 / handler 4 / invoke-runtime 回归 7）；改动文件 `pnpm tsgo`
> 零错误（总数 35→34，移除本任务引入的唯一错误；剩 34 为他人 WIP 既有错误，非本任务）；
> oxfmt + oxlint 本任务 7 文件全清。server-methods.test.ts 47 项方法注册一致性校验通过。

## Agents

- kiro-data-planner · role: owner · scope: Agent Data Planner + Context Broker（纯规划核心 + 授权对齐 + 上下文包 + 只读 RPC；含把授权判定抽为单一真源 capability-grant-resolver 并让 invoke-runtime 复用） · paths: `.kiro/specs/agent-data-planner/**`, `src/gateway/enterprise-data/capability-grant-resolver.ts`, `src/gateway/enterprise-data/agent-data-plan-types.ts`, `src/gateway/enterprise-data/agent-data-planner.ts`, `src/gateway/enterprise-data/agent-data-planner.test.ts`, `src/gateway/server-methods/enterprise-data-planner.ts`, `src/gateway/server-methods/enterprise-data-planner.test.ts` · since: 2026-07-12

### 定位（强约束）

- **规划 ≠ 执行**（D1）：只产 Data Plan；取数复用既有 W5 桥 `invokeDataCapabilityWithContext`。
- **只读元数据**：不读/不产业务数据行。
- **授权单一真源**（D5）：抽 `isCapabilityGrantedForSeat` 到 `capability-grant-resolver.ts`，
  invoke-runtime 改 import（该文件当前 CLEAN，重构安全）。
- **确定性相关性**（D2）：显式提示 > task 关键词 > 全部 active；无隐藏 LLM。

### 共享文件说明（多 agent 安全）

- **纯新增文件**（本任务独有）：`capability-grant-resolver.ts`、`agent-data-plan-types.ts`、
  `agent-data-planner.ts`、`agent-data-planner.test.ts`、`server-methods/enterprise-data-planner.ts`、
  `server-methods/enterprise-data-planner.test.ts`。
- **增量编辑**：`capability-agent-invoke-runtime.ts`（CLEAN；删私有函数 + import resolver，两个调用点不变）、
  `server-methods/enterprise-data.ts`（仅本任务 import + const + 展开 3 行）。
- **含他人 WIP 的共享注册表**：`server-methods-list.ts`、`method-scopes.ts`（各 +2 行 planner 方法；
  **提交时不可整文件提交**，仅拣本任务行或由 owner 协调）。

## Tasks

- [x] 1. 调研依赖（data-capability / seat-context / projection-spec / 授权模型 / 执行桥 / seeds）——结论见 design.md。 — kiro-data-planner

- [x] 2. 创建本 spec（requirements + design + tasks），签到 `## Agents`。 — kiro-data-planner

- [x] 3. 授权单一真源 `capability-grant-resolver.ts`
  - 导出 `CapabilityGrantContext` + `isCapabilityGrantedForSeat({store,context,capability})`。
  - 重构 `capability-agent-invoke-runtime.ts`：删私有拷贝，import 之（调用点签名不变；7 个既有测试仍全绿）。
  - _Requirements: R2, R7.3_ — kiro-data-planner

- [x] 4. 类型定义 `agent-data-plan-types.ts`
  - `DataPlan`/`DataPlanStep`/`DataPlanFieldSelection`/`DataPlanSummary`/`AgentContextPack`/
    `PlannerSeatContext`/`DataPlanRequest` + 枚举。type-only import 语义/能力/投影/分类类型。
  - _Requirements: R1, R3, R4, R5_ — kiro-data-planner

- [x] 5. 规划核心 + Broker `agent-data-planner.ts`
  - `planDataAccess`（相关性 → 能力绑定 → 授权 → 字段 → summary）。
  - `buildAgentContextPack`（identity + dataPlan + authorizedCapabilities + knowledgeProjections）。
  - `executeDataPlan`（仅 granted 步委派 `invokeDataCapabilityWithContext`）。
  - agent 包装 `planDataAccessForAgent` / `buildAgentContextPackForAgent`（解析会话，只读不落盘）。
  - _Requirements: R1, R2, R3, R4, R5_ — kiro-data-planner

- [x]\* 6. 单测 `agent-data-planner.test.ts`（8 tests）
  - granted/requestable/ungranted/unbindable、task 匹配、objectKeys/objectKinds/maxObjects 过滤、
    classificationCeiling、contextPack、executeDataPlan 委派。
  - _Requirements: R1, R2, R3, R4, R5_ — kiro-data-planner

- [x] 7. 只读 RPC `enterprise-data-planner.ts` + 注册
  - `createEnterpriseDataPlannerHandlers(deps?)`：`enterprise-data.planner.plan` / `.context`。
  - 主路由 `enterprise-data.ts` 展开；`server-methods-list.ts` + `method-scopes.ts` READ_SCOPE 各 +2。
  - 服务端解析本人席位（注入式 resolveContext）。
  - _Requirements: R6, R7.2_ — kiro-data-planner

- [x]\* 7b. handler 测试 `enterprise-data-planner.test.ts`（4 tests：plan / objectKeys 过滤 / contextPack / 无席位拒绝；注入 stores/resolveContext）。
  - _Requirements: R6_ — kiro-data-planner

- [x] 8. 验证：`pnpm tsgo` 改动文件零错误（总 35→34，剩 34 为他人 WIP）+ 19 个 scoped 测试全绿 + oxfmt/oxlint 全清 + 清理临时文件。 — kiro-data-planner

## Notes

- 文件路径全部仓库根相对（per AGENTS.md）。
- **多 agent 安全**：见上「共享文件说明」。`server-methods-list.ts`/`method-scopes.ts` 含他人 WIP，
  提交时按 landing-group 规则处理；`capability-agent-invoke-runtime.ts` CLEAN 可安全重构。
- 标 `*` 为测试任务。
