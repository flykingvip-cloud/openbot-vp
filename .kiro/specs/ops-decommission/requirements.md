# Requirements Document

> Ops 控制台下线与三端职责归位（Ops Decommission & Tri-Port Reallocation）

## Introduction

OpenBot 的前端是单一 SPA，按角色划分为五个 port：`employee / enterprise / platform / ops / builder`。其中 **Ops port**（`ui/src/ui/ports/ops/**` + 一批遗留视图 `ui/src/ui/views/{config,cron,debug,logs,nodes,sessions}.ts` + 落地页 `views/control-center.ts`）是原 openclaw **单租户运维控制台**的遗留物，假设「一个管理员掌控一台网关实例」。它与当前面向多租户 SaaS 的三端架构（平台端 / 企业端 / 员工端）定位冲突，属于冗余。

本 spec 的目标：**删除 Ops 前端，仅保留平台端 / 企业端 / 员工端三端架构；把 Ops 仍有价值的功能按三端定位重新归位；删除已失效的功能；并为多租户配置隔离打好地基。**

### 三端定位（本 spec 的归属判据）

- **平台端（Platform）**：管租户（企业客户）+ 基础设施。包含模型配置、公共资产、渠道连接器（通路）与治理、设备通路与治理、会话/日志的运维跟踪、网关服务端自更新、exec 策略基础设施。
- **企业端（Enterprise）**：管旗下所有岗位的机器人 + 企业自有资产。包含本企业渠道凭证配置（租户隔离）、机器人业务配置、自有机器人的 exec 审批、岗位机器人定时任务、审计/活动投影。**禁止暴露运行时技术细节**（prompt / workflow / provider / model routing），由 EnterpriseCapabilityProjection 强制。
- **员工端（Employee）**：只消费 + 个人知识沉淀。包含个人设备绑定、个人定时任务、自己的聊天会话、客户端 App「有新版本」提示。**禁止任何模型/渠道/运行时配置**。

### 部署模型（已决策：A 方案）

采用 **A — 平台共享多租户网关 + 配置按 `tenantId` 隔离**。企业各配各的渠道凭证、租户级模型配置等，存储与解析按租户隔离；平台可跨租户运维与治理。这是本 spec 的地基依赖（Phase 0）。

### 关键澄清：两种「更新」

- `update.run`（Ops 那个）= **网关服务端软件自更新**（git pull / npm 重装 openclaw 后重启网关）。A 方案下归 **平台端运维**，不可下放员工端（一个员工触发会升级全平台共享网关）。
- 客户端 App 更新（Mac App）= 独立的 Sparkle + `appcast.xml` 机制，不在网关 RPC 内，不属本 spec 范围；员工端最多展示「有新版本」提示。

### Ops 功能归属总表（本 spec 的核心契约）

| Ops 功能 / API                              | 平台端                        | 企业端                     | 员工端                | 处置                 |
| ------------------------------------------- | ----------------------------- | -------------------------- | --------------------- | -------------------- |
| 渠道 channels                               | 连接器/通路 + 治理            | 凭证配置（tenant-scoped）  | 个人绑定              | 三层拆分             |
| 设备 devices（device.pair/token、node）     | 通路 + 跨租户治理             | —                          | 绑定/管理自己的设备   | 平台 + 员工          |
| 会话 sessions（sessions.list/patch/delete） | 运维跟踪（跨租户/按租户过滤） | （后续）自有机器人会话治理 | 自己的聊天（已有）    | 归位平台运维         |
| 日志 logs（logs.tail）                      | 运维/排障                     | （后续）审计活动投影       | —                     | 归位平台运维         |
| 更新 update.run                             | 平台端运维                    | —                          | （仅 App 新版本提示） | 归位平台运维         |
| 定时任务 cron（cron.\*）                    | —                             | 岗位机器人调度             | 个人定时              | 归位企业 + 员工      |
| 模型/Provider/Key（含 apiKey）              | 基础设施                      | —                          | —                     | 平台保留 + 补 apiKey |
| 配置 config.\*（get/schema/set）            | 模型/渠道目录/系统            | 渠道凭证（tenant-scoped）  | —                     | 按子树拆分           |
| exec 审批 exec.approvals.\*                 | 策略基础设施                  | 治理自有机器人危险操作     | —                     | 平台 + 企业          |
| presence / 实例                             | 已有                          | 已有（mesh）               | —                     | 保留                 |
| debug 任意 RPC 调用                         | —                             | —                          | —                     | 删除（安全风险）     |
| 节点/exec 绑定（tools.exec.node）           | 基础设施（多节点时）          | —                          | —                     | 平台保留             |

### 删除边界

- **删（纯 Ops 前端）**：`ui/src/ui/ports/ops/**`、ops 独占视图 `ui/src/ui/views/{config,cron,debug,logs,nodes,nodes-exec-approvals,sessions}.ts`、`views/control-center.ts`、navigation 的 `CONSOLE_TABS`/`LEGACY_OPS_TABS`/`/ops/*` 路由及对应 i18n。
- **留（共享，三端在用）**：全部后端 RPC（本轮不删后端能力）、`capability/{config,channels,debug,presence,nodes,sessions}`、相关 controllers、`views/{channels,instances,config-form}.ts`。
- **三端在用的「必须留」功能（7 项，删 Ops 零损失）**：`config.get/schema/set`（平台）、`channels.status`+`web.login.*`+`channels.logout`（平台）、`status/health/models.list`（平台模型健康）、`models.probe`（平台）、`presence`（平台+企业）、`node.list/node.invoke`（员工 macOS 授权）、`sessions.list`（员工聊天卡片）。

## Glossary

- **Ops 控制台**：被下线对象 = `ports/ops` + 遗留 `views/{config,cron,debug,logs,nodes,sessions}.ts` + `control-center.ts`。
- **三端**：平台端 / 企业端 / 员工端。
- **tenant-scoped config（租户隔离配置）**：网关配置按 `tenantId` 隔离存储与解析。
- **渠道连接器（通路）**：与外部 IM（飞书/企业微信/钉钉/Telegram 等）对接的内置或插件连接器代码，决定「有哪些渠道可用」。
- **渠道凭证**：某企业自建应用的接入密钥（企业微信 corpId/secret/agentId、企业飞书凭证等）。
- **个人绑定**：员工在企业已开通的渠道内，把自己的账号映射到席位。
- **网关自更新（update.run）**：升级网关服务端软件并重启。
- **must-keep 集**：上述 7 项已被三端消费的功能。

## Requirements

### 需求 1：仅保留三端架构，移除 Ops 前端

**用户故事：** 作为产品负责人，我希望前端只保留平台端 / 企业端 / 员工端三端，移除原 openclaw 单租户运维控制台（Ops port），以消除与多租户 SaaS 定位冲突的冗余入口。

#### 验收标准

1. WHEN 所有归位任务完成后, THE 系统 SHALL 从前端移除 Ops port（`ui/src/ui/ports/ops/**`）、ops 独占视图（`views/{config,cron,debug,logs,nodes,nodes-exec-approvals,sessions}.ts`）、落地页 `views/control-center.ts`。
2. THE 系统 SHALL 从 `navigation.ts` 移除 `CONSOLE_TABS`、`LEGACY_OPS_TABS`、`/ops/*` 路由映射及 `TAB_PORTS` 中的 ops 条目，并移除对应 i18n 文案键。
3. WHEN 用户访问任意旧 `/ops/*` 路径, THE 系统 SHALL 重定向到对应的三端路径或平台端首页，不得出现 404 或空白页。
4. THE 系统 SHALL 保留全部网关后端 RPC 方法（本 spec 不删除任何后端能力）。
5. THE 系统 SHALL 保留被三端复用的共享模块（`capability/{config,channels,debug,presence,nodes,sessions}`、`views/{channels,instances,config-form}.ts` 及相关 controllers）。
6. WHEN Ops 前端被移除后, THE 系统 SHALL 通过 `pnpm build` 与 `pnpm tsgo` 无错误、无悬空 import（dangling import）地完成构建。
7. WHEN Ops 前端被移除后, THE 网关服务端及其子系统（会话存储、cron 调度、设备认证、exec 安全门、配置持久化）SHALL 不受影响地继续运行。
8. THE 系统 SHALL 在 Ops 对应能力的三端归位完成之前，不删除该能力的前端入口（避免迁移期功能空窗）。
9. THE 系统 SHALL 在删除 `views/control-center.ts` 之前，先把仍被三端引用的共享导出（`renderConsoleSubnav` 及其参数类型，当前被 `ports/{platform,enterprise,builder}/view-types.ts` 引用）提取到独立共享模块，避免删除导致三端类型断裂。
10. THE 系统 SHALL 通过全量枚举清理移除 `navigation.ts` 中所有 ops 痕迹（`CONSOLE_TABS`、`LEGACY_OPS_TABS`、`RESERVED_ROUTE_ROOTS`、`TAB_PATHS`、`LEGACY_PATH_TO_TAB`、`TAB_PORTS` 等处），而不是依赖构建报错逐个发现。
11. THE 系统 SHALL 在执行删除前产出一张 cutover matrix：每个旧 Ops 面板 → 新端 surface → 依赖的后端变更 → 测试门禁，作为「可删除」判定依据。

### 需求 2：Scope-aware 协议与多租户配置作用域（地基）

**用户故事：** 作为平台架构师，我需要在**网关协议与服务端**层面引入作用域（scope / tenantId），让每个企业各自配置渠道凭证、租户级模型等且互不可见；隔离必须由**服务端强制**，而非前端过滤。

> 评审结论（已核实）：当前 `config.set` 仅接收全局 `{ raw, baseHash }` 并整树写回（`src/gateway/server-methods/config.ts`）、`channels.status` 返回全局快照（`src/gateway/server-methods/channels.ts`）、`sessions.list` schema 无 `tenantId`（`src/gateway/protocol/schema/sessions.ts`）、`logs.tail` 直接 tail 全局日志、`cron` 无 owner/tenant 归属（`src/gateway/protocol/schema/cron.ts`）、`device.pair.list`/`node.list` 返回全部设备/节点。因此 UI 归位之前必须先在协议与服务端落地作用域，否则只能做前端假隔离。

#### 验收标准

1. THE 平台 SHALL 在 `config.get` / `config.set` / `config.schema` 协议中引入作用域参数（`scope`/`tenantId`），使配置读写可定向到 `platform` 默认或 `tenant:<tenantId>` 覆盖；`config.set` 不再要求整树提交即可写入某作用域的子树。
2. THE 平台 SHALL 在 `channels.status` 协议中支持作用域参数，并在服务端按租户投影返回，仅包含该租户可见的渠道账户与状态。
3. THE 平台 SHALL 为 `sessions.list` 增加 `tenantId`/归属过滤参数，并由**服务端**按归属过滤会话；会话仓库 SHALL 携带租户/归属元数据。
4. THE 平台 SHALL 为 `logs.tail` 增加归属/租户过滤能力（服务端投影），使平台运维可按租户筛选日志；无归属元数据的日志归平台运维全局可见、不下放租户。
5. THE 平台 SHALL 为 `cron` 任务增加 `owner`/`tenant` 归属字段，并在 `cron.list/add/update/remove` 的**服务端**按归属做授权过滤，使企业/个人只能操作各自的任务。
6. THE 平台 SHALL 为设备/节点提供 self-scoped 语义（self-scoped `list`/`remove`/`revoke`），使员工端只能列出与操作本人设备；平台端保留全局治理视角。
7. WHEN 解析某租户的运行时配置, THE 平台 SHALL 按「平台基础设施默认 → 租户覆盖」优先级合并，租户覆盖优先。
8. THE 平台 SHALL 确保一个租户无法读取或写入另一个租户的作用域（跨租户隔离），且该隔离由服务端强制，**前端过滤不得作为隔离手段**。
9. WHERE 某配置项属于平台基础设施（渠道连接器可用性、网关运行时参数）, THE 平台 SHALL 将其保留在平台作用域，不暴露给企业/员工写入。
10. THE 平台 SHALL 确保租户级密钥以 secret ref 或等价脱敏方式存储与传输，不以明文进入面向租户的渲染树。
11. THE 平台 SHALL 为每个「全局 RPC 变多租户/个人视角」的改动提供**服务端测试**（不仅前端可见性测试），覆盖 config/channels/sessions/logs/cron/devices；并通过属性测试验证跨租户读取交集为空、覆盖合并幂等。

### 需求 3：平台端模型管理补全 API Key（含原始故障修复）

**用户故事：** 作为平台管理员，我需要在平台端模型管理直接配置 Provider 的 API Key，以便接入与切换模型（这也是修复「员工端无法对话」根因之一：模型凭证失效后无处在产品内更新）。

#### 验收标准

1. THE 平台端模型管理 SHALL 在「新增 Provider」与「更新 Provider」表单中提供 API Key 输入项（密码态），并在提交时被读取。
2. THE 平台端 SHALL 将 API Key 通过 `config.set` 写入对应作用域的 `models.providers.<id>.apiKey`，接受 inline 字符串、`${ENV_VAR}` env-template 或 secret ref 三种形式。
3. THE 平台端 SHALL 确保 API Key 在**读取/展示**链路上不以明文进入渲染树：`config.get` 对 `models.providers.*.apiKey`（schema `sensitive`）返回脱敏哨兵 `__OPENCLAW_REDACTED__`。
4. WHEN 用户提交以 `__OPENCLAW_REDACTED__` 为值的 API Key（即未修改）, THE 网关 SHALL 通过 `restoreRedactedValues` 还原原有密钥（不被清空/覆盖）。

> 边界说明（评审采纳）：把**新输入的明文 key 物化为磁盘上的 file SecretRef**（避免明文落入 `openbot.json`）需要服务端 secrets 写入能力，属于跨切面密钥处理，归 **需求 2 / Phase 2**（见 2.6、2.10 及新增 task 2.9）。当前仓库既有行为本就允许 inline 明文 provider key（CLI auth 写入 `apiKey: "old-key"`），故 Phase 1 不引入新回归；Phase 1 的保证范围是「UI 不显示明文 + key 可在产品内设置/更新」，磁盘 secret-ref 物化由 Phase 2 落地。

5. THE 平台端类型定义（Provider 新增/更新输入）SHALL 包含 `apiKey` 字段，且 `render-actions` 透传该字段至网关写入链路。
6. WHEN API Key 保存成功, THE 平台端 SHALL 提供可见的保存成功反馈，并支持后续重新探测模型健康（`models.probe`）。
7. IF API Key 为空且 Provider 已存在密钥, THEN THE 平台端 SHALL 保留原密钥而非清空（避免误删凭证）。

### 需求 4：渠道三层归位（连接器/凭证/绑定）

**用户故事：** 作为产品负责人，我希望渠道按三层拆分：平台端开通连接器并治理，企业端配置本企业凭证，员工端绑定个人账号。

#### 验收标准

1. THE 平台端 SHALL 提供渠道连接器目录与开通/启用治理界面，展示平台已打通的渠道类型及其可用性，但不展示任何具体租户的凭证。
2. THE 企业端 SHALL 提供本企业渠道凭证配置界面，仅可配置平台已开通的渠道类型，凭证写入本租户作用域。
3. WHEN 企业端保存渠道凭证, THE 平台 SHALL 将凭证隔离存储到该租户，且不对其它租户或平台端明文展示。
4. THE 员工端 SHALL 提供在企业已配置渠道内绑定/激活个人账号的入口，且不暴露企业凭证或运行时细节。
5. WHERE 当前 `platformAdvanced` 渠道页同时承担了凭证配置, THE 系统 SHALL 将凭证配置职责迁出平台端，平台端仅保留连接器/通路与治理。
6. IF 平台未开通某渠道连接器, THEN THE 企业端 SHALL 不展示该渠道为可配置项。

### 需求 5：设备双层归位（平台通路+治理 / 员工配置）

**用户故事：** 作为平台管理员我需要治理设备接入；作为员工我需要绑定和管理自己的设备。

#### 验收标准

1. THE 平台端 SHALL 提供设备接入的通路与治理界面：可配对设备类型/角色、令牌策略、跨租户的撤销/轮换监督。
2. THE 员工端 SHALL 提供「我的设备」界面：绑定/查看/解绑属于本人的设备，并发起系统授权请求（复用现有 `node.invoke` 的 macOS 授权能力）。
3. WHEN 新设备发起配对, THE 平台端 SHALL 可在治理界面审批；同时保留 `openbot devices` CLI 作为审批通道。
4. THE 系统 SHALL 确保设备认证子系统（device-token、`PAIRING_REQUIRED`）后端不变，仅前端入口按平台/员工分层。
5. THE 员工端设备界面 SHALL 仅展示与操作本人设备，不得跨员工或跨租户可见。

### 需求 6：会话与日志归位平台端运维

**用户故事：** 作为平台运维，我需要在平台端查看会话与日志，用于后期维护与问题跟踪。

#### 验收标准

1. THE 平台端 SHALL 提供会话运维界面，支持查看会话列表，并按 `tenantId` 过滤；保留必要的运维处置（patch/delete）于平台运维范围。
2. THE 平台端 SHALL 提供日志/排障界面，承载 `logs.tail` 能力用于维护与跟踪。
3. THE 平台端会话与日志界面 SHALL 限定为平台运维/超级管理员可见，并确保一个租户的会话/日志不泄露给其它租户。
4. THE 员工端 SHALL 继续仅消费 `sessions.list` 用于自己的聊天会话卡片（保持现状，不获得运维处置能力）。
5. WHERE 企业端后续需要审计, THE 系统 SHALL 以独立的「审计/活动」业务投影提供，与平台运维日志分层，不混用 `logs.tail`。

### 需求 7：定时任务归位企业端与员工端

**用户故事：** 作为企业管理员我需要调度岗位机器人的定时任务；作为员工我需要管理个人助理的定时任务。

#### 验收标准

1. THE 企业端 SHALL 提供岗位机器人定时任务的管理界面（基于 `cron.*`），按租户隔离。
2. THE 员工端 SHALL 提供个人定时任务的管理界面，仅作用于本人可管理的机器人/会话。
3. THE 平台端 SHALL 不承载定时任务管理（平台不拥有机器人）。
4. WHEN 定时任务在企业/员工端创建或修改, THE 系统 SHALL 确保其归属与可见性限定在对应租户/个人范围内。
5. THE cron 调度后端子系统 SHALL 保持不变，仅前端入口按企业/员工归位。

### 需求 8：更新（update.run）归位平台端运维

**用户故事：** 作为平台运维，我需要在平台端触发并跟踪网关服务端自更新；终端用户的客户端 App 更新由 Sparkle 自行处理。

#### 验收标准

1. THE 平台端 SHALL 提供网关服务端自更新（`update.run`）的运维入口，限平台运维角色可执行。
2. THE 系统 SHALL 不在企业端或员工端暴露 `update.run`。
3. THE 员工端 SHALL 最多展示「客户端有新版本可用」提示，且该提示来源于 Sparkle/appcast 机制，不调用 `update.run`。
4. WHEN 平台运维触发 `update.run`, THE 平台端 SHALL 展示更新进度与重启状态反馈。

### 需求 9：exec 审批与节点绑定归位

**用户故事：** 作为平台管理员我维护 exec 策略基础设施；作为企业管理员我治理自有机器人的危险命令执行。

#### 验收标准

1. THE 平台端 SHALL 保留节点/exec 主机绑定与 exec 策略基础设施配置（多节点场景）。
2. THE 企业端 SHALL 提供针对自有机器人的 exec 审批治理界面，按租户隔离。
3. THE exec 审批后端安全门 SHALL 保持不变，删除 Ops 前端不得削弱执行安全约束。

### 需求 10：移除高危/失效能力的前端入口

**用户故事：** 作为安全负责人，我需要移除越权风险与已失效的前端入口。

#### 验收标准

1. THE 系统 SHALL 从所有面向租户的前端移除「任意网关方法调用（debug 任意 RPC）」入口。
2. WHERE 某 Ops 能力在三端均无消费且无归位价值, THE 系统 SHALL 仅移除其前端入口，后端 RPC 是否下线由后续单独评估，不在本 spec 删除。
3. THE 系统 SHALL 确保移除上述入口后不影响三端既有功能与网关运行。

### 需求 11：迁移安全与可回滚

**用户故事：** 作为工程负责人，我需要迁移分阶段、可验证、低风险。

#### 验收标准

1. THE 实施 SHALL 分阶段进行：先建多租户配置地基与平台端归位，再删除 Ops 前端（删除为最后一步）。
2. WHEN 任一阶段完成, THE 系统 SHALL 满足 `pnpm build`、`pnpm tsgo`、`pnpm test` 相关用例通过。
3. WHERE 某归位界面尚未在三端就绪, THE 系统 SHALL 暂不删除 Ops 中对应入口，确保无功能空窗。
4. THE 实施 SHALL 为被删除/归位的导航与路由提供旧路径重定向，保证既有书签可用。
5. THE 实施 SHALL 确保跨租户隔离相关变更具备属性测试覆盖（配置隔离、可见性）。
