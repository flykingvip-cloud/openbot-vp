# Requirements Document

> 中文名：运营身份治理（Operational Identity Governance）— **现有 User Operational Identity 的平台归属链与治理面补全**
> （平台归属链解耦 + 平台/企业/员工只读监管面 + 企业授权闸口增量）

## Introduction

本规格定义「我的运营身份」（员工个人可被 Agent 调用的对外执行身份）在**平台 / 企业 / 员工**三层下的归属、鉴权与监管模型，并修复当前导致员工端运营身份取不到数据的根因。

### 定位修正（Scope Framing，专家评审采纳）

本规格**不是**「运营身份三层重构」，也**不**重做 owner / store / runtime 模型——员工端 user-owned 运营身份内核**已存在并成型**（`ownerType="user"`、server-side trusted agent scope、OAuth binding、runtime/tool 接入、knowledge intent handoff 均已落地，见 `src/gateway/user-operational-identity-types.ts:17`、`user-operational-identity-trusted-agent-scope.ts:71`、`user-operational-identity-oauth.ts:107`、`src/agents/tools/user-operational-identity-tool.ts:76`）。

本规格的准确定位是：**把已存在的 user-owned 运营身份，接入平台会话归属链与（平台/企业/员工）治理面，并新增企业授权闸口**。据此区分两类工作：

- **既有事实（复用，不重做）**：owner 语义、credential source、OAuth/continuation/runtime/tool、企业端 tenant-owned 运营身份域与其审计。
- **增量接缝（本规格新增）**：① `auth.mode=none` 下挂接平台签名会话；② owner 解析改走统一可信归属范式；③ 三域只读监管面 + 方法级会话域门禁；④ 企业授权闸口真正进入 allow/deny（P3 级新增，非接线）。

本规格是对既有实现（`src/gateway/user-operational-identity-*.ts`、`ops-decommission` 任务 3.3、`enterprise-data-capability-center` 任务 4.2）的**治理增量**，不重写既有 store/runtime 数据模型。

### 被替换 / 修复的现状（Current State，带证据）

- 员工注册/激活在平台 platform-auth 库生成 `PlatformAuthUser`（稳定 `user.id`）+ `PlatformAuthMembership`（→ `enterpriseId`），席位绑定见 `EnterpriseSeatBinding`（`src/gateway/enterprise-seat-assets-store.ts:130`）。员工身份本质上**已在平台备案**。
- 运营身份 owner 解析强依赖平台登录态：`resolveTrustedPlatformAuthUserId`（`src/gateway/user-operational-identity-session.ts:9`）读取 `client.user`(email) → `findUserByEmail` → `user.id`，且要求 `trustedProxy.platformAuth.enabled`。
- 但连接层只在 `auth.mode === "trusted-proxy"` 分支读取平台签名会话 cookie 并挂 `client.user` / `client.sessionDomain`（`src/gateway/auth.ts:447` 的 `authorizeGatewayConnect`；写入处 `src/gateway/server/ws-connection/message-handler.ts:1132`）。在 `auth.mode === "none"` 分支直接 `return { ok:true, method:"none" }`，**丢弃身份**。
- 因此在本地 `auth.mode=none`（即便 `platformAuth.enabled=true`）下，员工连接不带身份 → `resolveUserOperationalIdentityRuntimeScope`（`src/gateway/user-operational-identity-runtime.ts:31`）与 list RPC 因 `client.user` 为空被拒（`Platform auth user is required.`）→ 员工端「我的运营身份」三态全 0。
- `auth.mode=none` 下控制台**不渲染登录入口**（`ui/src/ui/views/overview.ts` 面板条件 `isTrustedProxy && platformAuth.enabled`），员工无从登录。
- 运营身份使用/审计事件**仅 owner 自查**（`src/gateway/server-methods/user-operational-identity.ts:283`、`listUserOperationalIdentityUsageEvents` `src/gateway/user-operational-identity-store.ts:182`），**没有任何平台域跨员工/跨租户的监测入口**，无法支撑「平台监测每个员工活动 + 售后」。
- **企业授权当前未进入授权判定（关键事实）**：`grant`/`binding request`/`usage event` 虽记录了 `tenantId`/`seatId`（`src/gateway/user-operational-identity-types.ts:33`、`user-operational-identity-access.ts:126`），但 `resolveUserOperationalIdentity(...)` 的 allow/deny **只看** ownerId、provider/action、trusted agent scope、explicit/auto grant（`src/gateway/user-operational-identity-access.ts:112,231`），**未把 membership / seat binding / 企业 entitlement 纳入闸口**。即「企业决定谁可用」目前是**记录归属**而非**授权门**。
- **方法级会话域门禁缺失**：`user-operational-identity.*` / `enterprise-operational-identity.*` 已注册 method scope，但**未**在 `METHOD_REQUIRED_DOMAIN` 声明所需会话域，`getRequiredDomain` 默认 `"any"` 放行（`src/gateway/platform-auth/session-domain.ts:53` 区域 + `listUnscopedDomainMethods`）。可见域语义目前散落在各 handler 内部，不够稳。

### 目标架构（Target Architecture）

```
平台（Platform）  —— 员工注册即备案；platform-auth 库 = 系统级账本；可监测全部员工活动 + 售后
   │  开通/管理租户
   ▼
企业（Enterprise）—— 定义谁可用：开席位、派员工、配套餐/属性、授权数据源与凭证
   │  按席位/授权分发
   ▼
员工（Employee）  —— owner = 平台备案的 user.id；仅能在企业授权范围内绑定/调用运营身份
```

### 设计原则（强约束 / 非功能性需求）

1. **身份归属永远经平台备案库解析**：owner = `PlatformAuthUser.id`；服务端解析，**禁止信任浏览器传入 ownerId**。
2. **身份归属与网关 `auth.mode` 解耦**：只要平台签名会话有效，任何 `auth.mode` 都应挂上身份；`auth.mode` 仅决定传输层访问门禁，不决定是否有身份。
3. **平台全可见、企业按租户、员工按自身**：可见域由 `client.sessionDomain` + 归属解析决定（对齐 `src/gateway/scope-attribution.ts:100` `resolveQueryScope`）。
4. **非回归**：无平台会话的本地单操作员模式行为不变（仍可访问，运营身份按设计留空而非报错刷屏）。
5. **可追溯**：身份的创建/重授权/吊销/使用/拒绝均落审计，带 employee + tenant 归属。

## Glossary

- **运营身份（Operational Identity）**：员工个人拥有、可被 Agent 调用的对外执行身份（GitHub / 飞书 / 企业邮箱等），用于内容发布、消息发送、Issue 创建等。
- **平台备案**：员工注册/激活即在平台 platform-auth 库生成 `PlatformAuthUser`（稳定 `user.id`）的过程；平台据此可治理与售后。
- **owner / ownerId**：运营身份的归属者，等于员工的 `PlatformAuthUser.id`，由服务端可信会话解析。
- **会话域（sessionDomain）**：`platform | enterprise | employee`，由登录入口 `sessionKind` 派生，决定可见范围。
- **auth.mode**：网关传输层访问门禁模式（`none | token | password | trusted-proxy`），与「身份归属」正交。
- **membership**：`PlatformAuthMembership`，员工 `user.id` → 所属企业 `enterpriseId` 的映射。
- **席位绑定（SeatBinding）**：`EnterpriseSeatBinding`，员工 ↔ 席位 ↔ 租户的权威映射，企业据此定义谁可用。

## Requirements

### Requirement 1: 员工身份归属与平台备案

**User Story:** 作为平台，我希望每个员工在注册时即在平台备案为稳定身份，以便统一治理与售后。

#### Acceptance Criteria

1. WHEN 一个员工经企业派发/自助注册并激活 THEN 系统 SHALL 在 platform-auth 库存在该员工的 `PlatformAuthUser`（稳定 `user.id`）及指向其企业的 `PlatformAuthMembership`。
2. WHEN 解析某员工运营身份的 owner THEN 系统 SHALL 返回该员工的 `PlatformAuthUser.id`，而非邮箱、席位号或浏览器传入值。
3. IF 请求方在浏览器侧传入 ownerId THEN 系统 SHALL NOT 信任该值，必须由服务端可信会话解析。

### Requirement 2: 身份归属与网关 auth.mode 解耦

**User Story:** 作为员工，我希望登录后无论网关运行在何种 `auth.mode`，我的身份都能被识别，因为我的身份是企业定义、平台备案的，不应被基础设施门禁挡住。

#### Acceptance Criteria

1. WHEN 连接请求携带有效的平台签名会话 cookie AND `trustedProxy.platformAuth.enabled` 为真 THEN 系统 SHALL 在 `authorizeGatewayConnect` 中解析该会话并将 `client.user` 与 `client.sessionDomain` 挂到连接上，**无论 `auth.mode` 是 `none` 还是 `trusted-proxy`**。
2. WHEN 连接请求不携带有效会话 cookie THEN 系统 SHALL 保持原有行为（`auth.mode=none` 仍 `ok` 且匿名；`trusted-proxy` 仍按原规则）。
3. 平台签名会话 cookie SHALL 经 HMAC 校验（`safeEqualSecret`），系统 SHALL NOT 接受未签名或签名不符的会话作为身份来源。
4. WHEN `platformAuth.enabled` 为真 THEN 控制台 SHALL 渲染员工/企业登录入口，不再以 `auth.mode === "trusted-proxy"` 为前置条件。

### Requirement 3: 员工端运营身份按 employee 域解析

**User Story:** 作为员工，我希望我的运营身份按「员工自身」范式解析归属，而不是被当作平台登录用户对待。

#### Acceptance Criteria

1. WHEN `client.sessionDomain === "employee"` AND 已解析出 owner THEN 运营身份相关 RPC SHALL 以该 owner 为 self 范围返回其身份/授权/使用/目录。
2. 运营身份 owner 解析 SHALL 复用统一可信归属范式 `resolveTrustedAttribution(client).ownerId`（= 平台备案 `user.id`）+ employee 域 `resolveQueryScope` 的 self 范围（`src/gateway/scope-attribution.ts:37,99`），而**不再**单独维护 email→平台用户 的查找链（`resolveTrustedPlatformAuthUserId` 的 `client.user(email)→findUserByEmail→user.id`，`src/gateway/user-operational-identity-session.ts:9`）应被该范式取代/收敛，避免两套行为不一致的 owner 解析路径。
3. WHEN owner 无法解析（无会话） THEN 列表类 RPC SHALL 返回空快照并附明确提示，员工端 SHALL 引导登录而非反复报错。

### Requirement 4: 企业治理边界（谁可用由企业定义）—— 新增授权闸口（P3，非接线）

**User Story:** 作为企业管理员，我希望由我决定哪些员工、按什么套餐/属性可以使用哪些运营身份与数据源凭证。

> **现状澄清（专家评审采纳）**：`tenantId`/`seatId` 当前仅被**记录**（grant/binding/usage event），**未**进入 `resolveUserOperationalIdentity(...)` 的 allow/deny 判定（`src/gateway/user-operational-identity-access.ts:112,231`）。因此本需求是**新增的企业授权闸口**，属 P3 级增强，**不是**「复用现有员工身份逻辑稍微接一下」。

#### Acceptance Criteria

1. WHEN 员工尝试绑定/调用某运营身份 THEN 系统 SHALL 在授权判定中**新增**对该员工企业授权范围（membership / seat binding / 角色 / 套餐 / 数据源凭证授权）的校验，闸口 SHALL 落在 `resolveUserOperationalIdentity(...)` 内或其外层 enforcement，而非仅记录归属字段。
2. IF 员工不在企业授权范围内 THEN 系统 SHALL 拒绝并产生一条**标准化**的拒绝审计（带 employee + tenant 归属、denialCode）。
3. 员工的套餐/属性差异 SHALL 来源于企业级订阅/席位绑定（对齐 `billing/` 与 `model-entitlement-chain`），员工端 SHALL NOT 自行提升授权。
4. 本闸口 SHALL 为增量：在企业未配置授权数据或本地单操作员模式下，SHALL 保持既有行为（按 owner + grant 判定），不因引入闸口而误拒。

### Requirement 5: 平台监管面（监测 + 售后）

**User Story:** 作为平台，我希望能跨企业、跨员工监测运营身份的活动与状态，以便监管与售后。

#### Acceptance Criteria

1. WHEN 平台域会话（`sessionDomain === "platform"`）请求运营身份治理视图 THEN 系统 SHALL 返回跨租户/跨员工的聚合活动与状态（只读）。
2. WHEN 企业域会话请求 THEN 系统 SHALL 仅返回本租户范围；WHEN 员工域会话请求 THEN 系统 SHALL 仅返回自身范围。
3. 平台监管视图 SHALL 为只读聚合，SHALL NOT 暴露员工凭证明文或运行时密钥。
4. 平台监管视图 SHALL 至少覆盖：员工身份数量与状态分布、最近使用/拒绝事件、待续期/风险授权计数，按企业可下钻。
5. **双聚合流约束（专家评审采纳）**：平台监管面可在 UI 上统一呈现为「Operational Identity Governance」，但内部 SHALL 维持**两条独立聚合流**——tenant-owned **企业**运营身份（`enterprise-operational-identity-*`）与 user-owned **员工**运营身份（`user-operational-identity-*`）。可统一的是 **scope/visibility、audit 只读 read model、governance overview**；**不可**统一的是 **owner 语义、credential source、authorization subject**——SHALL NOT 强塞为通用 store / 通用 resolver / 通用可写入口。

### Requirement 6: 审计与可追溯（区分 usage 与 lifecycle）

**User Story:** 作为合规/售后，我希望所有运营身份动作都有带归属的审计记录。

> **诚实区分（专家评审采纳）**：员工端**已有 usage history**（使用/拒绝事件，append-only），但**缺**完整的 lifecycle 审计流（创建/重授权/吊销）。故拆为 6A（保住既有）与 6B（新增）。

#### Acceptance Criteria

1. **(6A，既有保住)** WHEN 发生身份**使用/拒绝**（usage/deny） THEN 系统 SHALL 记录事件，含时间、Agent、身份、动作、结果、denialCode、employee(ownerId) 与 tenantId；记录 SHALL 为 append-only，SHALL NOT 被覆盖。
2. **(6B，新增)** WHEN 发生身份**创建/重授权/吊销**（create/reauthorize/revoke）等 lifecycle 动作 THEN 系统 SHALL 新增对应 lifecycle 审计事件，字段与归属与 6A 对齐，并纳入同一可见域过滤。
3. 审计读取 SHALL 遵循可见域：platform=全部、enterprise=本租户、employee=自身。

### Requirement 7: 安全与非回归

**User Story:** 作为平台运维，我希望身份解耦改动是纯增量的，不削弱既有访问门禁，也不破坏本地单操作员体验。

#### Acceptance Criteria

1. WHEN 本地单操作员（无平台会话、`auth.mode=none`）使用系统 THEN 现有非身份相关功能 SHALL 不受影响。
2. 解耦改动 SHALL 为纯增量：有合法会话则附身份，无则按原逻辑放行。
3. 系统 SHALL NOT 因为引入会话读取而放宽 `auth.mode=token`/`trusted-proxy` 既有的访问拒绝规则。

### Requirement 8: 方法级会话域门禁（Session Domain Guard）

**User Story:** 作为平台运维，我希望「platform=全部 / enterprise=本租户 / employee=自身」的可见域语义在方法层稳定声明，而不是散落在各 handler 内部判断。

#### Acceptance Criteria

1. 运营身份相关 RPC（`user-operational-identity.*` 与平台监管读视图）SHALL 在 `METHOD_REQUIRED_DOMAIN` 显式声明所需会话域，而非默认 `"any"`（`src/gateway/platform-auth/session-domain.ts`）。
2. WHEN 会话域与方法所需域不符 THEN 系统 SHALL 以 `domain_mismatch` 拒绝，可见域过滤 SHALL NOT 仅依赖 store 层过滤兜底。
3. 域门禁 SHALL 与 `resolveQueryScope` 聚合过滤**叠加**使用（门禁挡入口，scope 决定可见行），二者语义一致。

## 实施分期（建议，专家评审采纳）

> 收紧 P1/P2/P3 边界，避免把员工运营身份改造成新的跨域权限平台。

- **P1 — 接通归属链（修根因）**
  - `auth.mode=none` 下读取平台签名会话并挂 `client.user` / `client.sessionDomain`（仅 `none`；`trusted-proxy` 维持现状，`token` 见 D1）。
  - overview 登录入口与 `auth.mode` 解耦（`platformAuth.enabled` 即渲染）。
  - owner 解析切到 `resolveTrustedAttribution` / `resolveQueryScope` 范式（R3）。
  - 无会话时 list RPC 返回空快照 + 明确提示（不报错刷屏）。
- **P2 — 三域只读监管面**
  - platform / enterprise / employee 三域只读监管面，基于 `QueryScope` 聚合过滤；**双聚合流**（R5.5）。
  - 为相关方法在 `METHOD_REQUIRED_DOMAIN` 补所需域（R8）。
  - 只做 read model，不动既有 store 主结构。
- **P3 — 企业授权闸口 + lifecycle 审计**
  - 把 membership / seat binding / entitlement 真正纳入 `resolveUserOperationalIdentity(...)` 的 allow/deny（R4）。
  - 拒绝审计标准化 + 补 create/reauthorize/revoke lifecycle 审计（R6.6B）。

## 范围边界与决策（Decisions）

- **D1（auth.mode 范围）**：P1 **只修 `auth.mode=none`**（当前员工端「看不到我的运营身份」的直接根因）；`trusted-proxy` 保持现状；`auth.mode=token` 的平台会话识别**推迟到后续 decision**，不卷入首版（token 不是根因，先修风险最小路径）。
- **D2（不合并身份域）**：企业端 tenant-owned 与员工端 user-owned 运营身份**不做模型合并**；企业端继续负责 tenant-owned 资产，并为员工端**增加**「是否允许绑定/调用某类 personal 运营身份」的授权闸口（治理联动，非模型合并）。
