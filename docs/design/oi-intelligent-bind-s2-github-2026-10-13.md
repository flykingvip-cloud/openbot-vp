# 个人私有数字身份智能化（S2）— GitHub OAuth 样板

日期：2026-10-13  
Repo：`upbeyond/openbot`  
承接：S0+S1（PR #684 / `ef55aa4f`）  
范围：`provider=github-personal`（authMode=`oauth`）  
原则：云电脑 / 隔离浏览器只协助打开授权页与协作同意；落库权威 = gateway `user-operational-identity.oauth.*`；access_token 仅进 secret store；不进聊天与 EffectiveAccess 投影；不改 OAuth 服务端逻辑（除非发现明显断线且最小修复）。

## 目标

为大白管家提供稳定 skill **`oi-bind-github-personal`**：经用户授权后，通过工作台「授权绑定」或等价 RPC 启动 GitHub OAuth，回调完成后个人运营身份 `active`，作为后续一切 oauth 类 provider 的模板。

## 字段契约（与 UI/API 对齐，勿臆造）

真相源：`user-operational-identity-providers.ts`、`workbench-operational-identity-forms.ts`（`renderGithubPersonalForm`）、`user-operational-identity-oauth.ts`。

| UI / 语义 | 写入 | 必填 |
|-----------|------|------|
| 显示名称 | `displayName`（oauth.start 可带；缺省用 GitHub login） | 建议填 |
| GitHub 用户名 | `credentialHandleId` 表单位；**真 OAuth 可留空**（回调用 `api.github.com/user` 的 login） | 否 |
| 提交 | 「授权绑定」/「重新认证」 | — |

运营动作（绑后 catalog，非整表勾选）：`create_issue`、`create_pull_request`、`comment`。  
绑后数字人授权：另走 `oi-grant-owned-bots` → `grants.upsert`（本 skill 不混写）。

## 回写路径（唯一）

1. `user-operational-identity.oauth.start`  
   - 入参：`provider=github-personal`，可选 `displayName` / `identityId`（重新认证）/ `returnPath` / `callbackOrigin`  
   - 出参：`authorizeUrl`（已配置 `GITHUB_CLIENT_ID`/`SECRET` + callback 时）、`session`、`simulateAllowed`（无真 GitHub 配置时）
2. 用户在 GitHub 同意页授权 → 回调 `user-operational-identity` OAuth callback（既有路径）→ `oauth` 会话 complete  
3. 验收：身份 `active`；secret store 有 token；个人设置 → 授权 → GitHub（个人）显示已配置  
4. 可选轮询：`user-operational-identity.oauth.status`；取消：`oauth.cancel`

**禁止**：直接改 `openbot-user-operational-identity.json` / `*-secrets.json`；禁止用 `credentials.bind` 假装 GitHub OAuth（manual 会被拒）；禁止把 access_token / refresh / cookie 打进聊天或投影。

## 深链

- UI：个人设置 → `authorization` → `add:github-personal`（或左栏「GitHub（个人）」）  
- Skill：`oi-bind-github-personal`；编排：`oi-orchestrate-personal-identity` catalog-map 已指向本 skill

## OAuth 路径摘要

| 步骤 | 真实 URL / 行为 |
|------|-----------------|
| 授权 | `https://github.com/login/oauth/authorize?client_id=…&redirect_uri=…&state=…&scope=read:user,user:email,repo` |
| 换票 | `https://github.com/login/oauth/access_token`（服务端，skill 不持 client_secret） |
| 账号标签 | `GET https://api.github.com/user` → `login` |
| 配置 | env：`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`（及既有 redirect 解析）；未配置时 `simulateAllowed` 仅限开发/测试，生产须真 OAuth |

云电脑角色：打开 `authorizeUrl`、必要时协助登录/2FA；**不是**权威源，也不代持 client_secret。

## 交付物

1. 本文档  
2. `skills/oi-bind-github-personal/`（SKILL + references）  
3. 更新 `oi-orchestrate-personal-identity` catalog-map：`github-personal` → 本 skill  
4. guidance / docs / platform-ops 最小接线  
5. 契约测：S2 skill 存在；`registrationReady` + `authMode=oauth`；回写与禁区声明

## 非目标

- 社交站（S3）、飞书、微信个人号云电脑主路径  
- 改 OAuth 服务端 / adapter（除非明显断线且最小修复）  
- 真机 E2E 必须（本阶段 skill + 文档 + 契约测）

## 验收闸门（独立验收 Bot「私有数字身份智能化验收」）

### 阻断

- [ ] S2 设计/契约与 `github-personal` catalog 一致（authMode=oauth，registrationReady=true）
- [ ] `oi-bind-github-personal` 存在；编排 map 已指向它（不再仅「S2 指针」）
- [ ] 回写仅 `oauth.*` 既有 API；禁直改 JSON；密钥/投影禁区写清
- [ ] 契约测绿（含 S2 断言）

### 非阻断

- CI 噪声、真机 OAuth E2E 未跑、simulate 路径在未配置 client 时仍可用
