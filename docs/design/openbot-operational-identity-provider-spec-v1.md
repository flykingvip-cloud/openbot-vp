# OpenBot Operational Identity Provider Technical Specification v1.0

## 文档定位

本文定义：**任何企业身份接入 OpenBot 后，Agent 如何安全、稳定、长期代理运营该身份。**

不是 OAuth 接入教程，而是 Provider Connector 技术规范 + 与当前 OpenBot 实现的映射。

关联：

- `docs/design/openbot-enterprise-operational-identity-v1-work-breakdown-2026-06-06.md`
- 代码：`src/gateway/enterprise-operational-identity-providers/`

## v1 产品聚焦（2026-07）

**纳入目录（P0 优先）**：

1. **企业邮箱**（`enterprise-email`）— SMTP/IMAP 发信、读信、搜信、回复
2. **微信公众号**（`wechat-official`）— 草稿、发布、群发
3. **新媒体矩阵** — 微博、抖音、B 站、小红书、知乎、X 等官方账号运营
4. **微信视频号**（`wechat-channels`）— 视频/直播预告发布

**暂不纳入目录（改经 MCP 扩展）**：

- 飞书（`feishu` / `lark`）
- 企业微信（`wecom`）
- 钉钉（`dingtalk`）

历史已绑定的 IM 身份仍可读展示（标记「已移出目录」），不可新注册。

## 设计原则

1. OpenBot **不实现**「帮用户登录第三方」；只实现「企业授权可治理的数字身份」。
2. 核心是 **Identity + Credential + Capability + Verification + Agent Binding + Audit** 闭环。
3. **v1 不引入独立 PostgreSQL 身份库**：复用 `EnterpriseSeatAssetsStore` + 加密 Secret Store；本文数据库表设计为 **逻辑模型**，便于未来迁移。
4. **不复杂化授权 UI**：`IdentityUsagePolicy` 保持 `seatIds + allowedAgentIds + allowedActions` 三要素；`approval_required` / `data_scope` 留 v2。

## 参考实践

| 来源                    | 借鉴点                                                         |
| ----------------------- | -------------------------------------------------------------- |
| OAuth 2.0 / OIDC        | 短期 access token + refresh；禁止长期明文 Secret               |
| Microsoft Entra / Graph | 应用权限 vs 委派权限分离                                       |
| GitHub App              | Installation token 替代 PAT → `github-org` 推荐 App 安装级授权 |
| 微信第三方平台          | 仅 OAuth 扫码；authorizer token + refresh；func_info 能力集    |

## 统一 Identity 模型

```typescript
OperationalIdentity {
  id                    // identityId
  provider              // provider code
  category              // official | communication | business
  displayName
  credential            // → credentialBindingId + encrypted secret store
  connectionStatus      // 推导：created | configuring | connected | active | ...
  healthStatus          // active | warning | failed
  capabilities          // verify 后发现的可执行动作
  metadata              // providerMetadata（公众号名称等）
  lastVerifiedAt
  credentialExpiresAt   // → expiresAt
  createdAt / updatedAt
}
```

**当前实现**：`EnterpriseIdentity`（`enterprise-operational-identity-types.ts`）+ API 层 `enrichOperationalIdentityApiView()`。

## Connector 生命周期

```
CREATED → CONFIGURING → VERIFYING → CONNECTED → ACTIVE
```

异常：`TOKEN_EXPIRED` | `AUTH_FAILED` | `REAUTH_REQUIRED` | `DISABLED`

**Agent Ready 条件**（v1 冻结）：

```
Identity Connected
  → Capability Discovery（verify）
  → Create Usage Policy（seat + agent + allowedActions ⊆ capabilities）
  → agentReady = true
```

**当前实现**：`identity-lifecycle.ts` + `identity-api-envelope.ts` 的 `agentReady` 字段。

## IdentityConnector 接口

所有 Provider 必须对齐以下契约（`identity-connector.ts`）：

| 方法                     | 职责                 | v1 状态                                                                                        |
| ------------------------ | -------------------- | ---------------------------------------------------------------------------------------------- |
| `connect()`              | OAuth / 手动凭证写入 | upsert / OAuth 回调                                                                            |
| `verify()`               | 真实探测             | `credential-probe.ts`                                                                          |
| `discoverCapabilities()` | 能力发现             | `capability-discovery.ts`                                                                      |
| `execute(action)`        | 动作执行             | `enterprise-operational-identity-execution.ts` + RPC `enterprise-operational-identity.execute` |
| `refreshCredential()`    | Token 续期           | `credential-refresh.ts`（wechat-official）；verify 前 `maybeRefresh`                           |
| `revoke()`               | 撤销                 | `revokeEnterpriseIdentity()`                                                                   |

## 能力字典（Capability Registry）

运行时动作名使用 **snake_case**（如 `send_email`）；规范别名见 `alias` 字段（如 `email.send`）。

P0 注册表：`provider-capability-registry.ts`

| Provider                                                    | 动作                                                 | 风险                       |
| ----------------------------------------------------------- | ---------------------------------------------------- | -------------------------- |
| enterprise-email                                            | send_email / read_email / search_email / reply_email | high / medium / low / high |
| wechat-official                                             | publish_draft / publish_article / broadcast_article  | low / high / high          |
| weibo / douyin / bilibili / xiaohongshu / zhihu / x-twitter | 各平台 publish\_\*                                   | 依 registry                |

**策略约束**：若身份已 verify 且存在 `capabilities[]`，则 `allowedActions` 必须为其子集（`IDENTITY_006`）。

## P0 Provider 规格摘要

### 01 enterprise-email

- **v1 接入**：SMTP + IMAP（手动）；v2 OAuth（M365 Graph / Gmail API）
- **必填**：smtpHost, smtpPort, smtpUser, smtpPassword, smtpFrom
- **建议**：imapHost（不配则仅发信能力）
- **Verify**：SMTP connect + AUTH；IMAP LOGIN + LIST（不发测试邮件，避免骚扰）
- **能力**：send_email, read_email, search_email, reply_email

### 02 wechat-official

- **必须 OAuth 扫码**；禁止手填 AppSecret
- **存储**：authorizer_appid, access_token, refresh_token（加密 secret store）
- **Verify**：get_authorizer_info + 能力发现（func_info）
- **能力**：publish_draft, publish_article, broadcast_article（群发依权限）

### 03 新媒体矩阵（weibo / douyin / bilibili / xiaohongshu / zhihu / x-twitter）

- **推荐 OAuth**；能力取决于各开放平台已审批接口
- **Verify**：OAuth token 有效 + 权限集探测（待各平台 handler 完善）
- **能力**：见 `adapters.ts` 各 provider 的 operational actions

## 统一错误码

| Code         | 含义                 |
| ------------ | -------------------- |
| IDENTITY_001 | Credential Missing   |
| IDENTITY_002 | Auth Failed          |
| IDENTITY_003 | Token Expired        |
| IDENTITY_004 | Permission Denied    |
| IDENTITY_005 | Provider Unavailable |
| IDENTITY_006 | Capability Missing   |

实现：`provider-connector-errors.ts`（与 `ENTERPRISE_IDENTITY_*` 并存映射）。

## HTTP API（当前 Gateway）

| 规范 API                          | 当前路径                               |
| --------------------------------- | -------------------------------------- |
| POST /identities                  | POST `.../identities/create`           |
| POST /identities/{id}/credential  | POST `.../credentials/upsert`          |
| POST /identities/{id}/verify      | POST `.../identities/{id}/verify`      |
| GET /identities/{id}/capabilities | GET `.../identities/{id}/capabilities` |
| POST /identities/{id}/policy      | POST `.../identity-policies/upsert`    |

## 逻辑数据库模型（未来 PostgreSQL 参考）

| 逻辑表                 | 当前存储                                       |
| ---------------------- | ---------------------------------------------- |
| provider_registry      | `adapters.ts` + `registration-profiles.ts`     |
| operational_identity   | `seatStore.enterpriseIdentities`               |
| identity_credential    | `credentialBindings` + encrypted secret store  |
| identity_capability    | `identity.capabilities` / `capabilityMissing`  |
| identity_usage_policy  | `identityUsagePolicies`                        |
| identity_verify_record | `lastVerifyResult` + audit `identity.verified` |
| identity_audit_event   | `recordEnterpriseAssetAuditEvent`              |

## Verify 测试用例（P0）

### EMAIL-001 ~ EMAIL-004

| ID        | 步骤          | 期望                         |
| --------- | ------------- | ---------------------------- |
| EMAIL-001 | SMTP TCP 连接 | 成功 / SMTP_HOST_UNREACHABLE |
| EMAIL-002 | SMTP AUTH     | 成功 / INVALID_PASSWORD      |
| EMAIL-003 | IMAP LIST     | 成功 / 跳过（未配 IMAP）     |
| EMAIL-004 | 能力发现      | send_email ± read_email      |

### WECHAT-001 ~ WECHAT-002

| ID         | 步骤                | 期望                                 |
| ---------- | ------------------- | ------------------------------------ |
| WECHAT-001 | get_authorizer_info | TOKEN_VALID                          |
| WECHAT-002 | 能力发现            | publish\_\* / broadcast 依 func_info |

## Sprint 建议

| Sprint | Provider                                                                      |
| ------ | ----------------------------------------------------------------------------- |
| 1      | enterprise-email（execute 全动作）、wechat-official（OAuth + execute）        |
| 2      | 新媒体矩阵 OAuth + verify + execute（微博 / 抖音 / B 站 / 小红书 / 知乎 / X） |
| 3      | wechat-channels、github-org / jira / notion（可选业务系统）                   |

## v1 明确不做

- 飞书 / 企微 / 钉钉原生 Connector（改经 MCP）
- 自动发送测试邮件（verify 可选开关，默认关闭）
- 公众号自动创建测试草稿（需用户确认）
- 策略 UI 增加 approval / data_scope 字段
- 动作名全量迁移为 `email.send` 格式（仅 registry alias）

## 下一步

1. ~~`enterprise-operational-identity-execution.ts`（execute 层）~~ — `enterprise-email` 全动作 + `wechat-official` 三动作已接入
2. 新媒体矩阵各平台 OAuth handler + verify + execute
3. `refreshCredential` 定时续期（verify/execute 路径已接入 `maybeRefresh`）
4. ~~公众号封面素材上传 helper（thumbMediaId 自动上传）~~ — 已支持 `thumbUrl` / `thumbBase64` / `upload_thumb`
   4.1 ~~公众号正文内图片 uploadimg~~ — 已支持 `upload_content_image` + 建草稿时自动替换 `<img src>`
5. ~~新媒体矩阵各平台 OAuth handler + verify + execute~~ — **weibo**、**douyin**、**bilibili** 已接入；其余平台待接
6. 《Provider Capability Registry v1.0》独立动作字典文档（与 registry 代码同步）

### execute RPC（Sprint 1）

- **方法**：`enterprise-operational-identity.execute`
- **参数**：`identityId`, `action`, `agentId`, `seatId?`, `payload?`
- **门禁**：`access.resolve` 同等策略 + 已 verify 的 `capabilities[]` 子集校验
- **已实现**：`enterprise-email` → send / read / search / reply
- **已实现**：`wechat-official` → upload_thumb / upload_content_image / publish_draft / publish_article / get_publish_status / broadcast_article
- **已实现**：`weibo` → post_status / upload_image（OAuth 回调已有；verify 调用 account/get_uid）
- **已实现**：`douyin` → publish_video（OAuth 已有；verify 调用 oauth/userinfo；token 可 refresh）
- **已实现**：`bilibili` → publish_article / publish_video（verify 调用分区列表；token 可 refresh）
- **响应**：`executed: true` + `output`；拒绝时 `executed: false` + `code` / `message`

#### IMAP payload（read / search / reply）

| 动作           | 主要 payload 字段                                                          |
| -------------- | -------------------------------------------------------------------------- |
| `read_email`   | `mailbox?`（默认 INBOX）、`uid?`（指定则读单封）、`limit?`、`includeBody?` |
| `search_email` | `mailbox?`、`query?`（TEXT 搜索）、`unseen?`、`limit?`、`includeBody?`     |
| `reply_email`  | `uid`（必填）、`message`/`body`、`to?`、`subject?`、`mailbox?`             |

`reply_email` 会从原邮件解析 `From` 作为回复地址，并通过 SMTP 写入 `In-Reply-To` / `References`。

#### 微信公众号 payload（publish / broadcast）

| 动作                   | 主要 payload 字段                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `publish_draft`        | `title`、`content`/`body`、封面三选一：`thumbMediaId` / `thumbUrl` / `thumbBase64`（≤64KB）、`author?`、`digest?`；默认自动 `uploadimg` 替换正文外链 `<img>` |
| `publish_article`      | `mediaId?`；或 `title` + `content` + 封面源，自动建草稿后提交发布                                                                                            |
| `upload_thumb`         | `thumbUrl` 或 `thumbBase64`（返回 `thumbMediaId`）                                                                                                           |
| `upload_content_image` | `imageUrl` 或 `imageBase64`（≤1MB，调用 `media/uploadimg`，返回微信 `imageUrl`）                                                                             |
| `get_publish_status`   | `publishId`（`freepublish/get`）                                                                                                                             |
| `broadcast_article`    | `mediaId`（必填）、`sendToAll?`（默认 true）、`tagId?`（按标签群发）                                                                                         |

`rewriteContentImages`（默认 true）：设为 `false` 可跳过正文 `<img src>` 自动 uploadimg 替换。

执行前会自动 `maybeRefresh` authorizer token。

#### 微博 payload（post / upload）

| 动作           | 主要 payload 字段                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `post_status`  | `message`/`status`/`body`（必填）、`picId?`（先 upload_image）、或 `picUrl`/`picBase64` 自动带图发博 |
| `upload_image` | `picUrl` 或 `picBase64`（≤5MB，返回 `picId`）                                                        |

#### 抖音 payload（publish_video）

| 动作            | 主要 payload 字段                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `publish_video` | `videoUrl` 或 `videoBase64`（≤50MB 整文件上传）或已有 `videoId`；`text`/`title`/`message` 为标题；`privateStatus?`、`coverTsp?` |

#### 哔哩哔哩 payload（专栏 / 视频）

| 动作              | 主要 payload 字段                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `publish_article` | `title`、`content`/`body`（必填）；`summary?`、`tags?`、`bannerUrl?`、`category?`                                                              |
| `publish_video`   | `title`、`tid`（二级分区 id）、`tag`/`tags`、`videoUrl`/`videoBase64`（≤20MB 单分片）、`coverUrl`/`coverBase64`（必填）；`desc?`、`copyright?` |
