# Design Document

> Ops 控制台下线与三端职责归位

## Overview

本设计将原 openclaw 单租户运维控制台（Ops port）的能力按「平台 / 企业 / 员工」三端定位重新分布，删除冗余前端，并以多租户配置作用域为地基支撑企业级凭证隔离。设计遵循两条既有架构红线：

- **运行时投影红线**：企业端/员工端禁止暴露运行时技术字段（prompt / workflow / provider / model routing）。平台端是唯一可见运行时配置的层。
- **共享能力复用**：Ops 的功能大多来自共享模块（`capability/*`、`controllers/*`、`views/{channels,instances,config-form}.ts`）；Ops port 只是消费者之一。删除 Ops 不触碰共享能力与后端 RPC。

## Architecture

### 现状基线（事实）

- 单一 SPA，由 `src/gateway/control-ui.ts` 提供；`navigation.ts` 通过 `portForTab(tab)` 选择 `employee/enterprise/platform/ops/builder` 五端外壳；`app-render.ts` 据此渲染。
- Ops port（`ports/ops/**`）挂载遗留视图：`views/config.ts`（config.get/schema/set/apply + update.run）、`views/sessions.ts`（sessions.list/patch/delete）、`views/cron.ts`（cron._）、`views/nodes.ts`+`nodes-exec-approvals.ts`（node.list、device._、exec.approvals._）、`views/debug.ts`（status/health/models._/任意调用）、`views/logs.ts`（logs.tail）。
- 配置目前是 `openbot.json` **单一全局树**（单租户）；渠道凭证写在全局 `channels.*`。
- 平台端模型管理已通过 `config.set` 写 `models.providers.*`、`agents.defaults.*`，但 Provider 表单缺 `apiKey` 字段（`PlatformModelAddInput`/`PlatformModelProviderUpdateInput` 无 apiKey，新增弹窗密码框未接线）。

### 目标三端能力分布

```
Platform（租户 + 基础设施）
├── 模型/Provider/Key 配置（含 apiKey 补全）
├── 渠道：连接器目录/开通/治理（不含某租户凭证）
├── 设备：通路 + 跨租户治理
├── 会话运维（跨租户/按租户过滤）
├── 日志/排障（logs.tail）
├── 网关自更新（update.run）
├── exec 策略基础设施 + 节点/exec 绑定
└── tenant-scoped 配置解析（平台默认）

Enterprise（旗下机器人 + 企业自有资产）
├── 渠道凭证配置（tenant-scoped，仅平台已开通类型）
├── 机器人业务配置（岗位/人设/装载能力/分配）
├── exec 审批（治理自有机器人）
├── 定时任务（岗位机器人调度）
└── 审计/活动投影（后续，独立于 logs.tail）

Employee（消费 + 个人沉淀）
├── 个人渠道绑定/激活
├── 我的设备（绑定/解绑/系统授权）
├── 个人定时任务
├── 自己的聊天会话（sessions.list，现状保留）
└── 客户端 App「新版本」提示（Sparkle）
```

## Components and Interfaces

### Scope-aware 协议与服务端投影（地基，UI 归位前置）

> 评审已核实的现状缺口：`config.set` 仅整树写回、`channels.status` 全局快照、`sessions.list` 无 `tenantId`、`logs.tail` 直接 tail 全局日志、`cron` 无 owner/tenant、`device.pair.list`/`node.list` 返回全部。UI 归位前必须先把作用域落到协议与服务端，隔离由**服务端强制**而非前端过滤。

需作用域化/归属化的协议点（每项含服务端测试）：

| RPC                            | 现状                        | 目标                                      | 关键文件                                                                  |
| ------------------------------ | --------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| `config.get/set/schema`        | 整树 `{raw, baseHash}` 提交 | 增加 `scope`/`tenantId`，按作用域读写子树 | `src/gateway/server-methods/config.ts`、`ui/src/ui/controllers/config.ts` |
| `channels.status`              | 全局快照                    | scope 参数 + 服务端租户投影               | `src/gateway/server-methods/channels.ts`                                  |
| `sessions.list`                | schema 无 tenantId          | 归属过滤 + 仓库归属元数据                 | `src/gateway/protocol/schema/sessions.ts`、`server-methods/sessions.ts`   |
| `logs.tail`                    | tail 全局日志               | 归属/租户过滤（服务端投影）               | `src/gateway/server-methods/logs.ts`                                      |
| `cron.list/add/update/remove`  | 无 owner/tenant             | owner/tenant 字段 + 服务端授权过滤        | `src/gateway/protocol/schema/cron.ts`、`server-methods/cron.ts`           |
| `device.pair.list`/`node.list` | 返回全部                    | self-scoped list/remove/revoke 语义       | `src/gateway/server-methods/devices.ts`、`nodes.ts`                       |
| `exec.approvals.get/set`       | 全局                        | 租户作用域（企业治理自有机器人）          | exec approvals handler                                                    |

### 渠道三层

| 层          | 端   | 数据/RPC                                                                   | 说明                       |
| ----------- | ---- | -------------------------------------------------------------------------- | -------------------------- |
| 连接器/通路 | 平台 | 连接器目录（内置 `src/{telegram,discord,...}` + `extensions/*`）+ 启用状态 | 平台决定「有哪些渠道可用」 |
| 凭证        | 企业 | `config.set channels.<id>.accounts[]`（tenant-scoped）                     | 仅平台已开通类型可配       |
| 绑定        | 员工 | 个人账号↔席位映射                                                          | 不见凭证/运行时            |

平台端 `platformAdvanced` 渠道页职责收敛：从「填某租户 corpId/secret」改为「连接器目录 + 开通治理」；凭证表单（复用 `views/channels.ts` config-form）迁到企业端，并接 tenant-scoped 写入。

### 设备双层

- 平台：设备/节点治理视图（device.pair.list/approve/reject、device.token.rotate/revoke、node.list）——跨租户监督。
- 员工：「我的设备」——本人设备绑定/解绑 + `node.invoke(device.permissions.request)`（现状已具备授权雏形，扩展为设备列表）。
- 后端 device-pairing / node-pairing 子系统不变；CLI `openbot devices` 作为冗余审批通道。

### 会话 / 日志 / 更新（平台运维）

- 复用现有 `views/sessions.ts`、`views/logs.ts`、`views/config.ts`（update 部分）渲染逻辑，迁入平台端新建运维 surface（平台下新增 `platformOps` 子标签，或并入 `platformAdvanced`），加 `tenantId` 过滤与平台运维角色门禁。
- `update.run` 仅平台运维入口；员工端「新版本提示」走 Sparkle，不调用 `update.run`。

### 定时任务 / exec 审批

- cron.\*：企业端（岗位机器人）+ 员工端（个人），按租户/个人隔离；调度后端不变。
- exec.approvals.\*：企业端治理自有机器人；平台端保留 exec 策略基础设施与节点绑定。

### 删除机制（最后一步）

0. **删除前置**：把 `views/control-center.ts` 中仍被三端引用的共享导出（`renderConsoleSubnav` 及其参数类型，当前被 `ports/{platform,enterprise,builder}/view-types.ts` 引用）提取到独立共享模块，改三端引用后再删 control-center.ts，避免类型断裂。
1. 产出 cutover matrix（旧 Ops 面板 → 新端 surface → 依赖的后端变更 → 测试门禁），逐行确认归位 surface 在三端就绪。
2. 删除 `ports/ops/**`、`views/{config,cron,debug,logs,nodes,nodes-exec-approvals,sessions}.ts`、`views/control-center.ts`。
3. **全量枚举清理** `navigation.ts`：`CONSOLE_TABS`、`LEGACY_OPS_TABS`、`RESERVED_ROUTE_ROOTS`、`TAB_PATHS`、`LEGACY_PATH_TO_TAB`、`TAB_PORTS` 各处 ops 痕迹；`/ops/*` 重定向到平台端；清理 `app-render.ts` ops 分支。
4. 清理 i18n、孤儿 `capability/{logs,devices,exec-approvals}`（cron 已归位则复用，不删）。
5. 构建守门检查无悬空 import。

### 保留清单（不可删）

- 后端：全部网关 RPC。
- 共享前端：`capability/{config,channels,debug,presence,nodes,sessions}`、`views/{channels,instances,config-form}.ts`、相关 controllers。
- must-keep 7 项（三端已消费）。

## Data Models

### 配置作用域模型（多租户地基）

> Phase 2 启动前的代码勘察结论（关键，影响范围远超原 spec 假设）。

**现状事实（已核实）：**

- 配置是**单一全局 `~/.openbot/openbot.json`**（`src/config/paths.ts` `CONFIG_FILENAME`）。
- 运行时是**进程级全局快照**:`runtimeConfigSnapshot` + `loadConfig()` 直接返回它、**完全不感知租户**(`src/config/io.ts`)。channels / agents / hooks / cron 等所有消费者都读这一份。
- 既有"多租户"数据(platform-auth、enterprise-data)用的是**单一全局 JSON、按 `tenantId` 字段过滤**,**没有**任何 per-tenant 目录或 per-tenant 配置文件先例(`src/gateway/enterprise-data/store.ts`)。
- 租户身份解析是**会话优先、客户端 tenantId 永不可信**(`resolveTrustedAdminTenantId`/`requireResolvedEnterpriseTenantId`,`enterprise-data-seat-context.ts`)。
- 明文→file SecretRef 物化引擎**已存在**:`runSecretsApply`(`src/secrets/apply.ts`),可直接复用给 task 2.9。
- `createConfigIO({ configPath })` 接受路径覆盖 → 技术上支持"另一个文件即另一个租户配置"。
- `config.set` 协议入参仅 `{ raw, baseHash }`,无 scope/tenantId(`schema/config.ts`),是插入点。

**比原 spec 更深的阻塞(必须先决策):**

> "企业端配置自己企业的渠道凭证"不仅是**配置存储**问题,更是**运行时实例**问题。当前网关**全局只跑一套 channels/agents**(一个 Telegram bot 进程对应一个 token)。真正的"每租户渠道凭证"意味着**每租户一套渠道运行时实例**,这比"配置按 tenantId 隔离"大得多,触及网关运行时架构。

**三个候选模型(2.2 已拍板 → C):**

- **A. 每租户配置文件** `~/.openbot/tenants/<tenantId>/openbot.json`,`createConfigIO({configPath})` 读,运行时 = `merge(platformDefault, tenantOverride)`。隔离最干净、复用现有 IO(含 base-hash/备份/审计);但运行时全局单快照 → 需改成**租户键控快照表 + 按请求解析**,波及每个 `loadConfig()` 调用方。
- **B. 全局配置内的租户覆盖层** `config.tenants.<tenantId>.{channels,models,...}`,平台默认在根。单文件/单快照/单 hash、读时合并;但要改 schema、redaction/uiHints 覆盖租户子树,且单文件多租户写竞争。
- **C.（已选）凭证存储与运行时解耦(渐进)**:Phase 2 先建协议 + `resolveConfigForTenant(tenantId)` 合并解析 seam,租户凭证存到 enterprise-data 式的**全局按 tenantId 键控存储**(非 openbot.json),运行时按消息解析;暂不动全局 channel/agent 运行时。风险最低、可增量,但不立刻提供"每租户独立渠道实例"。

**决策(已拍板,2026-06):走 C。** 理由:A/B 都只在"配置怎么存"上动刀,但真正的硬问题是"运行时只有一套全局 channels/agents"(`loadConfig()` 进程级全局快照 `src/config/io.ts:1435`;`channels.status` 全局 `loadConfig()` + 全局 runtime snapshot `src/gateway/server-methods/channels.ts:85`)。本轮若不同时改运行时实例模型,选 A/B 也兑现不了"每租户独立渠道",只会把内核改大、难回退。既有多租户数据已是"单一全局存储 + tenantId 过滤",延续此路线最稳;secrets 物化(`runSecretsApply`)现成可复用,task 2.9 顺路。

**两个阶段必须分清(写入 spec 的硬边界):**

- **「租户级渠道凭证隔离」(本轮 Phase 2/3 交付)**:协议 + 服务端强制隔离 + 租户键控凭证存储 + `resolveConfigForTenant()` 解析 seam + 复用 `runSecretsApply` 物化 + 企业端可管理"本企业凭证记录"。
- **「每租户独立渠道运行时实例」(本轮不承诺,另立 Runtime Phase)**:每租户独立 bot / channel daemon / agent runtime;在共享网关里同时跑多套基于不同 tenant token 的同类 singleton channel 实例。这是更大的运行时架构改造,**单列为后续独立设计项**,不混入本轮。

**本轮执行边界(C):**

- 交付:`resolveConfigForTenant()` 解析 seam;租户键控凭证存储;协议与服务端强制隔离;复用现有 secrets 物化链路;企业端管理"本企业凭证记录"。
- 不交付:每租户独立 bot/channel daemon/agent runtime;同一网关内多套同类 tenant-token channel singleton。
- **Phase 3 企业端渠道页只暴露本轮真正可兑现的能力**:展示/保存"本企业凭证记录",措辞不得把"凭证已保存"误导为"租户运行时已独立激活"。

### 归属模型（sessions / cron / devices / exec，2.4–2.8，决策 B）

与 config 不同（config 经 `resolveConfigForTenant` 直接作用域化），sessions/cron/devices/exec 是**记录型数据**，需要显式归属元数据才能服务端强制隔离。**决策 B：在记录上落归属字段**，而非仅前端过滤。

**归属字段（统一形状）：**

```
ownership: {
  tenantId?: string   // 规范化企业租户 id（canonicalizeTenantId）
  ownerId?: string    // 个人所有者 id（platform-auth user id；本地模式可空）
}
```

**可信归属来源（创建时盖戳，永不信客户端入参）：**

- 经 `resolveBillingScope(client)` 得 `{ enterpriseId, user }`：`tenantId = enterpriseId`，`ownerId = user?.id`。
- cron.add / device.pair 等**由已鉴权会话发起**的写操作，在创建时盖戳归属——这是最干净的来源。
- sessions / logs 由运行时（入站消息）创建,**当前全局运行时不感知租户**(Phase 8 前)；其归属只能**派生**（sessionKey → channel account → 反查租户配置归属）或保持**未归属=平台全局**。本轮 sessions/logs 仅做读侧过滤 + 派生归属，不改运行时创建路径。

**过滤语义（服务端强制）：**

| 调用者                       | 可见范围                           |
| ---------------------------- | ---------------------------------- |
| 平台运维（无 tenant scope）  | 全部记录（含未归属）               |
| 企业管理员（tenant scope=T） | 仅 `ownership.tenantId===T` 的记录 |
| 员工（self scope=U）         | 仅 `ownership.ownerId===U` 的记录  |

**未归属记录 = 平台全局**：仅平台可见，任何租户/个人查询都不返回（避免假隔离：宁可少返回，不跨租户泄漏）。

**分阶段落地（同一 `ownership` 形状，逐 RPC）：**

- 2.6 cron：schema 加 `ownership`；`cron.add` 盖戳；`cron.list/update/remove` 按 scope 授权过滤。（创建时归属，最干净，先做）
- 2.7 devices：`device.pair` 盖戳 ownerId；新增 self-scoped `list/remove/revoke`；平台保留全局治理。
- 2.8 exec.approvals：`get/set` 加 tenant scope（企业仅治理自有机器人）。
- 2.4 sessions：`sessions.list` 加 scope 过滤；归属派生自 sessionKey→account→租户配置；未归属=平台全局。
- 2.5 logs：`logs.tail` 加 scope 过滤；同 sessions，未归属=平台全局。

共享实现：`src/gateway/scope-attribution.ts`（`resolveTrustedAttribution(client)`、`isRecordVisibleToScope(record, scope)`），各 handler 复用。

### agent→tenant 归属模型 + exec.approvals 作用域化（2.8 前置）

**现状（已核对）：**

- 代理在 `cfg.agents.list[]` 已带 `ownerId` / `ownerName` / `scope` 字段（`readConfiguredAgentOwnership(agentId)`，`collaboration-learning/shared.ts`）；`src/shared/domain/agent.ts` 定义 `AgentOwnerType = "platform" | "tenant" | "position"`。**代理无显式 `tenantId`**，但 `ownerId`→平台用户→membership→`enterpriseId` 可推导租户（`resolveBillingScope`）。
- `exec.approvals.get/set`（`server-methods/exec-approvals.ts` + `infra/exec-approvals.js`）管理的是**单一全局控制面文件**（socket 路径 + 审批人身份），属平台基础设施；**不是 per-agent 记录**。
- 另有 **per-channel 审批配置** `channels.<id>.execApprovals{enabled,approvers,target}`（随渠道配置走），以及 agent 级 exec 策略——这些才是"某机器人的 exec 审批"语义。

**agent→tenant 归属（决策）：**

- 真源：`cfg.agents.list[].ownerId`（复用现有）。新增解析 seam `resolveAgentTenant(agentId): string | null`：
  - 若 agent 配置显式 `tenantId`（后续可加）→ 用之；
  - 否则 `ownerId` → 平台用户 membership → `enterpriseId`（经 `resolveBillingScope` 同源逻辑）；
  - 解析不到 → `null`（平台/无主代理 = 平台全局）。
- 与 `scope-attribution` 一致：未归属代理 = 平台全局（企业视图不返回）。

**exec.approvals 作用域化（决策，避免全局文件假隔离）：** 把 2.8 拆成两层——

1. **全局 exec 基础设施**（`exec.approvals.get/set`：socket + 审批人身份文件）→ **保持平台运维专属**（符合 Phase 6.4「平台端保留 exec 策略基础设施 + 节点绑定」）。企业/员工不直接读写该全局文件。
2. **per-agent / per-channel exec 审批配置**（"企业仅治理自有机器人"的真正语义）→ 经**租户作用域 config**（2.1/2.2）落地：企业端只能看/改**本租户拥有的 agent / 渠道**（用 `resolveAgentTenant` 过滤）的 exec 审批配置，而非全局审批文件。

即：2.8 的"企业治理自有机器人 exec 审批" = 在 tenant-scoped 配置面里，按 `resolveAgentTenant` 过滤出本租户代理 + 其渠道 `execApprovals` 子树；全局 `exec.approvals.*` 仍是平台基础设施。这样既满足企业治理诉求，又不在单一全局文件上做假隔离。

**落地子任务（更新 2.8）：**

- 2.8a：实现 `resolveAgentTenant(agentId)` seam + 测试（owner→tenant 推导、无主=平台全局）。
- 2.8b：`exec.approvals.get/set` 加平台运维门禁（非平台 scope 拒绝）；保持全局语义。
- 2.8c：企业端 exec 审批治理走 tenant-scoped config（Phase 6.3），按 `resolveAgentTenant` 过滤本租户代理/渠道；服务端测试跨租户不可见。

## Correctness Properties

### Property 1: 配置隔离

∀ 租户 A≠B，读取 A 作用域不返回 B 的任何配置项（跨租户读取交集为空）。

**Validates: Requirements 2.4, 2.7**

### Property 2: 覆盖合并幂等

`merge(platformDefault, tenantOverride)` 多次应用结果一致。

**Validates: Requirements 2.3, 2.7**

### Property 3: 投影纯净

企业端/员工端渲染数据集合 ∩ 运行时字段集合 = ∅（沿用既有 EnterpriseCapabilityProjection 属性）。

**Validates: Requirements 4.4, 6.5**

### Property 4: apiKey 脱敏

序列化到面向租户视图时，secret 值不出现明文。

**Validates: Requirements 2.6, 3.2**

### Property 5: 路由不丢

∀ 旧 `/ops/*` 路径，`matchTabRoute` 解析到合法三端 tab。

**Validates: Requirements 1.3, 11.4**

## Error Handling

- 跨租户越权读写：拒绝并返回授权错误，记录审计（不泄露目标租户存在性细节）。
- 渠道凭证保存失败：保留原值，提示失败原因，不进入半写状态。
- `update.run` 失败：展示失败原因与网关状态；不静默重启。
- 删除阶段出现悬空 import / 构建失败：阻断合并，回滚该删除步骤（先归位后删除的顺序保证可回退）。
- 归位 surface 未就绪时执行删除：被 Phase 7 就绪门禁拦截。

## Testing Strategy

- 属性测试（PBT）：配置隔离、合并幂等、投影纯净、apiKey 脱敏、路由重定向。
- 单元/快照：平台端 Provider apiKey 表单读写、渠道目录渲染、设备列表、会话/日志平台 surface。
- 构建守门：`pnpm build`（含 `[INEFFECTIVE_DYNAMIC_IMPORT]` 检查）、`pnpm tsgo`、`pnpm check`。
- 回归：删除后跑三端既有 `*.browser.test.ts` / `render-model.node.test.ts` 套件。
