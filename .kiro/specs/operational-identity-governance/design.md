# Design Document

> 中文名：运营身份治理（Operational Identity Governance）— **现有 User Operational Identity 的平台归属链与治理面补全**
>
> 状态：**草案（已纳入专家评审反馈）**。先讲清「现状 + 问题」（带 `path:line` 证据），再给方案与接缝；需求条目见 `requirements.md`。
>
> 关联：`.kiro/specs/platform-admin-login-isolation/`（会话域 domain）、`.kiro/specs/model-entitlement-chain/`（平台→套餐→企业→员工授权链）、`.kiro/specs/cost-budget-billing/`（套餐/席位）、`.kiro/specs/ops-decommission/`（员工端渠道绑定，任务 3.3）。

## Overview

> 本节即「背景与目标」。

### 1.0 定位修正（Scope Framing，专家评审采纳）

本规格**不是**「三层重构」、**不**重做 owner/store/runtime——员工端 user-owned 运营身份内核**已成型**（`ownerType="user"`、trusted agent scope、OAuth、runtime/tool、knowledge intent handoff，见 `user-operational-identity-types.ts:17`、`-trusted-agent-scope.ts:71`、`-oauth.ts:107`、`agents/tools/user-operational-identity-tool.ts:76`）。本规格 = **把已存在的 user-owned 运营身份接入平台会话归属链与治理面，并新增企业授权闸口**。

- **既有事实（复用，不重做）**：owner 语义、credential source、OAuth/continuation/runtime/tool、企业端 tenant-owned 运营身份域及其审计。
- **增量接缝（本规格新增）**：① `auth.mode=none` 挂接平台签名会话；② owner 解析统一可信归属范式；③ 三域只读监管面 + 方法级会话域门禁；④ 企业授权闸口进入 allow/deny（P3，非接线）。

### 1.1 业务诉求

把「我的运营身份」纳入清晰的三层治理：

```
平台  —— 员工注册即备案；platform-auth 库是系统级账本；可监测全部员工活动 + 售后
企业  —— 定义谁可用：席位/员工/套餐/数据源凭证授权
员工  —— owner = 平台备案的 user.id；仅能在企业授权内绑定/调用运营身份
```

### 1.2 两个目标

- **目标 A（修复）**：让员工登录后，运营身份能正确解析 owner 并出数据——核心是把「身份归属」与「网关 `auth.mode`」解耦。
- **目标 B（补面）**：新增平台域只读监管面，支撑「平台监测每个员工活动 + 售后」。

### 1.3 非目标（本期不做）

- 不重写运营身份 store/runtime/审计的数据模型（沿用 `user-operational-identity-*.ts`）。
- 不引入数据库/外部 MQ（沿用「租户/owner 键控 JSON + 进程内」范式）。
- 不实现真实支付；套餐/权益沿用 `cost-budget-billing` 与 `model-entitlement-chain` 的既有面。
- 不改 `auth.mode=token`/`trusted-proxy` 的既有访问拒绝语义。

## 2. 现状（As-Is，带证据）

### 2.1 三层身份在代码中的落点

- 会话域：`SessionDomain = "platform" | "enterprise" | "employee"`，由 `sessionKind` 派生——`deriveSessionDomain`（`src/gateway/platform-auth/session-domain.ts:24`）。`platform-super-admin/admin → platform`，`enterprise-admin → enterprise`，其余（`member` 等）→ `employee`。
- 员工备案：员工激活产出 `PlatformAuthUser.activatedUserId` + `PlatformAuthMembership`（`src/gateway/platform-auth/store-types.ts:115` membership、`:138` employee provision）。`user.id` 即稳定身份号，也是席位绑定里的 `employeeId`。
- 企业治理：`EnterprisePositionSeat`（`src/gateway/enterprise-seat-assets-store.ts:113`）、`EnterpriseSeatBinding`（`:130`，employeeId↔seat↔tenant 权威映射）、`EnterpriseAccessPolicy`（`:142`）。

### 2.2 连接层如何挂身份

- `authorizeGatewayConnect`（`src/gateway/auth.ts:447`）：
  - `auth.mode === "trusted-proxy"` 分支：先试代理头，否则 `readPlatformAuthSessionFromRequest`（`src/gateway/platform-auth/session-context.ts:464`）读取**平台签名会话 cookie**，返回 `{ method:"trusted-proxy", user, trustedProxy(含 domain) }`。
  - `auth.mode === "none"` 分支：直接 `return { ok:true, method:"none" }`——**不读 cookie、不挂身份**。
- 写入连接：`message-handler.ts`（`src/gateway/server/ws-connection/message-handler.ts:1132`）只有 `authMethod === "trusted-proxy"` 时才写 `client.user = trustedProxySession.user`、`client.sessionDomain = trustedProxySession.domain`。
- `GatewayClient`（`src/gateway/server-methods/types.ts:15`）仅有 `user?`、`sessionDomain?`，无 tenantId/role/session——handler 需经 attribution helper 再解析。

### 2.3 运营身份 owner 解析（问题点）

- `resolveTrustedPlatformAuthUserId`（`src/gateway/user-operational-identity-session.ts:9`）：`client.user`(email) → 要求 `platformAuth.enabled` → `findUserByEmail` → `user.id`。无 domain 感知。
- `resolveUserOperationalIdentityRuntimeScope`（`src/gateway/user-operational-identity-runtime.ts:31`）：`!client.user` 直接返回 null。
- 结论：**在 `auth.mode=none` 下 `client.user` 恒为空 → 全部运营身份 RPC 被拒**（实测网关日志：`user-operational-identity.list ... Platform auth user is required.`）。

### 2.4 可见域既有范式（应复用）

- `resolveTrustedAttribution`（`src/gateway/scope-attribution.ts:39`）→ `{ tenantId, ownerId }`（经 `resolveBillingScope` `src/gateway/billing/scope.ts:99`，owner = `user.id`，tenant = membership.enterpriseId）。
- `resolveQueryScope`（`src/gateway/scope-attribution.ts:100`）：enterprise+tenant→tenant 域；employee+owner→self 域；否则 platform（全量）。
- 设备模块已示范 employee 自助 owner：`resolveDeviceSelfOwner`（`src/gateway/server-methods/devices.ts:35`，gate on `sessionDomain==="employee"` → `resolveTrustedAttribution().ownerId`）。

### 2.5 平台监管缺口

- 运营身份使用/审计只 owner 自查：list history RPC 强制 `ownerId`（`src/gateway/server-methods/user-operational-identity.ts:283`）、`listUserOperationalIdentityUsageEvents(store, ownerId, ...)`（`src/gateway/user-operational-identity-store.ts:182`）。**无平台域跨租户监管入口**。

### 2.6 企业授权未进入闸口（关键事实，R4 依据）

- `grant`/`binding request`/`usage event` 记录 `tenantId`/`seatId`（`user-operational-identity-types.ts:33`、`user-operational-identity-access.ts:126`），但 `resolveUserOperationalIdentity(...)` 的 allow/deny **只看** ownerId、provider/action、trusted agent scope、explicit/auto grant（`user-operational-identity-access.ts:112,231`），**未纳入** membership/seat binding/企业 entitlement。→「企业决定谁可用」当前是**记录归属**而非**授权门**。

### 2.7 方法级会话域门禁缺失（R8 依据）

- `user-operational-identity.*` / `enterprise-operational-identity.*` 注册了 method scope，但**未**在 `METHOD_REQUIRED_DOMAIN` 声明所需域，`getRequiredDomain` 默认 `"any"` 放行（`src/gateway/platform-auth/session-domain.ts`，`listUnscopedDomainMethods` 即「待收紧」清单）。可见域语义散落在各 handler。

## Architecture

> 方案（To-Be）。下分四个接缝（seam），P1 三个接缝修复出数据，P2 补监管面。

### 3.1 接缝一：身份归属与 auth.mode 解耦（R2，P1 核心）

在 `authorizeGatewayConnect` 的 `auth.mode === "none"` 分支返回前，**追加**平台签名会话读取（与 trusted-proxy 分支一致的 helper）：

```
if (auth.mode === "none") {
  if (req) {
    const platformSession = await readPlatformAuthSessionFromRequest({
      req, trustedProxy: auth.trustedProxy, localDirect,
    });
    if (platformSession) {
      return { ok: true, method: "trusted-proxy", user: platformSession.user, trustedProxy: platformSession };
    }
  }
  return { ok: true, method: "none" };   // 无会话：行为不变
}
```

约束与理由：

- **纯增量**：有合法签名 cookie 才附身份；否则原样放行（R7）。
- cookie 经 `resolvePlatformAuthConfig(trustedProxy)` 决定是否启用 + HMAC 校验（`session-context.ts` `safeEqualSecret`），不可伪造（R2.3）。
- 返回 `method:"trusted-proxy"` 是为了复用 `message-handler.ts:1132` 已有的 `client.user`/`sessionDomain` 写入路径；不新增连接字段。
- 可考虑把「读 cookie 挂身份」抽成一个 `resolvePlatformAuthIdentity(req, auth, localDirect)` 小函数，供 none / trusted-proxy 两分支共用，避免重复。

**决策 D1（已定，专家评审采纳）**：P1 **只修 `auth.mode=none`**（当前根因）；`trusted-proxy` 保持现状；`auth.mode=token` 的平台会话识别**推迟到后续 decision**（token 非根因，且需确认不与 device-token 身份冲突）。身份识别与访问门禁正交的「上提到所有 mode」目标保留为后续，不进首版。

### 3.2 接缝二：登录入口可达（R2.4，P1）

`ui/src/ui/views/overview.ts` 中登录面板渲染条件由 `isTrustedProxy && platformAuthState?.enabled` 放宽为 `platformAuthState?.enabled`（员工/企业登录入口与 `auth.mode` 解耦）。需回归 `overview.browser.test.ts` 既有用例并补 `auth.mode=none` 下展示登录入口的断言。

**待审决策 D2**：`auth.mode=none` 且无平台会话时，控制台默认进入「匿名本地工作台」还是「先引导登录」。倾向：保留匿名可用 + 在「我的运营身份」内引导登录（R3.3），不强制全局登录墙，避免破坏本地单操作员体验。

### 3.3 接缝三：owner 解析走 employee 域范式（R3，P1）

`resolveUserOperationalIdentityRuntimeScope` 与 list RPC 的 owner 解析，从「仅 email→平台用户」改为优先 employee 域范式：

- 新增/改造 `resolveOperationalIdentityOwner(client)`：当 `client.sessionDomain === "employee"`（或 enterprise/platform 代员工操作的受控场景）时，用 `resolveTrustedAttribution(client).ownerId`；保留对 `client.user` email 的兜底以兼容 trusted-proxy 头部会话。
- 不改变 owner 取值（仍是 `user.id`），只改变「从哪条可信链拿到它」，使其与 `resolveQueryScope` 一致、并在 domain 维度可治理。

### 3.4 接缝四：平台监管面（R5/R6，P2）

新增 platform/enterprise 域只读治理读取，复用 `resolveQueryScope` 决定范围：

- 新 RPC（命名建议）`user-operational-identity.governance.overview`：
  - platform 域 → 跨租户聚合；enterprise 域 → 本租户；employee 域 → 拒绝或降级为自身。
  - 返回聚合指标：员工身份数量与状态分布（active/expired/reauth_required）、最近使用/拒绝事件、待续期/风险授权计数；platform 域可按 `tenantId` 下钻。
- store 侧补 owner 无关的聚合读取（如 `listUserOperationalIdentityActivityForScope({ scope })`），**只读、不暴露凭证明文**（R5.3）。
- 审计事件补 `tenantId` 归属（若现状仅存 ownerId），读取按可见域过滤（`isRecordVisibleToScope` `scope-attribution.ts`）。

**双聚合流约束（R5.5，专家评审采纳）**：监管面在 UI 上统一为「Operational Identity Governance」，但内部维持**两条独立聚合流**——tenant-owned **企业**运营身份（`enterprise-operational-identity-*`）与 user-owned **员工**运营身份（`user-operational-identity-*`）。**可统一**：scope/visibility、audit 只读 read model、governance overview；**不可统一**：owner 语义、credential source、authorization subject（不并通用 store / resolver / 可写入口）。

**审计区分（R6，专家评审采纳）**：

- **6A（既有保住）**：usage/deny 事件已 append-only，监管读取直接复用。
- **6B（新增）**：补 create/reauthorize/revoke 的 lifecycle 审计事件（字段/归属与 6A 对齐，纳入同一可见域过滤）。

### 3.5b 接缝五：方法级会话域门禁（R8，P2）

为运营身份相关 RPC 在 `METHOD_REQUIRED_DOMAIN`（`src/gateway/platform-auth/session-domain.ts`）显式声明所需会话域，替代默认 `"any"`：

- 员工自查类（list/usage/绑定流） → `employee`（platform/enterprise 视场景允许）；
- 平台监管 overview → `platform`（enterprise 调用降级为本租户视图，由 `resolveQueryScope` 决定可见行）；
- 门禁（挡入口）与 `resolveQueryScope` 聚合过滤（决定可见行）**叠加**，语义一致；避免可见域只靠 store 过滤兜底。

**待审决策 D3**：平台监管面挂在哪个前端入口——平台控制台新页签，还是并入既有企业数据能力中心的平台视角。倾向：平台控制台独立「运营身份监管」页，企业域复用同 RPC 的租户视图。

### 3.5 可见域矩阵

| 调用方 domain | 运营身份列表/使用  | 监管聚合         | 凭证明文 |
| ------------- | ------------------ | ---------------- | -------- |
| employee      | 自身               | 自身降级         | 否       |
| enterprise    | 本租户员工（只读） | 本租户           | 否       |
| platform      | 全部（只读）       | 全部，按租户下钻 | 否       |

## Components and Interfaces

### C1. 连接鉴权（`src/gateway/auth.ts`）

- `authorizeGatewayConnect(params)`：在 `none`（及待审 D1 的其它模式）分支追加平台会话识别。
- 建议抽取 `resolvePlatformAuthIdentity(req, auth, localDirect): Promise<GatewayAuthResult | null>`，供 `none` / `trusted-proxy` 共用，返回 `{ method:"trusted-proxy", user, trustedProxy }` 或 `null`。
- 输入：`IncomingMessage`、`ResolvedGatewayAuth`、`localDirect`。输出：是否附身份。**不新增 `GatewayClient` 字段**（沿用 `user` / `sessionDomain`）。

### C2. 连接写入（`src/gateway/server/ws-connection/message-handler.ts:1132`）

- 维持现状：`authMethod === "trusted-proxy"` 时写 `client.user` / `client.sessionDomain`。C1 通过返回该 method 复用此路径。

### C3. owner 解析（`src/gateway/user-operational-identity-session.ts` / `-runtime.ts`）

- 新增 `resolveOperationalIdentityOwner(client): Promise<string | null>`：`sessionDomain==="employee"` → `resolveTrustedAttribution(client).ownerId`；兜底 email→平台用户（trusted-proxy 头会话）。
- `resolveUserOperationalIdentityRuntimeScope` 改用之，并放宽「`!client.user` 即 null」为「owner 解析失败才 null」。

### C4. 平台监管 RPC（新增，P2）

- `user-operational-identity.governance.overview`：handler 用 `resolveQueryScope(client)` 决定 platform/tenant/self；调用 store 聚合读取；只读、脱敏。
- 前端：平台控制台「运营身份监管」页（D3 待审），企业域复用同 RPC 的租户视图。

### C5. 登录入口（`ui/src/ui/views/overview.ts`）

- 登录面板渲染条件：`platformAuthState?.enabled`（去掉 `isTrustedProxy &&`）。

## Data Models

> 不新增持久化模型；复用既有结构，仅在审计补租户归属。

- 复用：`PlatformAuthUser`（owner 源）、`PlatformAuthMembership`（owner→tenant）、`EnterpriseSeatBinding`（企业授权权威映射）、运营身份 `UserOperationalIdentityStore`（identities/grants/usageEvents）。
- 审计补字段（P2，向后兼容、可选）：使用/拒绝事件增加 `tenantId?`（由 owner 经 membership 解析）；旧记录无该字段时按 owner→membership 兜底解析归属（D4 待审是否回填）。
- 监管聚合读取（新增、只读）建议形态：
  - `listUserOperationalIdentityActivityForScope({ scope }): { tenantId?; ownerId; identityCounts; recentEvents; pendingReauths; riskyGrants }[]`，按 `QueryScope` 过滤（`isRecordVisibleToScope`）。

## Correctness Properties

### Property 1: 身份不可伪造

仅当平台会话 cookie HMAC 校验通过时，连接才被赋予 `user`/`sessionDomain`；伪造或缺失签名一律不附身份。

**Validates: Requirements 2.1, 2.3**

### Property 2: 非回归

无平台会话时，`auth.mode=none` 连接的授权结果与改动前逐字节一致（`{ ok:true, method:"none" }`）。

**Validates: Requirements 7.1, 7.2**

### Property 3: 门禁不放宽

`auth.mode=token`/`trusted-proxy` 的既有拒绝路径不因身份识别而被绕过。

**Validates: Requirements 7.3**

### Property 4: owner 稳定且唯一

同一员工跨会话/跨 auth.mode 解析出的 ownerId 恒为其 `PlatformAuthUser.id`。

**Validates: Requirements 1.2, 3.2**

### Property 5: 可见域隔离

employee 仅见自身、enterprise 仅见本租户、platform 见全部；任何低权域不得读到越界记录。

**Validates: Requirements 5.1, 5.2, 6.2**

### Property 6: 脱敏

监管/聚合读取不返回凭证明文或运行时密钥。

**Validates: Requirements 5.3**

## Error Handling

- 会话 cookie 解析失败/签名不符：视为无会话，按匿名路径处理，不抛错、不阻断连接（R7）。
- owner 解析失败（无会话）：list 类 RPC 返回空快照 + 明确提示，前端引导登录（R3.3）；runtime scope 返回 null，调用方按「未绑定」分支处理而非崩溃。
- 监管 RPC 越权（employee 调 platform 视图）：拒绝并返回权限错误，附审计。
- 企业授权外的绑定/调用（P3）：hard deny + 拒绝审计（R4.2）。

- **P1（必做，修复出数据）**：3.1 解耦读 cookie（仅 `auth.mode=none`，D1）+ 3.2 登录入口 + 3.3 owner 域解析（统一 `resolveTrustedAttribution`/`resolveQueryScope`，收敛旧 email→user 链）。验收：员工登录后「我的运营身份」正常加载/绑定；无会话本地模式不回归。
- **P2（监管面 + 域门禁）**：3.4 平台/企业只读监管 RPC（双聚合流）+ 前端页 + 审计 tenant 归属补齐（6A 复用 + 6B 新增 lifecycle）+ 3.5b `METHOD_REQUIRED_DOMAIN` 声明（R8）。只读，不动 store 主结构。
- **P3（企业授权闸口，新增非接线）**：把 membership/seat binding/entitlement 真正纳入 `resolveUserOperationalIdentity(...)`（或其外层 enforcement）的 allow/deny（现状 `user-operational-identity-access.ts:112,231` 只看 owner+grant），拒绝即标准化审计；与 `model-entitlement-chain` 的 gate 思路一致；增量不误拒（无企业授权数据/本地模式按既有行为）。

## 5. 风险与回归

- **安全**：连接鉴权属敏感路径。改动须保证「无会话不附身份、不放宽既有拒绝」。需补 `auth.test.ts` 用例：none+合法 cookie→挂身份；none+无 cookie→匿名；none+伪造签名→不挂身份。
- **多代理脏树**：本仓为多代理共享工作树，改动限定在上述接缝文件，避免无关重构。
- **非回归测试**：`overview.browser.test.ts`、`workbench-stage.node.test.ts`（运营身份 tab）、`scope-attribution`/`billing/scope` 相关单测。

## Testing Strategy

> 概要测试计划（详见各 P 阶段）。

1. 连接鉴权解耦：`src/gateway/auth.test.ts` 新增三态用例（见风险节）。
2. owner 域解析：employee 域 + 合法会话 → 返回 owner；无会话 → null/空快照。
3. 监管面可见域：platform=全量、enterprise=本租户、employee=自身/拒绝。
4. 审计归属与可见域过滤。
5. 端到端：本地 `auth.mode=none` 下员工登录 → list RPC 返回非拒绝 → 前端三态渲染。

## 7. 待审决策清单

- **D1（已定）**：P1 只识别 `auth.mode=none` 的平台会话；`trusted-proxy` 现状；`token` 推迟（不进首版）。
- **D2**：`auth.mode=none` 无会话时默认匿名工作台 vs 引导登录（倾向：匿名可用 + 「我的运营身份」内引导登录）。
- **D3**：平台监管面前端入口位置（倾向：平台控制台独立「运营身份监管」页，企业域复用同 RPC 租户视图）。
- **D4**：审计事件是否需要补历史回填 `tenantId`（仅新事件带 vs 迁移旧记录）。
