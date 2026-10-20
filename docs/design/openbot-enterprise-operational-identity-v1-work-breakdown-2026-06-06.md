# OpenBot 企业运营身份 V1.0 研发任务拆解表（2026-06-06）

关联主方案：

- `docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md`
- `docs/design/openbot-position-asset-management-work-breakdown-2026-06-04.md`
- `docs/design/connector-action-versioning.md`
- `docs/design/openbot-openclaw-ui-current-state-audit-and-task-plan-2026-04-10.md`

## 文档定位

本文用于把“Enterprise Operational Identity V1.0（基于现有 OpenBot 治理体系）”落成可排期、可指派、可验收的研发任务。

本文明确不做两件事：

1. 不重新设计一套独立的 Identity 平台。
2. 不引入绕过现有 `Seat -> Grant -> Governance` 的第二套执行授权模型。

本文默认以下事实已经在当前仓库中成立：

1. 企业设置中心已经存在，但目前仍以读模型和占位动作为主。
2. `Seat` 已经是企业侧最可信的执行主体。
3. `connectorProfiles`、`credentialBindings`、`channelAccounts` 已经构成现有凭证底座。
4. 企业数据治理中心已经冻结“执行授权层”和“消费可见性层”双层模型。

## 冻结执行结论

本轮方案名称统一调整为：

## Enterprise Operational Identity V1.0

中文名称建议冻结为：

**企业运营身份 V1.0**

它的定位不是“企业数据身份平台”，而是：

- 管理企业对外执行身份
- 治理这些身份的使用边界
- 让 Agent、DataSource、企业设置页复用同一套运营身份目录

## 必须冻结的架构原则

### 原则 1：`Seat` 仍是权威执行主体

- `Seat` 是执行授权主体
- `Agent` 是消费主体和执行别名
- `Agent` 不能真正拥有企业运营身份
- `Agent` 只能在被允许时代表某个 `Seat` 使用企业运营身份

### 原则 2：`Operational Identity != Data Access Identity`

允许：

- 企业公众号 -> 发布文章
- 企业邮箱 -> 发送邮件
- GitHub Org -> 创建 Issue / Comment
- 飞书 / 钉钉 / 企业微信 -> 发送消息

不允许：

- 公众号身份 -> CRM 查询
- 飞书身份 -> 绕过 Seat 直接访问企业数据
- 企业邮箱身份 -> 直接获得 `ConnectorAction@version`

企业数据访问仍然必须遵循：

`Seat -> SeatActionGrant -> Enterprise Data Gateway`

### 原则 3：不创建第三套 Credential 体系

本轮新增的是：

- `Identity Domain`

本轮不新增：

- 新的 `Credential Domain`

必须复用现有对象：

- `credentialBindings`
- `connectorProfiles`
- `channelAccounts`

### 原则 4：`DataSourceIdentityBinding` 表达“连接关系”，不表达“数据权限”

它只表示：

- 哪个企业运营身份帮助某个 `DataSource` 建立认证、采集或同步关系

它不表示：

- 某个企业运营身份因此获得数据访问授权

### 原则 5：企业设置中心只做增强，不新造一套后台

本轮只允许增强现有企业设置 surface，不允许复制一套新页面。

当前主入口仍然是：

- `ui/src/ui/ports/enterprise/views/enterprise-access-control-surface.ts`

## 当前代码现状约束

### 1. 企业设置中心已存在，但还不是完整可写配置中心

现有企业设置页已经有：

- `企业信息`
- `管理员与权限`
- `集成与密钥`
- `策略与治理`
- `审计与安全`

但当前很多设置动作仍只是 `loadOverview()` 刷新或“等待接入正式提交接口”的占位实现。

### 2. 当前可信成员角色仍然很窄

当前权威成员角色只有：

- `enterprise-admin`
- `member`

UI 里的 `admin / operator / viewer` 只是推导视图，不是权威后端 RBAC。

### 3. 企业侧已存在可复用的身份/凭证近邻模型

当前已有：

- `EnterpriseConnectorCredentialBinding`
- `EnterpriseConnectorProfileSnapshot`
- `EnterpriseSeatAssetBinding`

它们位于：

- `src/gateway/enterprise-seat-assets-store.ts`
- `src/gateway/enterprise-seat-assets-governance.ts`

### 4. 企业数据治理已经冻结了 Seat 边界

当前企业数据执行上下文会强制解析：

- `tenantId`
- `seatId`
- `employeeId`
- `teamLabel`
- `roleCode`

并禁止客户端覆写这些字段。

### 5. Provider 覆盖范围不均衡

当前仓库内直接存在或明显可复用的企业运营身份相关能力：

| Provider   | 当前现状                                                        | V1 结论       |
| ---------- | --------------------------------------------------------------- | ------------- |
| Feishu     | 已有企业通道插件                                                | `P0` 接入     |
| WeCom      | 已有企业通道插件                                                | `P0` 接入     |
| DingTalk   | 已有企业通道插件                                                | `P0` 接入     |
| 企业邮箱   | 现有 Gmail hook / SMTP 通知链可复用，但不是完整独立企业邮箱平台 | `P0` 限定接入 |
| 微信个人号 | 现有 `wechat` 插件是个人微信代理，不等于公众号/视频号           | 不进入 `P0`   |
| GitHub Org | 当前只有 GitHub Copilot / GitHub 远程能力，不是企业运营身份     | `P2`          |
| Jira       | 仓库内暂无内建企业运营连接器                                    | `P2`          |
| Notion     | 文档明确非内建能力                                              | `P2`          |

## V1 范围

### 本轮进入范围

1. 企业运营身份领域模型
2. 身份使用策略
3. 数据源身份绑定
4. 身份审计
5. 企业设置页新增“企业身份与数字账户”
6. 与现有 Seat / Agent / DataSource 的最小联动
7. 首批 Provider：
   - 飞书
   - 企业微信
   - 钉钉
   - 企业邮箱（限定版）

### 本轮不进入范围

1. 独立 Identity Provider 管理平台
2. 与企业数据访问合并的统一权限模型
3. 公众号 / 视频号 / 微博 / 知乎 / GitHub Org / Jira / Notion 的完整接入
4. 细粒度部门主管审批链
5. 把 `Agent` 变成独立的权威授权主体

## V1 核心模型（冻结建议）

```ts
type EnterpriseIdentityStatus = "active" | "expired" | "reauth_required";

type EnterpriseIdentity = {
  identityId: string;
  tenantId: string;
  provider: string;
  displayName: string;
  credentialBindingId: string;
  connectorProfileId?: string;
  externalAccountId?: string;
  status: EnterpriseIdentityStatus;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt?: string;
  expiresAt?: string;
};
```

```ts
type IdentityUsagePolicy = {
  policyId: string;
  tenantId: string;
  identityId: string;
  seatIds: string[];
  allowedAgentIds: string[];
  allowedActions: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
```

```ts
type DataSourceIdentityBindingPurpose =
  | "source_authentication"
  | "source_collection"
  | "source_sync";

type DataSourceIdentityBinding = {
  bindingId: string;
  tenantId: string;
  identityId: string;
  dataSourceId: string;
  purpose: DataSourceIdentityBindingPurpose;
  createdAt: string;
  updatedAt: string;
};
```

### 模型语义冻结

1. `EnterpriseIdentity` 只描述运营身份目录，不保存新凭证副本。
2. `credentialBindingId` 必须指向现有凭证绑定。
3. `connectorProfileId` 仅在存在 Seat/Connector profile 快照时挂接。
4. `IdentityUsagePolicy.seatIds` 是权威允许列表。
5. `allowedAgentIds` 只用于“Seat 下哪些 Agent 可以消费该身份”，不能替代 `seatIds`。
6. `allowedActions` 必须是显式白名单，不能留成隐式“全量允许”。

## 存储与迁移策略

V1 建议直接扩展现有 `EnterpriseSeatAssetsStore`，而不是另开第三套企业存储。

建议新增顶层记录：

- `enterpriseIdentities`
- `identityUsagePolicies`
- `dataSourceIdentityBindings`

建议继续复用现有审计写入底座：

- `src/gateway/enterprise-seat-assets-audit.ts`

### 存储版本注意事项

当前 `EnterpriseSeatAssetsStore` 版本仍是 `2`。

但 `docs/design/connector-action-versioning.md` 也计划占用下一次 store 升级。

因此本轮必须冻结一条规则：

1. 不假设 `v3` 一定空闲。
2. 实施前先检查 connector-action 迁移是否已落地。
3. 如 connector-action 先落地，则企业运营身份使用下一个可用版本号。
4. `scripts/migrate-enterprise-seat-assets-to-sqlite.ts` 必须同步升级。

## 交付方式

建议拆成 4 个里程碑和 1 个保留阶段：

| 里程碑 | 范围     | 目标                                                              |
| ------ | -------- | ----------------------------------------------------------------- |
| `M0`   | 方案冻结 | 冻结边界、模型、Provider 范围、存储落点                           |
| `M1`   | `P0`     | Identity Domain、Policy、Audit、Settings UI 基础接通              |
| `M2`   | `P1`     | Agent / DataSource 联动落地，形成 Operational Identity Governance |
| `M3`   | `P2`     | 扩展第二批 Provider 与更细运营动作                                |
| `M4`   | Next     | 审批深化、更多企业系统、统一治理分析                              |

## 角色分工建议

| 角色           | 负责范围                                        |
| -------------- | ----------------------------------------------- |
| 后端负责人     | Store、领域模型、审计、路由、绑定校验           |
| 企业数据负责人 | `DataSourceIdentityBinding`、治理视图、边界校验 |
| 前端负责人     | 企业设置页身份区、Agent/数据源详情联动          |
| 联调负责人     | Provider 可用性、重授权、跨 surface 验证        |
| 测试负责人     | 集成测试、回归矩阵、越权负例                    |
| 架构负责人     | 边界冻结、版本冲突控制、非范围需求拦截          |

## 当前高风险代码点

### Identity Domain / 存储

- `src/gateway/enterprise-seat-assets-store.ts`
- `src/gateway/enterprise-seat-assets-backend.ts`
- `src/gateway/enterprise-seat-assets-audit.ts`
- `scripts/migrate-enterprise-seat-assets-to-sqlite.ts`

### 企业设置 UI

- `ui/src/ui/ports/enterprise/views/enterprise-access-control-surface.ts`
- `ui/src/ui/ports/enterprise/semantic/enterprise-read-model.ts`
- `ui/src/ui/ports/enterprise/render-model.ts`
- `ui/src/ui/ports/enterprise/render-actions.ts`

### Agent / Seat / Organization

- `ui/src/ui/ports/enterprise/views/enterprise-organization-surface.ts`
- `src/shared/domain/agent.ts`
- `src/gateway/control-ui-contract.ts`

### Enterprise Data 边界

- `src/gateway/enterprise-data/enterprise-data-seat-context.ts`
- `src/gateway/enterprise-data/types.ts`
- `src/gateway/server-methods/enterprise-data-m2.ts`
- `src/gateway/server-methods/enterprise-data-m3.ts`

## M0：冻结输出

本阶段不改业务行为，只产出冻结结果。

### 任务清单

| ID     | 任务                      | 产出                                                                              | 负责人    |
| ------ | ------------------------- | --------------------------------------------------------------------------------- | --------- |
| `M0-1` | 冻结 Identity Domain 边界 | 明确“运营身份”与“数据访问身份”分离说明                                            | 架构      |
| `M0-2` | 冻结三个核心模型          | `EnterpriseIdentity` / `IdentityUsagePolicy` / `DataSourceIdentityBinding` 字段表 | 架构/后端 |
| `M0-3` | 冻结 Provider 分期        | `P0 / P1 / P2` provider 名单与限制说明                                            | 产品/架构 |
| `M0-4` | 冻结存储落点与版本策略    | 明确扩展 `EnterpriseSeatAssetsStore`，并写明版本协调规则                          | 后端      |
| `M0-5` | 冻结 UI 入口              | 确定仅增强现有企业设置页，不新增独立后台                                          | 前端/架构 |

### 完成定义

1. 三个核心模型字段冻结。
2. Provider 范围冻结。
3. 版本冲突策略冻结。
4. 非范围项写入文档并在排期中移除。

## M1：`P0` Identity Domain + Settings UI

目标：

- 先把企业运营身份域做成真正可存储、可审计、可展示、可校验的企业能力。
- 首批只接已存在或明显可复用的 Provider。

### 后端任务

| ID        | 任务                                  | 涉及文件                                                                                                                             | 产出                                                                                        | 依赖                 |
| --------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------- |
| `P0-BE-1` | 扩展 `EnterpriseSeatAssetsStore`      | `src/gateway/enterprise-seat-assets-store.ts`, `src/gateway/enterprise-seat-assets-backend.ts`                                       | 新增 `enterpriseIdentities` / `identityUsagePolicies` / `dataSourceIdentityBindings`        | `M0-2`               |
| `P0-BE-2` | 增加 store 迁移与 SQLite 迁移步骤     | `scripts/migrate-enterprise-seat-assets-to-sqlite.ts`                                                                                | JSON / SQLite 迁移可兼容旧版本                                                              | `P0-BE-1`, `M0-4`    |
| `P0-BE-3` | Identity CRUD Store helper            | 同上或新增 `src/gateway/enterprise-operational-identity-store.ts`                                                                    | 身份按 `credentialBindingId` / `connectorProfileId` 校验创建                                | `P0-BE-1`            |
| `P0-BE-4` | IdentityUsagePolicy 校验与解析 helper | 新增 `src/gateway/enterprise-operational-identity-policy.ts`                                                                         | `seatIds` 为权威门，`allowedAgentIds` 为消费限制                                            | `M0-1`               |
| `P0-BE-5` | Identity 审计事件接入现有审计底座     | `src/gateway/enterprise-seat-assets-audit.ts`, `src/gateway/enterprise-seat-assets-store.ts`                                         | 新增 `identity.registered / reauthorized / revoked / bound / unbound / used / usage_denied` | `P0-BE-1`            |
| `P0-BE-6` | 新增企业运营身份 HTTP/RPC 接口        | 新增 `src/gateway/enterprise-operational-identity.ts`, 更新 `src/gateway/control-ui.ts`                                              | 企业管理员可增删改查身份和策略                                                              | `P0-BE-3`, `P0-BE-4` |
| `P0-BE-7` | Provider 适配层只做首批 Provider      | `extensions/feishu/**`, `extensions/wecom/**`, `extensions/dingtalk/**`, `src/hooks/gmail*.ts`, `src/gateway/platform-auth-email.ts` | 形成最小身份映射规则和状态探测                                                              | `M0-3`               |
| `P0-BE-8` | 增加租户隔离与越权负例                | `src/gateway/enterprise-seat-assets.test.ts` 或新增 identity 测试                                                                    | 防止跨租户、跨 Seat、空凭证、假 agentId                                                     | `P0-BE-6`            |

### 前端任务

| ID        | 任务                                           | 涉及文件                                                                                                                                 | 产出                                                                       | 依赖      |
| --------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------- |
| `P0-FE-1` | 在企业设置中心新增“企业身份与数字账户” section | `ui/src/ui/ports/enterprise/views/enterprise-access-control-surface.ts`                                                                  | 新 section 出现在 settings hub 和详情区                                    | `M0-5`    |
| `P0-FE-2` | 增加身份目录读模型                             | `ui/src/ui/ports/enterprise/semantic/enterprise-read-model.ts`                                                                           | 提供 `identityCount / providerCounts / identitySummaries / identityAlerts` | `P0-BE-6` |
| `P0-FE-3` | 增加前端状态与 actions                         | `ui/src/ui/ports/enterprise/port-state.ts`, `ui/src/ui/ports/enterprise/action-state.ts`, `ui/src/ui/ports/enterprise/render-actions.ts` | 身份列表刷新、创建、停用、重授权入口                                       | `P0-BE-6` |
| `P0-FE-4` | 新增身份控制器                                 | 新增 `ui/src/ui/controllers/enterprise-operational-identity.ts`                                                                          | 复用现有 enterprise tenant session 与同域请求                              | `P0-BE-6` |
| `P0-FE-5` | 在 settings surface 展示四类视图               | `ui/src/ui/ports/enterprise/views/enterprise-access-control-surface.ts`                                                                  | 企业官方账号、企业通信身份、企业业务身份、Agent 授权关系                   | `P0-FE-2` |
| `P0-FE-6` | Provider 状态提示与空态文案                    | 同上                                                                                                                                     | 标出 `active / expired / reauth_required`、过期提醒、未绑定提醒            | `P0-BE-7` |

### 测试任务

| ID        | 任务                       | 产出                                                |
| --------- | -------------------------- | --------------------------------------------------- |
| `P0-QA-1` | 身份创建/更新/停用集成测试 | 同 tenant 成功，跨 tenant 拒绝                      |
| `P0-QA-2` | 凭证复用测试               | 新身份不产生新凭证副本                              |
| `P0-QA-3` | Seat/Agent 策略校验测试    | 无 `seatId` 不允许，仅 `allowedAgentIds` 不足以授权 |
| `P0-QA-4` | 首批 Provider 状态探测测试 | 缺 Secret、缺 Token、需重授权时状态正确             |
| `P0-QA-5` | 企业设置 UI 渲染测试       | section、列表、状态 badge、空态可见                 |

### M1 验收标准

1. 企业管理员能在企业设置页看到并管理企业运营身份目录。
2. 身份必须绑定到现有凭证记录，不允许生成新的凭证副本字段。
3. 身份使用策略中，`Seat` 必须是一等公民。
4. 所有身份变更都会进入企业侧审计。

## M2：`P1` Agent / DataSource 联动

目标：

- 把企业运营身份从“目录”升级成“可治理使用关系”。
- 明确它和 Agent、DataSource 的联动方式，但不突破企业数据治理边界。

### 后端任务

| ID        | 任务                                                                        | 涉及文件                                                                                                     | 产出                                                                    | 依赖                 |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------- |
| `P1-BE-1` | 增加 Operational Identity Access 解析器                                     | 新增 `src/gateway/enterprise-operational-identity-access.ts`                                                 | 运行时判断“某 Seat 下的某 Agent 能否执行某 identity action”             | `P0-BE-4`            |
| `P1-BE-2` | 增加身份使用审计写入                                                        | `src/gateway/enterprise-seat-assets-audit.ts`                                                                | 记录 `identity.used` / `identity.usage_denied`                          | `P1-BE-1`            |
| `P1-BE-3` | 增加 DataSourceIdentityBinding 读写接口                                     | `src/gateway/server-methods/enterprise-data-m2.ts` 或新增 server-methods 文件                                | 支持 `source_authentication / source_collection / source_sync` 三种用途 | `P0-BE-1`            |
| `P1-BE-4` | 在 `enterprise-data.sources.governance-view` 中返回绑定身份摘要             | `src/gateway/server-methods/enterprise-data-m2.ts`, `src/gateway/enterprise-data/access-governance-store.ts` | DataSource 详情可显示“关联身份”                                         | `P1-BE-3`            |
| `P1-BE-5` | 增加 runtime hard guard                                                     | `src/gateway/enterprise-data/enterprise-data-seat-context.ts`                                                | 明确企业运营身份绝不能注入 `EnterpriseDataInvokeContext`                | `M0-1`               |
| `P1-BE-6` | 对 Agent 侧只暴露 Operational Identity Access，不暴露 Data Access Elevation | 新增或更新 agent runtime helper                                                                              | 防止把 identity 当作数据访问 token                                      | `P1-BE-1`, `P1-BE-5` |

### 前端任务

| ID        | 任务                                                        | 涉及文件                                                                                                                                | 产出                                         |
| --------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `P1-FE-1` | 在身份详情中展示 Seat / Agent 使用策略                      | `ui/src/ui/ports/enterprise/views/enterprise-access-control-surface.ts`                                                                 | 可见哪些 Seat、哪些 Agent、哪些动作被允许    |
| `P1-FE-2` | 在岗位/Agent 关系最清晰的页面挂 Operational Identity Access | `ui/src/ui/ports/enterprise/views/enterprise-organization-surface.ts`                                                                   | 先在当前组织/岗位 surface 落地，不新建 tab   |
| `P1-FE-3` | 在 DataSource 详情页增加“关联身份”                          | 对应 enterprise-data 前端视图                                                                                                           | 可见身份名称、Provider、用途、状态           |
| `P1-FE-4` | 在企业设置页增加使用关系图谱摘要                            | `ui/src/ui/ports/enterprise/semantic/enterprise-read-model.ts`, `ui/src/ui/ports/enterprise/views/enterprise-access-control-surface.ts` | 可见“身份 -> Seat / Agent / DataSource” 摘要 |

### 测试任务

| ID        | 任务                           | 产出                                                      |
| --------- | ------------------------------ | --------------------------------------------------------- |
| `P1-QA-1` | Agent 使用运营身份的正负例测试 | 允许的 Seat+Agent+Action 通过，其余拒绝                   |
| `P1-QA-2` | 运营身份与数据访问边界测试     | identity 不得影响 `enterprise-data.invoke` 的 seat 上下文 |
| `P1-QA-3` | DataSource 身份绑定测试        | 绑定仅改变数据源连接关系，不产生 SeatActionGrant          |
| `P1-QA-4` | 审计联通测试                   | 能查到 bind / unbind / used / usage_denied 全链           |

### M2 验收标准

1. Agent 侧看到的是 `Operational Identity Access`，不是 `Execution Identity`。
2. DataSource 详情能显示绑定身份及用途。
3. 企业运营身份无法穿透企业数据治理边界。
4. 身份使用成功和拒绝都能被审计回放。

## M3：`P2` 第二批 Provider 扩展

目标：

- 在 V1 已稳定的前提下，扩展更多企业运营身份 Provider。

### 第二批建议名单

1. 公众号
2. 视频号
3. GitHub Org
4. Jira
5. Notion

### 后端任务

| ID        | 任务                                                 | 涉及文件                               | 产出                               |
| --------- | ---------------------------------------------------- | -------------------------------------- | ---------------------------------- |
| `P2-BE-1` | 为第二批 Provider 增加 adapter contract              | 新增 provider adapter 目录             | 状态探测、动作映射、重授权入口统一 |
| `P2-BE-2` | 为 GitHub Org / Jira / Notion 增加最小身份动作白名单 | 对应 provider / extension / skill 入口 | 只开放显式运营动作                 |
| `P2-BE-3` | 为公众号/视频号定义身份能力边界                      | 新增 provider adapter / docs           | 区分“发布运营动作”与“数据同步动作” |

### 前端任务

| ID        | 任务                                     | 涉及文件                                                                | 产出               |
| --------- | ---------------------------------------- | ----------------------------------------------------------------------- | ------------------ |
| `P2-FE-1` | 在企业设置页扩展 Provider 分组和状态提示 | `ui/src/ui/ports/enterprise/views/enterprise-access-control-surface.ts` | 支持更多账号分类   |
| `P2-FE-2` | 为第二批 Provider 增加重授权和异常提示   | 同上                                                                    | 明确显示为何不可用 |

### 测试任务

| ID        | 任务                       | 产出                                 |
| --------- | -------------------------- | ------------------------------------ |
| `P2-QA-1` | 第二批 Provider 接入测试   | 状态、动作、审计一致                 |
| `P2-QA-2` | 不支持 Provider 的降级测试 | UI 和 API 给出明确提示，不假装已支持 |

### M3 验收标准

1. 新 Provider 不改变 `Seat` 权威主体原则。
2. 新 Provider 不新增第三套凭证字段。
3. 新 Provider 的使用动作都能经过同一套策略与审计链路。

## 延后项（不进入本轮排期）

以下事项已确认重要，但不进入当前迭代：

1. 部门负责人审批流
2. 统一的企业身份风险评分引擎
3. 企业身份使用量计费
4. 与企业知识宇宙的统一身份画像
5. 公众号 / 视频号 / 微博 / 知乎的一次性全量铺开
6. 把个人微信插件包装成企业官方账号能力

## 排期建议

### Sprint 1

- `M0`
- `M1`

目标：

- 先冻结边界
- 先把 Identity Domain 做出来
- 先在企业设置页接通基础 UI

### Sprint 2

- `M2`

目标：

- 打通 Agent / DataSource 联动
- 落地 Operational Identity Governance

### Sprint 3

- `M3`

目标：

- 扩展第二批 Provider
- 补齐更细粒度运营动作

## 最终交付物清单

本轮实施完成后，应形成以下交付物：

1. 冻结版任务文档
   - `docs/design/openbot-enterprise-operational-identity-v1-work-breakdown-2026-06-06.md`
2. Store 版本迁移说明
3. 企业运营身份模型字段清单
4. 首批 Provider 适配清单
5. Agent / DataSource 联动验收矩阵
6. 审计事件清单
7. 越权负例测试记录

## 建议的执行门槛

以下门槛都满足后，才允许宣布企业运营身份 V1.0 完成：

1. `Seat` 仍然是权威执行主体。
2. `Agent` 只能消费身份，不能拥有独立权威授权。
3. 没有新增第三套 Credential 存储。
4. 企业数据访问边界未被运营身份突破。
5. 首批 Provider 可以被创建、治理、重授权和审计。

## 最终验收清单（建议直接执行）

### A. 研发验证

1. 身份创建后必须绑定现有 `credentialBindingId`。
2. 仅配置 `allowedAgentIds` 而无 `seatIds` 时，不得授权通过。
3. 允许的 `Seat + Agent + Action` 组合可以正确执行运营动作。
4. 不允许的组合必须被拒绝并留下审计。
5. `DataSourceIdentityBinding` 不得生成或修改 `SeatActionGrant`。

### B. 联调验证

1. 企业设置页能展示首批 Provider 身份目录。
2. DataSource 详情页能展示绑定身份。
3. 身份过期或需重授权时，UI 和 API 都能给出一致状态。
4. 运营动作执行后，企业管理员可在审计区回溯主体、身份、动作和结果。

### C. 归档材料

1. Store 迁移记录。
2. Provider 联调截图或录屏。
3. 审计链路截图或导出记录。
4. 回滚说明与版本兼容注意事项。
