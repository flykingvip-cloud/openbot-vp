# OpenBot 最终版注册登录流程方案

日期：2026-04-13  
状态：待评审  
适用范围：OpenBot 独立首页、平台端、企业端、员工端、网关本地认证存储

## 1. 文档目标

本文档用于定义 OpenBot 最终版企业注册、员工注册、登录、试用、验证码、密码与邮箱验证体系。

目标不是描述当前实现，而是给出一版可落地、可评审、可进入最终开发的注册登录方案。

本文档同时结合了当前已存在的注册实现，明确哪些逻辑可以继承，哪些逻辑必须重构。

## 2. 当前实现现状

当前系统已经具备最小可用的本地平台认证能力，核心实现位于：

- `src/gateway/platform-auth.ts`
- `ui/src/ui/controllers/platform-auth.ts`
- `ui/src/ui/app-render.ts`

### 2.1 当前已实现能力

- 开启 `trustedProxy.platformAuth.enabled` 后，可启用平台注册登录。
- 数据存储在本地 JSON 文件 `openbot-platform-auth.json` 中。
- 已存在的核心实体：
  - `tenants`
  - `users`
  - `sessions`
  - `memberships`
  - `invites`
- 支持：
  - 用户注册
  - 用户登录
  - 会话 Cookie
  - 企业邀请码生成
  - 邀请码撤销
  - 企业成员移除
- 密码已采用 `scrypt` 哈希，而非明文存储。

### 2.2 当前主要问题

当前实现仍然是“用户主导注册”，不符合 OpenBot 现在要的“企业先建、员工后激活”的体系。

具体问题如下：

1. 没有密码找回。
2. 没有修改密码。
3. 没有邮箱验证。
4. 没有企业试用时长配置。
5. 没有企业试用席位数量配置。
6. 员工注册仍然允许通过租户级邀请码加入，不是员工级验证码。
7. 员工验证码没有绑定员工姓名或员工邮箱。
8. 后续无邀请码用户可能自动并入“最早创建的租户”，这与企业归属模型冲突。
9. 没有试用到期后的续费或联系顾问流程。
10. 没有企业自助创建与平台代创建两条完整企业创建链路。
11. 没有验证码安全层、并发一致性、审计日志与基础风控的完整设计。

## 3. 最终设计原则

最终版注册登录体系必须满足以下原则：

1. 员工不能自由选择企业。
2. 员工不能自行创建企业归属。
3. 员工注册必须建立在企业已预创建员工记录的前提上。
4. 员工注册码必须天然携带企业归属信息。
5. 员工注册码必须是一人一码、一次性、可失效、可审计。
6. 企业试用时长必须可后台配置。
7. 企业试用账号数量必须可后台配置。
8. 企业试用到期后必须进入明确的付费或联系顾问流程。
9. 企业注册必须同时支持“企业自助创建”和“平台代创建”两种方式。
10. 首页不暴露复杂后台逻辑，只保留明确的用户入口。
11. 第一版产品能力明确采用单企业上下文，不支持“一邮箱多企业”。
12. 认证写操作必须具备串行一致性，不能依赖乐观假设。

## 4. 架构前提与角色模型

### 4.1 第一版架构前提

第一版明确采用单企业上下文模型：

1. 一个邮箱只对应一个 `user`。
2. 一个 `user` 第一版只归属一个 `enterprise`。
3. 登录成功后，可直接推导唯一企业上下文。
4. 数据结构可为未来“一个用户属于多个企业”预留扩展空间，但第一版产品与接口明确不支持。

这样可以避免首版在登录、忘记密码、邮箱验证、试用状态判断、工作台跳转上出现复杂分叉。

### 4.2 角色

系统最终涉及四类角色：

1. 平台管理员
2. 企业管理员
3. 企业员工
4. 平台销售或客户顾问

## 5. 对象模型

### 5.1 企业租户 `enterprise`

表示一个企业工作台实例。

建议字段：

- `id`
- `name`
- `slug`
- `status`
- `plan`
- `createdSource`
- `createdByPlatformUserId?`
- `billingStatus`
- `createdAt`
- `updatedAt`
- `trialStartedAt`
- `trialEndsAt`
- `trialExpiredAt`
- `trialDaysSnapshot`
- `trialSeatQuotaSnapshot`
- `seatQuota`
- `seatUsed`
- `expiredHandledAt`
- `allowReadOnlyAfterExpiry`
- `upgradeUrl`
- `contactAdvisorUrl`
- `salesOwnerId`

字段说明：

- `createdSource`
  - `self-service`
  - `platform-created`
- `billingStatus`
  - 与 `plan` 互补，描述计费侧状态
- `allowReadOnlyAfterExpiry`
  - 控制企业管理员在试用过期后是否允许只读访问

### 5.2 用户 `user`

表示一个已激活的真实登录账号。

建议字段：

- `id`
- `email`
- `normalizedEmail`
- `displayName`
- `passwordHash`
- `passwordUpdatedAt`
- `emailVerifiedAt`
- `lastLoginAt`
- `loginFailedCount`
- `lockedUntil`
- `status`
- `source`
- `createdAt`
- `updatedAt`

字段说明：

- `normalizedEmail`
  - 必须为统一 lower-case、trim 后的邮箱值
  - 所有邮箱比较必须基于该字段
- `source`
  - `self-created`
  - `admin-activated`
  - `platform-created`

### 5.3 企业成员关系 `membership`

表示用户与企业之间的归属关系。

建议字段：

- `id`
- `userId`
- `enterpriseId`
- `membershipRole`
- `createdAt`
- `updatedAt`

其中 `membershipRole` 第一版建议仅保留：

- `enterprise-admin`
- `member`

### 5.4 员工预创建记录 `employeeProvision`

表示企业管理员已经为某位员工预建了一个待激活席位或待激活身份。

建议字段：

- `id`
- `enterpriseId`
- `employeeName`
- `employeeEmail`
- `normalizedEmployeeEmail`
- `status`
- `createdByUserId`
- `lastCodeIssuedAt`
- `codeIssueCount`
- `revokedReason`
- `activationAttemptCount`
- `activatedUserId`
- `activatedAt`
- `createdAt`
- `updatedAt`

### 5.5 激活验证码 `activationCode`

用于管理员激活和员工激活。

建议拆为两类：

- `enterpriseAdminActivation`
- `employeeActivation`

共同字段建议为：

- `id`
- `enterpriseId`
- `provisionId?`
- `email`
- `codeHash`
- `displayCode`
- `codeType`
- `status`
- `attemptCount`
- `maxAttempts`
- `issuedByUserId`
- `deliveryChannel`
- `replacedByCodeId?`
- `replacesCodeId?`
- `createdAt`
- `updatedAt`
- `expiresAt`
- `claimedAt`
- `claimedByUserId`
- `revokedAt`

字段说明：

- `codeHash`
  - 持久化时只存哈希，不存可直接使用的明文凭证
- `displayCode`
  - 仅用于后台识别或人工核对，不作为唯一安全凭证
- `deliveryChannel`
  - `email`
  - `manual`

### 5.6 会话 `session`

第一版会话中建议显式保存：

- `sessionId`
- `userId`
- `enterpriseId`
- `membershipRole`
- `sessionIssuedAt`
- `expiresAt`

说明：

- 会话中存放企业上下文快照，便于稳定渲染与跳转。
- 敏感权限判断仍建议实时查询，避免角色调整后旧快照继续放权。

## 6. 唯一约束与索引

第一版建议明确以下约束：

1. `enterprise.slug` 唯一
2. `user.normalizedEmail` 唯一
3. `membership(userId, enterpriseId)` 唯一
4. `employeeProvision(enterpriseId, normalizedEmployeeEmail)` 在 `pending_activation` 和 `activated` 状态下唯一
5. `activationCode.codeHash` 唯一

## 7. 企业生命周期状态

企业建议使用以下生命周期状态：

- `trial`
- `paid`
- `suspended`
- `expired`

说明：

- `trial`：试用期内，可正常使用。
- `paid`：已付费，可正常使用。
- `suspended`：被平台暂停。
- `expired`：试用结束但未付费，仅允许进入升级或联系顾问流程。

## 8. 平台级试用策略

试用必须是平台配置项，而不是写死逻辑。

### 8.1 平台后台配置项

建议平台端后台增加以下配置：

- `defaultTrialDays`
- `allowedTrialDays`
- `defaultTrialSeatCount`
- `trialSeatOptions`
- `allowCustomTrialSeatCount`
- `trialExpiryPolicy`
- `upgradeUrl`
- `contactAdvisorUrl`

### 8.2 推荐解释

- `defaultTrialDays`
  - 新企业默认试用天数，例如 `5`、`10`、`15`
- `allowedTrialDays`
  - 平台后台允许选择的标准试用天数集合
- `defaultTrialSeatCount`
  - 默认试用账号数量
- `trialSeatOptions`
  - 平台支持的快捷席位数选项，例如 `1 / 3 / 5 / 10`
- `allowCustomTrialSeatCount`
  - 是否允许后台管理员输入自定义试用席位数
- `trialExpiryPolicy`
  - `redirect_to_upgrade`
  - `redirect_to_sales`
  - `choose`

### 8.3 企业创建时固化快照

企业创建成功时，系统必须把当前试用策略写入企业自身，避免后续平台修改默认策略时影响历史企业。

即企业创建时写入：

- `trialDaysSnapshot`
- `trialStartedAt`
- `trialEndsAt`
- `trialSeatQuotaSnapshot`
- `seatQuota`
- `seatUsed`

这样平台后来把默认试用天数从 `5` 改成 `10`，也不会影响已创建企业。

## 9. 试用席位规则

### 9.1 席位定义

建议席位按“已激活账号数”计算，而不是按“已发验证码数”计算。

推荐规则：

1. 企业管理员占用席位。
2. 已激活员工账号占用席位。
3. 仅预创建员工记录，不占席位。
4. 仅发送员工验证码，不占席位。
5. 员工真正激活成功时，席位才加一。

### 9.2 企业管理员是否占用试用席位

建议：占用。

原因：

- 企业管理员本质上也是可使用工作台的人。
- 这样“试用账号数”在产品认知上更清晰。

### 9.3 录入、发码、激活与席位校验

最终建议如下：

1. 允许企业管理员先录入员工预创建记录。
2. 录入员工记录本身不占用席位。
3. 发放验证码时检查可用席位。
4. 员工激活时再次校验席位。
5. 当企业试用席位已满但试用期未结束时，企业管理员仍可看到：
   - `升级企业方案`
   - `联系专属客户顾问`

这样可以把“组织录入”与“试用席位”解耦，避免企业端操作过于僵硬。

## 10. 企业创建路径

企业创建必须支持两种路径。

### 10.1 路径 A：企业自助创建企业租户

适用于企业自己从 OpenBot 首页进入。

#### 企业自助创建流程

1. 企业管理员进入首页。
2. 选择“创建企业”入口。
3. 填写：
   - 企业名称
   - 管理员姓名
   - 管理员邮箱
4. 系统创建：
   - 企业租户
   - 企业管理员待激活记录
   - 企业试用快照
   - 企业管理员激活验证码
5. 系统向管理员邮箱发送激活邮件或激活验证码。
6. 管理员完成邮箱验证、设置密码。
7. 系统创建管理员正式账号并自动登录。
8. 管理员进入企业端后台，可开始给员工创建账户并发码。

#### 路径 A 特点

- 企业名称只在此路径中填写一次。
- 该企业自动获得后台配置好的试用天数与试用席位。
- 管理员是企业首个正式成员。

### 10.2 路径 B：平台端代创建企业租户

适用于平台侧销售、运营或客户成功团队。

#### 平台代创建流程

1. 平台管理员在平台后台创建企业。
2. 填写：
   - 企业名称
   - 管理员姓名
   - 管理员邮箱
   - 试用天数
   - 试用席位数
   - 顾问或升级链接
3. 系统创建：
   - 企业租户
   - 企业管理员待激活记录
   - 企业试用快照
   - 企业管理员激活验证码
4. 管理员收到激活通知。
5. 管理员激活账号、设置密码。
6. 登录企业端，为员工发放验证码。

#### 路径 B 特点

- 企业不需要在首页自助创建。
- 平台可直接干预试用时长、席位、销售归属。

## 11. 员工账户创建流程

员工不能直接注册一个未知归属的账号。

员工创建账户必须遵循“企业预创建 -> 员工激活”的流程。

### 11.1 企业管理员预创建员工

企业管理员在企业后台录入：

- 员工姓名
- 员工邮箱

系统创建一条 `employeeProvision` 记录，状态为：

- `pending_activation`

同时生成一条员工专属激活验证码，状态为：

- `active`

### 11.2 员工验证码规则

员工验证码必须满足以下规则：

1. 一人一码
2. 一码绑定一个企业
3. 一码绑定一个员工邮箱
4. 一码一次性使用
5. 可设置过期时间
6. 可撤销
7. 可审计

#### 安全规则

员工验证码不能继续使用“短格式顺序码”作为唯一安全凭证。

推荐采用“双层码”：

1. 后台展示友好编号，例如：
   - `ACME-0001`
   - `ACME-0002`
2. 实际校验凭证使用高熵随机令牌。
3. 存储时仅保存高熵令牌的哈希值。

也就是说：

- 顺序编号可用于后台识别
- 真正用于激活校验的值必须不可预测
- 明文凭证只在发码时展示一次或通过邮件链接发送

若第一版坚持让员工手输验证码，则输入值也必须为不可预测随机码，而不是顺序号。

### 11.3 员工注册流程

员工在首页只需要填写：

- 注册邮箱
- 登录密码
- 邀请码核验

姓名策略建议如下：

1. 企业管理员预创建时已录入员工姓名。
2. 员工注册页默认展示该姓名作为只读确认信息，或允许作为 `displayName` 轻微修改。
3. 第一版不建议让员工自由输入一个完全独立的“用户名称”，以免与企业预创建姓名不一致。

员工不需要填写企业名称。

原因：

- 企业归属已经由验证码携带。
- 员工只属于已明确存在的企业。

#### 员工注册校验规则

后端必须同时校验：

1. 验证码存在。
2. 验证码未过期。
3. 验证码未被使用。
4. 验证码未被撤销。
5. 验证码绑定的企业存在。
6. 验证码绑定的员工邮箱与提交邮箱一致。
7. 对应 `employeeProvision` 记录存在且处于待激活状态。
8. 企业仍在 `trial` 或 `paid` 状态。
9. 企业还有可用席位。

校验通过后：

1. 创建正式用户。
2. 创建成员关系。
3. 标记员工激活成功。
4. 标记验证码已使用。
5. 增加企业已用席位。
6. 自动建立登录会话。

## 12. 登录流程

登录保持统一，不区分企业管理员和员工。

### 12.1 登录输入

- 邮箱
- 密码

### 12.2 登录校验

1. 邮箱存在。
2. 密码匹配。
3. 用户状态正常。
4. 用户所在企业状态允许登录。

### 12.3 登录后跳转

根据角色与企业状态进行跳转：

- 企业管理员 + 企业正常
  - 进入企业管理与工作台
- 员工 + 企业正常
  - 进入工作台
- 企业状态 `expired`
  - 进入“试用到期”限制页
- 企业状态 `suspended`
  - 进入“账号已暂停”页

### 12.4 第一版企业上下文假设

第一版明确假设：

- 一个 `user` 仅属于一个 `enterprise`

因此登录成功后可直接推导唯一企业上下文，无需用户选择企业。

### 12.5 登录风控与安全要求

建议新增以下基础能力：

1. 登录失败次数限制
2. 短时锁定
3. 新设备登录通知
4. 验证码发送频率限制
5. 管理员发码频率限制
6. IP 与 User-Agent 审计日志

## 13. 密码与邮箱体系

### 13.1 邮箱验证

建议新增邮箱验证链路。

#### 管理员邮箱验证

无论是企业自助创建还是平台代创建，都建议管理员必须先完成邮箱验证，再激活正式账号。

#### 员工邮箱验证

员工注册时由于激活码已强绑定员工邮箱，且建议通过邮箱链路送达，因此可以视为“邮箱所有权已部分验证”。

第一版建议：

1. 员工注册成功后允许直接进入系统。
2. 系统仍发送验证邮件。
3. 在未完成邮箱验证前，限制敏感操作。

### 13.2 忘记密码

建议新增“忘记密码”流程。

#### 流程

1. 用户输入邮箱。
2. 系统返回统一提示，不区分邮箱是否存在。
3. 系统发送一次性重置链接或重置验证码。
4. 链接或验证码使用短时效策略。
5. 持久化时仅保存其哈希值。
6. 用户设置新密码。
7. 系统更新密码并使旧会话全部失效。

### 13.3 修改密码

登录后新增“修改密码”。

#### 流程

1. 输入旧密码。
2. 输入新密码。
3. 校验旧密码正确。
4. 更新密码。
5. 默认允许全部设备下线。

## 14. 企业试用到期后的处理

企业试用到期后，不应继续无条件使用核心工作台能力。

### 14.1 到期后的系统状态

企业到达 `trialEndsAt` 后：

- 企业状态从 `trial` 转为 `expired`

### 14.2 到期后的行为

#### 企业管理员端

企业管理员登录后进入限制态页面，展示：

- 试用已结束
- 剩余试用信息
- 升级按钮
- 联系专属客户顾问按钮

限制能力：

- 不可新增员工
- 不可发放新验证码
- 不可继续使用核心业务工作台

保留能力：

- 查看企业信息
- 查看试用状态
- 查看成员概览
- 跳转付费页
- 跳转顾问页

#### 员工端

员工登录后不进入正常工作台，直接进入“试用已结束”落地页。

展示：

- 企业试用已结束
- 请联系管理员
- 升级方案
- 联系顾问

### 14.3 试用席位用尽但尚未到期

当 `seatUsed >= seatQuota` 且企业仍在 `trial` 时：

- 企业管理员仍可登录
- 企业管理员不能再为新员工发放激活码
- 企业管理员应看到：
  - `试用席位已用尽`
  - `升级企业方案`
  - `联系专属客户顾问`

员工端若尝试激活，应收到“企业试用席位已满”的明确提示。

### 14.4 升级与顾问

试用结束后必须提供明确转化路径：

- `升级企业方案`
- `联系专属客户顾问`

此处应由平台后台配置：

- `upgradeUrl`
- `contactAdvisorUrl`

## 15. 首页最终入口方案

首页建议只保留三条入口：

1. 企业创建
2. 员工注册
3. 登录

### 15.1 企业创建

适用于新企业管理员，创建新的企业租户。

### 15.2 员工注册

适用于已拿到企业验证码的员工。

### 15.3 登录

适用于企业管理员和员工的日常登录。

## 16. 后端接口建议

当前 `/register` 需要拆分为更清晰的业务接口。

建议新增或重构为以下接口：

### 16.1 企业创建与激活

- `POST /__openbot/platform-auth/enterprise/create`
- `POST /__openbot/platform-auth/enterprise/admin/activate`

### 16.2 员工发码与激活

- `POST /__openbot/platform-auth/employee/provision`
- `POST /__openbot/platform-auth/employee/code/issue`
- `POST /__openbot/platform-auth/employee/code/revoke`
- `POST /__openbot/platform-auth/employee/activate/verify`
- `POST /__openbot/platform-auth/employee/activate/complete`

### 16.3 登录与会话

- `POST /__openbot/platform-auth/login`
- `POST /__openbot/platform-auth/logout`
- `GET /__openbot/platform-auth/session`

### 16.4 密码体系

- `POST /__openbot/platform-auth/password/forgot`
- `POST /__openbot/platform-auth/password/reset`
- `POST /__openbot/platform-auth/password/change`

### 16.5 邮箱体系

- `POST /__openbot/platform-auth/email/verify/send`
- `POST /__openbot/platform-auth/email/verify/confirm`

### 16.6 平台端企业管理

- `POST /__openbot/platform-auth/platform/enterprise/create`
- `POST /__openbot/platform-auth/platform/enterprise/trial/policy/update`
- `POST /__openbot/platform-auth/platform/enterprise/trial/instance/update`
- `POST /__openbot/platform-auth/platform/enterprise/upgrade`
- `POST /__openbot/platform-auth/platform/enterprise/suspend`

### 16.7 接口幂等性要求

以下写操作建议支持幂等键或后端防重策略：

1. 企业创建
2. 企业管理员激活
3. 员工激活完成
4. 忘记密码发送
5. 发放员工验证码

原因：

- 防止用户双击
- 防止前端重试
- 防止网络抖动造成重复创建

### 16.8 配置变更与运营特批分离

以下两类修改不应混用同一个接口：

1. 平台默认试用策略配置更新
2. 单个企业试用特批调整

因此建议拆分为：

- `trial/policy/update`
- `trial/instance/update`

## 17. 对当前实现的重构要求

### 17.1 必须删除或重写的旧逻辑

以下逻辑与最终方案冲突，必须删除或重构：

1. “首个注册用户自动创建企业，后续用户自行注册”的中心逻辑。
2. “后续无邀请码用户自动并入最早租户”的逻辑。
3. “邀请码仅绑定租户，不绑定员工”的逻辑。
4. “员工注册时可通过前端推导租户名”的逻辑。

### 17.2 可继承的旧逻辑

以下能力可以继续复用：

1. 本地 JSON 存储框架。
2. 会话 Cookie 签名机制。
3. `scrypt` 密码哈希。
4. 当前登录会话读取逻辑。
5. 企业成员关系基本结构。

### 17.3 重点改造点

后端重点改造：

- `src/gateway/platform-auth.ts`

前端重点改造：

- `ui/src/ui/controllers/platform-auth.ts`
- `ui/src/ui/app-render.ts`
- `ui/src/ui/views/auth-home.ts`

## 18. 推荐状态机

### 18.1 企业状态机

- `trial`
  - 到期后 -> `expired`
  - 付费后 -> `paid`
  - 平台暂停 -> `suspended`

- `paid`
  - 到期未续费或手动停用 -> `suspended`

- `expired`
  - 付费后 -> `paid`
  - 平台重新开放试用 -> `trial`

- `suspended`
  - 恢复后 -> `paid` 或 `trial`

### 18.2 员工预创建状态机

- `pending_activation`
  - 成功激活后 -> `activated`
  - 管理员撤销后 -> `revoked`
- `activated`
  - 不可逆
- `revoked`
  - 不可逆

建议：

- 重发验证码不新建第二个并行 `employeeProvision`
- 而是在原 `employeeProvision` 上撤销旧码并生成新码

### 18.3 验证码状态机

- `active`
  - 激活完成后 -> `claimed`
  - 管理员撤销后 -> `revoked`
  - 过期任务或懒更新后 -> `expired`
- `claimed`
  - 不可逆
- `revoked`
  - 不可逆
- `expired`
  - 不可逆

副作用要求：

1. `active -> claimed`
   - 必须写入 `claimedAt`
   - 必须写入 `claimedByUserId`
2. `active -> revoked`
   - 必须写入 `revokedAt`
3. `active -> expired`
   - 过期后不得再 claim

## 19. 推荐实施顺序

建议按以下顺序实施，降低改造风险：

### 第一阶段：后端数据模型重构

1. 企业增加试用与席位字段。
2. 增加来源字段、唯一约束与会话上下文。
3. 新增员工预创建记录。
4. 把租户级邀请码改成员工级激活码。

### 第二阶段：企业创建链路

1. 实现企业自助创建。
2. 实现平台代创建企业。
3. 实现企业管理员激活。

### 第三阶段：员工注册链路

1. 企业管理员创建员工。
2. 发放员工验证码。
3. 员工验证激活码。
4. 员工完成激活注册。

### 第四阶段：账号生命周期补全

1. 忘记密码
2. 重置密码
3. 修改密码
4. 邮箱验证

### 第五阶段：试用商业化闭环

1. 试用到期拦截
2. 试用席位耗尽提示
3. 升级入口
4. 顾问入口
5. 平台后台试用配置

### 第六阶段：风控与审计

1. 登录失败限流
2. 发码频率限制
3. 审计日志
4. 事务式串行写入

## 20. 最终结论

最终版 OpenBot 注册登录体系应当从“用户自行注册”重构为“企业先创建、员工后激活”的体系。

最终用户路径如下：

### 路径一：企业自助创建

企业管理员创建企业 -> 获得试用 -> 激活管理员 -> 登录企业端 -> 创建员工 -> 发验证码

### 路径二：平台代创建企业

平台创建企业 -> 管理员激活 -> 登录企业端 -> 创建员工 -> 发验证码

### 路径三：员工注册

企业预创建员工 -> 企业发放专属验证码 -> 员工使用邮箱、密码、验证码完成激活注册 -> 自动登录

### 路径四：统一登录

企业管理员或员工使用邮箱密码登录，按企业状态进入正常工作台或试用到期限制页。

该方案的核心价值在于：

1. 企业归属清晰
2. 员工注册受控
3. 试用策略可配置
4. 商业化闭环完整
5. 安全模型清晰
6. 与当前 OpenBot 首页和企业工作台定位一致

## 21. 本方案建议直接定版的关键决策

以下事项建议直接定版，不再继续悬而未决：

1. 企业管理员计入试用席位。
2. 员工验证码必须绑定邮箱。
3. 企业管理员允许重发验证码，但实现方式为“撤销旧码 + 生成新码”。
4. 试用到期后：
   - 企业管理员允许有限只读
   - 员工不允许进入核心工作台
5. 试用席位用尽但尚未到期时，允许企业管理员直接升级或联系顾问。
6. 第一版不支持一个邮箱属于多个企业。

以上决策确认后，即可进入最终版接口设计与实现阶段。

## 附录 A：核心唯一约束

| 对象                | 约束                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- |
| `enterprise`        | `slug` 唯一                                                                        |
| `user`              | `normalizedEmail` 唯一                                                             |
| `membership`        | `(userId, enterpriseId)` 唯一                                                      |
| `employeeProvision` | `(enterpriseId, normalizedEmployeeEmail)` 在 `pending_activation/activated` 下唯一 |
| `activationCode`    | `codeHash` 唯一                                                                    |

## 附录 B：关键状态迁移表

| 对象                | 当前状态             | 触发动作     | 下一状态    | 副作用                         | 操作方          |
| ------------------- | -------------------- | ------------ | ----------- | ------------------------------ | --------------- |
| `enterprise`        | `trial`              | 到期         | `expired`   | 写入 `trialExpiredAt`          | 系统            |
| `enterprise`        | `trial`              | 付费升级     | `paid`      | 更新计费状态                   | 平台/系统       |
| `enterprise`        | `trial/paid/expired` | 暂停         | `suspended` | 限制访问                       | 平台            |
| `employeeProvision` | `pending_activation` | 员工激活成功 | `activated` | 绑定 `activatedUserId`         | 系统            |
| `employeeProvision` | `pending_activation` | 管理员撤销   | `revoked`   | 记录原因                       | 企业管理员      |
| `activationCode`    | `active`             | 激活成功     | `claimed`   | 写 `claimedAt/claimedByUserId` | 系统            |
| `activationCode`    | `active`             | 管理员撤销   | `revoked`   | 写 `revokedAt`                 | 企业管理员/平台 |
| `activationCode`    | `active`             | 到期         | `expired`   | 懒更新或任务更新               | 系统            |

## 附录 C：关键失败场景与标准错误码

建议至少定义以下错误码：

| 错误码                            | 场景                               |
| --------------------------------- | ---------------------------------- |
| `ENTERPRISE_ALREADY_EXISTS`       | 企业 slug 或企业创建冲突           |
| `EMAIL_ALREADY_REGISTERED`        | 邮箱已存在                         |
| `EMAIL_NOT_MATCHED`               | 员工注册邮箱与验证码绑定邮箱不一致 |
| `ACTIVATION_CODE_NOT_FOUND`       | 验证码不存在                       |
| `ACTIVATION_CODE_EXPIRED`         | 验证码已过期                       |
| `ACTIVATION_CODE_REVOKED`         | 验证码已撤销                       |
| `ACTIVATION_CODE_ALREADY_CLAIMED` | 验证码已使用                       |
| `ENTERPRISE_TRIAL_EXPIRED`        | 企业试用已结束                     |
| `ENTERPRISE_SEAT_LIMIT_REACHED`   | 企业席位已满                       |
| `ENTERPRISE_SUSPENDED`            | 企业已暂停                         |
| `PASSWORD_RESET_TOKEN_INVALID`    | 密码重置链接无效                   |
| `PASSWORD_RESET_TOKEN_EXPIRED`    | 密码重置链接过期                   |
| `LOGIN_RATE_LIMITED`              | 登录失败过多被锁定                 |

## 附录 D：审计日志要求

建议至少审计以下事件：

1. 企业创建
2. 企业管理员激活
3. 员工预创建
4. 员工验证码发放
5. 员工验证码重发
6. 员工验证码撤销
7. 员工激活成功
8. 企业状态变更
9. 试用策略变更
10. 密码重置申请
11. 密码重置完成
12. 登录成功
13. 登录失败

建议审计字段包括：

- `eventType`
- `operatorUserId?`
- `enterpriseId?`
- `targetUserId?`
- `provisionId?`
- `codeId?`
- `ip`
- `userAgent`
- `createdAt`
- `metadata`

## 附录 E：并发一致性要求

当前底层若继续采用本地 JSON 文件存储，则认证链路必须实现“事务式串行写入”。

所有认证写操作必须遵守：

1. 获取写锁
2. 读取最新状态
3. 在同一临界区内完成：
   - 校验验证码
   - 校验员工预创建记录
   - 校验企业状态
   - 校验席位
   - 创建用户
   - 创建成员关系
   - 更新员工预创建状态
   - 更新验证码状态
   - 更新 `enterprise.seatUsed`
   - 创建会话
4. 全部成功才提交
5. 任一环节失败则整体回滚

如不能满足这一要求，则可能产生：

- 同一码被重复激活
- 席位超用
- `seatUsed` 丢失更新
- `provision` 与 `activationCode` 状态不一致
