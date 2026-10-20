# OpenBot 我的运营身份 V1 研发任务拆解表（2026-06-06）

关联主方案：

- `docs/design/openbot-enterprise-operational-identity-v1-work-breakdown-2026-06-06.md`
- `docs/design/openbot-openclaw-ui-current-state-audit-and-task-plan-2026-04-10.md`
- `docs/design/workbench-boundary-parity-audit-2026-04-09.md`
- `docs/design/openbot-four-port-ia-and-reorg-plan-2026-04-12.md`

## 文档定位

本文用于把员工端 “My Operational Identity V1” 落成可排期、可指派、可验收的研发任务。

本文默认以下前提已经成立：

1. 当前员工端主产品不是“个人身份中心”，而是“个人工作台”。
2. 员工端现有主资产是：
   - 我的机器人
   - 我的协作小组
   - 我的资产
   - 我的知识
3. 员工端设置当前只分为 `personal` 与 `system` 两个大视图。
4. 知识宇宙当前是“消费与沉淀平面”，不是“执行平面”。

本文明确不做三件事：

1. 不重构员工工作台 IA。
2. 不把个人运营身份塞进 `UiSettings` / `localStorage`。
3. 不让知识宇宙直接执行对外发布动作。

## 冻结执行结论

本轮方案名称统一调整为：

## My Operational Identity V1

中文名称建议冻结为：

**我的运营身份 V1**

它的定位不是：

- 我的数字身份平台

而是：

- 我的对外执行账号目录
- 我的机器人可消费的个人运营身份授权层
- 工作台内可持续复用的个人账号能力

## 必须冻结的架构原则

### 原则 1：员工端身份能力必须嵌入现有工作台

当前员工端不是“账号中心”，而是“工作台”。

因此本轮只允许：

- 在 `个人设置 / personal settings` 中新增一个新 section

不允许：

- 新增独立一级导航
- 重做 `settingsView`
- 复制一套新的“我的账号中心”

### 原则 2：`My Operational Identity` 必须服务端持久化

禁止把以下数据放入：

- `UiSettings`
- `localStorage`
- 浏览器缓存
- URL 参数

原因：

- 身份需要跨设备复用
- 身份需要跨浏览器复用
- 身份需要跨工作台会话复用
- 凭证与授权记录必须可审计

### 原则 3：共享 Identity Kernel，但不共享 Owner 语义

企业端与员工端可以共享：

- provider catalog
- action whitelist
- status / reauth hint
- usage event vocabulary
- resolver contract pattern

但不能共享：

- owner 语义
- store 语义
- policy 语义

必须明确区分：

- `tenant-owned identity`
- `user-owned identity`

### 原则 4：`Seat` 是执行上下文，不是个人身份所有权

员工端个人运营身份的所有权必须属于：

- `user`

而不是：

- `seat`

`Seat` 只参与：

- 当前任务执行上下文
- 当前 agent 使用该身份时的安全判定

### 原则 5：Agent 授权必须分级

#### Level 1：Owned Agent

- 用户拥有
- 可自动授权

#### Level 2：Shared Agent

- 团队共享
- 必须二次确认

#### Level 3：Group Agent

- 协作小组机器人
- 默认禁止
- 只有明确批准后才允许

### 原则 6：Identity Resolver 必须基于 Provider + Action + User + Agent + Seat 决策

禁止继续采用过弱签名：

```ts
resolveIdentity(agentId, provider);
```

建议冻结为：

```ts
resolveOperationalIdentity({
  provider,
  action,
  currentUserId,
  currentAgentId,
  currentSeatId,
  tenantId,
});
```

### 原则 7：Knowledge Universe 只负责发布意图，不负责发布执行

禁止：

- `Knowledge Universe -> publish_to_zhihu()`
- `knowledge.*` 直接调用对外发布 provider

允许：

- `Knowledge Object -> 发布意图 -> Agent Runtime -> Identity Resolver -> Operational Identity -> 外部平台`

### 原则 8：对话授权必须分阶段推进

#### `P0`

- 手工绑定
- 个人设置中完成绑定

#### `P1`

- Agent 发现缺失身份
- 展示 “需要绑定 / 去绑定”
- 绑定完成后回到任务界面
- 但不自动重放原任务

#### `P2`

- 完整 continuation
- OAuth 完成后恢复任务并继续执行

`P2` 不进入首版交付。

## 当前代码现状约束

### 1. 员工端设置只有 `personal / system` 两个视图

当前设置入口通过：

- `workbench=settings`
- `settingsView=personal | system`

控制。

现阶段不应新增第三个 `settingsView`。

### 2. `personal settings` 已是一个真实页面，但没有账号连接域

当前 `personal settings` 已经承载：

- 账号信息
- seat 绑定确认
- 数据空间
- 工作台偏好
- 助手偏好
- 账号安全

它不是空壳。

因此“我的运营身份”最适合作为一个新 section 插入现有 personal page。

### 3. 当前 personal settings 同时混合了本地偏好与服务端状态

当前以下字段是浏览器本地偏好：

- `workbenchProfileName`
- `workbenchProfileNote`
- `theme`
- `workbenchHomeModule`

它们持久化在：

- `ui/src/ui/storage.ts`

因此新身份能力必须显式绕开这条持久化链路。

### 4. 当前 “默认绑定” 实际是 seat 下发默认资源

当前员工端可见的：

- `defaultAgentId`
- `agentIds`
- `defaultSpaceIds`
- `connectorIds`

来自：

- `employeeAccess`
- `ControlUiPlatformEmployeeAccessSnapshot`

语义是：

- 当前岗位默认资源

不是：

- 用户自己的长期外部账号

因此：

- 不能把现有“默认绑定”直接改名成“我的运营身份”

### 5. 当前知识宇宙已经是完整模块，但职责是消费与沉淀

当前知识宇宙提供：

- 搜索
- 图谱
- 推荐
- 个人知识收录
- 文档上传
- 企业知识访问申请
- 数据能力访问申请

但没有：

- 对外发布执行
- 身份管理
- OAuth continuation

### 6. 知识宇宙已有明确消费边界

当前代码明确禁止知识平面直接调用企业数据执行网关。

这说明知识宇宙未来也不应直接接入运营身份执行。

### 7. 工作台已区分 `ownedAgents` 与 `sharedAgents`

当前 employee render model 已经把机器人区分为：

- owned
- shared / team

这为“Owned 自动授权 / Shared 二次确认 / Group 默认禁止”提供了现成分类基础。

### 8. 企业运营身份 kernel 已部分落地，但类型仍是 tenant-specific

当前仓库已经有：

- `src/gateway/enterprise-operational-identity-types.ts`
- `src/gateway/enterprise-operational-identity-providers/**`
- `src/gateway/enterprise-operational-identity-access.ts`
- `src/gateway/server-methods/enterprise-operational-identity.ts`

这些可以作为员工端共享 kernel 的基础，但不能直接拿来当员工端 store 使用，因为它们的 owner 和 policy 仍然是 tenant / seat 语义。

### 9. 现有 `auth-profiles` 不适合作为首版用户运营身份仓库

`auth-profiles` 当前主要服务于：

- model provider auth
- agentDir 范围的凭证轮换

它是：

- 服务端持久化

但不是：

- 明确的 user-owned operational identity store

因此：

- 可以复用其 credential shape 经验
- 但不建议首版直接把 “我的运营身份” 绑定到 agentDir 级 `auth-profiles`

## 当前 Provider 可行性判断

当前用户提案中的 Provider 覆盖面，与代码现状并不对齐。

### 建议按现状分层

| Provider       | 当前现状                                                             | V1 结论           |
| -------------- | -------------------------------------------------------------------- | ----------------- |
| GitHub（个人） | 有部分 GitHub / OAuth / token 相关基础，但不是现成用户运营连接器     | `pilot candidate` |
| 个人邮箱       | 有 Gmail / SMTP 片段能力，但不是用户级运营身份链路                   | `pilot candidate` |
| 飞书个人账号   | 当前主要是企业 bot/app 连接，不是用户账号连接                        | `defer`           |
| 微信个人号     | 现有 `wechat` 插件为代理自动化，高风险且不适合作为首版工作台身份能力 | `defer`           |
| 知乎           | 当前无连接器 / OAuth 能力                                            | `defer`           |
| 抖音           | 当前无连接器 / OAuth 能力                                            | `defer`           |

### V1 Provider 原则

1. UI 可以展示未来 provider catalog。
2. 首版只允许绑定 `pilot candidate` provider。
3. 其余 provider 只显示降级提示，不假装可用。

## V1 架构分层

### Shared Identity Kernel

建议共享：

- provider catalog contract
- action spec contract
- status hint / reauth hint
- usage event schema
- resolver input shape

建议逐步抽离自：

- `src/gateway/enterprise-operational-identity-providers/**`

### User-Owned Identity Layer

员工端必须新增：

- `user operational identity store`
- `user operational identity grant store`
- `binding request store`
- `usage history store`

### Tenant-Owned Identity Layer

企业端现有：

- tenant-owned identity
- seat policy
- data source binding

继续保持不变。

## V1 核心模型（冻结建议）

```ts
type OperationalIdentityOwnerType = "tenant" | "user";
```

```ts
type UserOperationalIdentityStatus = "active" | "expired" | "reauth_required" | "revoked";

type UserOperationalIdentity = {
  identityId: string;
  ownerType: "user";
  ownerId: string;
  provider: string;
  displayName: string;
  externalAccountId?: string;
  credentialHandleId: string;
  status: UserOperationalIdentityStatus;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
};
```

```ts
type UserOperationalIdentityGrant = {
  grantId: string;
  identityId: string;
  ownerId: string;
  tenantId?: string;
  seatId?: string;
  agentId: string;
  agentScope: "owned" | "shared" | "group";
  allowedActions: string[];
  grantMode: "auto" | "explicit";
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  revokedAt?: string;
};
```

```ts
type UserOperationalIdentityBindingRequest = {
  requestId: string;
  ownerId: string;
  tenantId?: string;
  seatId?: string;
  sessionKey?: string | null;
  agentId: string;
  agentScope: "owned" | "shared" | "group";
  provider: string;
  requestedAction: string;
  status: "pending" | "completed" | "cancelled" | "expired";
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
};
```

```ts
type UserOperationalIdentityUsageEvent = {
  eventId: string;
  ownerId: string;
  tenantId?: string;
  seatId?: string;
  agentId: string;
  identityId: string;
  provider: string;
  action: string;
  result: "allowed" | "denied" | "reauth_required";
  denialCode?: string;
  sessionKey?: string | null;
  createdAt: string;
};
```

### 模型语义冻结

1. `ownerType = "user"` 才属于员工端。
2. 员工端身份所有权不依赖 `Seat`。
3. `credentialHandleId` 必须指向服务端凭证句柄，而不是浏览器存储。
4. `agentScope` 必须进入 grant 记录。
5. `grantMode = auto` 只允许 `owned`。
6. `grantMode = explicit` 才允许 `shared` / `group`。
7. `group` 默认无权，除非存在明确 grant。

## 交付方式

建议拆成 4 个里程碑和 1 个保留阶段：

| 里程碑 | 范围        | 目标                                                |
| ------ | ----------- | --------------------------------------------------- |
| `M0`   | 方案冻结    | 冻结 owner 语义、UI 入口、阶段边界、pilot provider  |
| `M1`   | `P0`        | 手工绑定 + 服务端仓库 + personal settings section   |
| `M2`   | `P1`        | Resolver + Agent 触发绑定提示 + 分级授权 + 使用历史 |
| `M3`   | `P1.5`      | 知识宇宙发布意图 handoff，不做发布执行              |
| `M4`   | Next (`P2`) | 完整 OAuth continuation / 自动恢复任务              |

## 角色分工建议

| 角色             | 负责范围                                                |
| ---------------- | ------------------------------------------------------- |
| 后端负责人       | shared kernel 抽离、user store、resolver、usage history |
| 前端负责人       | personal settings section、binding prompt、history UI   |
| Workbench 负责人 | assistant / settings / session handoff 交互             |
| Knowledge 负责人 | publish intent handoff，不越界到执行平面                |
| 测试负责人       | owned/shared/group 负例、跨设备、越权和降级测试         |
| 架构负责人       | owner 语义冻结、localStorage 禁止项、P0/P1/P2 边界控制  |

## 当前高风险代码点

### Workbench personal settings

- `ui/src/ui/app-settings.ts`
- `ui/src/ui/storage.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-module.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-contracts.ts`
- `ui/src/ui/ports/employee/render-model.ts`

### Knowledge Universe

- `ui/src/ui/controllers/knowledge-universe.ts`
- `ui/src/ui/capability/knowledge-universe/endpoints.ts`
- `ui/src/ui/capability/knowledge-universe/gateway-client.ts`
- `src/gateway/server-methods/knowledge.ts`
- `src/gateway/knowledge/context.ts`
- `src/gateway/knowledge/source-bundle.ts`
- `src/gateway/knowledge/knowledge-consumption-boundary.test.ts`

### Shared operational identity kernel

- `src/gateway/enterprise-operational-identity-types.ts`
- `src/gateway/enterprise-operational-identity-providers/**`
- `src/gateway/enterprise-operational-identity-access.ts`
- `src/gateway/server-methods/enterprise-operational-identity.ts`

## M0：冻结输出

本阶段不改业务行为，只产出冻结结果。

### 任务清单

| ID     | 任务                 | 产出                                                    | 负责人         |
| ------ | -------------------- | ------------------------------------------------------- | -------------- |
| `M0-1` | 冻结员工端身份定位   | 明确“我的运营身份”是 workbench section，不是独立端      | 架构           |
| `M0-2` | 冻结 owner 语义      | `tenant-owned` 与 `user-owned` 关系表                   | 架构/后端      |
| `M0-3` | 冻结 UI 接入点       | personal settings 新增 section，不增加新 `settingsView` | 前端/架构      |
| `M0-4` | 冻结阶段边界         | `P0/P1/P2` 对话授权分期表                               | 产品/架构      |
| `M0-5` | 冻结 pilot provider  | 首版可绑定 provider 名单与降级文案                      | 产品/后端      |
| `M0-6` | 冻结 local-only 禁令 | 明确禁止把身份放入 `UiSettings` / `localStorage`        | 架构           |
| `M0-7` | 冻结知识宇宙发布边界 | 明确只允许 publish intent handoff，禁止 publish execute | 架构/Knowledge |

### 完成定义

1. `ownerType`、grant 分级、阶段范围都已冻结。
2. `personal settings` section 方案冻结。
3. pilot provider 冻结。
4. “知识宇宙只发意图不执行”写入研发规范。
5. localStorage / UiSettings 禁令已冻结并传达给实现团队。

## M1：`P0` 手工绑定 + 服务端仓库 + personal settings section

目标：

- 在不重构工作台的前提下，把员工端运营身份能力先做成真实可用的服务端资产。
- 首版只支持手工绑定和手工管理。

### 后端任务

| ID        | 任务                           | 涉及文件                                                                                                                     | 产出                                                                  | 依赖                 |
| --------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------- |
| `P0-BE-1` | 抽离 shared provider contract  | 从 `src/gateway/enterprise-operational-identity-providers/**` 抽出共享 provider/action/status contract，并保留企业端兼容导出 | 建立 owner-agnostic identity kernel                                   | `M0-2`               |
| `P0-BE-2` | 新增 user-owned identity types | 新增 `src/gateway/user-operational-identity-types.ts`                                                                        | `UserOperationalIdentity` / `Grant` / `BindingRequest` / `UsageEvent` | `M0-2`               |
| `P0-BE-3` | 新增 user-owned store          | 新增 `src/gateway/user-operational-identity-store.ts`                                                                        | 身份/授权/历史的服务端持久化，不落浏览器                              | `P0-BE-2`, `M0-6`    |
| `P0-BE-4` | trusted user 解析 helper       | 从 `resolveTrustedSessionEmployeeId(...)` 经验抽出 `resolveTrustedPlatformAuthUserId(...)` 或等价 helper                     | 以平台用户 id 作为 ownerId                                            | `M0-2`               |
| `P0-BE-5` | 手工绑定接口                   | 新增 `src/gateway/server-methods/user-operational-identity.ts`                                                               | list/create/revoke/reauthorize/history.list/provider.catalog          | `P0-BE-3`, `P0-BE-4` |
| `P0-BE-6` | method scopes 注册             | `src/gateway/server-methods-list.ts`, `src/gateway/method-scopes.ts`, `src/gateway/server-methods.ts`                        | 员工端可读写 user identity API                                        | `P0-BE-5`            |
| `P0-BE-7` | provider catalog 首版降级策略  | 新增 `src/gateway/user-operational-identity-providers.ts` 或 shared catalog user branch                                      | 对非 pilot provider 返回 `registrationReady=false` + degraded hint    | `M0-5`               |
| `P0-BE-8` | usage history store            | 新增 `src/gateway/user-operational-identity-history.ts` 或并入 store                                                         | 后续 resolver 和 UI 可追踪最近使用                                    | `P0-BE-3`            |

### 前端任务

| ID        | 任务                                           | 涉及文件                                                                                                     | 产出                                                                          | 依赖      |
| --------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------- |
| `P0-FE-1` | personal settings 中新增“我的运营身份” section | `ui/src/ui/ports/employee/views/workbench-stage-module.ts`                                                   | 作为现有 personal page 新 section 出现                                        | `M0-3`    |
| `P0-FE-2` | 扩展 settings contract                         | `ui/src/ui/ports/employee/views/workbench-stage-contracts.ts`                                                | 新增 identities / providerCatalog / history / busy / notice / error / actions | `P0-BE-5` |
| `P0-FE-3` | 扩展 employee workbench props                  | `ui/src/ui/ports/employee/views/workbench-types.ts`, `ui/src/ui/ports/employee/views/home-page-contracts.ts` | 工作台可消费 user-owned identity snapshot                                     | `P0-FE-2` |
| `P0-FE-4` | 新增 controller                                | 新增 `ui/src/ui/controllers/user-operational-identity.ts`                                                    | 复用 enterprise controller 的 snapshot/controller 模式                        | `P0-BE-5` |
| `P0-FE-5` | render-model 接线                              | `ui/src/ui/ports/employee/render-model.ts`                                                                   | 把服务端 identity snapshot 注入 settings contract                             | `P0-FE-4` |
| `P0-FE-6` | provider catalog 降级文案                      | 同上 + `workbench-stage-module.ts`                                                                           | 让不可绑定 provider 直接显示“暂不支持/后续开放”                               | `P0-BE-7` |
| `P0-FE-7` | 明确不落 `UiSettings`                          | `ui/src/ui/storage.ts`, `ui/src/ui/app-settings.ts`                                                          | 不新增任何 identity local persistence 字段；必要时加守卫注释/测试             | `M0-6`    |

### 测试任务

| ID        | 任务                               | 产出                                        |
| --------- | ---------------------------------- | ------------------------------------------- |
| `P0-QA-1` | personal settings section 渲染测试 | section、catalog、empty state、history 可见 |
| `P0-QA-2` | 服务端持久化测试                   | 刷新页面/重开浏览器后身份仍存在             |
| `P0-QA-3` | localStorage 负例测试              | identity 数据不写入 `UiSettings`            |
| `P0-QA-4` | 未登录/无 platform auth 负例       | 明确提示不可用，不展示伪绑定能力            |
| `P0-QA-5` | non-pilot provider 降级测试        | provider 可见但不能绑定，提示清晰           |

### M1 验收标准

1. 员工可以在 personal settings 中看到“我的运营身份” section。
2. 绑定/停用/重新校验记录存于服务端，不进入本地设置。
3. 当前页面没有新增新的顶级设置路由或新的 `settingsView`。
4. 非 pilot provider 不会伪装成已可用。

## M2：`P1` Resolver + Agent 触发绑定提示 + 分级授权 + 使用历史

目标：

- 让 agent/runtime 可以安全地消费 user-owned 身份。
- 但仍不实现完整 continuation 自动恢复。

### 后端任务

| ID        | 任务                                    | 涉及文件                                                                      | 产出                                                                                                       | 依赖                 |
| --------- | --------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------- |
| `P1-BE-1` | 新增 user resolver                      | 新增 `src/gateway/user-operational-identity-access.ts`                        | `resolveOperationalIdentity({ provider, action, currentUserId, currentAgentId, currentSeatId, tenantId })` | `P0-BE-3`, `P0-BE-8` |
| `P1-BE-2` | agent scope 分类 helper                 | 新增 `src/gateway/user-operational-identity-agent-scope.ts` 或并入 access     | 识别 `owned/shared/group`                                                                                  | `M0-2`               |
| `P1-BE-3` | grant 规则实现                          | `user-operational-identity-store.ts`, `user-operational-identity-access.ts`   | `owned -> auto`，`shared -> explicit`，`group -> default deny`                                             | `P1-BE-2`            |
| `P1-BE-4` | 新增 binding request store              | 新增 `src/gateway/user-operational-identity-binding-request.ts`               | 支持 agent 触发“去绑定”但不自动回放任务                                                                    | `M0-4`               |
| `P1-BE-5` | 新增绑定请求 API                        | `src/gateway/server-methods/user-operational-identity.ts`                     | create/get/cancel/complete minimal flow                                                                    | `P1-BE-4`            |
| `P1-BE-6` | usage event 写入                        | `user-operational-identity-access.ts`, `user-operational-identity-history.ts` | 记录 allow / deny / reauth_required                                                                        | `P0-BE-8`            |
| `P1-BE-7` | resolver 严禁浏览器伪造 user/seat/agent | access + session helper                                                       | 一律基于 trusted session + runtime context 解析                                                            | `P0-BE-4`            |

### 前端任务

| ID        | 任务                                                     | 涉及文件                                                                | 产出                                    |
| --------- | -------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------- | --------- |
| `P1-FE-1` | 在 personal settings identity section 展示“已授权机器人” | `ui/src/ui/ports/employee/views/workbench-stage-module.ts`              | 区分 owned / shared / group             |
| `P1-FE-2` | Shared Agent 二次确认 UI                                 | 同上                                                                    | shared 机器人授权需二次确认             |
| `P1-FE-3` | Group Agent 默认禁止 UI                                  | 同上                                                                    | group 机器人显示默认禁止与手动批准入口  |
| `P1-FE-4` | Agent 触发“去绑定”提示                                   | 新增 workbench/assistant prompt controller                              | 缺身份时显示 `需要绑定 / 去绑定`        | `P1-BE-5` |
| `P1-FE-5` | 绑定完成后的任务界面返回                                 | `ui/src/ui/app-settings.ts`, `ui/src/ui/ports/employee/render-model.ts` | 绑定后返回原会话/原模块并提示“已可继续” | `P1-BE-5` |
| `P1-FE-6` | 最近使用记录 UI                                          | `workbench-stage-module.ts`                                             | 展示最近使用、最后结果、最近 agent      |

### 测试任务

| ID        | 任务                      | 产出                                            |
| --------- | ------------------------- | ----------------------------------------------- |
| `P1-QA-1` | owned agent 自动授权测试  | 同 user + owned agent + allowed action 自动通过 |
| `P1-QA-2` | shared agent 二次确认测试 | 未确认前拒绝，确认后通过                        |
| `P1-QA-3` | group agent 默认禁止测试  | 无显式 grant 时拒绝                             |
| `P1-QA-4` | usage history 测试        | allow / deny / reauth_required 均落历史         |
| `P1-QA-5` | 缺身份提示测试            | Agent 能触发“去绑定”，但不自动执行              |

### M2 验收标准

1. Resolver 不再只看 `agentId + provider`。
2. owned/shared/group 三档策略全部生效。
3. 缺身份时可以创建绑定请求并返回工作台。
4. 绑定完成后用户能返回原任务界面，但系统不会自动重放任务。

## M3：`P1.5` Knowledge Universe 发布意图 handoff

目标：

- 让知识宇宙可以把“发布”交给 agent/runtime。
- 但绝不在知识平面执行发布动作。

### 后端任务

| ID         | 任务                                | 涉及文件                                                       | 产出                                                    | 依赖       |
| ---------- | ----------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------- | ---------- |
| `P15-BE-1` | 新增 publish intent contract        | 新增 `src/gateway/knowledge/publish-intent.ts` 或等价层        | 定义意图载荷，不执行 provider 动作                      | `M0-7`     |
| `P15-BE-2` | 保持 knowledge boundary test 为红线 | `src/gateway/knowledge/knowledge-consumption-boundary.test.ts` | 明确禁止新增 `knowledge.publish.execute` / 类似执行方法 | `M0-7`     |
| `P15-BE-3` | 增加 handoff payload builder        | knowledge / workbench bridge                                   | 生成“让助手发布”的结构化 prompt / payload               | `P15-BE-1` |

### 前端任务

| ID         | 任务                                   | 涉及文件                                                                    | 产出                                 |
| ---------- | -------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------ | ---------- |
| `P15-FE-1` | 在知识对象详情中新增“交给助手发布”入口 | `ui/src/ui/views/knowledge-universe-detail-preview.ts` 或相关 object row    | 只创建发布意图，不执行               |
| `P15-FE-2` | 扩展 `WorkbenchKnowledgeSurface`       | `ui/src/ui/ports/employee/views/home-page-contracts.ts`                     | 新增 `onCreatePublishIntent(...)`    |
| `P15-FE-3` | 复用现有 workbench handoff 能力        | `ui/src/ui/ports/employee/render-model-shell-actions.ts`, `render-model.ts` | 切换到 assistant，并预填发布草稿     | `P15-BE-3` |
| `P15-FE-4` | 明确文案区分“发布意图”与“发布执行”     | knowledge UI                                                                | 避免误导用户以为知识宇宙直接发出内容 |

### 测试任务

| ID         | 任务                        | 产出                                             |
| ---------- | --------------------------- | ------------------------------------------------ |
| `P15-QA-1` | publish intent handoff 测试 | 点击后切到 assistant 并预填草稿                  |
| `P15-QA-2` | boundary 负例测试           | knowledge method 列表中不出现执行类 publish 方法 |
| `P15-QA-3` | 无身份时的意图链测试        | assistant 侧可继续触发 “去绑定”                  |

### M3 验收标准

1. 知识宇宙只能创建发布意图，不能执行发布。
2. 现有 knowledge boundary test 继续通过。
3. 发布意图能无缝 handoff 到 assistant/runtime。

## M4：Next（`P2` 完整 continuation）

以下事项确认重要，但不进入本轮排期：

1. OAuth 完成后自动恢复原任务
2. 完整 continuation token / callback / resume 流水线
3. 发布动作中断后自动重试
4. 多 provider 并发授权编排

## 排期建议

### Sprint 1

- `M0`
- `M1`

目标：

- 冻结 owner / UI / provider 范围
- 先把服务端仓库和 personal settings section 做出来

### Sprint 2

- `M2`

目标：

- 打通 resolver、分级授权、去绑定提示、使用历史

### Sprint 3

- `M3`

目标：

- 给知识宇宙增加 publish intent handoff
- 不触碰执行平面边界

## 最终交付物清单

本轮实施完成后，应形成以下交付物：

1. 冻结版任务文档
   - `docs/design/openbot-my-operational-identity-v1-work-breakdown-2026-06-06.md`
2. shared identity kernel 复用说明
3. user-owned identity 模型字段清单
4. pilot provider 名单与降级策略
5. owned/shared/group 授权矩阵
6. usage history 字段与查询说明
7. knowledge publish intent handoff 验收记录

## 建议的执行门槛

以下门槛都满足后，才允许宣布 `My Operational Identity V1` 完成：

1. 员工端身份能力嵌入 personal settings，而不是新端。
2. 身份数据不进入 `UiSettings` 或 `localStorage`。
3. user-owned 与 tenant-owned owner 语义已经分离。
4. owned/shared/group 授权层级全部生效。
5. 知识宇宙只发起意图，不直接执行发布。

## 最终验收清单（建议直接执行）

### A. 研发验证

1. personal settings 中出现“我的运营身份” section。
2. 刷新页面或更换浏览器后，身份仍可通过服务端加载恢复。
3. owned agent 自动授权成立。
4. shared agent 未确认前不可用，确认后可用。
5. group agent 默认不可用。
6. Resolver 决策显式包含 `provider + action + user + agent + seat`。

### B. 联调验证

1. assistant 遇到缺少身份时可展示 “去绑定”。
2. 绑定完成后可回到原任务界面并看到“已可继续”。
3. 最近使用记录能看到成功、拒绝、需重授权三类结果。
4. 知识对象可以创建发布意图并 handoff 给 assistant。

### C. 归档材料

1. 服务端持久化验证记录。
2. shared / group 授权确认截图或录屏。
3. usage history 导出或审计记录。
4. knowledge publish intent 边界测试记录。
