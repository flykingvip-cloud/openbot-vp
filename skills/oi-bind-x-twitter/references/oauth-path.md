# X OAuth 路径图（应用内主路径 + S6 证据指针）

```yaml
path_unstable: false
provider: x-twitter
verified_live: false
product_path: in_app_oauth_pkce
live_probe_date: "2026-10-19"
live_evidence: references/live-evidence.md
```

**S6（2026-10-19 Asia/Shanghai）**：见 [live-evidence.md](live-evidence.md)。本切片未完成真机/OHBE（https://github.com/flykingvip-cloud/harness-Benchmark-Engine）OAuth → **保持** `verified_live: false`（`path_unstable` 仍为 false）。

## 真实 URL（adapter）

1. **Authorize**  
   `https://x.com/i/oauth2/authorize`  
   Query：`response_type=code`、`client_id`、`redirect_uri`、`scope`、`state`、`code_challenge`、`code_challenge_method=S256`  
   默认 scope：`tweet.read tweet.write users.read offline.access`  
   （可由 `OPENBOT_USER_OPERATIONAL_IDENTITY_X_TWITTER_SCOPE` 覆盖；由 `oauth.start` 返回的 `authorizeUrl` 已拼好，skill 不要手改。）

2. **用户侧**
   - 若未登录 X：登录（可能 2FA）
   - 同意应用权限 → 重定向到 OpenBot callback（`redirect_uri` + `code` + `state`）

3. **服务端（非 skill）**
   - POST `https://api.twitter.com/2/oauth2/token`（PKCE `code_verifier`）
   - GET `https://api.twitter.com/2/users/me` → `username` 作 `@handle`
   - 写入 secret store（`kind=oauth_token`，`metadata.scope`）+ 注册/轮换 identity

## 云电脑步骤

1. 调用 `oauth.start`，拿到 `authorizeUrl`（若为 null 且 `simulateAllowed`，说明未配 X OAuth——停止并提示运维配置 env，不要发明 Cookie/手填 Token 冒充 OAuth）。
2. 隔离浏览器打开 `authorizeUrl`。
3. 需要时请用户完成登录/2FA（人机；不要截取密码）。
4. 同意后等回调；`oauth.status` 至 completed / 刷新个人设置。
5. 失败：读错误码；可 `oauth.cancel` 后重开；不要把 `code` 贴进聊天。

## 开发者门户（非产品主路径）

| 名称                 | URL                        | 来源级别    |
| -------------------- | -------------------------- | ----------- |
| X Developer Platform | `https://developer.x.com/` | public_docs |

菜单点击序、App 创建控件均为 **UNKNOWN**。运维配好 Client ID/Secret 后，用户只走应用内「授权绑定」。

## 注意

- client_secret **只在服务端**；云电脑会话不是权威源。
- scope 以平台拼装 / 回调 `scope` 为准；发布动作执行与 grant 会门禁 `tweet.write`。
- 本路径是继 `github-personal` 后的第二个 oauth 类个人身份模板，可供其他社媒后续照搬。
