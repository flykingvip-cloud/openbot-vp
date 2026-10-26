# 个人设置 X（x-twitter）OAuth 数字身份（可复用样板）

日期：2026-10-14  
Repo：`upbeyond/openbot`  
承接：S2 GitHub OAuth 样板（`oi-intelligent-bind-s2-github-2026-10-13.md`）、既有 `xTwitterOAuthAdapter`  
范围：`provider=x-twitter` 在 **个人设置 → 授权 → 绑定账户**（`user_operational_identity`）  
原则：主路径 = OAuth2 + PKCE（镜像 `github-personal`），**不是** `social_account` 手填；密钥只进 secret store；bind ≠ grant；scope 门禁发布动作。

## 产品决策（锁定）

1. Primary auth = OAuth2 + PKCE，复用 `src/gateway/user-operational-identity-oauth-adapters/x-twitter.ts`。
2. Catalog：`authMode=oauth`，`manualKind=null`（与 `github-personal` 同构）。
3. Capability 按授权 scope 拆分：
   - 身份/阅读：`users.read tweet.read offline.access` → `sync_profile_metrics` 等读类
   - 发布：必须含 `tweet.write` 才开放 `publish_post` / `reply_comment`
4. Secrets 只在 secret store（`kind=oauth_token`，`metadata.scope`）；永不进聊天 / EffectiveAccess 投影。
5. 数字人授权仍走 `oi-grant-owned-bots` / `grants.upsert`（grant 侧也会按 scope 过滤发布动作）。
6. **本实现是后续其他个人社媒设置的可复用模板**（目录改 oauth → UI 共用 oauth 表单 → adapter 接线 → scope 门禁 → skill 改 oauth.\*）。

## 实现要点

| 层           | 变更                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Catalog      | `user-operational-identity-providers.ts`：`x-twitter` → oauth                                          |
| OAuth 运行时 | `user-operational-identity-oauth.ts`：`adapter_authorization_code` + PKCE；回调走 adapter.exchangeCode |
| Scope 门禁   | `user-operational-identity-x-twitter-scope.ts`；execution deny + grants.upsert 过滤                    |
| UI           | `workbench-operational-identity-forms.ts`：`renderOauthPersonalForm` 支持 `x-twitter`                  |
| Skill        | `oi-bind-x-twitter` → oauth 路径（对齐 `oi-bind-github-personal`）                                     |
| 编排         | `oi-orchestrate-personal-identity` catalog-map 更新                                                    |

## Env

优先（adapter 默认）：

- `OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_CLIENT_ID`
- `OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_CLIENT_SECRET`
- `OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_REDIRECT_URI`（可省略，用 callbackOrigin 拼）
- 可选：`OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_SCOPE`（默认 `tweet.read tweet.write users.read offline.access`）

别名（等效）：

- `X_TWITTER_CLIENT_ID` / `X_TWITTER_CLIENT_SECRET` / `X_TWITTER_REDIRECT_URI`

Callback：`<gateway-origin>/__openbot/user-operational-identity/oauth/callback`

未配置 client 时：`simulateAllowed=true`（仅开发/测试）。

生产注入样板：`deploy/production/x-twitter-oauth.env.example`（矩阵见 `deploy/production/env-authority-matrix.md` §3）。

## 回写路径（唯一）

1. `user-operational-identity.oauth.start`（`provider=x-twitter`）
2. 用户同意 → 既有 callback → secret + identity active
3. 可选 `oauth.status` / `oauth.cancel`
4. 数字人：`oi-grant-owned-bots` → `grants.upsert`

**禁止**：`credentials.bind`；直改 OI JSON；把 token/code 打进聊天或投影；声称已 `verified_live`（本阶段 false）。

## 可复用模式（其他个人社媒）

1. Catalog 将该 provider 的 `authMode` 改为 `oauth`，`manualKind=null`。
2. 确认/补齐 `user-operational-identity-oauth-adapters/<provider>.ts` 并注册到 index。
3. OAuth 运行时已支持通用 `adapter_authorization_code`（含可选 PKCE）——无需再为每个社媒复制 GitHub 专用分支。
4. UI：在 `OAUTH_HANDLE_COPY` + oauth 分支加入 provider（或继续走通用 oauth 表单）。
5. 若平台有写权限 scope：仿照 `user-operational-identity-x-twitter-scope.ts` 做动作门禁。
6. Skill：以 `oi-bind-github-personal` / `oi-bind-x-twitter` 为模板改写为 `oauth.*`；编排 catalog-map 同步。
7. 契约测：从 S3 social_account 集合移出，加入 oauth 合同断言；`verified_live` 等真机验收后再翻。

## 非目标

- 合入 main 前的 OHBE（https://github.com/flykingvip-cloud/harness-Benchmark-Engine）真机 E2E（本 PR 等验收）
- Cookie / social_account 手填作为默认路径
- 企业侧新媒体矩阵改版（可并行复用同一 adapter）

## 验收闸门（合 main 前）

### 阻断

- [ ] Catalog：`x-twitter` authMode=oauth、manualKind=null、registrationReady=true
- [ ] 未配 env 时可 simulate；配齐 env 时 start 返回 authorizeUrl（含 PKCE challenge）
- [ ] 无 `tweet.write` 时 publish_post / reply_comment 被拒绝或不可 grant
- [ ] Skill / catalog-map / 设计文档一致；禁 credentials.bind 与 JSON 直改
- [ ] 相关单元/契约测绿

### 非阻断

- 真机 X 授权 E2E、`verified_live` 翻转、其他社媒一次性迁 oauth
