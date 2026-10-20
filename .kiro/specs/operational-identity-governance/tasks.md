# Implementation Plan: 运营身份治理（Operational Identity Governance）

## Overview

本实施计划落地 `requirements.md` / `design.md` 定义的**治理增量**：把已存在的 user-owned 运营身份接入
**平台会话归属链 + 三域只读监管面 + 方法级会话域门禁**，并把「企业决定谁可用」作为**新增授权闸口**（P3）。

## Agents

- codex-oig · role: owner · scope: operational identity governance UI mount · paths: .kiro/specs/operational-identity-governance/**, src/gateway/auth.platform-identity.test.ts, src/gateway/user-operational-identity**, src/gateway/server-methods/user-operational-identity**, src/gateway/enterprise-operational-identity**, src/gateway/server-methods/enterprise-operational-identity**, ui/src/ui/controllers/user-operational-identity**, ui/src/ui/controllers/operational-identity-governance**, ui/src/ui/views/operational-identity-governance-panel** · since: 2026-06-11

### 定位（强约束）

- **复用，不重做**：owner 语义 / credential source / OAuth / runtime / tool / 企业端 tenant-owned 域均为既有事实。
- **增量接缝**：① `auth.mode=none` 挂平台会话；② owner 解析走 `resolveTrustedAttribution`/`resolveQueryScope`；
  ③ 三域只读监管面 + `METHOD_REQUIRED_DOMAIN`；④ 企业授权闸口进入 allow/deny（P3，新增非接线）。

### 技术栈锁定（不引入新栈）

- 后端 TS（ESM）+ 既有「租户/owner 键控 JSON + 进程内」范式；前端 lit-html + `GatewayBrowserClient`。
- 不引入 DB/MQ；不改 `token`/`trusted-proxy` 既有访问拒绝语义；不新增 `GatewayClient` 字段（沿用 `user`/`sessionDomain`）。

### 实施阶段（对齐 design §实施分期）

- **P1 — 接通归属链（修根因，最高优先）**：解耦读 cookie（仅 `auth.mode=none`）+ 登录入口解耦 + owner 域解析 + 无会话空快照。
- **P2 — 三域只读监管面 + 会话域门禁**：双聚合流监管 RPC + 前端页 + `METHOD_REQUIRED_DOMAIN` + 审计 tenant 归属（6A 复用 / 6B 新增 lifecycle）。
- **P3 — 企业授权闸口**：membership/seat binding/entitlement 进入 `resolveUserOperationalIdentity` allow/deny + 标准化拒绝审计。

### 已锁定决策

- **D1**：P1 只识别 `auth.mode=none` 的平台会话；`trusted-proxy` 现状；`token` 推迟。
- **D2**：无会话保持匿名可用，仅在「我的运营身份」内引导登录（不设全局登录墙）。
- **D5（governance.overview 域门禁，采纳专家反馈）**：运行时门禁是**单值**判定
  （`isSessionDomainAllowed`：`requiredDomain === "any" || requiredDomain === sessionDomain`，
  `session-domain.ts:42-47`），**无法表达 platform∪enterprise**。若把 `governance.overview` 写死
  `requiredDomain=platform`，enterprise 会话会在入口被 `domain_mismatch` 拦掉，与「enterprise 降级租户视图」
  目标自相矛盾。**决策**：保留**单一** `governance.overview` RPC，`requiredDomain` 显式置 `"any"`
  （**清单中唯一允许的 `"any"`，理由见此**），授权在 **handler 内**经 `resolveQueryScope(client)` 权威强制
  （platform=全量 / enterprise=本租户 / employee|无会话=自身或空），**不信任请求参数**。门禁层不挡，scope 层定行。
- **D6（自助方法域归属）**：「我的运营身份」是 **employee 域**产品面，全部自助 `user-operational-identity.*`
  方法（含 OAuth/continuation/binding-request/grants/execute/access.\* 等）均门禁为 `employee`。RPC 门禁仅约束
  **UI 客户端调用**；Agent 运行时工具走**进程内** `enforceUserOperationalIdentityRuntimeAccess`（不经 RPC dispatch，
  不受此门禁影响）。平台/企业管理员对员工身份的可视化经 `governance.overview`（D5），不复用自助 RPC。

## Tasks

- [-] 1. P1：身份归属与 auth.mode 解耦（修根因）
  - [ ] 1.1 抽取并复用平台会话识别 helper（**推迟**：`auth.ts` 由并行工作流编辑中，1.2 逻辑已内联落地；helper 去重为 cosmetic，避让以免冲突）
    - 在 `src/gateway/auth.ts` 抽 `resolvePlatformAuthIdentity({ req, trustedProxy, localDirect })`，
      封装 `readPlatformAuthSessionFromRequest` 调用，返回 `{ method:"trusted-proxy", user, trustedProxy } | null`。
    - `trusted-proxy` 分支的会话 fallback 改用该 helper（行为不变，仅去重）。
    - **范围红线**：该 helper **只用于** `auth.mode=none` 与 `trusted-proxy` fallback；**禁止**扩到 `token`（D1）。
    - _Requirements: 2.1, 2.3_

  - [x] 1.2 `auth.mode=none` 分支挂接平台会话
    - 修改 `src/gateway/auth.ts` 的 `if (auth.mode === "none")` 分支（`auth.ts:511`）：返回前，若 `req` 存在则调
      `resolvePlatformAuthIdentity(...)`；命中则 `return { ok:true, method:"trusted-proxy", user, trustedProxy }`，
      未命中维持 `return { ok:true, method:"none" }`（逐字节不变）。
    - 复用 `message-handler.ts:1132` 既有写入路径（`authMethod==="trusted-proxy"` → `client.user`/`client.sessionDomain`），
      **不新增连接字段**。
    - **P1 不修改 `token` 路径**（D1）：本任务只动 `none` 分支，`token`/`trusted-proxy` 既有拒绝语义不变。
    - _Requirements: 2.1, 2.2, 2.3, 7.1, 7.2, 7.3_

  - [x] 1.3 登录入口与 auth.mode 解耦
    - 修改 `ui/src/ui/views/overview.ts`：登录面板渲染条件由 `isTrustedProxy && platformAuthState?.enabled`
      放宽为 `platformAuthState?.enabled`。
    - _Requirements: 2.4_

  - [x] 1.4 owner 解析走统一可信归属范式
    - 新增 `resolveOperationalIdentityOwner(client)`（`user-operational-identity-session.ts` 或新文件）：
      `sessionDomain==="employee"` → **优先复用** `resolveTrustedAttribution(client).ownerId`（`scope-attribution.ts:37`，
      底层 `readPlatformAuthSessionFromRequest` 已带完整 context + domain，`session-context.ts:425-476`）；
      email→平台用户 链（`user-operational-identity-session.ts:9-23`）仅作 trusted-proxy 头会话兼容兜底。
    - **禁止新建第二套 session 读取链**：不得在 user-identity 侧复制 cookie/session 解析逻辑，统一走既有可信归属。
    - `resolveUserOperationalIdentityRuntimeScope`（`user-operational-identity-runtime.ts:31`）改用之，
      把「`!client.user` 即 null」放宽为「owner 解析失败才 null」。
    - _Requirements: 3.1, 3.2_

  - [x] 1.5 无会话空快照（不报错刷屏，覆盖全部读接口）
    - 员工设置页并行调用三个读接口（`ui/src/ui/controllers/user-operational-identity.ts:216-223`），均须在 owner
      解析失败时返回**空结果**而非抛错：
      - `user-operational-identity.list`（其 payload 内含 identities/grants/usageHistory/providerCatalog）
      - `user-operational-identity.binding-request.list-pending`
      - `user-operational-identity.continuation.list-pending`
    - 任何其它**只读**运营身份 RPC（如单独的 history/providers 读取，若存在）一律同样返回空快照 + `needsLogin` 提示；
      **写类**接口（oauth/grants/revoke/reauthorize/binding-request.create 等）保持「需登录」拒绝语义不变。
    - 前端「我的运营身份」据 `needsLogin` 引导登录，不反复报 `Platform auth user is required.`。
    - _Requirements: 3.3_

  - [x]\* 1.6 P1 测试
    - `src/gateway/auth.test.ts`：none+合法 cookie→挂身份；none+无 cookie→匿名（`method:"none"` 不变）；
      none+伪造签名→不挂身份。
    - owner 域解析单测：employee 域+会话→owner；无会话→空快照。
    - `overview.browser.test.ts`：`auth.mode=none` + `platformAuth.enabled` → 渲染登录入口。
    - _Requirements: 1.2, 2.1, 2.2, 2.3, 2.4, 3.2, 3.3, 7.1, 7.2_

  - [x] 1.7 Checkpoint —— 本地 `auth.mode=none` 下员工登录后「我的运营身份」可加载/绑定；无会话单操作员不回归。

- [x] 2. P2：三域只读监管面 + 会话域门禁（2.0–2.6 已落地）
  - [x] 2.0 审计 tenant 归属补齐（6A 保住 / 6B 起步）
    - 已落地：读侧 owner→membership 兜底解析（`resolveOwnerTenantId`，D4），事件已含 `tenantId?` 字段；
      append 时的权威 tenant 写入推迟到 P3（届时 owner→membership/seat 复核一并处理），保持向后兼容、不动事件语义。
    - _Requirements: 6.1_

  - [x] 2.1 监管聚合读取（store 侧，只读、双聚合流）
    - 已落地：`listUserOperationalIdentityActivityForScope`（`user-operational-identity-governance.ts`），
      按 `QueryScope` 经 `isRecordVisibleToScope` 过滤 user-owned 流；**未**合并 enterprise tenant-owned 流；脱敏（仅计数 + 元数据）。
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.2_

  - [x] 2.2 监管 RPC `user-operational-identity.governance.overview`（单一 RPC，D5）
    - 新建 handler：`resolveQueryScope(client)` → platform 全量 / enterprise 本租户 / employee 降级自身（或空）；
      返回身份数量与状态分布、最近使用/拒绝事件、待续期/风险授权计数，platform 域按 `tenantId` 下钻。
    - **门禁 = `"any"`（D5）**：单值门禁无法表达 platform∪enterprise，故不在入口锁域；**授权完全在 handler 内**
      经 `resolveQueryScope` 权威强制，**不信任** client 传入的 tenantId/scope 参数。
    - **不得**在 handler 层叠加 owner-only RPC（`history.list` / `listUserOperationalIdentityUsageEvents(store, ownerId)`
      `user-operational-identity-store.ts:182-190`）遍历拼装；必须用 2.1 的 scoped aggregator。
    - 注册到 `server-methods-list.ts` + `method-scopes.ts`（READ_SCOPE）。**已在工作区注册**，但因这两个共享注册表当前由
      并行工作流（platform-plan-bundle / sources.sync-log，landing group PM）改动中，按多 agent 安全约定**未由本流提交**；
      handler + 聚合器已提交，注册随 PM 组落地或由其负责人合并。
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 2.3 方法级会话域门禁（R8）+ **完整** requiredDomain 清单
    - 在 `METHOD_REQUIRED_DOMAIN`（`src/gateway/platform-auth/session-domain.ts`）**逐一**声明所有
      `user-operational-identity.*` 方法（运行时 hard gate，入口生效见 `src/gateway/server-methods.ts:82-95`；
      未声明者默认 `"any"`，`session-domain.ts:83-84`）。**完整清单**（对照 `server-methods-list.ts:139-164`，共 26 个自助方法 + 1 个新增监管）：

      | RPC                                                          | requiredDomain | 备注                                                      |
      | ------------------------------------------------------------ | -------------- | --------------------------------------------------------- |
      | `user-operational-identity.list`                             | `employee`     | 读（1.5 空快照）                                          |
      | `user-operational-identity.providers.catalog`                | `employee`     | 读                                                        |
      | `user-operational-identity.history.list`                     | `employee`     | 读（owner usage）                                         |
      | `user-operational-identity.access.list-for-agent`            | `employee`     | 读（agent 可用条目）                                      |
      | `user-operational-identity.access.resolve`                   | `employee`     | 读/判定                                                   |
      | `user-operational-identity.binding-request.get`              | `employee`     | 读                                                        |
      | `user-operational-identity.binding-request.list-pending`     | `employee`     | 读（1.5 空快照）                                          |
      | `user-operational-identity.continuation.get`                 | `employee`     | 读                                                        |
      | `user-operational-identity.continuation.list-pending`        | `employee`     | 读（1.5 空快照）                                          |
      | `user-operational-identity.create`                           | `employee`     | 写                                                        |
      | `user-operational-identity.revoke`                           | `employee`     | 写                                                        |
      | `user-operational-identity.reauthorize`                      | `employee`     | 写                                                        |
      | `user-operational-identity.grants.upsert`                    | `employee`     | 写                                                        |
      | `user-operational-identity.grants.revoke`                    | `employee`     | 写                                                        |
      | `user-operational-identity.execute`                          | `employee`     | 写（UI 触发；运行时工具走进程内，D6）                     |
      | `user-operational-identity.binding-request.create`           | `employee`     | 写                                                        |
      | `user-operational-identity.binding-request.cancel`           | `employee`     | 写                                                        |
      | `user-operational-identity.binding-request.complete`         | `employee`     | 写                                                        |
      | `user-operational-identity.continuation.create`              | `employee`     | 写                                                        |
      | `user-operational-identity.continuation.complete-oauth`      | `employee`     | 写                                                        |
      | `user-operational-identity.continuation.resume`              | `employee`     | 写                                                        |
      | `user-operational-identity.continuation.cancel`              | `employee`     | 写                                                        |
      | `user-operational-identity.oauth.start`                      | `employee`     | 写                                                        |
      | `user-operational-identity.oauth.status`                     | `employee`     | 读                                                        |
      | `user-operational-identity.oauth.simulate-complete`          | `employee`     | 写（测试/模拟）                                           |
      | `user-operational-identity.oauth.cancel`                     | `employee`     | 写                                                        |
      | `user-operational-identity.governance.overview`（新增，2.2） | `"any"`        | **唯一例外**：D5，handler 内 `resolveQueryScope` 权威定域 |

    - **风险**：勿把需平台售后读取的接口锁成 `employee`——售后/平台监测统一走 `governance.overview`（D5），
      不读员工自助 owner-only RPC；故自助 26 个锁 `employee` 不影响平台售后。门禁与 `resolveQueryScope`
      聚合过滤**叠加**（挡入口 + 决定可见行）。
    - **验收红线（采纳专家反馈）**：`METHOD_REQUIRED_DOMAIN` **不得遗漏任何** `user-operational-identity.*` 方法；
      唯一允许保留 `"any"` 的是 `governance.overview`（理由见 D5）。2.6 增加断言：
      `listUnscopedDomainMethods([...all user-operational-identity.* ...])` 仅返回 `governance.overview`。
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 2.4 平台监管前端页（D3）
    - 后端就绪 + **RPC 已注册**：`user-operational-identity.governance.overview` 现已在 `BASE_METHODS` +
      `method-scopes`（READ）注册（仅本流 2 行，未含他人 in-flight 行），handler/聚合器齐备，RPC 可达。
    - **已落地**：监管控制器 `ui/src/ui/controllers/operational-identity-governance.ts`（消费 RPC，scope 由服务端
      据可信会话解析，前端不传 scope）+ 只读面板 `ui/src/ui/views/operational-identity-governance-panel.ts`
      （totals / per-tenant 下钻 / 近期拒绝 / 生命周期审计）+ 浏览器测试（3 绿）。
    - **已补接线**：通过 platform/enterprise port render-model 读取轻量缓存，把面板挂入平台 Dashboard 与企业 Overview；
      避开 `ui/src/ui/app.ts` / `ui/src/ui/app-render.ts` 并行 WIP，不混入其它 agent 改动。— codex-oig
    - _Requirements: 5.1, 5.4, 5.5_

  - [x] 2.5 lifecycle 审计（6B 新增）
    - 已落地：新增 append-only `lifecycleEvents` 流（store 版本 4→5，向后兼容 normalize），在
      create/reauthorize/revoke（含 credential rotation）store 路径统一记录；纳入 `governance.overview`
      同一可见域过滤（`recentLifecycle`）。tenant 归属沿用读侧 owner→membership 兜底（D4）。
    - _Requirements: 6.1, 6.2_

  - [x]\* 2.6 P2 测试
    - 可见域：platform 全量 / enterprise 本租户 / employee 自身或拒绝；域门禁 `domain_mismatch`。
    - 审计归属与可见域过滤；脱敏断言。
    - **门禁完整性断言（采纳专家反馈）**：对全部 `user-operational-identity.*` 方法调用 `getRequiredDomain`，
      断言除 `governance.overview`（`"any"`，D5）外**无任何**方法落 `"any"`；即
      `listUnscopedDomainMethods(allUserOperationalIdentityMethods)` 恰等于 `["user-operational-identity.governance.overview"]`。
    - **跨域准入断言（D5）**：`governance.overview` 在 platform / enterprise 会话下均**不**被 `domain_mismatch` 拦截；
      enterprise 会话经 handler scope 仅见本租户。
    - _Requirements: 5.1, 5.2, 5.3, 6.2, 8.1, 8.2_

- [x] 3. P3：企业授权闸口（新增 allow/deny，非接线）
  - [x] 3.1 授权解析器（membership/seat/entitlement）
    - 已落地：`resolveEmployeeOperationalAuthorization`（`user-operational-identity-enterprise-authorization.ts`）以
      **权威信号**解析——tenant 经 `findMembershipByUserId`（owner→enterpriseId），seat 经 `EnterpriseSeatBinding`
      （employeeId↔seat↔tenant），**不信任**请求参数 tenantId/seatId。
    - **增量不误拒**：无 membership（本地/无企业）或有 membership 但**从未** seat 绑定 → allow；仅当存在 seat 绑定
      且**全部非 active**（revoked/suspended/completed）→ deny（`USER_IDENTITY_ENTERPRISE_SEAT_REVOKED`）。
    - _Requirements: 4.1, 4.3_

  - [x] 3.2 闸口进入 allow/deny
    - 已落地：`resolveUserOperationalIdentity` 新增 `enterpriseAuthorization` 入参，deny 在 owner/grant 评估**之前**
      短路硬拒；audit 一律采用**复核后**的 tenant/seat（覆盖任何传入值）。在 runtime enforcement 链
      （`enforceUserOperationalIdentityRuntimeAccess`，覆盖工具 + `.execute`）与 `.access.resolve` RPC 接线。
    - _Requirements: 4.1, 4.4_

  - [x] 3.3 标准化拒绝审计
    - 已落地：越界拒绝产生标准化 deny usage 事件（denialCode + ownerId + 权威 tenantId），经既有 usageEvents 流
      自动纳入 `governance.overview` 监管面与可见域过滤。
    - _Requirements: 4.2_

  - [x]\* 3.4 P3 测试
    - 已落地：resolver 5 态（未治理/无 membership/无 seat/active/withdrawn）+ 闸口 deny 硬拒+审计 / allow 用权威
      tenant·seat / 未提供授权不误拒（回归）。
    - _Requirements: 4.1, 4.2, 4.4_

  - [x] 3.5 Final Checkpoint —— `pnpm tsgo`（本规格文件无新错）+ `pnpm vitest run src/gateway/user-operational-identity`（49 绿）；安全回归（增量不误拒、deny 走权威 tenant/seat）确认。

## Notes

- 文件路径全部仓库根相对（per AGENTS.md）。
- **安全红线**：连接鉴权为敏感路径——无会话不附身份、不放宽 `token`/`trusted-proxy` 既有拒绝；cookie 必经 HMAC 校验。
- **不合并身份域**（D2/R5.5）：企业 tenant-owned 与员工 user-owned 不并 store/resolver/可写入口；仅统一 scope/visibility/audit-read/overview。
- **多 agent 安全**：改动限定在上述接缝文件，避免无关重构；提交按本仓 landing-group 规则分组。
- 标 `*` 为测试任务，可为加速暂缓，但 P1 的 `auth.test.ts` 三态用例强烈建议保留（敏感路径）。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4"] },
    { "id": 3, "tasks": ["1.5", "1.6"] },
    { "id": 4, "tasks": ["1.7"] },
    { "id": 5, "tasks": ["2.0", "2.1"] },
    { "id": 6, "tasks": ["2.2", "2.3"] },
    { "id": 7, "tasks": ["2.4", "2.5", "2.6"] },
    { "id": 8, "tasks": ["3.1"] },
    { "id": 9, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 10, "tasks": ["3.5"] }
  ]
}
```
