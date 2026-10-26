---
name: oi-bind-github-personal
description: >-
  把 GitHub 个人账号经 OAuth 写入「个人」私有数字身份（个人设置 → 授权 → GitHub（个人））。
  经 user-operational-identity.oauth.start 拿到 authorizeUrl，云电脑/隔离浏览器协助用户同意授权；
  回调由既有 OAuth 链完成落库。access_token 只进 secret store，禁止进聊天或 EffectiveAccess 投影。
  表单字段：显示名称；GitHub 用户名（真 OAuth 可留空）。运营动作 create_issue / create_pull_request / comment。
  不要用 credentials.bind 绑 GitHub；不要直接改 OI JSON。
metadata:
  openclaw:
    emoji: "🐙"
    promptPriority: 89
    requires:
      config:
        - browser.enabled
---

# 个人 GitHub OAuth 绑定（OI）

本 skill = **oauth 类样板**。不改 GitHub OAuth 服务端；只编排用户授权闸门 → `oauth.start` → 打开授权页 → 等回调 → 刷新 snapshot。

字段契约：[references/field-contract.md](references/field-contract.md)  
OAuth 路径图：[references/oauth-path.md](references/oauth-path.md)  
回写与禁区：[references/writeback-and-bans.md](references/writeback-and-bans.md)

## 表单同构字段（个人设置）

与 `renderGithubPersonalForm` 一致：

| UI 标签       | 写入                                            | 必填 |
| ------------- | ----------------------------------------------- | ---- |
| 显示名称      | displayName（`oauth.start`）                    | 建议 |
| GitHub 用户名 | 表单 credentialHandleId 位；真 OAuth **可留空** | 否   |
| 提交          | 「授权绑定」/「重新认证」                       | —    |

运营动作（catalog，绑后）：`create_issue`、`create_pull_request`、`comment`。  
数字人授权：另调 `oi-grant-owned-bots`，不要混进本 bind。

## 回写路径（唯一）

1. 调用 gateway **`user-operational-identity.oauth.start`**（`provider=github-personal`）。
2. 若返回 `authorizeUrl`：在隔离浏览器 / 云电脑打开，用户完成 GitHub 同意（含 2FA）。
3. 回调由平台既有 OAuth callback 完成；可用 **`oauth.status`** 轮询至 completed。
4. 未配置 `GITHUB_CLIENT_ID`/`SECRET` 时可能 `simulateAllowed=true`——仅开发/测试；生产必须真授权 URL。
5. **禁止** `credentials.bind` 绑 GitHub；**禁止**直接改 `openbot-user-operational-identity.json` / secrets JSON。
6. **禁止**把 access_token、code、cookie、client_secret 打进聊天或 EffectiveAccess **投影**。

## 流程摘要

1. 确认用户授权代配；否则 `user-guidance-protocol`，只带路到「授权绑定」按钮。
2. 收集显示名称（可选用户名）→ `oauth.start`。
3. 打开 `authorizeUrl`；等待回调成功。
4. 刷新个人授权页；需要时再 `oi-grant-owned-bots`。

## 完成标准

- 个人设置 → 授权 → GitHub（个人）显示已配置 / active
- 回写只经 `oauth.*`；聊天与投影中无 token
- 编排 catalog-map 已将 `github-personal` 指向本 skill
