# Implementation Plan: diagnosis-evolution-decision-surfaces

## Agents

- kiro-decision-surfaces · role: owner · scope: diagnosis-evolution-decision-surfaces · paths: `.kiro/specs/diagnosis-evolution-decision-surfaces/**`, `packages/evolution-core/src/decision-surface/**`, `packages/evolution-core/src/index.ts`, `packages/evolution-core/README.md`, `ui/src/ui/ports/employee/evolution-decision/**`, `ui/src/ui/ports/employee/views/employee-evolution-decision-section.ts`, `ui/src/ui/ports/employee/views/employee-evolution-decision-section.node.test.ts`, `ui/src/ui/ports/employee/views/workbench-stage-module.ts`, `ui/src/styles/workbench.css`, `ui/src/ui/ports/enterprise/evolution-decision/**`, `ui/src/ui/ports/enterprise/views/enterprise-evolution-decision-surface.ts`, `ui/src/ui/ports/enterprise/views/enterprise-evolution-decision-surface.node.test.ts`, `ui/src/ui/evolution-decision-contract.ts`, `ui/src/ui/ports/enterprise/views/enterprise-surfaces-core.ts`, `ui/src/ui/ports/enterprise/views/enterprise-evolution-decision-mount.node.test.ts` · since: 2026-09-28

## 接管记录

`## Agents` 由 `pnpm loom derive` 从 `.loom/registry.yaml` 生成，registry 是唯一来源。

- Loom task：`diagnosis-evolution-decision-surfaces:c6d3191e-e009-4e42-9d8f-9aeba33559aa`（沿用原任务，不另建并行任务）
- 2026-09-28：`kiro-decision-surfaces` 按 verify-then-take 接管（`ownerHistory` via `verified`）。新 session `3cb98a8e-d480-4a9c-aa42-eb2ab14b8e34` · ide: kiro · agent: `kiro-decision-surfaces`
- 前任 owner：`c6d3191e-e009-4e42-9d8f-9aeba33559aa`。sessions `8745244a-50da-47ae-9448-412ab2b87cbe`（D0/D1，ide: cursor）与 `48c025c4-1ad6-4d93-b0a8-2251b5531e6b`（D2，ide: cursor）保留在 registry `sessions[]`
- 2026-09-29 verified path takeover: `enterprise-surfaces-core.ts` from `ops-decommission:kiro-enterprise-tsgo` to `diagnosis-evolution-decision-surfaces`（单文件，人工批准）。接管前核对：两个 GitHub 仓库都没有涉及该文件的开放 PR；关联 worktree 与同级 clone 中没有该文件的分歧副本；远端分支没有未合入的该文件改动；`origin/main` 是唯一事实源。旧任务其余 15 条路径、全部 sessions 与 `ownerHistory` 不变；不登记 sharedPaths。`.kiro/specs/enterprise-ui-baseline/tasks.md` 的旧 `## Agents` 行仍列出该文件，只影响 legacy 视图

接管后每个提交 trailers：

```
Task: diagnosis-evolution-decision-surfaces
Agent: kiro-decision-surfaces
```

路径说明：`packages/evolution-core/**` 已由任务 `openbot-evolution-unification:cursor-evolution` 声明，并在 `.loom/registry.yaml` 的 sharedPaths 中以该任务为 lander。本任务只新增 `decision-surface/`，对 `index.ts` 与 `README.md` 只做追加导出和合同说明，不改现有状态机、Surface 目录或实验接受门。

`ui/src/styles/workbench.css` 另有六个任务声明且不在 sharedPaths，工作区里只要它有改动，`agent-attribution --fail-on-conflict` 就报 CONFLICT。是否登记 sharedPaths 与 lander 由人决定。

## Phase D0 — 现状盘点

- [x] **D0.1** 干净工作区、`origin/main` 祖先检查、规格目录 — c6d3191e-e009-4e42-9d8f-9aeba33559aa
- [x] **D0.2** `current-state-inventory.md` — c6d3191e-e009-4e42-9d8f-9aeba33559aa
- [x] **D0.3** `surface-routing-matrix.md` 与 `authority-matrix.md` — c6d3191e-e009-4e42-9d8f-9aeba33559aa
- [x] **D0.4** 确认 `system.engineering-remediation` 未注册且本轮不注册 — c6d3191e-e009-4e42-9d8f-9aeba33559aa
- [x] **D0.5** 不修改业务 UI 与 Gateway 写路径 — c6d3191e-e009-4e42-9d8f-9aeba33559aa

## Phase D1 — 合同冻结

- [x] **D1.1** Decision DTO 与客户端禁字段 — c6d3191e-e009-4e42-9d8f-9aeba33559aa
- [x] **D1.2** Surface Router — c6d3191e-e009-4e42-9d8f-9aeba33559aa
- [x] **D1.3** Authority Resolver — c6d3191e-e009-4e42-9d8f-9aeba33559aa
- [x] **D1.4** Visibility / Audience Projection — c6d3191e-e009-4e42-9d8f-9aeba33559aa
- [x] **D1.5** Command → 现有控制面动作映射 — c6d3191e-e009-4e42-9d8f-9aeba33559aa
- [x] **D1.6** 幂等与过期判定，零写入测试 — c6d3191e-e009-4e42-9d8f-9aeba33559aa
- [x] **D1.7** 不接 UI，不接 Gateway 写路径，不打开 E5.2 — c6d3191e-e009-4e42-9d8f-9aeba33559aa
- [x] **D1.8** 专家复审修订：回放绑定、路由与角色标志、员工最终授权所有者、authorize / approve_application 失败关闭、端点动作矩阵、员工参与视图脱敏、expectedVersion — c6d3191e-e009-4e42-9d8f-9aeba33559aa

## Phase D2 — 员工 Decision Surface（PR #189）

- [x] **D2** 员工 Decision Surface 垂直切片 — c6d3191e-e009-4e42-9d8f-9aeba33559aa 初版，kiro-decision-surfaces 按 D2.1 收口。2026-09-28 验收签收：D2 code-present: Go；runtime-enabled: No-Go；production-proven: No-Go；D3 / D4: Frozen；E5.2: Closed。运行门保持关闭

### D2.1 — 接管与收口（kiro-decision-surfaces）

- [x] **D2.1.1** verify-then-take：读规格、PR #189 全部 diff 与验收阻断评论；Loom 转移 owner 并登记新 session；重绑最新 `origin/main` — kiro-decision-surfaces
- [x] **D2.1.2** 运行门：`EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED = false`，客户端不可翻转；设置页不挂载 Decision Surface，不显示占位与开发徽标；Perception 不变 — kiro-decision-surfaces
- [x] **D2.1.3** 周度变化：`current` / `prior` 双快照，各自经同一套 D1 router 与 visibility；缺 prior 为 `history-unavailable`；不建历史库 — kiro-decision-surfaces
- [x] **D2.1.4** 员工文案：action、reason、decisionType、requiredAuthority、target 均为中文业务标签；内部合同字段只留在类型、`data-*`、日志与测试 — kiro-decision-surfaces
- [x] **D2.1.5** 权限与动作分离：删除 `requiredPermissions`；`requiredAuthority` 显示为「需要谁处理」，`allowedActions` 显示为「可执行动作」 — kiro-decision-surfaces
- [x] **D2.1.6** 回归测试与门禁：evolution-core 测试与 typecheck、两份 D2 UI 测试、focused oxfmt、`git diff --check`、Loom check、agent attribution — kiro-decision-surfaces

### D2.2 — 员工视图省略 id（2026-09-29 登记）

- [ ] **D2.2** 员工视图不再返回被省略事项的 decisionId 或计数（`omitted`），与企业端一致。员工端运行门打开之前必须完成，不阻断 D3

## Phase D3 — 企业 Decision Surface（code-present，运行门关闭）

同一执行团队继续：owner `kiro-decision-surfaces`，session `3cb98a8e-d480-4a9c-aa42-eb2ab14b8e34`。分支 `kiro-decision-surfaces/diagnosis-evolution-decision-surfaces-d3`，PR #206。

2026-09-29 验收：D3.0 Go；D3.1–D3.2 Conditional Go（participation 修复后复验）；D3.3 mount Frozen；runtime-enabled / production-proven No-Go；D4 Frozen；E5.2 Closed。

2026-09-29 复验：D3.1–D3.2 Go，D3.3 独立组件开始。D3.3 mount 与 D3.4 联合验收未完成，PR #206 保持 Draft。

2026-09-29：PR #206 在 D3.3 验收前合入 main（`0d6743163`）；D3.3 独立组件验收 Go。main UI 生产构建 No-Go（#189 起 `pnpm ui:build` 失败），由 UI Build Repair（#214）修复；D3.3 mount、D3.4 Frozen；修复合入前禁止生产构建与部署。

2026-09-29：UI Build Repair（#214）验收通过并合入（`939701f0f`），main UI build Go；尚未进行生产镜像构建、发布或部署。D3.3 mount 解冻，由当前 owner 在关闭的运行门下做最小挂载，尚未完成。D3.4.1 修复 #216 已合入 main（`59dd5b13a`），待验收。Vitest Browser 缺 `node:crypto` alias 的修复见 #218。

2026-09-29 验收：#216 通过，D3.4.1 Go / Landed。#218 Go for landing，已 squash 合入（`fc7840404`）；`ui/vitest.config.ts` 这次由本任务紧急修复，之后转交 UI 测试基础设施 owner（后续独立任务 `ui-browser-test-infrastructure`）。D3.3 path takeover Approved，mount 在 #218 后解冻，新开 Mount PR（#220），不复用 #206。D3.4 联合验收在挂载与浏览器门禁完成前 Frozen。runtime-enabled / production-proven No-Go；D4 Frozen；E5.2 Closed；生产构建与部署未授权。顺序：#218 → 单文件接管 → D3.3 最小挂载 → evolution-lineage 浏览器安全导入 → `node:buffer` 浏览器测试基础设施 → D3.4 联合验收。

2026-09-29 验收：#220 Go / Landed（`bb72d0340`）。企业 Decision Surface 仍只有 code-present 挂载：运行门关闭，没有身份、数据源、提交上下文或 Gateway 接线。规格立即做 Truth Sync，不等 D3.4。B 与 `ui/vitest.config.ts` 归新任务 `ui-browser-test-infrastructure:kiro-ui-browser-infra`；A 授权该任务在途检查后单文件正式接管 `evolution-lineage.ts` 再修复。当前等级：D3.3 component Go；D3.3 mount Go；D3.4 In Progress；runtime-enabled / production-proven No-Go；D4 Frozen；E5.2 Closed；生产构建、发布、部署未授权。顺序：Truth Sync → 建立 `ui-browser-test-infrastructure` → 修复 evolution-lineage 浏览器导入 → 修复 `node:buffer` 浏览器测试 → 全量浏览器测试 → D3.4 联合验收 → D3 主项签收。

2026-09-30 验收：#224（前置 A，`125027049`）与 #226（前置 B，`52ca9c7a0`）Go / Landed。两个 lineage 浏览器测试授权 `ui-browser-test-infrastructure:kiro-ui-browser-infra` 做只含测试文件的单文件正式接管，改用 `setGovernanceApiClient` 注入，修复见 #228（待验收）。当前等级：D3.4 In Progress，签收 No-Go，直到 lineage 7 项修复合入并完成最终冷、热联合验收；runtime-enabled / production-proven No-Go；D4 Frozen；E5.2 Closed；生产构建、发布、部署未授权。

2026-09-30 D3.4 最终收敛：#228 重绑 main `f6a2e255a` 后 squash 合入（`e82c99d11`）。U6 在 main `e82c99d11` 上完成，全部标准满足：冷、热两轮依赖扫描失败、中途刷新、导入失败都是 0；lineage 7 项与企业端 14 个浏览器测试文件都全部通过；与同时段合入前基线相比，没有新增稳定失败。剩余 21 个稳定失败登记为基线问题；其中 `navigation` 的两个企业 Mesh 路由用例登记为独立缺陷 D3.R1：不阻挡 D3.4 code-present，阻挡 runtime-enabled 与 production-proven。等级：D3.4 code-present Go（以 #221 专家签收为准）；运行门 false；runtime-enabled / production-proven No-Go；D4 Frozen；E5.2 Closed；生产构建、发布、部署未授权。

2026-09-30 D3.4 最终专家签收（#221 验收评论，基于 main `e82c99d11` 与 PR head `438b4dc11`）：D3.4 code-present Go / 已签收；D3 企业 Decision Surface code-present 父项 Go / 已签收。runtime-enabled No-Go；production-proven No-Go；D3.R1 的两个企业 Mesh navigation 失败不阻挡 code-present，但仍是 runtime-enabled 与 production-proven 的硬性阻挡，提议打开运行门之前必须修复通过。D4 Frozen；E5.2 Closed；运行门 false；生产构建、发布、部署未授权。D3.R1 另建任务 `enterprise-mesh-navigation-repair` 修复；U6 记录另开 `ui-browser-test-infrastructure` 的规格 PR。

- [x] **D3** 企业 Decision Surface — code-present 已签收（2026-09-30 专家签收；runtime-enabled / production-proven 仍为 No-Go） — kiro-decision-surfaces

- [x] **D3.0** 现状盘点 `enterprise-surface-inventory.md`：企业治理页面、企业管理员身份、读入口、Delegation / Grant、Canary 参与、员工最终授权阻断点、可见性与脱敏现状、不接 runtime 范围、拟挂载位置；Loom 签入 — kiro-decision-surfaces
- [x] **D3.1** 企业纯投影合同：`enterprise-surface.ts`，current / prior 双快照经同一套 D1 router 与 visibility（与员工端共用 `snapshot.ts`），动作可用性由 D1 judge 判定 — kiro-decision-surfaces
- [x] **D3.2** 租户 / 委托 / Canary / 员工个人资产脱敏矩阵：D1 visibility 增加企业参与视图，`participation_required`，客户端禁字段与回放路由绑定；被省略事项不进入企业视图；合同 `enterprise-surface-contract.md` — kiro-decision-surfaces
  - [x] **D3.2.1** 验收修复：参与只确认一次。已确认的企业 Canary 与已记录的员工最终授权，新 `commandId` 为 `participation_already_satisfied`（零写入），原 `commandId` 回放不变；企业行与员工行都不再提供已完成的参与动作（2026-09-29 复验通过） — kiro-decision-surfaces
- [x] **D3.3** 独立企业组件、copy / display、关闭的运行门 `EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED = false` 与 standalone tests；不编辑 `enterprise-surfaces-core.ts`，组件只在测试中独立导入（2026-09-29 Go / Landed，#206；挂载见 D3.3 mount） — kiro-decision-surfaces
  - [x] **D3.3.1** 企业 UI types / client / runtime gate：注入式只读 history source、服务端解析的 submit context、command id 注入；gate 只返回核心常量 — kiro-decision-surfaces
  - [x] **D3.3.2** 中文 copy / display 与脱敏展示：状态、周度分类、动作、事项类型、需要谁处理、对象、依据状态、原因码，未知值统一中文降级 — kiro-decision-surfaces
  - [x] **D3.3.3** 独立组件 `<enterprise-evolution-decision-surface>` 与组件本地样式：缺主体、快照源或企业身份时不渲染；只渲染 `row.allowedActions`；提交只经 D1 judge — kiro-decision-surfaces
  - [x] **D3.3.4** 未挂载与无旁路源码扫描、内部字段不可见检查、规格收口 — kiro-decision-surfaces
- [x] **UI Build Repair**（#214）：D2 / D3 运行时导入改经 `ui/src/ui/evolution-decision-contract.ts`（只重导出 decision-surface 入口），`pnpm ui:build` 恢复；源码合同测试禁止已挂载的 D2 代码与 D3 候选挂载代码运行时导入 `@openbot/evolution-core` 根入口（2026-09-29 验收通过，已合入） — kiro-decision-surfaces
- [x] **Vitest Browser node:crypto alias**（#218）：`ui/vitest.config.ts` 补上与 `ui/vite.config.ts` 相同的 `node:crypto` → `ui/src/shims/node-crypto.ts` alias，此前导入即失败的 11 个浏览器测试文件恢复加载，热缓存全量对比无回归（2026-09-29 Go / Landed，`fc7840404`；2026-09-30 该文件已转交 `ui-browser-test-infrastructure:kiro-ui-browser-infra`（#224），不登记 sharedPaths）。当时未修（非本任务文件，后续见 D3.4.2–D3.4.5）：`evolution-lineage.ts` 运行时导入 `@openbot/evolution-core` 根入口，`actions-page`、`evolution-lineage-panel` 两个浏览器测试仍无法导入，且使 Vite 依赖扫描失败、冷缓存首跑中途刷新并随机打断其他文件的导入，owner `openbot-evolution-unification:cursor-evolution`；恢复加载后暴露的 11 个既有失败归各文件 owner — kiro-decision-surfaces
- [x] **D3.3 mount** 企业运行页面的 gated mount。2026-09-29 verified path takeover 后由 D3 owner 落地（见接管记录）：`enterprise-surfaces-core.ts` 的 `case "enterpriseMesh"` 在 Mesh 模板之后按 `enterpriseEvolutionDecisionSurfaceMountEnabled()` 追加裸元素 `<enterprise-evolution-decision-surface>`，不接 principal、快照源、提交上下文、command id 或 client；门关闭时原样返回 Mesh 模板，生产包中门控分支被裁掉。不登记 sharedPaths（#220，2026-09-29 Go / Landed，`bb72d0340`） — kiro-decision-surfaces
- [x] **D3.4** 回归测试与签收：code-present Go，U6 全部标准满足（2026-09-30），最终签收以 #221 专家验收为准 — kiro-decision-surfaces
  - [x] **D3.4.1** 企业组件测试的 Lit change-in-update 开发模式警告（https://lit.dev/msg/change-in-update）：`updated()` 在 `principal` / `historySource` 变化后同步调用 `refresh()`，未接线分支同步写 `view`、`loading`、`lastReceipt`，在「clears itself when the principal loses enterprise identity」中触发。不阻断 UI Build Repair（2026-09-29 登记）。修复：`refresh()` 改由 `willUpdate()` 触发，首次连接只读取一次快照源（#216，2026-09-29 Go / Landed，`59dd5b13a`） — kiro-decision-surfaces
  - [x] **D3.4.2** 浏览器前置 A：`ui/src/ui/capability/ai-workforce-governance/evolution-lineage.ts` 的运行时值改从浏览器安全来源导入，优先 `packages/evolution-core/src/capsule-eligibility.ts`，不加根 barrel alias。2026-09-29 决定：原 owner `openbot-evolution-unification:cursor-evolution` 长期无信号，授权 `ui-browser-test-infrastructure:kiro-ui-browser-infra` 在途检查后单文件正式接管并修复；原任务其他路径、sessions 与历史不变；不登记 sharedPaths；不给 Vite / Vitest 配置根 barrel alias。完成：改从 `capsule-eligibility.ts` 导入，并加浏览器运行时导入守卫测试（#224，2026-09-30 Go / Landed，`125027049`） — kiro-ui-browser-infra
  - [x] **D3.4.3** 浏览器前置 B：企业页面浏览器测试用 `node:buffer` 取 `File` 的问题，归 `ui-browser-test-infrastructure:kiro-ui-browser-infra`。只在浏览器测试中使用时改用浏览器原生 `File`、`Blob` 或 `Uint8Array`，不为一个测试给浏览器运行时加 Buffer polyfill；不得为通过测试而跳过企业 Surface 测试。完成：该测试文件单文件接管后改用浏览器原生 `File`，没有 polyfill，84 / 84 通过（#226，2026-09-30 Go / Landed，`52ca9c7a0`） — kiro-ui-browser-infra
  - [x] **D3.4.4** A、B 合入后的全量浏览器测试：main `52ca9c7a0` 上冷、热各一次，依赖扫描失败、中途刷新、导入失败都是 0；681 个用例，冷 651 通过 / 29 失败，热 652 通过 / 28 失败；企业端 14 个浏览器测试文件全部通过；两个 lineage 文件的 7 个失败见 D3.4.5（`ui-browser-test-infrastructure` U4） — kiro-ui-browser-infra
  - [x] **D3.4.5** 两个 lineage 浏览器测试（`actions-page` 3、`evolution-lineage-panel` 4）：`vi.mock` 在 chromium 中不生效，组件用的是真实服务。2026-09-30 决定：授权 `ui-browser-test-infrastructure:kiro-ui-browser-infra` 做只含测试文件的单文件正式接管，改用现有 `setGovernanceApiClient` 注入，每个测试后恢复原 client；不改生产组件、`governanceApi.ts`、Gateway、Adapter 或运行门，不跳过、不降级。完成：#228 重绑 main 后 squash 合入（2026-09-30，`e82c99d11`）；每个测试结束后 client 恢复为 `null`，未声明的 Gateway 方法仍判失败；7 / 7 在 chromium 中通过，U6 冷、热也都通过 — kiro-ui-browser-infra
  - [x] **D3.4.6** 最终冷、热联合验收（`ui-browser-test-infrastructure` U6）：main `e82c99d11`（含 #228）上用独立的优化缓存各跑一次全量浏览器测试。冷、热两轮：依赖扫描失败、中途刷新、导入失败都是 0；681 个用例，都是 659 通过 / 21 失败 / 1 跳过，失败集合相同；lineage 7 项都通过；企业端 14 个浏览器测试文件都全部通过。同时段合入前基线（同一 main，两个测试文件换回 #228 之前的版本，另一个独立缓存）：冷 652 通过 / 28 失败，热 650 通过 / 30 失败（多出的 2 个是 `platform/pricing/page` 的顺序相关断言）。基线稳定通过、U6 稳定失败的用例 0 个；#228 新增稳定失败 0 个，修掉 7 个；U6 的 21 个稳定失败在基线中同样稳定失败。Decision Surface 的 node 测试（含 Mesh 挂载测试与浏览器运行时导入守卫）103 个全部通过 — kiro-ui-browser-infra
- [x] **D3.R1** 独立缺陷（2026-09-30 登记，运行门前置）：`ui/src/ui/navigation.browser.test.ts` 的两个企业 Mesh 路由用例失败：「navigates within the enterprise shell using tenant-bound left nav routes」与「preserves enterprise mesh deep-links when opening object routes directly」，都报 `expected … to match /机巢|AI Mesh/`。#218 恢复该文件加载后首次暴露；#220 挂载前后同时段结果相同；U6 与合入前基线中失败信息相同。分类：不阻挡 D3.4 code-present；阻挡企业路径的 runtime-enabled 与 production-proven，提议打开运行门时不得豁免。该测试文件在 registry 中属于 `builder-decommission:cursor-builder`（owner `codex-platform-manifest-compat`，最后信号 2026-07-23），修复不在本任务范围，由谁修待人决定
  - 2026-10-01 关闭：按 #221 签收评论中的方案由独立任务 `enterprise-mesh-navigation-repair:kiro-mesh-navigation` 单文件接管该测试文件后修复，#245 验收后 squash 合入（`9b87c82f3`）。两条断言过期，路由与渲染都正确，只改测试文件：两个用例改为断言 Mesh 模块页眉等于当前 locale 的 `tabs.enterpriseMesh`，深链用例另外断言只读详情在 `governance-assets-page` 的 shadow root 中打开。合入后在 main `9b87c82f3` 上冷、热各跑一次，两个 Mesh 用例都通过（该文件 2 失败 / 47 通过；另外 2 个失败不属于 D3.R1，另开任务处理）。D3.R1 不再阻挡运行门提议；运行门仍关闭，runtime-enabled 与 production-proven 仍为 No-Go，打开需单独提议 — kiro-decision-surfaces

基线问题（2026-09-30 登记，不阻挡 D3.4 code-present）：U6 与合入前基线中都稳定失败的 21 个浏览器测试用例，都不在 Decision Surface 文件中。`navigation` 4（含 D3.R1 的 2 个）、`port-shells` 4、`pricing-v3-layout` 6，以及 `platform-sidebar-routing`、`chat-image-open`、`brand-assets`、`public-home`、`auth-home`、`employee-model-access-section`、`knowledge-universe-local-folder` 各 1。

## 以后阶段（本任务不实现）

- [ ] **D4** 平台 Decision Surface 与 Engineering Remediation Surface UI（冻结）
- [ ] **E5.2** 不在本任务打开（关闭）
