# Implementation Plan

## Overview

> **2026-05-31 重新对账（Reconciliation）**：本计划已与代码库现状对账。结论——**绝大部分客户端实现已落地**（控制器/视图/类型/术语过滤/属性测试，含 Phase 3），真实缺口集中在**一批被客户端调用、但后端从未注册的 gateway 端点**。原计划中"新建 `capability/skills-lifecycle/types.ts` + `EmployeeSkillView`""扩展 `WorkbenchSystemSettingsTab` 增 `skills`"等任务**已被现有等价实现取代，不得再执行**（否则造重复/V2 副本，违反 AGENTS.md）。详见下方「现状基线」与逐任务状态。

## 现状基线（Reconciliation Baseline，全部经代码核对）

### 命名映射（spec 设想 → 代码现状）

| spec 设想                                                               | 代码现状                                                                                                                                                                              | 处置                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `capability/skills-lifecycle/types.ts` 的 `EmployeeSkillView`           | `controllers/skill-models.ts` 的 `EmployeeSkillProfile` / `EmployeeSkillSummary` / `EmployeeSkillDetail`（含 `sanitizeEmployeeSkillProfile` 投影 + `containsSkillRuntimeField` 守卫） | **已落地，复用现有**；勿造 `EmployeeSkillView`           |
| `WorkbenchSystemSettingsTab` 增 `"skills"`（"我的技能"）                | 已有 `"my-accumulation"`（"我的积累"，`workbench-types.ts:54`）+ `my-accumulation.ts` 控制器/视图                                                                                     | **已落地，复用 `my-accumulation`**；勿加 `"skills"` 分叉 |
| `skill-health.*` / `skill-dependency.*` / `skill-review.*` 等独立端点族 | 业务等价端点族 `employee-capability.*` + `robot-skills.*` + `skill-lifecycle.*` + `personal-skills.*` 已注册                                                                          | 主路径已落地；下表「缺口」为客户端引用但**未注册**的端点 |
| `quick-save-skill-modal.ts` / `personal-skill-library.ts` 视图          | `robot-skills-tab.ts` + `my-accumulation.ts` + `quick-capability-save.ts` 已承担同等职责                                                                                              | **已落地，复用现有**；勿新建重复视图                     |

### 已落地清单（经核对存在 + 多数带测试）

- **控制器**：`skill-models.ts`、`skill-lifecycle.ts`、`skill-autofill.ts`、`skill-dependency.ts`、`skill-health.ts`、`skill-health-repair.ts`、`skill-review.ts`、`skill-status.ts`、`skill-recommendations.ts`、`skill-auto-classify.ts`、`skills.ts`、`robot-capability.ts`、`robot-skills.ts`、`pattern-detection.ts`、`quick-capability-save.ts`、`my-accumulation.ts`、`capability-*`（health-label/recommendation/update-recap/usage-brief/maturity）
- **capability 目录**：`skill-lifecycle/`、`skill-autofill/`、`skill-dependency/`、`skill-health/`、`skill-review/`、`skill-recommendations/`、`skill-auto-classify/`、`robot-capability/`、`robot-skills/`、`pattern-detection/`、`employee-capability/`、`enterprise-asset-library/`、`enterprise-incubation/`
- **视图**：`robot-capability-tab.ts`、`robot-skills-tab.ts`、`skill-dependency-panel.ts`、`skill-health-badge.ts`、`my-accumulation.ts`（均带 `.test.ts`）
- **术语黑名单**：`capability/employee-capability/terminology-filter.ts` 的 `scanNode`（视图测试已接入）
- **gateway 端点（已注册，`server-methods-list.ts` + `skill-lifecycle.ts`）**：`skill-lifecycle.extract/save`、`personal-skills.list/detail/edit/share/submit`、`robot-skills.list/toggle/upgrade/remove/install`、`employee-capability.*`（含 `quick-save`/`my-accumulation`/`detail`/`edit`/`delete`/`share-to-group`/`submit-to-enterprise`/`recommendations`/`health-label.subscribe`/`update-recap`/`attribution`/`usage-brief`）

### 真实缺口（客户端控制器已调用，但后端未注册 → 运行时 method-not-found）

> 已确认这些方法**不在** `server-methods-list.ts`，也**不在** `coreGatewayHandlers`。客户端单测用 mock client 通过，但无真实后端。

| 客户端调用（文件）              | 缺失端点                                                                                      | 已存在的可复用后端逻辑                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `skill-dependency.ts`           | `skill-dependency.summary`、`skill-dependency.graph`                                          | `skill-lifecycle-store.ts` 的依赖图数据；`employee-capability.attribution` 有相近聚合 |
| `skill-health.ts`               | `skill-health.sample`、`skill-health.subscribe`                                               | `employee-capability.health-label.subscribe` 已有健康度推送                           |
| `skill-review.ts`               | `skill-review.submit/record/publish/deprecate/retire`                                         | `enterprise-capability.review*` + `personal-skills.submit` 有等价流程                 |
| `skill-recommendations.ts`      | `skill-recommendations.list`                                                                  | `employee-capability.recommendations` 已注册（功能等价，疑似只差客户端改用该端点）    |
| `skill-auto-classify.ts`        | `skill-auto-classify.suggestions`、`skill-auto-classify.accept`                               | 无；需新建或并入 `personal-skills.edit`                                               |
| `skill-autofill.ts`             | `skill-autofill.result`（及 `start`/`subscribe`）                                             | 无；需新建                                                                            |
| `personal-skill-library` 草稿流 | `personal-skills.finalize-draft`、`personal-skills.accept-autofill`、`personal-skills.delete` | `employee-capability.delete` 已注册（可复用/转调）                                    |

---

## Tasks

## Phase 1：MVP（能力可见 + 极简保存 + 资产库 + 双层模型 + 基础健康度）

### 1. 定义共享类型与状态枚举

- [x] **已落地** — `controllers/skill-models.ts` 提供 `SkillStatus`/`SkillHealthStatus`/`EmployeeSkillProfile`/`SkillHealth`/`SkillDependencyGraph` 等 + `containsSkillRuntimeField` 守卫 + `skill-models.test.ts`
- **对账**：勿新建 `capability/skills-lifecycle/types.ts` 或 `EmployeeSkillView`，复用 `skill-models.ts`
- _Requirements: 4.1–4.5, 6.1, 7.1, 7.2_ / _Properties: 1, 10_

### 2. 实现 `SkillProjection` 投影层

- [x] **已落地** — `skill-models.ts` 的 `sanitizeEmployeeSkillProfile` / `sanitizeEmployeeSkillDetail` 即投影，剥离运行层字段；`skill-models.test.ts` 覆盖
- _Requirements: 4.4, 4.5, 5.3, 5.4_ / _Properties: 1_

### 3. 建立术语黑名单扫描器

- [x] **已落地** — `capability/employee-capability/terminology-filter.ts` 的 `scanNode`；视图测试（`robot-capability-tab.test.ts` 等）已接入 `term-blacklist.property.test.ts`
- **对账**：构建期 i18n lint 脚本 `scripts/skill-terminology-lint.ts` 待核实是否存在（见缺口任务 G7）
- _Requirements: 5.3, 5.4, 5.5_ / _Properties: 22, 1_

### 4. 扩展 Workbench 类型并接入路由

- [x] **已落地（以 `my-accumulation` 实现）** — `WorkbenchSystemSettingsTab` 已含 `"my-accumulation"`；`my-accumulation.ts` 视图/控制器已接入
- **对账**：勿再加 `"skills"` tab（会与 `my-accumulation` 分叉）
- _Requirements: 1.1, 3.1, 5.1, 5.2_

### 5. 定义 Gateway API 类型与桩实现（Phase 1 子集）

- [~] **部分落地** — `skill-lifecycle.extract/save`、`personal-skills.list/detail`、`robot-skills.*` 已注册并有 `skill-lifecycle.test.ts`
- [ ] **缺口** — `skill-health.sample/subscribe`、`skill-autofill.result` 客户端已调用但后端未注册（见 G1、G2）
- _Requirements: 1.2, 2.3, 2.4, 3.2, 3.7, 4.8, 4.11, 6.3, 7.3_

### 6. Robot Capability 控制器与能力门面

- [x] **已落地** — `controllers/robot-capability.ts` + `robot-capability.test.ts`；`capability/robot-capability/` 门面
- _Requirements: 1.7–1.9, 4.6–4.10_ / _Properties: 2, 3, 4_

### 7. Robot Capability Tab 视图

- [x] **已落地** — `views/robot-capability-tab.ts` + `robot-capability-tab.test.ts`（含术语扫描、二级菜单、空/错/加载态、版本提示）
- _Requirements: 1.1–1.10_ / _Properties: 1, 2, 3, 4, 22_

### 8. Skill Lifecycle 控制器与极简保存 Modal

- [x] **已落地** — `controllers/skill-lifecycle.ts`（`extractSkillContent`/`saveSkill`/`openSaveModal`）+ `quick-capability-save.ts` + `quick-capability-save.property.test.ts`
- **对账**：极简保存以 `quick-capability-save` 实现，勿新建 `quick-save-skill-modal.ts`
- _Requirements: 2.1–2.6, 2.8, 4.9_ / _Properties: 5, 6, 7_

### 9. Skill Autofill 控制器与任务订阅

- [~] **部分落地** — `controllers/skill-autofill.ts` + `skill-autofill.test.ts` 存在
- [ ] **缺口** — `skill-autofill.result`（及 `start`/`subscribe`）后端未注册（见 G2）
- _Requirements: 6.3, 6.4, 6.5, 6.8_

### 10. Personal Skill Library 控制器（Phase 1 子集）

- [x] **已落地（以 `my-accumulation` 实现）** — `controllers/my-accumulation.ts` + `my-accumulation.property.test.ts`；列表/筛选/详情走 `personal-skills.*` + `employee-capability.*`
- _Requirements: 3.1–3.7_ / _Properties: 10, 11_

### 11. Personal Skill Library 视图（Phase 1 子集）

- [x] **已落地** — `views/my-accumulation.ts` + `my-accumulation.test.ts`（草稿标识、业务层分区、不展示运行层字段）
- _Requirements: 3.1, 3.2, 3.3, 3.7, 3.9, 6.2_ / _Properties: 1, 10, 22_

### 12. Skill Health 控制器与健康徽章

- [~] **部分落地** — `controllers/skill-health.ts` + `skill-health.test.ts`、`views/skill-health-badge.ts` 已落地
- [ ] **缺口** — `skill-health.sample/subscribe` 后端未注册（见 G1）
- _Requirements: 4.11, 7.1–7.7_ / _Properties: 15, 16, 17_

### 13. 测试数据生成器

- [x] **已落地（分散）** — 各 `*.property.test.ts` 自带 arbitrary；如需集中可补 `test/generators/skill-generators.ts`（低优先）
- _Properties: 支撑 1-25_

### 14. Phase 1 Verification

- [ ] **待执行** — 跑 `pnpm check` / `pnpm tsgo` / `pnpm test` + 术语扫描；**在 G1/G2 缺口修复后**做端到端回归（当前健康度/autofill 真实链路不通）

---

## Phase 2：资产沉淀

### 15. Skill Status 控制器与完整状态机

- [x] **已落地** — `controllers/skill-status.ts`（`VALID_TRANSITIONS`/`isValidTransition`/`assertCanSubmitToEnterprise`/`canShareToGroup`）+ `skill-status.test.ts`
- _Requirements: 6.6, 6.7, 10.1, 10.2, 10.10, 10.11_ / _Properties: 9, 18, 19_

### 16. 草稿完成与 Autofill 接受

- [~] **部分落地** — 客户端逻辑在 `skill-autofill.ts` / `my-accumulation.ts`
- [ ] **缺口** — `personal-skills.finalize-draft`、`personal-skills.accept-autofill` 后端未注册（见 G3）
- _Requirements: 6.4–6.8_ / _Properties: 8, 9_

### 17. 版本管理

- [~] **部分落地** — `personal-skills.edit`（创建新版本）、`robot-skills.upgrade` 已注册；客户端 `robot-capability.switchCapabilityVersion` 存在
- [ ] **核实** — 版本历史读取端点是否齐全（`personal-skills.detail` 是否返回 `versions[]`，见 G6）
- _Requirements: 3.9, 9.1–9.5_ / _Properties: 12, 20_

### 18. Skill Dependency 控制器与影响面板

- [~] **部分落地** — `controllers/skill-dependency.ts` + `views/skill-dependency-panel.ts`（+ `.test.ts`）已落地
- [ ] **缺口** — `skill-dependency.summary/graph` 后端未注册（见 G4）
- _Requirements: 3.10, 8.1–8.7, 1.9_ / _Properties: 13, 14_

### 19. 分享到协作小组

- [x] **已落地** — `personal-skills.share` 已注册；客户端 `shareSkillToGroup`
- _Requirements: 10.2, 8.7_

### 20. 企业审核提交与审核记录

- [~] **部分落地** — 客户端 `controllers/skill-review.ts` + `skill-review.test.ts`；`personal-skills.submit` 已注册
- [ ] **缺口** — `skill-review.submit/record` 后端未注册（客户端调的是 `skill-review.*` 而非 `personal-skills.submit`，命名不一致需统一，见 G5）
- _Requirements: 10.3, 10.11_

### 21. 企业侧审核评审（安全 + 质量）

- [~] **部分落地** — 企业侧用 `enterprise-capability.review*`（已注册）；员工侧 `skill-review` 客户端未接后端
- [ ] **缺口** — 统一到 `enterprise-capability.review*` 或新建 `skill-review.*`（见 G5）
- _Requirements: 10.4, 10.5, 10.7_

### 22. 发布与弃用/下线

- [~] **部分落地** — 客户端 `publishSkill/deprecateSkill/retireSkill` 存在
- [ ] **缺口** — `skill-review.publish/deprecate/retire` 后端未注册（见 G5）
- _Requirements: 10.6–10.10_ / _Properties: 18, 19_

### 23. Personal Skill Library 视图 Phase 2 升级

- [x] **已落地** — `my-accumulation.ts` 详情含依赖摘要、分享/提交、草稿标识；术语扫描通过
- _Requirements: 3.10, 8.2, 8.3, 10.7, 10.8_ / _Properties: 13, 18, 22_

### 24. 集成测试

- [ ] **待执行** — 各 `test/integration/*.integration.test.ts` 需在 G1–G5 端点修复后补端到端（当前依赖未注册端点的链路无法真实跑通）

### 25. Phase 2 Verification

- [ ] **待执行** — 缺口修复后回归

---

## Phase 3：智能资产化

### 26. 稳定模式检测

- [x] **已落地** — `controllers/pattern-detection.ts` + `pattern-detection.test.ts` + `pattern-detection.property.test.ts`；`capability/pattern-detection/`
- _Requirements: 11.1–11.3_ / _Properties: 23_

### 27. 智能推荐

- [~] **部分落地** — 客户端 `controllers/skill-recommendations.ts` + 测试；`employee-capability.recommendations` 已注册
- [ ] **缺口** — 客户端调 `skill-recommendations.list`（未注册），应改用已注册的 `employee-capability.recommendations` 或注册别名（见 G5）
- _Requirements: 12.1–12.3_ / _Properties: 21_

### 28. Autofill 标准化增强

- [~] **部分落地** — `skill-autofill.ts` 含 enhancement source 逻辑
- [ ] **缺口** — 依赖 `skill-autofill.*` 后端（见 G2）
- _Requirements: 11.4_

### 29. 健康度修复建议

- [x] **已落地（客户端）** — `controllers/skill-health-repair.ts` + `skill-health-repair.test.ts`
- [ ] **缺口** — 依赖 `skill-health.*` 真实样本链路（见 G1）
- _Requirements: 13.1–13.3_ / _Properties: 24, 25_

### 30. 自动分类与自动标签

- [~] **部分落地** — 客户端 `controllers/skill-auto-classify.ts` + `skill-auto-classify.test.ts`
- [ ] **缺口** — `skill-auto-classify.suggestions/accept` 后端未注册（见 G5）
- _Requirements: 13.4_

### 31. Phase 3 Verification

- [ ] **待执行** — 缺口修复后回归

---

## 真实缺口任务（Gateway 端点接线，本 spec 剩余实际工作）

> 这是重新对账后**真正待做**的工作：把已落地客户端控制器接到真实后端。每项要么新建 handler，要么复用既有等价 handler 并统一客户端调用名。动工前先确认对应客户端控制器调用的方法名。

- [x] G0. **端点接线总体决策**（先做）
  - 已定：依赖图/健康/草稿/审核/自动分类/autofill 均**新建 handler 并复用 `skill-lifecycle-store.ts` 现有逻辑**；推荐沿用客户端期望的 `skill-recommendations.list`（后端新建，复用 store 推荐逻辑）。映射统一落在 `server-methods/skill-lifecycle.ts`
  - _Requirements: 16（接口契约一致性）_

- [x] G1. **健康度端点**
  - 已注册 `skill-health.sample`（聚合滚动窗口 → `recordSkillHealthSample` → `recordSkillHealthTelemetry`）+ `skill-health.repair-suggestions`（`suggestSkillHealthRepair`）
  - `server-methods-list.ts` + `method-scopes.ts`（sample→WRITE，repair→READ）+ handler 单测
  - _Requirements: 4.11, 7.1, 7.3, 7.4, 7.5_

- [x] G2. **Autofill 端点**
  - 已注册 `skill-autofill.start` / `result`（`startSkillAutofill` / `getSkillAutofillResult`，从同类技能复用 tags/category 派生建议）
  - _Requirements: 6.3, 6.4, 6.5, 6.8, 11.4_

- [x] G3. **草稿生命周期端点**
  - 已注册 `personal-skills.finalize-draft`（`draft→private`）、`personal-skills.accept-autofill`（按字段接受，summary 精修需显式接受）、`personal-skills.delete`（`deletePersonalSkillAsset`）
  - handler 单测覆盖 `draft→private`、autofill 接受、二次 finalize 拒绝
  - _Requirements: 6.6, 6.7, 3.10_

- [x] G4. **依赖图端点**
  - 已注册 `skill-dependency.summary` / `skill-dependency.graph`（`getRuntimeDependencySummary` / `getRuntimeDependencyGraphSnapshot`，由 `buildDependencyGraph` 聚合）
  - handler 单测 + `hasAnyConsumer` 场景
  - _Requirements: 8.1–8.7_

- [x] G5. **审核 / 推荐 / 自动分类端点**
  - 已注册 `skill-review.submit/record/publish/deprecate/retire`（store 新增 `reviews` 集合 + 生命周期流转）、`skill-recommendations.list`（`listSkillRecommendations`，排除已安装 + 仅 published/共享）、`skill-auto-classify.suggestions/accept`
  - handler 单测覆盖审核全链路、推荐去已安装、自动分类接受
  - _Requirements: 10.3–10.10, 12.1–12.3, 13.4_

- [x] G6. **版本历史读取核实**
  - 已确认 `personal-skills.detail`（`projectDetail`）返回 `versions[]`，无需补端点
  - _Requirements: 3.9, 9.2, 9.3_

- [x] G7. **术语 lint 脚本核实**
  - 已核实：i18n locale 中的 `skills` 命名空间属于**管理员/开发者技能页**（合法使用 workflow/provider/model 等技术术语），员工端术语在视图层经 `scanNode` 运行期精确强制。构建期 i18n 全量扫描会对管理员页误报，故**不新增**该脚本；运行期 `scanNode`（已接入视图测试）即为正确机制
  - _Requirements: 5.3, 5.4_

- [x] G8. **端到端集成 + 回归**
  - 已跑通：`skill-lifecycle.test.ts`（10）+ skill-\* 控制器测试（138）+ skill 视图/状态/健康测试（113）= 261 项全绿；缺口文件 `pnpm tsgo` 零错误
  - _Requirements: 全部_

---

## Task Dependency Graph

> 对账后真正待做的工作仅为 G0–G8（gateway 端点接线）。Phase 1–3 的客户端任务已落地（标 `[x]`/`[~]`），不进入依赖波次。

```json
{
  "waves": [
    { "id": "wave-0", "name": "端点接线决策", "tasks": ["G0"], "dependsOn": [] },
    {
      "id": "wave-1",
      "name": "缺口端点接线（互不依赖，可并行）",
      "tasks": ["G1", "G2", "G3", "G4", "G5", "G6", "G7"],
      "dependsOn": ["wave-0"]
    },
    { "id": "wave-2", "name": "端到端集成 + 回归", "tasks": ["G8"], "dependsOn": ["wave-1"] }
  ]
}
```

**关键路径**：G0 → (G1..G7 并行) → G8

## 验证与交付清单（对账后）

- [x] 控制器/视图/能力门面/类型按等价命名已落地（见「已落地清单」）
- [x] 术语黑名单运行期扫描接入视图测试
- [x] **缺口 G1–G7：客户端引用的 gateway 端点全部接线并注册**
- [x] 端到端集成测试在真实后端跑通（G8：261 项 skill 相关测试全绿）
- [~] `pnpm check` / `pnpm tsgo` / `pnpm test` 全绿 + 术语扫描零命中（skill 子集全绿；仓库存在与本 spec 无关的既有 tsgo 报错）
- [ ] i18n zh-CN / en 补齐且无黑名单术语（员工端运行期已强制；如需新增员工端文案再补）

## Notes

- **关键提醒**：勿按原 Phase 1–3 字面"新建"控制器/视图/类型——它们已存在。本 spec 的剩余价值仅在 G0–G8 的后端端点接线。
- **不可触碰**：已落地的 `my-accumulation`（"我的积累"）tab 与控制器是"我的技能"的等价实现，勿新增 `skills` tab 分叉；`skill-models.ts` 是 `EmployeeSkillView` 的等价实现，勿新建并行类型。
- **优先复用**：缺口端点优先复用已注册的等价 handler（`employee-capability.recommendations` / `employee-capability.health-label.subscribe` / `employee-capability.delete` / `enterprise-capability.review*`），仅在语义确实不符时新建。
- **验证命令**：纯函数/store 改动跑 `pnpm tsgo` + 对应 `pnpm test` 子集；UI 改动跑 `pnpm test:ui` 子集；提交前 `pnpm check`。低内存环境用 `OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test`。

## Agents

- cursor-grok · role: owner · scope: capability contract (can / preflight / pack recipes) · paths: src/gateway/skill-capability-contract.ts, src/gateway/skill-capability-contract.test.ts, src/gateway/skill-lifecycle-store.ts, src/gateway/skill-lifecycle-store.test.ts, src/gateway/capability-packs/**, src/gateway/server-methods/employee-capability.ts, src/gateway/server-methods/employee-capability.test.ts, src/gateway/server-methods/skill-lifecycle.ts, src/gateway/server-methods-list.ts, src/gateway/method-scopes.ts, src/gateway/skill-execution-binding/materialize.ts, ui/src/ui/controllers/skill-models.ts, ui/src/ui/controllers/capability-install-preflight.ts, ui/src/ui/controllers/capability-recommendation.ts, ui/src/ui/controllers/robot-capability.ts, ui/src/ui/controllers/robot-skills.ts, ui/src/ui/views/robot-capability-tab.ts, ui/src/ui/capability/employee-capability/**, ui/src/ui/ports/employee/render-model.ts, ui/src/styles/workbench.css · since: 2026-08-13

## Capability contract (CLI-Hub borrow, 2026-08-13)

- [x] P0 动词索引：`SkillRuntimeDefinition.capabilities` + starter pack `capabilities` / `recipes`；保存时从名称/摘要推断 — cursor-grok
- [x] P0 `employee-capability.can`：按「要做的事」匹配已装 + 推荐能力，员工文案，不泄漏运行层 — cursor-grok
- [x] P1 `employee-capability.preflight` + 安装门禁：密钥/本机不可装；岗位推送副本可装；草稿在来源机器人建关系 — cursor-grok
- [x] P2 pack recipe 裁剪：`resolvePackInstallSkillKeys`；SKILL.md 写入任务列表 — cursor-grok
- [x] 员工端「安装」接到 preflight：不能装时显示下一步，不新开入口 — cursor-grok
- [ ] 员工端「还能做什么」意图搜索入口未做 — cursor-grok
