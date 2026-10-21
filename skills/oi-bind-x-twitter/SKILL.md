---
name: oi-bind-x-twitter
description: >-
  把 X（Twitter）个人账号经 OAuth2+PKCE 写入「个人」私有数字身份（个人设置 → 授权 → X）。
  经 user-operational-identity.oauth.start 拿到 authorizeUrl，云电脑/隔离浏览器协助用户同意授权；
  回调由既有 OAuth 链完成落库。access_token / refresh_token 只进 secret store，禁止进聊天或 EffectiveAccess 投影。
  表单字段：显示名称；X 用户名（真 OAuth 可留空）。运营动作：sync_profile_metrics（读）；
  publish_post / reply_comment 需授权含 tweet.write。
  不要用 credentials.bind 绑 X；不要直接改 OI JSON。
  应用内 OAuth 是产品主路径；开发者门户取证点击序仍可为 UNKNOWN，勿伪造已 live。
metadata:
  openclaw:
    emoji: "🐦"
    promptPriority: 89
    path_unstable: false
    verified_live: false
    requires:
      config:
        - browser.enabled
    oi:
      provider: x-twitter
      manualKind: null
      authMode: oauth
---

# 个人 X OAuth 绑定（OI）

本 skill = **oauth 类样板（对齐 `oi-bind-github-personal`）**。不改 X OAuth 服务端；只编排用户授权闸门 → `oauth.start` → 打开授权页 → 等回调 → 刷新 snapshot。

`path_unstable: false`：产品主路径是应用内 OAuth（adapter 已存在），不再走 social_account 手填。  
`verified_live: false`：S6（2026-10-19）live-evidence 记录尚未 OHBE（https://github.com/flykingvip-cloud/harness-Benchmark-Engine）/真机 OAuth 完成；禁止口头称为已 live。

字段契约：[references/field-contract.md](references/field-contract.md)  
OAuth 路径图：[references/oauth-path.md](references/oauth-path.md)  
S6 live 证据：[references/live-evidence.md](references/live-evidence.md)  
回写与禁区：[references/writeback-and-bans.md](references/writeback-and-bans.md)

## 表单同构字段（个人设置）

与 `renderOauthPersonalForm`（`x-twitter`）一致：

| UI 标签 | 写入 | 必填 |
|---------|------|------|
| 显示名称 | displayName（`oauth.start`） | 建议 |
| X 用户名 | 表单 credentialHandleId 位；真 OAuth **可留空** | 否 |
| 提交 | 「授权绑定」/「重新认证」 | — |

运营动作（catalog，绑后按 scope 门禁）：

- 身份/阅读：`sync_profile_metrics`（需 `users.read` / `tweet.read` 语义；默认授权串含之）
- 发布：`publish_post` / `reply_comment` — **仅当** OAuth `scope` 含 `tweet.write`

数字人授权：另调 `oi-grant-owned-bots`，不要混进本 bind。

## 回写路径（唯一）

1. 调用 gateway **`user-operational-identity.oauth.start`**（`provider=x-twitter`）。
2. 若返回 `authorizeUrl`：在隔离浏览器 / 云电脑打开，用户完成 X 同意（含 2FA）。
3. 回调由平台既有 OAuth callback 完成（PKCE `code_verifier` 仅存会话）；可用 **`oauth.status`** 轮询至 completed。
4. 未配置 `OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_CLIENT_ID`/`SECRET`（或别名 `X_TWITTER_CLIENT_ID`/`SECRET`）时可能 `simulateAllowed=true`——仅开发/测试；生产必须真授权 URL。
5. **禁止** `credentials.bind` 绑 X；**禁止**直接改 `openbot-user-operational-identity.json` / secrets JSON。
6. **禁止**把 access_token、refresh_token、code、cookie、client_secret 打进聊天或 EffectiveAccess **投影**。

## 流程摘要

1. 确认用户授权代配；否则 `user-guidance-protocol`，只带路到「授权绑定」按钮。
2. 收集显示名称（可选用户名）→ `oauth.start`。
3. 打开 `authorizeUrl`；等待回调成功。
4. 刷新个人授权页；需要时再 `oi-grant-owned-bots`（发布类 grant 会被 scope 过滤）。

## 完成标准

- 个人设置 → 授权 → X 显示已配置 / active
- 回写只经 `oauth.*`；聊天与投影中无 token
- 未声称 `verified_live`（S6 未翻旗；除非后续单独验收翻转）
- 编排 catalog-map 已将 `x-twitter` 指向本 skill（oauth）
