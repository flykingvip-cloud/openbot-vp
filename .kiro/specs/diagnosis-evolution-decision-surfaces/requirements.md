# diagnosis-evolution-decision-surfaces

## 身份

- 任务：`diagnosis-evolution-decision-surfaces`
- 仓库：`https://github.com/upbeyond/openbot.git`
- 基线：`main`。Phase D0 / D1 已合入（#169），Phase D2 员工 Decision Surface 已合入（#189）。Phase D3 企业 Decision Surface 在分支 `kiro-decision-surfaces/diagnosis-evolution-decision-surfaces-d3`，见文末。
- 当前执行者：`kiro-decision-surfaces`（2026-09-28 verify-then-take 接管）
- 前任执行者：`c6d3191e-e009-4e42-9d8f-9aeba33559aa`（D0 / D1 / D2 初版）
- Loom 任务：`diagnosis-evolution-decision-surfaces:c6d3191e-e009-4e42-9d8f-9aeba33559aa`
- Loom session：`3cb98a8e-d480-4a9c-aa42-eb2ab14b8e34`（ide: kiro）。前任 sessions `8745244a-50da-47ae-9448-412ab2b87cbe`、`48c025c4-1ad6-4d93-b0a8-2251b5531e6b`（ide: cursor）保留

## 问题

员工端已有只读进化履历。企业端已有 Mesh 治理，没有进化待决中心。平台端已有进化谱系、Kill Switch 和人工 Hold/Resume，没有与员工履历闭环的 Decision Surface。

Decision Surface 是待决查询、命令提交和回执读取。它不是第二套 Proposal、Ledger 或状态机，也不直接调用 Adapter。

## 本轮必须完成

### Phase D0

只读盘点，写入本目录：

- `requirements.md`
- `current-state-inventory.md`
- `surface-routing-matrix.md`
- `authority-matrix.md`
- `tasks.md`

D0 不改业务 UI，不改 Gateway 写路径，不注册新的 Evolution Surface。

### Phase D1

在 `packages/evolution-core` 冻结纯类型和纯函数：

- Decision DTO（`EvolutionDecisionItem` / `EvolutionDecisionCommand` / `EvolutionDecisionReceipt`）
- Surface Router
- Authority Resolver
- Visibility / Audience Projection
- Command → 现有控制面动作映射
- 幂等与过期判定
- 零写入单元测试

D1 不接 UI，不接 Gateway 写路径，不执行控制面方法。

## 已冻结的合同要点

1. 客户端命令只允许 `commandId`、`decisionId`、`action`、`expectedVersion`。
2. 客户端不得提交可信身份或证据：`tenantId`、`principalRef`、`role`、`ownerId`、`approval`、`grant`、Adapter 参数、自述 Evidence。
3. 路由、主体、Grant、租户均由服务端已解析事实进入纯函数。纯函数不读取会话，也不写存储。
4. `status` 是对现有 Proposal 状态、过期时间和授权阻塞的投影，不是新的持久状态。
5. 命令映射只指向现有控制面方法名与已注册 Gateway 方法名。`callsAdapter` 恒为 false。
6. 回执的 `accepted` 在 D1 只表示“可交给现有控制面”。`executed` 恒为 false，`effectProof` 恒为 false。回执不是效果证明。
7. 同一 `commandId` 重复且决策、动作、期望版本一致时，还须核对已存记录上的租户、决策版本、目标、surface、所需权威和主体绑定。全部一致才返回 `idempotent_replay`，过期后也可以回放，且不产生第二次写入计划。绑定不一致为 `replay_binding_mismatch`。同一 `commandId` 改绑决策、动作或期望版本时拒绝，代码 `command_rebind`。改变状态的命令必须带非空 `expectedVersion`；只有 `participate_canary` 与 `employee_final_authorization` 可以省略版本。
8. `system.engineering-remediation` 在现有注册表中不存在。D1 只保留该标识为未注册保留名，路由失败关闭，不把它插入 `listEvolutionSurfaces()`。

## 明确不做

- D0 / D1 不实现 Decision Surface UI。员工端 D2 与企业端 D3 见文末（code-present，运行门关闭）；平台端 D4 冻结。
- 不新建 Decision 数据库，不复制 Proposal / Ledger，不新增平行状态机。
- 不修改 `employee-evolution-perception-section`，不把 Perception RPC 改成写面。
- 不从 Decision Surface 代码调用 Adapter。
- 不把大白聊天文本当成正式批准。
- 不让平台管理员绕过企业 Canary 参与或员工最终授权。
- 不让企业管理员成为系统 / 核心代码的审批者。
- 不打开 E5.2，不扩大自动 Apply，不做生产部署。
- 不宣布 Diagnosis Platform 或 Evolution Platform 完成。

## 完成等级

| 阶段      | 本轮目标等级               | 禁止宣称                           |
| --------- | -------------------------- | ---------------------------------- |
| D0 规格   | code-present（文档已入库） | runtime-enabled、production-proven |
| D1 纯函数 | code-present               | runtime-enabled、production-proven |

Gateway、UI 和线上行为在本轮保持不变。

## Phase D2 / D2.1 — 员工 Decision Surface（PR #189）

D2 初版于 2026-09-28 验收为 Changes Required / Landing No-Go。D2.1 按下列合同收口。

### 运行门

- `EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED = false`，位于 `packages/evolution-core/src/decision-surface/employee-surface.ts`。UI 只通过 `ui/src/ui/ports/employee/evolution-decision/runtime-gate.ts` 读取它。该函数没有参数，不读 URL、query、浏览器存储、表单或客户端声明。
- 运行门关闭时，设置页「进化」只挂载 Perception，不挂载 Decision Surface，不显示占位区块或开发徽标。
- 组件在宿主注入服务端主体和快照源之前不渲染任何内容。测试注入数据时可以独立渲染。
- 打开运行门需要评审过的代码改动、服务端解析的主体，以及服务端先做 D1 visibility 再下发的 Timeline/Ledger 只读快照。本轮不做。

### 周度变化

- 输入是两份只读快照：`EvolutionEmployeeDecisionHistory = { current, prior }`，快照为 `{ asOf, facts }`，`prior` 可以为 `null`。
- current 与 prior 各自经过同一套 D1 router 与 visibility，用同一主体重新做租户、所有权和机密过滤。同一快照内重复的 decisionId 被省略（`duplicate_decision_id`）。
- 摘要比较两份快照里每个事项的状态，给出各状态计数、差值和逐项变化。同一事项从上周「待我确认」变为本周「系统已完成」时，待确认减少、已完成增加，总数可以不变。
- 下列情况结果为 `history-unavailable`，员工文案为「暂无足够历史数据，不能形成周度对比。」，不输出任何计数：prior 缺失、`asOf` 无法解析、prior 不早于 current、两者间隔不在 7 天 ± 1 天、快照读取失败。
- 快照只能来自现有 Timeline/Ledger 的只读投影。不建立历史数据库。

### 员工可见文案

- action、reason / code、decisionType、requiredAuthority、target / surface 只通过 `evolution-decision/copy.ts` 的中文映射显示。未知值显示通用中文，不回显原值。
- claim grade、runtime / production / E5.2 标记、`executed`、`effectProof`、`decision-plan`、`auditReceiptRef`、原始代码和英文 surfaceId / decisionType 只留在类型、`data-*`、日志与测试。
- 受理回执只表达「请求已通过规则校验，但尚未执行。」，不表达已应用或已完成。

### 权限与动作

- 删除 `requiredPermissions`。`requiredAuthority` 显示为「需要谁处理」，`allowedActions` 显示为「可执行动作」。
- `allowedActions` 只在 pending 事项上开放，与 D1 judge 一致：员工参与视图上只开放 `employee_final_authorization`，hold / reject 由企业管理员处理（`wrong_endpoint`）。
- 本人最终授权记录后不再开放（`participation_already_satisfied`，D3.2 验收修复）。为此员工事实增加服务端的 `authorityFacts`。
- 员工参与视图的行不从企业事项派生证据计数、案例或控制面 id，证据状态为 `withheld`。

### 保持不变

- D1 合同：`writes = []`、`executed = false`、`effectProof = false`；版本与路由绑定失败零写入；同一 `commandId` 回放幂等，改绑失败关闭。
- 不新增 Gateway mutation，不接 Adapter，Perception 只读，不打开 E5.2，不改 autoApply，不注册 `system.engineering-remediation`，不做 D3 / D4。

### 完成等级（D2 验收时，2026-09-28）

| 项                | 等级   |
| ----------------- | ------ |
| D2 code-present   | Go     |
| runtime-enabled   | No-Go  |
| production-proven | No-Go  |
| D3                | Frozen |
| D4                | Frozen |
| E5.2              | Closed |

### D2.2（2026-09-29 登记，未开始）

员工视图仍返回 `omitted`（被省略事项的 decisionId 与代码），会暴露隐藏事项的存在。员工端运行门打开之前必须改为与企业端一致：视图不留被省略事项的 id 或计数。不阻断 D3。

## Phase D3 — 企业 Decision Surface（code-present，运行门关闭）

现状见 `enterprise-surface-inventory.md`，合同全文见 `enterprise-surface-contract.md`。

### 已冻结的边界（D3.0–D3.2）

- 运行门 `EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED = false`。员工端运行门不变。
- 只服务可信租户的企业管理员。其他主体得到 `denied`，不含任何行与 id。
- 事实全部由服务端解析。快照只来自 Timeline/Ledger 只读投影，不建历史库。
- 动作可用性由 D1 judge 判定。企业端矩阵之外的动作不提供，`employee_final_authorization` 永不提供。
- 三类事项的展示方式：
  - 企业自有事项：证据只显示计数。
  - 员工个人资产事项：只以脱敏参与视图出现，显示「等待本人最终授权」。
  - 平台事项：只以本租户 Canary 参与视图出现，只提供 `participate_canary`。
- 被省略的事项不在企业视图里留下 id 或计数。
- 参与只确认一次：已确认的 Canary 或已记录的员工最终授权，新的 `commandId` 为 `participation_already_satisfied`，零写入；原 `commandId` 回放仍为 `idempotent_replay`。
- 周度不可用文案：「暂无足够历史数据，不能形成企业周度对比。」
- 提交只经 `judgeEvolutionDecisionCommand`，零写入。回放绑定主体与路由。

### 验收（2026-09-29）

- D3.0 Go。D3.1–D3.2 Conditional Go：已确认的企业 Canary 仍可用新 `commandId` 重复参与，要求在 D1 authority / judge 层失败关闭。修复见上一节，待复验。
- 挂载：`enterprise-surfaces-core.ts` 不登记 sharedPaths。D3 团队先做独立组件、关闭的运行门与 standalone tests，不编辑该文件。gated mount 由当前 owner `ops-decommission:kiro-enterprise-tsgo` 落地；若该任务已结束，先完成正式 Loom path takeover。
- 复验通过前，D3.3 只能准备独立文件，不能挂载到企业运行页面。
- 复验（2026-09-29）：D3.1–D3.2 Go，D3.3 独立组件开始。
- 2026-09-29：PR #206 在 D3.3 验收前合入 main；D3.3 独立组件 Go。main 的 UI 生产构建自 #189 起失败（UI 运行时导入 `@openbot/evolution-core` 根入口），由 UI Build Repair（#214）修复。修复合入前禁止生产构建与部署。
- 2026-09-29：UI Build Repair（#214）验收通过并合入，main UI 生产构建 Go。
- 2026-09-29：D3.4.1（#216，`59dd5b13a`）与 Vitest 浏览器配置 `node:crypto` alias（#218，`fc7840404`）Go / Landed。
- 2026-09-29：`enterprise-surfaces-core.ts` 完成单文件正式接管（`ops-decommission:kiro-enterprise-tsgo` → 本任务）；D3.3 mount（#220，`bb72d0340`）Go / Landed。企业 Decision Surface 仍只有 code-present 挂载：运行门关闭，没有身份、数据源、提交上下文或 Gateway 接线。
- 2026-09-30：D3.4 浏览器前置 A（#224，`125027049`）与 B（#226，`52ca9c7a0`）Go / Landed。main 上冷、热全量浏览器测试没有依赖扫描失败、中途刷新或导入失败，企业端 14 个浏览器测试文件全部通过。两个 lineage 浏览器测试的 7 个失败仍阻挡 D3.4 签收，修复见 #228（待验收）。
- 2026-09-30：#228 合入（`e82c99d11`）后，U6 在 main `e82c99d11` 上完成，全部标准满足：冷、热两轮依赖扫描失败、中途刷新、导入失败都是 0；681 个用例，都是 659 通过 / 21 失败，失败集合相同；lineage 7 项与企业端 14 个浏览器测试文件都全部通过；与同时段合入前基线相比，没有基线稳定通过、合入后稳定失败的用例，#228 没有新增稳定失败。剩余 21 个稳定失败登记为基线问题；其中 `navigation` 的两个企业 Mesh 路由用例登记为独立缺陷（tasks.md D3.R1），不阻挡 D3.4 code-present，阻挡 runtime-enabled 与 production-proven。

### D3.3 独立组件与挂载（code-present，运行门关闭）

UI 合同见 `enterprise-surface-contract.md` 第 12、13 节。要点：

- 组件 `<enterprise-evolution-decision-surface>` 由企业 Mesh 页（`enterprise-surfaces-core.ts` 的 `case "enterpriseMesh"`）按运行门挂载。门关闭时原样返回 Mesh 模板，不渲染标签、不读取数据、不显示占位；挂载的是裸元素，不接主体、快照源、提交上下文或 client。其他企业页面与主入口不导入该组件。
- 运行门包装只返回 `EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED`（false）。
- 数据源是注入式只读 `loadHistory()`，本阶段只由测试夹具实现。不新增 Gateway RPC、HTTP 请求、文件读取或历史库。
- 缺主体、快照源或服务端企业身份事实时，组件不渲染任何内容，也不读取快照。
- 只渲染 `row.allowedActions`，按钮为中文业务标签。提交只经 D1 judge，客户端命令只含 `commandId`、`decisionId`、`action`、`expectedVersion`。
- 回执只显示中文句子，零写入字段、命令编号与审计引用只留在 `data-*`。

### 完成等级（当前）

| 项                            | 等级                                                    |
| ----------------------------- | ------------------------------------------------------- |
| D3.0                          | Go                                                      |
| D3.1–D3.2                     | Go                                                      |
| D3.3 独立组件                 | Go / Landed（#206）                                     |
| D3.3 mount                    | Go / Landed（#220，`bb72d0340`）                        |
| `enterprise-surfaces-core.ts` | 已正式单文件接管（2026-09-29）                          |
| 运行门                        | `EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED = false` |
| main UI 生产构建              | Go（#214）                                              |
| D3.4 code-present             | Go（U6 全部标准满足，2026-09-30；以 #221 专家签收为准） |
| runtime-enabled               | No-Go（D3.R1 也阻挡）                                   |
| production-proven             | No-Go（D3.R1 也阻挡）                                   |
| 生产构建、发布、部署          | 未授权                                                  |
| D4                            | Frozen                                                  |
| E5.2                          | Closed                                                  |
