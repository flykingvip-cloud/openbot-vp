# Implementation Plan: 平台管理员登录隔离（重新对齐版）

## Overview

> 实施计划于 2026-05-31 基于当前代码库**重新对齐** requirements.md（8 需求）与 design.md（8 组件 + 12 属性）。旧版的 Phase 3（legacy `/admin/login` alias + legacy cookie 迁移）已**整体删除**——这些目标在代码库中不存在。

**技术栈锁定**：TypeScript (strict) + Lit + 现有 `src/gateway/platform-auth/*` 模块。TOTP 本地实现（HMAC-SHA1，`node:crypto`，无新第三方依赖）。

**关键约束（对齐现状）**：

- 不新建登录端点：改 `routes-login-password.ts` 的 `handleLoginRoute`。
- 不新建登录页路由：复用 `/platform/login`（`platformLogin` tab）。
- 不改 cookie 名：保留 `openbot_platform_session`；域隔离落在会话记录 + RPC 守卫。
- 所有新文件走 `CONFIG_DIR`（`~/.openbot`），禁止硬编码 `~/.openclaw`。

**前置门禁（Task 0）**：动工前必须先核对基线，确认与本计划假设一致，否则停下来修计划。

## Tasks

- [x] 0. 基线核对（硬门禁，先做）
  - 已核对：`handleLoginRoute` 仍处理 `${routeBase}/login`；`auth-helpers.ts` 仍导出 `resolvePlatformRole`/`createSessionAndReply`/`recordFailedLogin`/`resolveSessionContext`/`isUserLocked`；`PlatformAuthSessionRecord` 字段一致；cookie `openbot_platform_session`、store `CONFIG_DIR/openbot-platform-auth.json`；`navigation.ts` 有 `platformLogin`→`/platform/login`、`platformDashboard`→`/platform`。全部相符
  - _Validates: 全部（防止再次基于过时假设动工）_

- [x] 1. 会话域基础设施（数据层 + 守卫已实现、已测试、已实时挂载 RPC）
  - [x] 1.1 定义 `SessionDomain` 类型与会话记录扩展
    - 已建 `src/gateway/platform-auth/session-domain.ts`（`SessionDomain` + `deriveSessionDomain` + `isSessionDomainAllowed` + `guardSessionDomain` + 方法注册表）
    - `store-types.ts` 的 `PlatformAuthSessionRecord` 增可选 `domain?`
    - _Validates: 需求 5.1, 5.4_
  - [x] 1.2 `createSessionAndReply` 写入 domain
    - `auth-helpers.ts` 的 `createSessionAndReply` 经 `deriveSessionDomain(context)` 写入会话记录 `domain`（所有签发路径自动生效）
    - _Validates: 需求 5.1_
  - [x] 1.3 实现 `Session_Domain_Guard` 中间件
    - 纯守卫 `guardSessionDomain` 已实现并测试；**已实时挂载到 RPC 分发链**：`GatewayTrustedProxySession`/`PlatformAuthTrustedProxySession`/`GatewayWsClient`/`GatewayClient` 增 `domain`/`sessionDomain`，由 `readPlatformAuthSessionFromRequest` 经 `deriveSessionDomain` 填充，connect 时落到 `client.sessionDomain`，`authorizeGatewayMethod` 首段调 `guardSessionDomain`（未注解方法默认 `"any"`，无 domain 的旧会话按 `"any"` 放行，不影响既有部署）
    - 测试 `server-methods.domain-guard.test.ts`（4 用例）：平台方法对 enterprise 会话拒绝、对 platform 放行、无 domain 放行、unscoped 全放行
    - _Validates: 需求 5.2, 5.3, Property 7_
  - [x] 1.4 会话域单元测试
    - `session-domain.test.ts`（7 用例）：`requiredDomain × session.domain` 矩阵 + 旧记录推导兜底 + unscoped 列举
    - _Validates: Property 6, Property 7_

- [x] 2. MFA：TOTP + 密钥存储
  - [x] 2.1 本地 TOTP 验证器
    - `mfa-totp.ts`：`generateTotpSecret`/`buildOtpAuthUrl`/`verifyTotp`（±1 周期）/`generateRecoveryCodes`/`currentTotp`；仅 `node:crypto`
    - _Validates: 需求 3.3_
  - [x] 2.2 MFA 密钥存储 + Provider
    - `mfa-store.ts`：`MfaSecretRecord` + `getMfaSecret`/`enrollMfa`/`activateMfaEnrollment`/`verifyMfaCode`/`consumeRecoveryCode`/`revokeMfa`/`deleteMfa`/`getMfaEnrollmentState`/`scanMfaOrphans`/`scanMfaOrphansAtStartup`
    - 落盘 `CONFIG_DIR/openbot-platform-auth-mfa.json`，`0o600`；自带 per-file 写锁
    - _Validates: 需求 4.1, 4.2, 4.4, Property 10, Property 11_
  - [x] 2.3 用户视图派生 MFA 启用状态（不泄露密钥）
    - `getMfaEnrollmentState` 仅返回 `{ enabled, enrolledAt?, pending?, secretRevokedAt? }`；密钥/恢复码绝不外泄（测试断言）
    - _Validates: 需求 4.1, 4.2, 4.5_
  - [x] 2.4 启动时 MFA 孤儿扫描
    - `scanMfaOrphansAtStartup(validUserIds)` 已实现并**已接线到 boot 序列**（`server-startup.ts` 的 `startGatewaySidecars`：尽力而为、非阻塞，解析 platform-auth config → 加载 store → 扫描孤儿 → 每孤儿发 `mfa_orphan_detected` 审计并删盘）
    - _Validates: 需求 4.4, Property 11_
  - [x] 2.5 MFA 单元测试
    - `mfa-totp.test.ts`（7）+ `mfa-store.test.ts`（8）：±1 周期、无效码、enroll→activate→verify、pending、revoke、孤儿扫描、恢复码单次、无密钥泄露
    - _Validates: Property 10, Property 11_

- [x] 3. 登录审计
  - [x] 3.1 审计 writer
    - `login-audit.ts`：`PlatformLoginAuditEvent` + `emitPlatformLoginAuditEvent`（追加 JSONL 到 `CONFIG_DIR/audit/platform-auth-login.jsonl`，`0o600`，失败仅 warning）+ `generateRequestId`
    - _Validates: 需求 6.1, 6.2, 6.5, 6.7_
  - [x] 3.2 审计验证
    - 审计在 `login-mfa.integration.test.ts` 覆盖（X-Request-Id 存在、响应无密码泄露）；无秘密入审计由 `emitPlatformLoginAuditEvent` 字段白名单保证
    - _Validates: Property 4, Property 5_

- [x] 4. 在 `handleLoginRoute` 内接入 MFA 关卡 + 审计
  - [x] 4.1 平台路径 MFA 关卡
    - `routes-login-password.ts`：平台账号（`resolvePlatformRole !== null`）在角色校验后过 MFA 关卡，按 `requireMfaForPlatformAdmins` + 注册状态返回 `mfa_required_enroll_first`(412)/`mfa_required`(401)/`mfa_invalid`(401) 或放行；MFA 码错调用 `recordFailedLogin`（共享 lockout）
    - _Validates: 需求 3.1–3.6, 2.2, Property 2, Property 3, Property 9_
  - [x] 4.2 全出口审计发射 + X-Request-Id
    - 每个返回出口前发一条审计事件（去重保证恰好一条）；`X-Request-Id` 响应头已设置
    - _Validates: 需求 2.6, 6.1, 6.3, 6.4, 6.6, Property 1, Property 4_
  - [x] 4.3 MFA enroll（内联于登录流，无需独立端点）
    - 采用「内联自动注册」：`requireMfa && 未注册` → `enrollMfa` 即时签发 pending 密钥 + 返回 `otpAuthUrl`/恢复码；客户端用首个 OTP 重试 → `activateMfaEnrollment` 自动激活并完成登录（单端点闭环，比独立 enroll-start/verify 更简）
    - _Validates: 需求 7.1, 7.4_
  - [x] 4.4 handler 集成测试
    - `login-mfa.integration.test.ts`（6 用例）：MFA off 直登、MFA on 强制注册→验证成功、已注册无码→prompt、错码→invalid、bootstrap 不经 MFA、X-Request-Id+无密码泄露
    - 既有 `platform-auth.test.ts`（17）回归通过（预 MFA 配置补 `requireMfaForPlatformAdmins:false`）
    - _Validates: Property 1, Property 2, Property 3, Property 8, Property 9_

- [x] 5. 平台 MFA 设置开关
  - [x] 5.1 配置读写 + 运行时覆盖 + 审计
    - `GatewayPlatformAuthConfig.requireMfaForPlatformAdmins`（默认 `true`）+ `ResolvedPlatformAuthConfig` 已落地（config 默认）；新增运行时覆盖 `PlatformAuthStore.securityPolicy.requireMfaForPlatformAdmins`（super-admin 可改、无需重启）；`resolveEffectiveMfaPolicy(config, store)` = 覆盖 → 默认；登录关卡与 `buildPlatformAuthState` 均消费有效值；变更经 `handleMfaPolicyRoute` 持久化并发审计事件
    - 新增 HTTP 路由 `POST ${routeBase}/platform/security/mfa-policy`（super-admin only）+ `normalizeStore` 保留 `securityPolicy`
    - 测试 `login-mfa.integration.test.ts`：runtime 切换关闭后免 MFA 登录、无 super-admin 会话返回 403
    - _Validates: 需求 3.7, 3.8_
  - [x] 5.2 系统设置 UI 开关
    - `system-settings/page.ts` 安全态势页用真实 `renderMfaPolicyControl` 替换「强制 MFA（计划中）」占位：显示已启用/已关闭状态、super-admin 可切换、非 super-admin 只读 + 关闭风险文案
    - 控制器 `setPlatformMfaPolicy` + `app.ts` 方法 + `platform-auth-panel` `onSetMfaPolicy` + render-model/port-state/view-state 接线
    - _Validates: 需求 3.7_

- [x] 6. UI：内联 MFA 注册/校验（复用 `/platform/login`）
  - [x] 6.1 登录页处理 MFA 响应码
    - `controllers/platform-auth.ts` 新增 `postPlatformLoginWithMfa`（不抛错，捕获 412 enroll-first / 401 mfa_required|mfa_invalid），平台超管/管理员登录改用之；新增 host 状态 `platformAuthMfaCode`/`platformAuthMfaStage`/`platformAuthMfaEnrollment`
    - `views/auth-home.ts` 新增 `renderMfaSection`：`code` 阶段渲染 OTP 字段；`enroll` 阶段渲染 otpauth setup key + 恢复码列表 + OTP 字段；仅平台登录模式显示
    - i18n：`authHome.form.mfaCode` + `authHome.mfa.*`（en + zh-CN）
    - `app.ts` 增 `@state` 字段、`app-render.ts` 透传 MFA props、`app-view-state-slices.ts` 扩展 Pick
    - 浏览器测试 `auth-home.mfa.browser.test.ts`（4 用例）：none 不渲染、code 渲染 OTP、enroll 渲染 otpauth+恢复码、非平台模式不渲染
    - _Validates: 需求 1.5, 7.1, 7.2_
  - [x] 6.2 平台登录落地校验
    - 现状已确认：平台会话成功后导航 `/platform`（`platformDashboard`，`navigation.ts`），无需改动
    - _Validates: 需求 8.1, 8.3, Property 12_
  - [ ] 6.3 浏览器测试
    - 扩展 `auth-home.browser.test.ts`：`mfa_required_enroll_first` 渲染注册面板、OTP gating、成功后导航 `/platform`
    - _Validates: 需求 1, 7.1, 7.2, 8.1_

- [ ] 7. 集成测试 + 文档
  - [ ] 7.1 端到端集成测试
    - `src/gateway/platform-auth/login-isolation.integration.test.ts`：Flow A（MFA off 登录落地）/ B（开 MFA→强制注册→成功）/ C（公共登录成功 + 平台角色不符）/ D（MFA off 未注册仅密码登录）
    - 断言审计文件含期望事件、无秘密、`0o600`
    - _Validates: 全部 Property_
  - [ ] 7.2 属性测试覆盖审计
    - Property 1/2/3/5/9 的 fast-check 覆盖（分流不签发、域一致、MFA 单调、无泄露、lockout 共享）
    - _Validates: Property 1, 2, 3, 5, 9_
  - [ ] 7.3 文档
    - `docs/gateway/security/index.md`：MFA 管理（开关/吊销/恢复）、会话域守卫说明、审计日志位置
    - `CHANGELOG.md`：platform admin login MFA + session domain isolation + 登录审计（用户向）
    - _Validates: 流程_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": "wave-0", "name": "基线核对", "tasks": ["0"], "dependsOn": [] },
    {
      "id": "wave-1",
      "name": "会话域 + MFA store + 审计（互不依赖）",
      "tasks": ["1.1", "1.2", "1.3", "2.1", "2.2", "2.3", "2.4", "3.1"],
      "dependsOn": ["wave-0"]
    },
    {
      "id": "wave-1-test",
      "name": "基础设施测试",
      "tasks": ["1.4", "2.5", "3.2"],
      "dependsOn": ["wave-1"]
    },
    {
      "id": "wave-2",
      "name": "handler MFA 关卡 + 审计 + enroll",
      "tasks": ["4.1", "4.2", "4.3"],
      "dependsOn": ["wave-1"]
    },
    { "id": "wave-2-test", "name": "handler 测试", "tasks": ["4.4"], "dependsOn": ["wave-2"] },
    { "id": "wave-3", "name": "设置开关", "tasks": ["5.1", "5.2"], "dependsOn": ["wave-2"] },
    {
      "id": "wave-4",
      "name": "UI MFA 注册/校验",
      "tasks": ["6.1", "6.2"],
      "dependsOn": ["wave-2"]
    },
    { "id": "wave-4-test", "name": "UI 测试", "tasks": ["6.3"], "dependsOn": ["wave-4"] },
    {
      "id": "wave-5",
      "name": "集成 + 属性 + 文档",
      "tasks": ["7.1", "7.2", "7.3"],
      "dependsOn": ["wave-2-test", "wave-3", "wave-4-test"]
    }
  ]
}
```

**关键路径**：0 → 2.2 → 4.1 → 6.1 → 7.1

**并行**：

- Wave 1 内会话域（1.x）、MFA store（2.x）、审计（3.1）三组互不依赖，可并行。
- Wave 4 UI（6.x）与 Wave 3 设置（5.x）可在 4.1/4.3 完成后并行。

## Notes

- **预估**：单人约 5–7 个工作日；双人并行 Wave 1 三组约 3–4 天。
- **回滚**：纯增量。MFA 关卡受 `requireMfaForPlatformAdmins` 开关保护，关闭即回到当前行为；域守卫默认 `"any"` 不破坏既有调用；审计为尽力而为不阻塞登录。
- **MFA 逃生通道**：超管可经系统设置关闭开关，或吊销某管理员 MFA 触发重注册。
- **删除项说明**：旧 Phase 3（legacy `/admin/login` alias、legacy cookie 迁移、双 cookie 拆分）已剔除，对应 Property 13–16 一并移除。若未来确需 cookie 物理拆分，另开独立规格。
