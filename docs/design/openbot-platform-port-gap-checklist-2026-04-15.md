# OpenBot Platform Port 缺口对照清单

Date: 2026-04-15

## Related Docs

- 四端 IA 总方案：[/design/openbot-four-port-ia-and-reorg-plan-2026-04-12](/design/openbot-four-port-ia-and-reorg-plan-2026-04-12)
- 平台认证与企业创建专项：[/design/openbot-platform-auth-final-registration-login-flow-2026-04-13](/design/openbot-platform-auth-final-registration-login-flow-2026-04-13)
- 四端组件复用清单：[/design/openbot-four-port-component-reuse-inventory-2026-04-15](/design/openbot-four-port-component-reuse-inventory-2026-04-15)

## 1. 文档目的

本文档只做一件事：

把平台端“方案里应有的功能”和“当前代码里实际交付的页面内容”逐项对照，明确：

1. 哪些已经完成。
2. 哪些只是摘要页 / 结构页。
3. 哪些应直接复用现有组件，不应重复开发。
4. 下一步应先补哪些真实管理内容。

## 2. 平台端最终职责

来源：`docs/design/openbot-four-port-ia-and-reorg-plan-2026-04-12.md`

平台端不是企业内部运营页，也不是运维恢复页。它的职责应稳定为：

- 跨租户平台运营
- 能力分发
- 模型策略管理
- 平台资产治理
- 高级可见性与下钻协调

平台端不应承担：

- 单租户内部主操作
- 底层运行态诊断闭环
- 恢复执行动作

## 3. 平台端最终 IA

来源：`docs/design/openbot-four-port-ia-and-reorg-plan-2026-04-12.md`

一级导航：

- Dashboard
- Tenants
- Capabilities
- Models
- Agents
- Advanced

补充：

- 按当前业务需要，`System Settings` 已作为平台管理扩展模块加入实现，用于承接管理员设置、企业创建和试用策略。

## 4. 当前实现判断

当前平台端不是“空壳”，但仍明显分成两类：

### 4.1 已开始进入真实管理态

- `platformTenants`
  - 已接入企业租户列表
  - 已接入试用与转化队列
  - 已接入前往 `platformSystemSettings` 的操作入口
- `platformAdvanced`
  - 已直接复用 `ui/src/ui/views/channels.ts`
  - 已不再只是说明型高级控制页
- `platformSystemSettings`
  - 已接入 `ui/src/ui/views/platform-auth-panel.ts`
  - 已承接管理员设置、企业创建和试用策略的统一容器

### 4.2 仍以摘要 / 结构页为主

- `platformDashboard`
- `platformCapabilities`
- `platformModels`
- `platformAgents`

这些页面目前大多还是：

- summary stats
- section grid
- workspace panel
- drill-down links

它们可以作为导航和上下文首页，但还不是实质性管理内容。

## 5. 模块逐项对照

## 5.1 Dashboard

方案应有：

- Overview
- Health
- Cost
- Attention

当前状态：

- 已实现 IA 结构。
- 主要内容仍是平台摘要、健康摘要、成本摘要和关注项摘要。
- 价值偏低，容易形成“大面积低密度 summary”。

判断：

- 可保留为平台首页。
- 但应压缩为紧凑运营入口，不应继续扩张成大量低价值卡片。

建议：

- 保留少量核心指标。
- 主体改成真实入口：
  - 租户管理
  - 系统设置
  - 通道管理
  - 模型治理
  - 平台关注项

## 5.2 Tenants

方案应有：

- Directory
- Coverage
- Activity

当前状态：

- 已进入半真实管理态。
- 已接入：
  - 企业租户列表
  - 试用与转化队列
  - 运行与覆盖工作区
  - 平台创建 / 企业自助试用说明

缺口：

- 仍缺对单租户的直接运营动作区。
- 仍缺平台端真正的“企业状态管理”和“试用特批入口”。

建议：

- 继续在本页补：
  - 企业升级
  - 企业暂停
  - 单企业试用特批
  - 激活记录 / 转化记录

优先级：高

## 5.3 Capabilities

方案应有：

- Catalog
- Installed
- Setup Health

当前状态：

- 页面结构已经对齐。
- 但主体仍是结构化 workspace 和摘要卡。
- 尚未真正接入已有 `skills.ts` 等供给/目录能力。

可复用组件：

- `ui/src/ui/views/skills.ts`
- `ui/src/ui/controllers/skills.ts`

建议：

- 直接把 `skills.ts` 接回 `Capabilities`
- 用它承接：
  - 能力目录
  - 已安装
  - 部署健康

优先级：高

## 5.4 Models

方案应有：

- Model Pool
- Policies
- Recommendations
- Overrides

当前状态：

- IA 与文案已基本对齐。
- 但主体仍是摘要和工作区，缺少真实治理内容。

相关方案要求：

- 平台端应支持平台默认试用和企业创建相关的模型/策略治理语义。
- 模型页应是“平台策略面”，不是 builder 的 provider 接入面。

建议：

- 优先回接已有配置/模型治理片段，而不是再造新卡片。
- 最少要补：
  - 模型池对象列表
  - 平台模型策略
  - 覆盖项与缺失归因处理

优先级：中高

## 5.5 Agents

方案应有：

- Fleet
- Directory
- Workspaces

当前状态：

- 已完成命名区分为“代理资产”。
- 但主体仍偏分发摘要和目录视图。
- 还没有形成真正的平台代理资产管理面。

可复用组件：

- `ui/src/ui/views/agents.ts`

注意：

- `agents.ts` 当前更偏 Builder 本体管理语义。
- Platform 不能直接把 Builder 本体页原样搬过来。
- 应只借用列表/面板能力，不复用 Builder 语义。

优先级：中

## 5.6 Advanced

方案应有：

- Channels
- Instances
- Usage
- Domains

当前状态：

- 已接回 `channels.ts`
- 已开始成为真实管理页，而不是纯摘要页

缺口：

- 还没接回：
  - 实例管理真实组件
  - 使用情况真实组件
  - 域与路由真实内容

可复用组件：

- `ui/src/ui/views/channels.ts`
- `ui/src/ui/views/usage.ts`
- `ui/src/ui/views/instances.ts`（若继续保留）

优先级：高

## 5.7 System Settings

当前业务补充要求：

- 超级管理员 / 一般管理员模型
- 平台代创建企业
- 企业自助试用规则
- 默认试用策略
- 企业级试用特批

专项方案要求：

- `POST /__openbot/platform-auth/platform/enterprise/create`
- `POST /__openbot/platform-auth/platform/enterprise/trial/policy/update`
- `POST /__openbot/platform-auth/platform/enterprise/trial/instance/update`
- `POST /__openbot/platform-auth/platform/enterprise/upgrade`
- `POST /__openbot/platform-auth/platform/enterprise/suspend`

当前状态：

- 已新增 `System Settings`
- 已接入 `platform-auth-panel`
- 已开始承接：
  - 管理员设置
  - 企业创建
  - 试用策略

判断：

- 这是当前平台端最接近真实管理页的模块之一。
- 后续不应再把这些内容放回 `Tenants` 或 `Dashboard`。

优先级：最高

## 6. 平台端现有真实组件复用路径

优先复用，不重复开发：

| 平台模块        | 应复用组件                                                                                | 当前状态     |
| --------------- | ----------------------------------------------------------------------------------------- | ------------ |
| Tenants         | `ui/src/ui/views/platform-auth-panel.ts`（只承接创建链路入口，不直接承载主面）            | 已部分接入   |
| Capabilities    | `ui/src/ui/views/skills.ts`                                                               | 未接回       |
| Models          | `ui/src/ui/views/config.ts` 的模型相关片段 / 既有模型配置链路                             | 未接回       |
| Agents          | `ui/src/ui/views/agents.ts` 的局部能力                                                    | 未接回       |
| Advanced        | `ui/src/ui/views/channels.ts`, `ui/src/ui/views/usage.ts`, `ui/src/ui/views/instances.ts` | 已接回一部分 |
| System Settings | `ui/src/ui/views/platform-auth-panel.ts`                                                  | 已接回       |

## 7. 结论

当前平台端最大问题不是“没导航”，而是：

- `Dashboard / Capabilities / Models / Agents` 仍偏摘要页
- 只有 `Tenants / Advanced / System Settings` 开始进入真实管理态

因此平台端下一阶段不应继续泛改布局，而应直接做“真实内容回接”。

## 8. 下一步实施顺序

建议顺序：

1. `platformSystemSettings`
   - 补齐平台管理员管理、企业创建、试用策略、企业级特批
2. `platformAdvanced`
   - 继续回接 `usage.ts`、`instances.ts`
3. `platformCapabilities`
   - 直接接回 `skills.ts`
4. `platformTenants`
   - 补企业升级 / 暂停 / 特批入口
5. `platformModels`
   - 补模型池、策略、覆盖项真实治理内容
6. `platformDashboard`
   - 最后收缩成紧凑入口页，不再继续扩成摘要大卡页
