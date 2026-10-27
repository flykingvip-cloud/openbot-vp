# GitHub OAuth 路径图（云电脑协助）

## 真实 URL

1. **Authorize**  
   `https://github.com/login/oauth/authorize`  
   Query：`client_id`、`redirect_uri`、`state`、`scope=read:user,user:email,repo`  
   （由 `oauth.start` 返回的 `authorizeUrl` 已拼好，skill 不要手改 scope。）

2. **用户侧**
   - 若未登录 GitHub：登录（可能 TOTP/WebAuthn）
   - 同意应用权限 → 重定向到 OpenBot callback（`redirect_uri` + `code` + `state`）

3. **服务端（非 skill）**
   - POST `https://github.com/login/oauth/access_token`
   - GET `https://api.github.com/user` → `login` 作 accountLabel
   - 写入 secret store + 注册/轮换 identity

## 云电脑步骤

1. 调用 `oauth.start`，拿到 `authorizeUrl`（若为 null 且 `simulateAllowed`，说明未配 GitHub OAuth——停止并提示运维配 `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`，不要发明 PAT 粘贴流程冒充 OAuth）。
2. 隔离浏览器打开 `authorizeUrl`。
3. 需要时请用户完成登录/2FA（人机；不要截取密码）。
4. 同意后等回调；`oauth.status` 至 completed / 刷新个人设置。
5. 失败：读错误码；可 `oauth.cancel` 后重开；不要把 `code` 贴进聊天。

## 注意

- client_secret **只在服务端**；云电脑会话不是权威源。
- scope 以平台拼装为准；本 skill 不扩大授权范围。
- 本路径是 oauth 类模板；S3 社媒勿照搬除非 authMode 也是 oauth。
