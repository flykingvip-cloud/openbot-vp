# Requirements Document

> 需求文档：平台管理员登录隔离（重新对齐版）。本文档于 2026-05-31 基于当前代码库**重新对齐**。旧版（基于重构前的 `platform-auth.ts` 4439 行 monolith、虚构的 `/admin/login` 端点与 `_v1` legacy cookie）已废弃。重写依据见下方「现状基线」。

## Introduction

> 简介

本特性强化**平台管理员（`platform-super-admin` / `platform-admin`）**的登录安全姿态，与员工/企业自助登录流程进一步隔离。核心增量是三块当前**完全不存在**的能力：

1. **TOTP MFA**：平台级账号登录的二次验证，由系统设置开关 `requireMfaForPlatformAdmins`（默认 `true`）控制。
2. **结构化登录审计**：每次平台登录尝试写一条 JSONL 审计记录，带 `requestId` 关联，永不记录密码/验证码/会话令牌。
3. **会话域隔离（Session Domain）**：在会话记录上增加 `domain` 字段，并在 RPC 分发链上加域守卫，使非平台会话无法调用平台级 RPC。

以下能力**已在代码库中存在**，本规格仅做「验证 + 必要加固」，不重建（详见「现状基线」）：

- 专用平台登录页 `/platform/login`（`platformLogin` tab，`entryVariant: "platform"`）。
- public auth-home 通过 entryVariant 隔离，不向公众暴露平台模式。
- 角色感知的登录分流（`handleLoginRoute` 按 `expectedPlatformRole` 校验并签发 `platform-super-admin` / `platform-admin` 会话）。
- 平台会话登录后落地 `/platform`（`platformDashboard`）。
- 首次初始化 `platform-bootstrap` 流程（`/platform/bootstrap`）。

**不在范围内（明确剔除）：**

- ~~legacy `/admin/login` 转发别名 + 30 天 sunset~~ —— 该端点从未存在，整块剔除。
- ~~legacy `__openbot_session_v1` cookie 30 天向后兼容窗口~~ —— 该 cookie 从未存在，整块剔除。
- ~~双 cookie 拆分（`__openbot_platform_session` / `__openbot_session`）~~ —— 现有单 cookie `openbot_platform_session` 工作正常且被所有会话类型共用；本规格不重命名 cookie，会话域隔离改为在**会话记录层 + RPC 守卫层**实现（见需求 5），cookie 物理拆分推迟到独立后续规格。
- SSO/IDP 联邦、密码策略改革、WebAuthn（留待兄弟规格）、超出现有 lockout 的反爬限流。

## 现状基线 (Current-State Baseline)（重写依据，全部经代码核对）

| 关注点              | 当前实现位置                                                                                  | 事实                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| platform-auth 结构  | `src/gateway/platform-auth.ts`（facade）+ `src/gateway/platform-auth/*`                       | 已被 `gateway-plugins-monolith-decomposition` 拆解；旧 monolith 行号无效                                           |
| 登录端点            | `routes-login-password.ts` `handleLoginRoute`，路由 `${routeBase}/login`                      | 唯一登录路由；已按 `expectedPlatformRole` / `expectedSessionKind` 分流                                             |
| 角色解析            | `auth-helpers.ts` `resolvePlatformRole` / `isPlatformUser`                                    | 已导出可复用                                                                                                       |
| 用户查找            | `memberships.ts` `findUserByEmail`（无 `loadUser`）                                           | 对已加载 store 调用                                                                                                |
| 会话记录            | `store-types.ts` `PlatformAuthSessionRecord`                                                  | `{ id, userId, createdAt, updatedAt, sessionIssuedAt, expiresAt }`，**无 `domain` / `sessionKind`**                |
| 会话种类            | `auth-helpers.ts` `resolveSessionContext`                                                     | 读取时计算 `platform-super-admin` / `platform-admin` / membershipRole                                              |
| Cookie              | `auth-helpers.ts` `buildCookieHeader`，名 `openbot_platform_session`（`config.ts` 可配置）    | 单 cookie，`Path=/`，`SameSite=Lax`，token=`sessionId.HMAC-SHA256(secret,sessionId)`                               |
| 存储                | `config.ts` `CONFIG_DIR/openbot-platform-auth.json`（`~/.openbot`）                           | 单文件；`~/.openclaw` 仅 legacy 回退                                                                               |
| 前端登录页          | `navigation.ts` `platformLogin` → `/platform/login`；`auth-home.ts` `entryVariant:"platform"` | 已隔离、已自动选 bootstrap/admin-login                                                                             |
| 平台落地            | `navigation.ts` `platformDashboard` → `/platform`                                             | 已存在                                                                                                             |
| MFA / 审计 / 会话域 | ——                                                                                            | **均不存在**（已确认无 `SessionDomain`、`requiredDomain`、`requireMfaForPlatformAdmins`、mfa-secrets、审计 jsonl） |

## Glossary

> 术语表

- **Platform_Login_Surface**：现有专用平台登录页，`platformLogin` tab，规范路由 `/platform/login`（`<basePath>/platform/login`），由 `auth-home.ts` 在 `entryVariant: "platform"` 下渲染。
- **Login_Handler**：现有 `handleLoginRoute`（`routes-login-password.ts`），处理 `POST ${routeBase}/login`。本规格在其内**增加 MFA 关卡与审计发射**，不新建端点。
- **Platform_Login_Path**：当 `Login_Handler` 解析出的账号具备平台角色时所走的逻辑分支（密码 + lockout + MFA 关卡 + 角色校验 + 平台会话签发 + 审计）。
- **Public_Login_Path**：解析出的账号无平台角色时所走的分支（密码 + lockout + 企业/员工会话签发 + 审计），**永不触发 MFA**。
- **Platform_MFA_Setting**：系统设置开关 `platformAuth.requireMfaForPlatformAdmins`，默认 `true`。
- **Platform_MFA_Provider**：签发/校验 TOTP（RFC 6238）的组件；密钥材料仅在该组件内可达。
- **MFA_Secret_Store**：TOTP 密钥与恢复码的持久化存储，键为 `userId`，落盘 `CONFIG_DIR/openbot-platform-auth-mfa.json`（`~/.openbot`），文件权限 `0o600`。
- **Platform_Login_Audit_Event**：每次 `Login_Handler` 调用都发射一条的结构化审计记录，字段见需求 7。
- **Platform_Login_Audit_Log**：审计落盘文件 `CONFIG_DIR/audit/platform-auth-login.jsonl`（`~/.openbot`），行分隔 JSON，文件权限 `0o600`。
- **Session_Domain**：会话记录上新增的必填字段 `"platform" | "enterprise" | "employee"`，由签发分支写入；RPC 守卫据此校验。
- **Session_Domain_Guard**：RPC 分发链上的中间件，比对方法声明的 `requiredDomain` 与会话 `domain`，不匹配返回 `domain_mismatch`。
- **Platform_Default_Landing_Path**：平台会话登录后的落地路由，固定为 `platformDashboard`（`/platform`，含 basePath）。
- **Enterprise_Admin** / **Platform_Admin**：操作主体角色，沿用现有定义。

## Requirements

> 需求

### 需求 1：平台登录页隔离（验证 + 加固现有实现）

**用户故事：** 作为平台超级管理员，我希望我的登录入口与员工/企业自助流程隔离、且不向公众暴露，以便降低钓鱼面与信息架构混淆。

#### 验收标准

1. WHEN 用户访问 `Platform_Login_Surface`（`/platform/login`）, THE UI SHALL 在 `entryVariant: "platform"` 下渲染，仅呈现平台相关模式（`platform-bootstrap` / `platform-super-admin-login` / `platform-admin-login`），不渲染员工/企业/注册模式。
2. WHEN 用户访问 public auth-home（`entryVariant: "public"`）, THE UI SHALL NOT 渲染任何指向平台登录模式的入口或链接以外的平台模式表单。
3. WHERE `state.requiresPlatformBootstrap === true`, THE Platform_Login_Surface SHALL 默认选中 `platform-bootstrap` 并展示首次初始化说明。
4. WHERE `state.requiresPlatformBootstrap === false`, THE Platform_Login_Surface SHALL 默认选中 `platform-admin-login`（或在可用时 `platform-super-admin-login`）。
5. THE 本需求 SHALL 以「验证现有 `/platform/login` 行为 + 必要时补测」为主，SHALL NOT 新增 `/platform/auth/login` 路径或重复的登录页组件。

### 需求 2：登录分流应用平台级安全默认（扩展 `Login_Handler`）

**用户故事：** 作为安全运维，我希望平台级登录在协议层就强制 MFA 与审计，使任何走 `Login_Handler` 的平台账号都无法绕过这些默认。

#### 验收标准

1. WHEN 客户端 `POST ${routeBase}/login`, THE Login_Handler SHALL 先按邮箱解析用户，再依 `resolvePlatformRole(user)` 选择 `Platform_Login_Path`（有平台角色）或 `Public_Login_Path`（无平台角色）。
2. WHEN 走 `Platform_Login_Path`, THE Login_Handler SHALL 仅签发 `Session_Domain === "platform"` 且 `sessionKind ∈ {platform-super-admin, platform-admin}` 的会话。
3. WHEN 走 `Public_Login_Path`, THE Login_Handler SHALL 仅签发 `Session_Domain ∈ {employee, enterprise}` 的会话，且 SHALL NOT 触发 MFA。
4. WHEN 请求带 `expectedPlatformRole` 且走 `Platform_Login_Path`, THE Login_Handler SHALL 沿用现有行为，角色不符返回 `PLATFORM_AUTH_ROLE_MISMATCH`（保持现状，不回归）。
5. IF 账号被 suspend, THEN THE Login_Handler SHALL 返回账号停用错误，不论凭据是否正确。
6. WHILE `Login_Handler` 处理任意请求, THE Login_Handler SHALL 在返回响应前发射恰好一条 `Platform_Login_Audit_Event`（见需求 7）。

### 需求 3：平台 MFA 关卡与系统设置开关

**用户故事：** 作为平台超级管理员，我希望平台登录默认开启 MFA，并可在恢复/受控环境下临时放宽，以平衡默认安全与运维灵活性。

#### 验收标准

1. WHILE `Platform_MFA_Setting === true`, WHEN `Platform_Login_Path` 收到一个 MFA 未注册账号的登录请求, THE Login_Handler SHALL 返回 `mfa_required_enroll_first` 并在 payload 中带注册入口信息。
2. WHILE `Platform_MFA_Setting === true`, WHEN `Platform_Login_Path` 收到已注册 MFA 但缺 `mfaCode` 的请求, THE Login_Handler SHALL 返回 `mfa_required` 且 SHALL NOT 签发会话。
3. WHEN `Platform_Login_Path` 收到 `mfaCode`, THE Platform_MFA_Provider SHALL 校验该码，失败返回 `mfa_invalid`。
4. WHILE `Platform_MFA_Setting === false`, WHEN 缺 `mfaCode` 且账号已注册 MFA, THE Login_Handler SHALL 在仅 `{email, password}` 下允许登录；若带 `mfaCode` 仍 SHALL 校验之。
5. WHILE `Platform_MFA_Setting === false`, WHEN 账号未注册 MFA, THE Login_Handler SHALL 允许登录且不提示 MFA。
6. WHEN 平台会话被签发, THE Login_Handler SHALL 在对应审计事件上记录 `mfaUsed: boolean`。
7. WHEN 平台超级管理员打开系统设置, THE UI SHALL 暴露绑定 `platformAuth.requireMfaForPlatformAdmins` 的开关，并说明关闭会降低安全与审计保证。
8. WHEN `Platform_MFA_Setting` 被变更, THE Gateway SHALL 持久化新值并发射一条配置审计事件（含旧值/新值）。

### 需求 4：MFA 密钥模型与启用状态暴露（不泄露密钥）

**用户故事：** 作为读取用户记录的开发者，我希望能拿到「该用户是否启用 MFA」这一语义，但绝不会把 TOTP 密钥加载进内存。

#### 验收标准

1. WHEN 任意代码经现有 `findUserByEmail` / store 访问用户, THE 返回值 SHALL 可附带 `mfa?: { enabled, enrolledAt?, pending?, secretRevokedAt? }` 派生状态，且 SHALL NOT 包含 TOTP 密钥或恢复码。
2. THE TOTP 密钥与恢复码 SHALL 仅经 `Platform_MFA_Provider` API（`getMfaSecret`、`verifyTotp`、`consumeRecoveryCode`、`enrollMfa`、`revokeMfa`）可达，存于 `MFA_Secret_Store`。
3. WHEN 用户被删除, THE Gateway SHALL 在同一写事务内移除用户记录与其 MFA 密钥；部分失败 SHALL 回滚。
4. WHEN Gateway 启动, THE Gateway SHALL 扫描 `MFA_Secret_Store`，对 `userId` 已不存在于用户库的记录逐条发射 `mfa_orphan_detected` 审计事件并从磁盘移除。
5. WHEN 用户邮箱变更, THE Gateway SHALL 更新用户记录但 SHALL NOT 变更 `userId`（MFA 记录的不可变连接键）。

### 需求 5：会话域隔离（会话记录层 + RPC 守卫层）

**用户故事：** 作为安全运维，我希望平台会话与非平台会话在数据层隔离，使服务端缺陷无法用非平台会话调用平台 RPC。

#### 验收标准

1. WHEN 任意会话记录被创建（platform/employee/enterprise）, THE Gateway SHALL 在 `PlatformAuthSessionRecord` 上写入 `Session_Domain`，取值与签发分支一致。
2. WHEN 任意 RPC 方法被调用, THE Session_Domain_Guard SHALL 比对方法注册的 `requiredDomain` 与会话记录的 `Session_Domain`，不匹配返回 HTTP 401 `domain_mismatch`。
3. WHERE RPC 方法未声明 `requiredDomain`, THE Session_Domain_Guard SHALL 默认按 `"any"` 放行，并在启动时列出所有 `"any"` 方法名以便后续逐个收紧（一次性全量注解不在范围内）。
4. WHEN 既有会话记录（升级前创建、无 `domain` 字段）被读取, THE Gateway SHALL 依据该会话用户的角色推导 `Session_Domain` 兜底，SHALL NOT 因缺字段而拒绝既有会话。
5. THE 本规格 SHALL NOT 重命名或拆分现有 `openbot_platform_session` cookie；会话域信息 SHALL 仅落在会话记录与 RPC 守卫，不引入新 cookie。

### 需求 6：平台登录审计（发射、关联、可查）

**用户故事：** 作为做事件响应的安全运维，我希望每次登录尝试都留下带请求关联 ID 的结构化记录，以便从 SIEM 透视到具体账号、IP 或单次多步流程。

#### 验收标准

1. WHEN `{登录成功, 登录失败, MFA 失败, 需先注册 MFA, 角色不符, 账号停用, 账号锁定, 公共回退重定向, 未预期错误}` 中任一发生于 `Login_Handler`, THE Gateway SHALL 发射一条 `Platform_Login_Audit_Event`。
2. WHEN 发射 `Platform_Login_Audit_Event`, THE Gateway SHALL 追加写入 `Platform_Login_Audit_Log`，行分隔 JSON，文件权限 `0o600`。
3. WHEN 审计描述成功签发, THE 事件 SHALL 含 `sessionKind`、`mfaUsed`、`Session_Domain`。
4. WHEN 审计描述失败/重定向, THE 事件 SHALL 含 `outcome` 枚举 `{success, invalid_credentials, mfa_required, mfa_invalid, mfa_required_enroll_first, role_mismatch, account_suspended, account_locked, redirected, unexpected_error}`。
5. WHILE 写审计, THE Gateway SHALL NOT 记录密码、MFA 码、恢复码或任何会话令牌材料。
6. WHEN `Login_Handler` 处理请求, THE Gateway SHALL 生成 `requestId`（上游未提供则 UUID v4），写入该请求的每条审计事件，并以 `X-Request-Id` 响应头回显。
7. WHEN 审计写入失败, THE Gateway SHALL 记录 warning 但 SHALL NOT 阻塞登录响应（审计为尽力而为）。

### 需求 7：MFA 升级迁移安全

**用户故事：** 作为升级前尚未注册 MFA 的存量运维，我希望升级后有安全的注册路径，使新的 MFA 默认不会在升级时把我锁在门外。

#### 验收标准

1. WHEN `Platform_MFA_Setting === true` 且某未注册 MFA 的平台账号升级后首次登录, THE Login_Handler SHALL 返回 `mfa_required_enroll_first`，且 THE UI SHALL 在 `Platform_Login_Surface` 内联渲染注册流程。
2. WHEN 内联注册成功, THE UI SHALL 用刚生成的首个 MFA 码自动重试登录，成功后导航至 `Platform_Default_Landing_Path`。
3. WHILE 升级后尚无平台超管成功登录, THE Login_Handler SHALL 照常接受 `platform-bootstrap`（视为恢复路径），且 bootstrap SHALL NOT 要求 MFA。
4. WHEN 某平台管理员的 MFA 密钥被超管吊销, THE Login_Handler SHALL 在其下次登录时视为未注册并再次走内联注册流程。
5. IF 部署在首次升级登录前显式关闭 `Platform_MFA_Setting`, THEN 不强制注册，存量账号 SHALL 继续以 `{email, password}` 工作。

### 需求 8：平台会话登录后统一落地

**用户故事：** 作为平台管理员，我希望每次平台登录都落到同一工作区起始页，使审计与 runbook 能引用单一规范入口。

#### 验收标准

1. WHEN 平台会话经 `Platform_Login_Path` 签发, THE UI SHALL 在响应处理后导航至 `Platform_Default_Landing_Path`（`/platform`）。
2. WHEN 非平台会话经 `Public_Login_Path` 签发, THE UI SHALL 按现有行为导航。
3. WHEN 平台会话由持久化令牌恢复（刷新）, THE UI SHALL 渲染属于平台 port 的上次访问 tab，否则回退到 `Platform_Default_Landing_Path`。
