# OpenBot 四端现有组件复用清单（2026-04-15）

## 目的

本清单用于回答一个核心问题：

- 当前四端很多页面只呈现了模块化结构，哪些“真实管理内容”其实已经存在？
- 后续应优先复用哪些现有组件，而不是重复开发？
- 哪些模块只需要优化布局与衔接，哪些模块才需要新增实现？

本清单是四端后续接入与优化的执行基线。后续实施必须遵守：

1. 先复用现有真实组件。
2. 再优化现有 surface。
3. 只有在仓库中确实不存在对应能力时，才新增页面或新组件。

## 当前判断

当前代码基线的真实状态不是“都没做”，而是：

- 导航、端口壳层、路由已经基本完成。
- 很多真实管理组件仍保留在 `ui/src/ui/views/*` 或旧控制台拼装链路里。
- 四端 `surface` 页面里存在较多“结构化分区 + 工作区”包装层。
- 问题的根本不是缺页面壳，而是没有优先把已有真实管理内容重新接回四端模块。

因此，下一阶段不应继续大规模新建页面，而应执行“组件回接 + 布局压缩 + 语义收口”。

## 一、现有可直接复用的真实组件

### 1. 平台鉴权与企业创建

| 组件                               | 文件                                     | 已有能力                                                                                   | 建议                               |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------- |
| 平台鉴权/平台管理员/企业创建总面板 | `ui/src/ui/views/platform-auth-panel.ts` | 平台超级管理员登录、一般管理员登录、平台代创建企业、平台管理员管理、试用策略、企业实例策略 | 直接复用，不再重复造表单           |
| 认证首页                           | `ui/src/ui/views/auth-home.ts`           | 公开登录、自助试用、企业激活、平台管理员入口                                               | 保留为首页认证入口，不移入各端内部 |

### 2. 运维与控制类真实组件

| 组件               | 文件                          | 已有能力                   | 建议                                                           |
| ------------------ | ----------------------------- | -------------------------- | -------------------------------------------------------------- |
| 通道管理           | `ui/src/ui/views/channels.ts` | 通道列表、通道配置与管理   | 回接到 `platformAdvanced` 或 `enterpriseSettings` 的对应管理区 |
| 会话管理           | `ui/src/ui/views/sessions.ts` | 会话列表、运行会话内容     | 回接到 `opsRuntime`                                            |
| 节点/设备/审批管理 | `ui/src/ui/views/nodes.ts`    | 节点、设备绑定、执行审批   | 回接到 `opsRuntime` 或 `opsRecovery`                           |
| 配置管理           | `ui/src/ui/views/config.ts`   | 配置表单、保存、应用、更新 | 回接到 `opsRecovery` 或 `platformSystemSettings` 的配置区      |
| 调试/RPC           | `ui/src/ui/views/debug.ts`    | 调试调用与只读权限控制     | 回接到 `opsDiagnostics`                                        |
| 日志               | `ui/src/ui/views/logs.ts`     | 日志检索与展示             | 回接到 `opsLogs`                                               |
| 使用情况           | `ui/src/ui/views/usage.ts`    | 使用概览、洞察、时段明细   | 优先回接到 `enterpriseUsage`，再评估 `platformAdvanced` 复用   |

### 3. 供给侧真实组件

| 组件     | 文件                        | 已有能力                           | 建议                                                                            |
| -------- | --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| 代理管理 | `ui/src/ui/views/agents.ts` | 代理配置、文件、工具、技能面板     | Builder 端直接复用，Platform/Enterprise 仅借用局部面板语义，不复制 Builder 本体 |
| 技能管理 | `ui/src/ui/views/skills.ts` | 技能列表、编辑、安装检查、消息状态 | Builder 端直接复用                                                              |

## 二、四端模块复用盘点

## Platform 端

### 模块结论

| 模块                     | 当前状态                  | 已有真实内容                                     | 结论                                     |
| ------------------------ | ------------------------- | ------------------------------------------------ | ---------------------------------------- |
| `platformDashboard`      | 自定义 surface            | 平台总览读模型已接入                             | 优化现有实现，不重做                     |
| `platformTenants`        | 已进入半真实管理态        | 企业目录、激活记录、系统设置跳转已接入           | 继续深化，不重做                         |
| `platformCapabilities`   | 结构化 surface 为主       | 暂无独立通用管理组件                             | 保留现有 surface，后续只补对象级管理内容 |
| `platformModels`         | 结构化 surface 为主       | 可复用部分 `usage` / provider 配置语义           | 保留现有 surface，避免另起新页           |
| `platformAgents`         | 结构化 surface + 资产视角 | 可借用 `agents.ts` 的部分面板概念                | 不重复造 Builder 式代理页                |
| `platformAdvanced`       | 结构化 surface 为主       | `channels.ts`、`usage.ts`、会话/实例相关已有组件 | 优先回接旧组件                           |
| `platformSystemSettings` | 已有真实管理内容          | `platform-auth-panel.ts` 已直接接入              | 直接深化，不重做                         |

### 必须优先复用的点

1. `platformSystemSettings`
   - 已经直接使用 `renderPlatformAuthPanel(...)`。
   - 后续所有平台管理员、企业创建、试用策略相关改造都必须在这条链上继续，不允许新建第二套表单。

2. `platformAdvanced`
   - `通道` 应优先回接 `ui/src/ui/views/channels.ts`
   - `使用情况` 应优先回接 `ui/src/ui/views/usage.ts`
   - `实例/运行态` 应优先借用 `sessions.ts` / `nodes.ts` 的现有管理内容

3. `platformTenants`
   - 当前已经接入租户目录与激活记录。
   - 后续仅补“真实列表动作”和“转化动作”，不应再造新的目录页。

### Platform 端后续建议

- `Tenants`：在现有租户列表上补筛选、状态动作、转化动作。
- `Advanced`：优先把 `channels.ts`、`usage.ts`、实例/节点管理内容回接进来。
- `System Settings`：继续承接平台管理员管理与企业创建，不再把这些能力分散回 `Tenants`。

## Enterprise 端

### 模块结论

| 模块                     | 当前状态                               | 已有真实内容                                       | 结论                                  |
| ------------------------ | -------------------------------------- | -------------------------------------------------- | ------------------------------------- |
| `enterpriseOverview`     | 自定义 surface                         | 首页四块、下钻链路已存在                           | 优化现有实现，不重做                  |
| `enterpriseOrganization` | 自定义 surface，已有交接/席位/角色动作 | 企业成员、席位、交接案例编辑已存在                 | 直接深化，不重做                      |
| `enterpriseAgents`       | 自定义 surface                         | 默认代理、团队代理、模板工作区已存在               | 继续深化，不重做                      |
| `enterpriseMesh`         | 自定义 surface                         | 成员、群组、运行态、事故升级队列已存在             | 继续深化，不重做                      |
| `enterpriseUsage`        | 自定义 surface                         | 可复用 `usage.ts` 的使用洞察与细节能力             | 现有页保留，优先回接 `usage` 真实内容 |
| `enterpriseSettings`     | 自定义 surface                         | 部分可借用 `platform-auth-panel.ts`、`channels.ts` | 继续接入真实配置内容，不重做          |

### Enterprise 端必须避免的重复开发

1. 不要重做 `Organization`
   - 该页已经包含成员、岗位席位、交接治理、角色与权限工作区。
   - 还包含交接编辑器与真实动作。
   - 后续应在这个页面内继续补列表和管理密度，而不是另起“企业用户管理页”。

2. 不要重做 `Mesh`
   - 该页已经具备成员、群组、运行态、事故升级的关系页基础。
   - 后续应继续强化对象关系与 drill-down，而不是再造第二套机巢视图。

3. 不要在无租户态做“完整管理页”
   - 无租户态只保留轻量模块预览与 gating。
   - 真实管理操作只在 tenant-bound 路由中展示。

### Enterprise 端优先复用方向

- `enterpriseUsage`：优先回接 `ui/src/ui/views/usage.ts` 中的真实洞察和明细展示。
- `enterpriseSettings`：优先回接 `channels.ts` 和平台鉴权面板中的可复用配置段，而不是新写一套配置表单。

## Ops 端

### 模块结论

| 模块             | 当前状态            | 已有真实内容                                 | 结论                             |
| ---------------- | ------------------- | -------------------------------------------- | -------------------------------- |
| `opsIncidents`   | 自定义 surface 聚合 | 已有日志、配置问题、恢复任务数据             | 保留当前页，继续增加真实问题列表 |
| `opsRuntime`     | 自定义 surface 包装 | `sessions.ts`、`nodes.ts` 已存在真实管理内容 | 优先回接现有组件                 |
| `opsLogs`        | 自定义 surface 包装 | `logs.ts` 已存在真实管理内容                 | 优先回接现有组件                 |
| `opsDiagnostics` | 自定义 surface 包装 | `debug.ts` 已存在真实调试内容                | 优先回接现有组件                 |
| `opsRecovery`    | 自定义 surface 包装 | `config.ts`、`nodes.ts`、恢复相关动作已存在  | 优先回接现有组件                 |

### 明确可复用的现有 props 链

`ui/src/ui/ports/ops/view-types.ts` 已经明确保存了这些真实组件所需 props：

- `sessionsProps`
- `nodesProps`
- `configProps`
- `debugProps`
- `logsProps`

这说明当前真正缺的不是数据或组件，而是没有在 `ops-shell` 中直接优先渲染这些已有真实组件。

### Ops 端后续建议

1. `opsRuntime`
   - 直接回接 `renderSessions(...)` 与 `renderNodes(...)`
2. `opsLogs`
   - 直接回接 `renderLogs(...)`
3. `opsDiagnostics`
   - 直接回接 `renderDebug(...)`
4. `opsRecovery`
   - 直接回接 `renderConfig(...)`，并结合节点/恢复动作

结论：Ops 端后续原则是“减少 surface 包装，优先重新暴露已有运维组件”。

## Builder 端

### 模块结论

| 模块       | 当前状态               | 已有真实内容                      | 结论         |
| ---------- | ---------------------- | --------------------------------- | ------------ |
| `skills`   | 已直接复用真实组件     | `renderSkills(model.skillsProps)` | 保持，不重做 |
| `agents`   | 已直接复用真实组件     | `renderAgents(model.agentsProps)` | 保持，不重做 |
| `tools`    | 自定义 builder surface | 已有工具目录与工作区数据          | 优化现有实现 |
| `models`   | 自定义 builder surface | 已有 provider/config/binding 数据 | 优化现有实现 |
| `releases` | 自定义 builder surface | 已有版本/部署/变更数据            | 优化现有实现 |

### 已经直接复用的事实

`ui/src/ui/ports/builder/views/builder-shell.ts` 中已经明确：

- `skills` -> `renderSkills(model.skillsProps)`
- `agents` -> `renderAgents(model.agentsProps)`

因此 Builder 端的 `skills` 与 `agents` 绝对不能重复开发。

### Builder 端后续建议

- 仅继续压缩页首 summary，增强工具/模型/发布的真实操作密度。
- 不再为 `skills`、`agents` 另造新的“Builder 专属管理页”。

## 三、重复开发禁止清单

后续实施中，以下内容禁止重复开发：

1. 不再重复开发平台管理员、企业创建、试用策略表单
   - 统一复用 `ui/src/ui/views/platform-auth-panel.ts`

2. 不再重复开发 Builder 的技能和代理编辑页
   - 统一复用 `ui/src/ui/views/skills.ts`
   - 统一复用 `ui/src/ui/views/agents.ts`

3. 不再重复开发 Ops 的会话、节点、配置、调试、日志页
   - 统一回接：
     - `ui/src/ui/views/sessions.ts`
     - `ui/src/ui/views/nodes.ts`
     - `ui/src/ui/views/config.ts`
     - `ui/src/ui/views/debug.ts`
     - `ui/src/ui/views/logs.ts`

4. 不再为 Enterprise 的 `Organization / Agents / Mesh / Usage / Settings` 另建第二套页面
   - 现有 `enterprise-surfaces.ts` 已是主线，只允许增强和回接，不允许复制。

## 四、布局优化原则

当前四端存在一个共同问题：页首纵向大卡过高、占用过大。

已定原则：

1. 所有页首 summary 优先使用横向摘要条。
2. 不允许在同一页里出现：
   - 页面标题区
   - 再来一张重复标题的大 summary 卡
   - 再来一层重复分区说明
3. 无租户态只保留一层 gating，不允许“租户选择器 + 模块预览”双层大块叠加。

## 五、后续实施顺序

后续不要再按“从零做页面”推进，而应按下面顺序执行：

### Phase 1：组件回接

1. `platformAdvanced`
   - 回接 `channels.ts`
   - 回接 `usage.ts`
   - 回接运行态相关已有组件

2. `opsRuntime / opsLogs / opsDiagnostics / opsRecovery`
   - 直接回接：
     - `sessions.ts`
     - `nodes.ts`
     - `logs.ts`
     - `debug.ts`
     - `config.ts`

3. `enterpriseUsage / enterpriseSettings`
   - 优先回接 `usage.ts` 与配置相关已有组件

### Phase 2：现有页深化

1. `platformTenants`
   - 补真实列表动作、筛选、状态管理
2. `platformSystemSettings`
   - 深化管理员设置、企业创建、试用策略
3. `enterpriseOrganization`
   - 提升成员、席位、交接管理的真实操作密度

### Phase 3：最后才补新内容

只有在完成上述回接后，仍缺失某项独立业务能力时，才允许新增组件。

## 六、执行规则

从本清单开始，四端后续开发必须遵守：

- 先查 `ui/src/ui/views/*`
- 再查当前端口 `surface`
- 确认仓库里不存在后，才新增页面或新组件

任何新增页面前，都必须先回答：

1. 仓库里是否已有对应真实组件？
2. 当前是否只是没有接入，而不是没有实现？
3. 是否可以通过回接与布局优化解决？

如果答案是“可以回接”，则禁止重复开发。
