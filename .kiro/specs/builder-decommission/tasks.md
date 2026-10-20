# Implementation Plan: Builder 退役与三端职责收口

## Agents

- `codex-builder-plan` · role: owner · scope: Builder 退役任务书起草、范围固化、验收口径定义 · paths: .kiro/specs/builder-decommission/tasks.md · since: 2026-06-23
- `cursor-builder` · role: owner · scope: Builder 退役 Phase 0–5 执行与验收自测（已签收） · paths: .kiro/specs/builder-decommission/**, ui/src/ui/app-render.ts, ui/src/ui/routing/**, ui/src/ui/ports/platform/view-models/\*\*, ui/src/ui/views/skills.ts, ui/src/ui/views/frontstage.ts, ui/src/ui/navigation.browser.test.ts, ui/src/ui/routing/port-permissions.test.ts, vitest.config.ts · since: 2026-06-23
- **热文件 handoff（不归本任务 claim）**：`ui/src/ui/navigation.ts` + `ui/src/ui/navigation.test.ts` → `enterprise-overview-redesign:cursor-fable`；`ui/src/ui/ports/port-shells.browser.test.ts` + `app-render.boundary.node.test.ts` + `port-state-lens.node.test.ts` → `ops-decommission:codex-opsd`

## Overview

目标：将现有 `Builder` 端口从“用户可见产品面”退役，把仍然有价值的能力明确收口到平台端、企业端、员工端，删除遗留壳层、路由和专属状态链路，消除混淆与冗余。

这不是“重做一个新的 Builder”，也不是“把旧页面换个皮继续保留”。原则是：

1. **职责先归位，再删壳层**。
2. **保留真实能力，删除旧端口包装**。
3. **优先迁移入口与链路，不为旧 Builder 深链重建新 UI**。
4. **旧 `/builder/*` 路径至少做受控跳转/兼容一轮，避免硬断已有链接**。
5. **共享组件只在确认无活跃消费者后删除**，避免误伤平台端现有能力中心。

## Confirmed Findings

以下结论已由代码核对，可作为本任务执行前提：

- `ui/src/ui/ports/builder/views/builder-shell.ts` 不是单一页面，而是 5 个 Builder 子页的壳层：
  - `skills`
  - `agents`
  - `tools`
  - `models`
  - `releases`
- `skills` 与 `agents` 主要复用旧通用组件：
  - `ui/src/ui/views/skills.ts`
  - `ui/src/ui/views/agents.ts`
- `tools` / `models` / `releases` 主要是 Builder 专属统计卡片与工作区包装，真实独立操作深度很弱：
  - `ui/src/ui/ports/builder/semantic/builder-read-model.ts`
  - `ui/src/ui/ports/builder/render-actions.ts`
- 平台端已接住大部分核心职责：
  - 能力治理 / 技能治理：`ui/src/ui/ports/platform/capabilities/page.ts`
  - 模型管理：`ui/src/ui/ports/platform/models/**`
  - 资产管理：`ui/src/ui/ports/platform/agents/page.ts`
  - 版本更新 / 运行时更新：`ui/src/ui/ports/platform/system-settings/page.ts`
- 企业端已接住连接器目录、凭证、安装与探测：
  - `ui/src/ui/ports/enterprise/views/enterprise-data-governance-center-surface.ts`
- 平台端代码已经明确：运行依赖安装动作下沉到员工端运行节点，而不是继续留在 Builder：
  - `ui/src/ui/ports/platform/capabilities/page.ts`

## Non-Goals

本任务**不**做以下事情：

- 不新建“Builder 2.0”。
- 不重做能力治理的数据模型。
- 不借机重构平台端 / 企业端 / 员工端的整套 IA。
- 不为了保留旧 Builder 体验而新增新的中间适配层。
- 不在共享脏树里顺手清 unrelated WIP。

## Handoff Rules For Cursor

Cursor 接手前必须遵守以下流程：

1. 先阅读本文件，再开始改代码。
2. 先执行 Loom / attribution 签到，不要直接改动共享热文件。
3. 采用“小步迁移 + 每个 green checkpoint 立即提交”的节奏，不要攒巨大 diff。
4. 任何时刻如果发现以下两类情况，必须暂停并记录：
   - 平台端仍缺失 Builder 对应的正式承接页，无法无损迁移。
   - 目标热文件已有别的 agent 未提交 WIP，且本任务无法安全穿插。

建议接手动作：

1. 新建/接管执行任务，owner 使用 Cursor 自己的 agent id。
2. 用 staged-claim 工作流只认领自己实际修改的文件，不预先大面积 claim。
3. 在首个提交前跑一次 `bun scripts/agent-attribution.ts`，确认没有 `UNATTRIBUTED` / 新的 `CONFLICT`。

## Canonical Migration Map

Builder 退役后的目标收口如下：

| 旧 Builder 入口                   | 新入口                      | 迁移说明                                             |
| --------------------------------- | --------------------------- | ---------------------------------------------------- |
| `/builder`                        | `/platform/capabilities`    | Builder 根入口不再存在，直接落到平台能力中心         |
| `/builder/skills`                 | `/platform/capabilities`    | 技能治理收口到平台能力中心                           |
| `/builder/agents`                 | `/platform/agents`          | 代理/资产治理收口到平台资产管理                      |
| `/builder/agents/:agentId`        | `/platform/agents/:agentId` | 保留对象级跳转能力                                   |
| `/builder/tools`                  | `/platform/advanced`        | 工具/连接器/供给侧目录不再独立成端，进入平台高级治理 |
| `/builder/tools/:capabilityId`    | `/platform/advanced`        | 无等价对象页，允许降级到父页                         |
| `/builder/models`                 | `/platform/models`          | 模型接入与治理收口到平台模型管理                     |
| `/builder/models/:capabilityId`   | `/platform/models`          | 无稳定对象路由时可降级到父页                         |
| `/builder/releases`               | `/platform/system-settings` | 版本与更新收口到平台系统设置                         |
| `/builder/releases/:capabilityId` | `/platform/system-settings` | 无稳定对象路由时可降级到父页                         |

## Phase 0 — Preflight And Guardrails

- [x] 0.1 建立执行基线 — cursor-builder
  - 基线（2026-06-23）：940 dirty files；802 UNATTRIBUTED；4 CONFLICT（`record-credit-usage.ts`、`en.ts`、`zh-CN.ts`、`workbench.css`）。
  - 热文件注意：`navigation.ts` 同时有 `cursor-fable` WIP；`port-shells.browser.test.ts` 有 `codex-opsd` claim；本任务仅局部编辑 builder 相关段落。
- [x] 0.2 建立 Builder 引用清单 — cursor-builder
  - 已固化：`ui/src/ui/ports/builder/**`（11 文件，已删除）、`"/builder"` 路由、`builderLink`、`前往供给构建`、`查看 Builder Models`、`sourcePort: "builder"`。
- [x] 0.3 定义退役策略 — cursor-builder
  - UI 入口移除；`/builder/*` 受控跳转；无 Builder 权限面；平台端不再引导 Builder。

## Phase 1 — 先迁入口与文案，不删底层

- [x] 1.1 清理平台端对 Builder 的显式引导 — cursor-builder
- [x] 1.2 用三端正式入口替换旧跳转 — cursor-builder
- [x] 1.3 清理用户可见 Builder 文案 — cursor-builder

## Phase 2 — 退役 Builder 路由与导航

- [x] 2.1 从导航模型中移除 Builder 作为 active port — cursor-builder
- [x] 2.2 保留旧 `/builder/*` 路径的兼容跳转 — cursor-builder
- [x] 2.3 清理 Builder 专属 query / state 同步 — cursor-builder

## Phase 3 — 删除 Builder 端口实现链路

- [x] 3.1 从主渲染入口摘除 Builder — cursor-builder
- [x] 3.2 删除 Builder 端口目录 — cursor-builder
- [x] 3.3 删除 Builder 专属权限/上下文残留 — cursor-builder

## Phase 4 — 清理 Builder 遗留共享页面，但不要误删仍在用的 contract

- [x] 4.1 删除已无消费者的 Builder 专属旧页面 — cursor-builder
- [x] 4.2 谨慎处理 `ui/src/ui/views/skills.ts` — cursor-builder（方案 A：保留 `SkillsProps` contract，删除整页 renderer）
- [x] 4.3 清理平台端遗留 Builder 占位语义 — cursor-builder

## Phase 5 — 测试、死代码核验、最终收口

- [x] 5.1 更新和替换测试 — cursor-builder
- [x] 5.2 最小功能回归 — cursor-builder（浏览器测试覆盖 legacy redirect；完整人工回归待 Codex 验收）
- [x] 5.3 死代码与残留扫描 — cursor-builder

## Stop Conditions

出现以下情况时，Cursor 不应继续“硬做完”，而应暂停并记录：

1. 平台端当前没有正式承接某个 Builder 核心动作，若直接删除会造成功能缺失。
2. 为了兼容旧 `/builder/*` 深链，被迫重新实现 Builder 式对象页。
3. 删除 `skills.ts` 会导致平台能力中心 contract 大面积连锁破坏。
4. 共享热文件里存在其它 agent 未提交变更，且无法安全局部编辑。

## Verification Commands

优先跑最小必要集；内存紧张时使用低压 profile。

```sh
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  ui/src/ui/navigation.test.ts \
  ui/src/ui/navigation.browser.test.ts \
  ui/src/ui/app-render.boundary.node.test.ts \
  ui/src/ui/ports/port-shells.browser.test.ts \
  ui/src/ui/ports/port-state-lens.node.test.ts \
  ui/src/ui/routing/port-permissions.test.ts

pnpm build

rg -n "/builder|sourcePort: \"builder\"|builderLink|前往供给构建|查看 Builder Models" ui/src/ui
```

如果测试拆分后新增了更小的针对性文件，允许替换为更窄的 vitest 范围，但最终必须覆盖：

- 路由归一化
- legacy redirect
- 主渲染入口无 Builder 分支
- 权限模型无 Builder 端口

## Final Acceptance Gate (Codex)

我只会在以下条件全部满足时验收通过：

1. Builder 不再是用户可见端口：
   - 无侧边导航
   - 无 active port
   - 无 Builder shell 渲染分支
2. `/builder/*` 不再落入旧 Builder UI，而是稳定跳到平台端对应入口。
3. `ui/src/ui/ports/builder/**` 已删除，或仅剩过渡性占位文件且有明确删除理由。
4. 平台端不再把用户引导到 Builder。
5. `ui/src/ui/views/skills.ts` 若保留，必须有清晰的“共享 contract / 非 Builder 页面”理由；若删除，平台端相关 contract 必须已迁走。
6. 目标测试通过，`pnpm build` 通过。
7. 未引入新的无主文件、ownership conflict 或与本任务无关的大面积 churn。

## Suggested Commit Shape

建议至少拆成以下 3 个 checkpoint：

1. `UI: reroute Builder entry points into platform surfaces`
2. `UI: retire Builder routing and shell wiring`
3. `UI: remove retired Builder pages and tests`

每个 checkpoint 都应是可回归、可测试、可单独 review 的逻辑单元。

## Acceptance

- [x] Codex 功能验收通过（2026-06-23）— cursor-builder
  - 137/137 关键测试全绿；`pnpm build` 通过；Builder 端口/渲染链/活链路残留已清除。
- [x] Loom ownership 收口（2026-06-23）— cursor-builder
  - `builder-decommission:cursor-builder` 标记 `landed`；从 paths 移除与 `enterprise-overview-redesign:cursor-fable`、`ops-decommission:codex-opsd` 重叠的热文件 claim。
  - `navigation.ts` / `navigation.test.ts` 正式 merge 由 `cursor-fable` land；本任务仅保留无冲突 paths。
