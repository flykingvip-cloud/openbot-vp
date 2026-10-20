# Implementation Plan: 能力生命周期闭环（Capability Lifecycle Closure）

## Agents

- kiro-daibai · role: owner · scope: asset admission readiness gate + type inference fix + org-candidate badge real evidence + group share notification · paths: src/gateway/asset-admission.ts, src/gateway/asset-admission.test.ts, src/gateway/server-methods/employee-capability.ts, src/gateway/skill-lifecycle-store.ts, ui/src/ui/capability/employee-capability/types.ts, ui/src/ui/controllers/asset-incubation/\*, ui/src/ui/controllers/my-accumulation.ts, ui/src/ui/views/my-accumulation.ts, .kiro/specs/capability-lifecycle-closure/tasks.md · since: 2026-07-01

## Overview

本实施计划按优先级分三个阶段推进：企业孵化中心 → 平台上行通道 → 员工能力市场。

核心实现路径：

- 后端：`src/gateway/incubation-store.ts`（File Store）+ `src/gateway/server-methods/incubation.ts`（RPC handlers）
- 前端控制器：`ui/src/ui/controllers/enterprise-incubation/`（纯函数 + 状态管理）
- 前端视图：`ui/src/ui/views/enterprise-incubation/`（Lit Web Components）
- 员工市场：嵌入 `ui/src/ui/views/robot-capability-tab.ts`

技术栈：Lit + TypeScript + Gateway RPC + File Store（JSON 原子写入）+ Vitest + fast-check

> **架构收口修订（Path Unification, 2026-07）**：下方任务记录了初版按「孵化中心自带 `upstream.*` 上报旁路」的实现历史。该旁路后被判定为孤儿通路（不脱敏、不进注册表、状态永不推进），已收口删除，平台上行统一走**脱敏提交通路**：`enterprise-capability.sanitization-preview/confirm` → `submit-to-platform` → `platform-capability.enterprise-submissions/review/publish` → 治理注册表；孵化中心上报追踪改读 `enterprise-capability.platform-submissions`。因此以下任务中的 `upstream.submit/report-list/proposal-status/supplement`、`incubation-store` 的 upload-report 类型与 CRUD、以及视图 `upstream-report-form.ts` / `proposal-timeline.ts` / `incubation-center-page.ts` 与控制器 `proposal-status.ts` **均已移除**（详见 requirements.md / design.md「架构收口修订」）。另：`enterprise-capability.certify` / `promote-to-standard` 现已从「只校验」升级为「校验 + 持久化企业认证/企业标准授予（`manualMaturityGrant`，作为成熟度下限）」。

## Tasks

- [x] 1. 数据存储层与 RPC 端点基础设施
  - [x] 1.1 实现 Incubation Store（孵化数据文件存储）
    - 创建 `src/gateway/incubation-store.ts`
    - 实现 `atomicWriteJson` 原子写入函数（写入临时文件后 rename）
    - 实现 `readJsonFile<T>` 安全读取函数（文件不存在返回 fallback）
    - 定义并导出类型：`PromotionDecisionRecord`、`IncubationScoreSnapshot`、`UploadReportRecord`、`UploadFormContent`、`ProposalStatus`、`ProposalStatusChange`、`EffectTrackingRecord`
    - 实现 CRUD 函数：`listDecisions`、`saveDecision`、`listUploadReports`、`getUploadReport`、`saveUploadReport`、`hasActiveUpload`、`getEffectTracking`、`saveEffectTracking`
    - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - [x] 1.2 实现 Incubation RPC Handlers
    - 创建 `src/gateway/server-methods/incubation.ts`
    - 实现 `incubation.candidate-pool` 端点：实时计算候选池（maturity >= 企业认证、calls30d >= 100、departmentCount >= 2、successRate >= 0.8）
    - 实现 `incubation.score` 端点：计算四维度评分 + 综合分
    - 实现 `incubation.decide` 端点：验证 reason 长度 10-500、持久化决策记录
    - 实现 `incubation.effect-tracking` 端点：返回晋升前后对比数据
    - 实现 `upstream.proposal-status` 端点：查询提案审批状态 + 时间线
    - 实现 `upstream.supplement` 端点：提交补充材料、更新状态为 reviewing
    - 将 handlers 注册到 Gateway server methods
    - _Requirements: 11.1, 11.2, 11.4, 11.5, 1.1, 3.2, 5.3, 6.7_
  - [x] 1.3 编写 Incubation Store 单元测试
    - 创建 `src/gateway/__tests__/incubation-store.test.ts`
    - 测试原子写入（写入后读取一致）
    - 测试 CRUD 操作（listDecisions、saveDecision、hasActiveUpload 等）
    - 测试文件不存在时返回 fallback
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 2. 孵化评分与候选池核心逻辑（纯函数）
  - [x] 2.1 实现孵化评分计算器
    - 创建 `ui/src/ui/controllers/enterprise-incubation/incubation-score.ts`
    - 定义类型：`ScoreInput`、`ScoreDimension`、`IncubationScore`
    - 定义权重常量 `WEIGHTS`（复用广度 0.3、效果稳定性 0.3、业务覆盖度 0.2、员工满意度 0.2）
    - 实现 `calcReuseBreath`、`calcEffectStability`、`calcBusinessCoverage`、`calcEmployeeSatisfaction`、`calcCompositeScore`、`calculateIncubationScore`
    - _Requirements: 2.1, 2.2, 2.3, 2.6_
  - [x] 2.2 实现候选池筛选与排序逻辑
    - 创建 `ui/src/ui/controllers/enterprise-incubation/candidate-pool.ts`
    - 定义类型：`CandidateCapability`、`CandidatePoolState`
    - 实现 `isCandidateEligible`、`filterByDomain`、`sortCandidates`
    - _Requirements: 1.2, 1.7, 1.8, 2.5_
  - [x] 2.3 编写评分与候选池单元测试
    - 创建 `ui/src/ui/controllers/enterprise-incubation/__tests__/incubation-score.test.ts`
    - 创建 `ui/src/ui/controllers/enterprise-incubation/__tests__/candidate-pool.test.ts`
    - 测试评分维度边界（0-100）、综合分加权平均、缺失维度权重重分配
    - 测试候选池筛选条件、领域筛选、排序不变量
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 1.2, 1.7, 1.8_

- [x] 3. 晋升决策与效果追踪逻辑
  - [x] 3.1 实现晋升决策控制器
    - 创建 `ui/src/ui/controllers/enterprise-incubation/promotion-decision.ts`
    - 实现 `validateDecisionReason`（10-500 字符）、决策提交状态管理、决策历史排序
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 3.2 实现效果追踪控制器
    - 创建 `ui/src/ui/controllers/enterprise-incubation/effect-tracking.ts`
    - 实现 `calcDeclineRate`、`hasEffectDeclineWarning`（阈值 20%）
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_
  - [x] 3.3 编写决策与效果追踪单元测试
    - 测试 reason 长度验证、效果下降阈值判断
    - _Requirements: 3.2, 4.4_

- [x] 4. 平台上行通道逻辑
  - [x] 4.1 实现上报记录控制器
    - 创建 `ui/src/ui/controllers/enterprise-incubation/upstream-report.ts`
    - 实现 `validateUploadForm`、`getProposalStatusDisplay`
    - _Requirements: 5.1, 5.6, 6.3_
  - [x] 4.2 实现提案状态控制器
    - 创建 `ui/src/ui/controllers/enterprise-incubation/proposal-status.ts`
    - 实现提案状态查询、补充材料提交、重复上报检测
    - _Requirements: 5.7, 6.1, 6.2, 6.6, 6.7, 6.8_
  - [x] 4.3 编写上行通道单元测试
    - 测试表单验证、状态颜色映射、重复上报拒绝
    - _Requirements: 5.7, 6.3_

- [x] 5. 员工能力市场逻辑
  - [x] 5.1 实现员工能力市场控制器
    - 创建 `ui/src/ui/controllers/enterprise-incubation/marketplace.ts`
    - 实现 `projectToMarketplace`、`isTerminologyClean`、`filterByTag`、`searchByName`、`markInstalled`
    - _Requirements: 7.2, 7.4, 7.5, 7.8, 7.9, 12.1, 12.3_
  - [x] 5.2 编写员工市场单元测试
    - 测试投影剥离运行时字段、术语黑名单、筛选/搜索、已安装标记
    - _Requirements: 7.4, 7.5, 7.8, 12.1, 12.3_

- [x] 6. 控制器模块导出
  - [x] 6.1 创建控制器索引文件
    - 创建 `ui/src/ui/controllers/enterprise-incubation/index.ts`
    - 统一导出所有控制器模块的公共 API
    - _Requirements: 11.4_

- [x] 7. 孵化中心前端视图
  - [x] 7.1 创建共享样式
    - 创建 `ui/src/ui/views/enterprise-incubation/shared/styles.css.ts`
    - 定义白色背景 + 蓝色主色调样式常量
    - _Requirements: 9.6, 13.1_
  - [x] 7.2 实现孵化中心主页面
    - 创建 `ui/src/ui/views/enterprise-incubation/incubation-center-page.ts`
    - 实现页面标题 + 三区域布局 + 右上角"上报记录"按钮
    - _Requirements: 9.1, 9.2, 9.5_
  - [x] 7.3 实现候选池概览与统计卡片
    - 创建 `ui/src/ui/views/enterprise-incubation/candidate-pool-section.ts`
    - 实现四个统计卡片 + 筛选栏 + 骨架屏 + 空状态 + 超时重试
    - _Requirements: 9.3, 9.4, 1.3, 1.4, 1.5, 1.6_
  - [x] 7.4 实现候选能力卡片（含雷达图）
    - 创建 `ui/src/ui/views/enterprise-incubation/candidate-card.ts`
    - 实现卡片内容 + 雷达图 + 综合分 + 跳转链接
    - _Requirements: 1.3, 2.1, 2.4, 14.2_
  - [x] 7.5 实现晋升决策面板与决策历史
    - 创建 `ui/src/ui/views/enterprise-incubation/decision-panel.ts`
    - 创建 `ui/src/ui/views/enterprise-incubation/decision-history.ts`
    - 实现三个决策按钮 + 理由输入 + 历史列表
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 14.3_
  - [x] 7.6 实现效果追踪面板
    - 创建 `ui/src/ui/views/enterprise-incubation/effect-tracking-panel.ts`
    - 实现前后对比 + 折线图 + 下降警告 + 追踪中标注
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 14.6_

- [x] 8. 平台上行通道前端视图
  - [x] 8.1 实现上报表单
    - 创建 `ui/src/ui/views/enterprise-incubation/upstream-report-form.ts`
    - 实现必填字段 + 自动填充 + 验证 + 重复上报拦截
    - _Requirements: 5.1, 5.2, 5.4, 5.6, 5.7_
  - [x] 8.2 实现上报记录列表与审批时间线
    - 创建 `ui/src/ui/views/enterprise-incubation/upstream-report-list.ts`
    - 创建 `ui/src/ui/views/enterprise-incubation/proposal-timeline.ts`
    - 实现颜色编码徽章 + 时间线 + 补充材料提交
    - _Requirements: 5.8, 6.1, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 14.4_

- [x] 9. 员工能力市场前端视图
  - [x] 9.1 实现员工能力市场入口与卡片网格
    - 创建 `ui/src/ui/views/enterprise-incubation/marketplace-section.ts`
    - 创建 `ui/src/ui/views/enterprise-incubation/marketplace-card.ts`
    - 在 `robot-capability-tab.ts` 中添加"探索更多能力"入口
    - 实现卡片网格 + 筛选/搜索 + 安装流程 + 成功/失败反馈
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 14.5_

- [x] 10. 模块间集成与导航
  - [x] 10.1 实现导航集成
    - 在企业能力中心页面添加"孵化中心"导航入口
    - 确保各模块间跳转链接正常
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

- [x] 11. 平台分发可见性模式
  - [x] 11.1 扩展平台治理分发协议与存储模型
    - `src/gateway/protocol/schema/capability-governance.ts`：`EmployeeVisibilityModeSchema` + `updateDistribution` 增加可选 `employeeVisibilityMode`
    - `src/gateway/capability-governance-store.ts`：`GovernanceDistributionPolicy.employeeVisibilityMode` + `normalizeEmployeeVisibilityMode`（缺省 `enterprise_review_required`）
    - `capabilities.governance.updateDistribution` handler 透传 `employeeVisibilityMode`
    - _Requirements: 15.1, 15.4_
  - [x] 11.2 扩展平台端分发配置 UI
    - `ui/src/ui/ports/platform/capabilities/page.ts`：分发编辑器内「员工可见性」单选（`enterprise_review_required` / `direct_employee_visible`）
    - `render-actions.ts` 的 `onPromoteDistribution` 将所选模式发送至 `updateDistribution`
    - _Requirements: 15.1, 15.4_
  - [x] 11.3 实现员工市场平台直达推荐聚合
    - `src/gateway/server-methods/employee-capability.ts`：`listPlatformDirectCapabilityEntries`（命中租户 + `direct_employee_visible` + active）
    - `recommendations` handler 聚合 `platform_direct + position_market + personal_shared`，按 `capabilityId` 去重，优先级：岗位推送(1) > 平台直达(2) > 共享推荐(3)
    - _Requirements: 15.2, 15.3, 15.5, 15.6_
  - [x] 11.4 更新员工市场来源投影与文案
    - 后端 `recommendations` 在每条推荐上附加 `source`（platform_direct/position_market/personal_shared）
    - `ui/src/ui/controllers/enterprise-incubation/marketplace.ts`：新增 `projectEmployeeRecommendations` + `recommendationSourceLabel`，展示「平台直达 / 企业推送 / 共享推荐」来源标签；保持术语黑名单约束
    - _Requirements: 15.2, 15.3, 12.1, 12.2, 12.3_
  - [x] 11.5 编写平台分发可见性模式测试
    - 后端可见性差异：`employee-capability.test.ts` 覆盖 `direct_employee_visible` 直达可见 + 仅岗位推送可见两种模式
    - 去重测试：平台直达与岗位推送命中同一能力时仅返回一条（优先岗位推送）
    - 协议 round-trip：新建 `src/gateway/protocol/schema/capability-governance.test.ts` 验证 `employeeVisibilityMode` 接受/拒绝/可选
    - UI 投影：`marketplace.test.ts` 覆盖 `projectEmployeeRecommendations` 来源标签映射与回退
    - _Requirements: 15.2, 15.3, 15.4, 15.5, 15.6_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2", "3.1", "3.2", "4.1", "4.2", "5.1"] },
    { "id": 3, "tasks": ["2.3", "3.3", "4.3", "5.2"] },
    { "id": 4, "tasks": ["6.1"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3", "7.4", "7.5", "7.6", "8.1", "8.2", "9.1"] },
    { "id": 7, "tasks": ["10.1"] },
    { "id": 8, "tasks": ["11.1", "11.2", "11.3", "11.4"] },
    { "id": 9, "tasks": ["11.5"] }
  ]
}
```

## Notes

### 依赖关系说明

- **Wave 0 — 数据存储层**：1.1（Incubation Store）作为后端基础，必须最先完成。已完成。
- **Wave 1 — RPC 与存储测试**：1.2（RPC Handlers）依赖 1.1 的 Store 类型与 CRUD 函数；1.3（Store 单元测试）独立于 1.2，可与之并行。
- **Wave 2 — 前端控制器（纯函数）**：2.1/2.2（评分与候选池）、3.1/3.2（决策与效果追踪）、4.1/4.2（上行通道）、5.1（员工市场）均为相互独立的纯函数控制器，可并行实施。它们使用 Wave 1 端点契约，但实现层不强依赖 RPC handler 完成。
- **Wave 3 — 控制器单元测试**：2.3、3.3、4.3、5.2 仅依赖各自对应的控制器实现，可并行执行。
- **Wave 4 — 控制器索引**：6.1 聚合所有控制器导出，必须在所有控制器实现（Wave 2）完成后才能写入完整的 `index.ts`。
- **Wave 5 — 共享样式**：7.1 是所有 Lit 视图的样式基础，必须在视图开发前完成。
- **Wave 6 — Lit 视图**：7.2-7.6（孵化中心视图）、8.1/8.2（上行通道视图）、9.1（员工市场视图）依赖控制器层和共享样式，相互之间布局独立可并行。
- **Wave 7 — 集成与导航**：10.1 作为最后一步，链接所有页面。
- **Wave 8 — 平台分发可见性模式**：11.1（协议与存储）、11.2（平台 UI）、11.3（员工推荐聚合）、11.4（员工市场投影）可按后端优先、前端并行方式实施。
- **Wave 9 — 可见性模式测试**：11.5 依赖 Wave 8 的所有实现完成后统一补测。

### 实施约定

- 所有 Property 1-15 对应的单元测试统一使用 Vitest + fast-check（fast-check 作为 PBT 工具）。
- 所有视图严格遵守术语黑名单（员工市场使用 `terminology-filter.ts`，管理端禁止暴露 prompt/workflow 等运行时字段）。
- File Store 的所有写入必须使用 `atomicWriteJson`（写入临时文件后 rename）以保证原子性。
- Gateway RPC 端点超时 10 秒，UI 层处理超时重试。
- 复用已有端点（`enterprise-capability.promote-to-standard`、`enterprise-capability.certify`、`employee-capability.recommendations`），仅 `incubation.*` 与 `upstream.*` 为新增。
- 平台分发可见性模式落在 `capabilities.governance.updateDistribution`，不新增独立配置端点。

### 测试覆盖

- 单元测试覆盖 Property 1-15 的所有不变量。
- 视图层（Wave 6）当前未规划 VRT/E2E，依赖控制器层测试 + 类型层守卫。
- 后端 Store 测试（1.3）覆盖原子写入安全性（Property 14）与 Round-Trip 完整性（Property 5）。
