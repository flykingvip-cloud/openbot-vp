# OpenBot / OpenBot UI 实施状态复核

Date: 2026-04-11

> Update: 本文档记录的是 2026-04-11 早期复核快照。最新阶段结论与剩余任务，请以
> `docs/design/openbot-openclaw-ui-stage-closeout-and-next-phase-2026-04-11.md`
> 为准。

## Related Docs

- 总体迁移策略：[/design/openbot-openclaw-ui-capability-migration-plan-2026-04-10](/design/openbot-openclaw-ui-capability-migration-plan-2026-04-10)
- 现状审计与任务清单：[/design/openbot-openclaw-ui-current-state-audit-and-task-plan-2026-04-10](/design/openbot-openclaw-ui-current-state-audit-and-task-plan-2026-04-10)
- 产品入口矩阵：[/design/openbot-product-entry-matrix-2026-04-11](/design/openbot-product-entry-matrix-2026-04-11)
- 最新阶段收尾：[/design/openbot-openclaw-ui-stage-closeout-and-next-phase-2026-04-11](/design/openbot-openclaw-ui-stage-closeout-and-next-phase-2026-04-11)

## 1. 复核结论

基于当前仓库状态，既定方案已经完成了第一批边界搭建，但还没有达到“Phase 1 已完成，可以进入大规模替换”。

当前判断：

- 已完成：浏览器 capability 第一批骨架、主渲染层 capability 接入、入口矩阵、`AppViewState` capability 切片识别、employee port state adapter 第一版。
- 部分完成：gateway seam、console/control state adapter、workbench read-model contract、native legacy 冻结策略。
- 未完成：legacy UI 真正物理隔离、local-only workbench object 冻结、feature flag / build flag 退场机制、CI 约束、parity test。

结论上，这一阶段应判定为：

- Phase 1 基础边界已建立
- Phase 1 复核未通过
- 还不能宣布 legacy 退场准备完成

## 2. 完成度总览

| 级别 | 完成 | 部分完成 | 未完成 |
| ---- | ---- | -------- | ------ |
| P0   | 7    | 5        | 0      |
| P1   | 3    | 5        | 2      |
| P2   | 0    | 0        | 3      |

## 3. P0 任务复核

| ID    | 状态     | 判断                                                                                                                             | 证据                                                                                                                                            |
| ----- | -------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1  | 部分完成 | 文档层已经定义 legacy 壳层冻结，但仓库内未见强制 review / CI / build 约束。                                                      | `docs/design/openbot-openclaw-ui-current-state-audit-and-task-plan-2026-04-10.md`, `docs/design/openbot-product-entry-matrix-2026-04-11.md`     |
| P0-2  | 完成     | `ui/` 已被明确为 OpenBot 浏览器主前端候选，且能力抽取工作全部围绕该层展开。                                                      | `docs/design/openbot-openclaw-ui-current-state-audit-and-task-plan-2026-04-10.md`, `ui/src/ui/app-render.ts`, `ui/src/ui/ports/employee/**`     |
| P0-3  | 完成     | 入口矩阵已经建立，并对 browser/native/doc/CLI 入口做了保留、迁移、冻结、改名标注。                                               | `docs/design/openbot-product-entry-matrix-2026-04-11.md`                                                                                        |
| P0-4  | 部分完成 | 已识别风险，但 `workspaceTeamObjects` / `workspaceTeamOrder` 仍保留在本地存储与 workbench read-model 中。                        | `ui/src/ui/storage.ts`, `ui/src/ui/ports/employee/render-model.ts`                                                                              |
| P0-5  | 部分完成 | `gateway` facade 已建立，但 gateway bootstrap / connect / target 细节仍大量留在 `app-gateway.ts`。                               | `ui/src/ui/capability/gateway/facade.ts`, `ui/src/ui/app-gateway.ts`                                                                            |
| P0-6  | 完成     | `config` facade 已建立，主渲染层和 settings/channels 已通过 capability 调用。                                                    | `ui/src/ui/capability/config/**`, `ui/src/ui/app-render.ts`, `ui/src/ui/app-settings.ts`, `ui/src/ui/app-channels.ts`                           |
| P0-7  | 完成     | `channels` facade 已建立，顶层调用点已经不再直接依赖旧 controller 路径。                                                         | `ui/src/ui/capability/channels/**`, `ui/src/ui/app-render.ts`, `ui/src/ui/app-settings.ts`, `ui/src/ui/app-channels.ts`                         |
| P0-8  | 完成     | `sessions` facade 已建立，主渲染和 chat/gateway/settings 都已通过 capability 接口访问。                                          | `ui/src/ui/capability/sessions/**`, `ui/src/ui/app-render.ts`, `ui/src/ui/app-chat.ts`, `ui/src/ui/app-gateway.ts`, `ui/src/ui/app-settings.ts` |
| P0-9  | 完成     | `chat` facade 已建立，history/send/abort/event 处理已通过 capability 调用。                                                      | `ui/src/ui/capability/chat/**`, `ui/src/ui/app-chat.ts`, `ui/src/ui/app-gateway.ts`, `ui/src/ui/app-render.ts`                                  |
| P0-10 | 完成     | 已拆出 gateway/config/channels/chat/sessions/workbench 等 capability state 切片。                                                | `ui/src/ui/capability/view-state.ts`, `ui/src/ui/capability/app-view-state-slices.ts`, `ui/src/ui/app-view-state-shell-slices.ts`               |
| P0-11 | 部分完成 | `AppPortState` 与 `adaptAppPortState()` 已建立，但 workbench 仍直接读取 `settings.workspaceTeamObjects` / `workspaceTeamOrder`。 | `ui/src/ui/app-port-state.ts`, `ui/src/ui/ports/employee/render-model.ts`                                                                       |
| P0-12 | 部分完成 | `app-render.ts` 已建立 `capabilityState` 聚合，但仍未形成独立的 console/control port adapter。                                   | `ui/src/ui/app-render.ts`, `ui/src/ui/capability/view-state.ts`                                                                                 |

## 4. P1 任务复核

| ID    | 状态     | 判断                                                                                                                  | 证据                                                                                                                                                                                                   |
| ----- | -------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-1  | 部分完成 | employee read-model 已有 `AppPortState` 收口，但 `render-model.ts` 仍从 state 拼装大量视图数据。                      | `ui/src/ui/app-port-state.ts`, `ui/src/ui/ports/employee/render-model.ts`                                                                                                                              |
| P1-2  | 部分完成 | `ui/src/ui/data/**` 与 `ui/src/ui/ports/employee/**` 已存在职责分层，但仍有 legacy workbench object 混入 read-model。 | `ui/src/ui/data/**`, `ui/src/ui/ports/employee/**`, `ui/src/ui/ports/employee/render-model.ts`                                                                                                         |
| P1-3  | 未完成   | 后端优先的团队/空间领域模型尚未替换本地工作台对象。                                                                   | `ui/src/ui/storage.ts`, `ui/src/ui/ports/employee/render-model.ts`                                                                                                                                     |
| P1-4  | 部分完成 | collaboration packages 与 UI 层已经并存，但还没有完成“UI 全量对齐 package contract”的复核闭环。                       | `packages/collaboration-*`, `ui/src/ui/controllers/collaboration-*.ts`, `ui/src/ui/ports/employee/**`                                                                                                  |
| P1-5  | 完成     | 浏览器入口命名矩阵已建立。                                                                                            | `docs/design/openbot-product-entry-matrix-2026-04-11.md`                                                                                                                                               |
| P1-6  | 部分完成 | 路由层已有 OpenBot workbench/control 分离趋势，但仍保留较多 compatibility alias 和 legacy 文案。                      | `ui/src/ui/navigation.ts`, `ui/src/ui/navigation.test.ts`, `ui/src/ui/views/overview.ts`                                                                                                               |
| P1-7  | 部分完成 | dashboard/control UI 命名混淆已被识别并入文档，但外部命名尚未真正收口。                                               | `docs/design/openbot-product-entry-matrix-2026-04-11.md`, `src/commands/dashboard.ts`, `docs/web/dashboard.md`                                                                                         |
| P1-8  | 完成     | iOS legacy 壳层入口依赖已盘点并标注 freeze / migrate。                                                                | `docs/design/openbot-product-entry-matrix-2026-04-11.md`, `apps/ios/Sources/RootCanvas.swift`, `apps/ios/Sources/Settings/SettingsTab.swift`, `apps/ios/Sources/Onboarding/OnboardingWizardView.swift` |
| P1-9  | 完成     | macOS legacy 壳层入口依赖已盘点并标注 freeze / migrate。                                                              | `docs/design/openbot-product-entry-matrix-2026-04-11.md`, `apps/macos/Sources/OpenBot/MenuContentView.swift`                                                                                           |
| P1-10 | 未完成   | 尚未看到 iOS/macOS legacy shell 的 feature flag / build flag 退场机制。                                               | `apps/ios/**`, `apps/macos/**`                                                                                                                                                                         |

## 5. P2 任务复核

| ID   | 状态   | 判断                                                                     | 证据                                                                                             |
| ---- | ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| P2-1 | 未完成 | browser/native 之间尚未形成统一 capability contract 文档或共享实现约束。 | `ui/src/ui/capability/**`, `apps/shared/OpenBotKit/**`, `apps/macos/Sources/OpenBotProtocol/**`  |
| P2-2 | 未完成 | native legacy store 仍处于盘点阶段，尚未形成 adapter 下沉方案。          | `apps/macos/Sources/OpenBot/ConfigStore.swift`, `apps/macos/Sources/OpenBot/ChannelsStore.swift` |
| P2-3 | 未完成 | native host-only service 边界还未显式收口。                              | `apps/ios/Sources/Model/NodeAppModel.swift`, `apps/macos/Sources/OpenBot/AppState.swift`         |

## 6. 对既定验收标准的复核

### 6.1 架构验收

| 验收项                                         | 状态     | 说明                                                                                      |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| 新 OpenBot UI 不再直接依赖 legacy view         | 完成     | 浏览器新 UI 未直接引入 native legacy view。                                               |
| 新 OpenBot UI 不再直接依赖 legacy ViewModel    | 部分完成 | 浏览器层已不依赖 legacy native ViewModel，但 browser shell 内部仍存在单体 app host 透传。 |
| gateway/config/channels 存在 capability facade | 完成     | 第一批 facade 已落地。                                                                    |
| 新 UI 状态通过 capability/domain store 读取    | 部分完成 | capability state adapter 已建立，但仍未形成真正 domain store。                            |

### 6.2 工程验收

| 验收项                                         | 状态     | 说明                                        |
| ---------------------------------------------- | -------- | ------------------------------------------- |
| release 构建中没有旧 UI 主入口                 | 未完成   | native legacy 入口仍在产品链路中。          |
| legacy UI 被明确隔离并冻结                     | 部分完成 | 文档层明确，工程层未硬隔离。                |
| 新增代码默认进入 capability 或 OpenBot UI 边界 | 部分完成 | 浏览器层有明显趋势，但仓库尚无硬性规则。    |
| review 能阻止新的跨层耦合进入主分支            | 未完成   | 当前未见 import / state access 的 CI 约束。 |

### 6.3 业务验收

| 验收项                             | 状态     | 说明                                                  |
| ---------------------------------- | -------- | ----------------------------------------------------- |
| gateway 主路径在新 UI 可用         | 部分完成 | 可以使用，但 connect/bootstrap 细节仍散在 app shell。 |
| config 主路径在新 UI 可用          | 完成     | capability facade 已接到主渲染层。                    |
| channels 主路径在新 UI 可用        | 完成     | capability facade 已接到主渲染层。                    |
| 关键会话与工作台主路径在新 UI 可用 | 部分完成 | workbench 可用，但仍依赖 local-only object。          |
| parity test 能证明关键行为一致     | 未完成   | 未见迁移对照测试体系。                                |

## 7. 当前阶段的真实判断

当前最准确的阶段判断不是“计划完成”，而是：

1. 第一批 capability facade 与 state seam 已落地。
2. `app.ts`、`app-lifecycle.ts`、`app-gateway.ts`、`app-settings.ts` 已开始通过 adapter 收口 host 边界。
3. workbench 与 console 两个新层已经从“直接吃整对象”转向“通过 adapter 缩边界”。
4. 但 legacy 退场条件还远未满足。

因此，当前阶段应该正式判定为：

- 可以结束“第一批边界搭建”
- 不可以结束“第一批复核”
- 不可以进入“legacy 删除阶段”

## 8. 阻塞进入下一阶段的关键缺口

必须先补这五项，才能说既定计划第一阶段真正通过：

1. 把 `workspaceTeamObjects` / `workspaceTeamOrder` 迁出产品主语义，停止作为 workbench 主数据源。
2. 把 `gateway` 从 `app-gateway.ts` 继续下沉到真正可替换的 capability 边界。
3. 为 console/control 层建立独立 port state adapter，而不是继续在 `app-render.ts` 内做大对象装配。
4. 给 native legacy shell 加 feature flag / build flag 或至少 release 入口隔离。
5. 建立 import / state access 规则与 parity test，防止新耦合重新进入。

## 9. 下一步执行建议

按既定方案，下一轮不应继续盲目扩 façade，而应严格按以下顺序推进：

1. 完成 `P0-4`
   先收掉 `workspaceTeamObjects` / `workspaceTeamOrder` 的主语义地位。

2. 完成 `P0-5`
   继续把 gateway bootstrap/connect/target 边界从 `app-gateway.ts` 抽到 capability 层。

3. 完成 `P0-12`
   建立 console/control port adapter，把 `app-render.ts` 继续瘦身。

4. 完成 `P1-10`
   为 iOS/macOS legacy shell 制定可执行的退场开关。

5. 补 `Phase 1` 复核项
   加 import/state access 审核规则，并补第一批 parity test。

## 10. 最终结论

既定方案方向正确，且第一批落地没有偏航。

但如果严格按照原始计划复核，当前只能判定为：

- 已完成“第一批能力边界搭建”
- 未完成“第一批计划闭环”
- 尚不能宣称“新旧混淆问题已经被结构性解决”

现在最重要的不是继续扩写新页面，而是把第一阶段剩余的结构性缺口补齐。
