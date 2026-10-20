# 回写 API 与禁区

## 允许

- `user-operational-identity.oauth.start` / `oauth.status` / `oauth.cancel`
- 平台 OAuth callback（authorization code 换票，skill 不直接持 token）
- 绑后：`oi-grant-owned-bots` → `grants.upsert`

## 禁止

1. 直接编辑 `openbot-user-operational-identity.json` 或 `openbot-user-operational-identity-secrets.json`
2. 对 `github-personal` 调用 `credentials.bind`（会返回 manual/oauth 错配）
3. 把 `access_token`、authorization `code`、cookie、`client_secret`、PAT 写入聊天、日志摘要或 EffectiveAccess **投影**
4. 用云电脑会话 cookie 冒充已 enrollment / 已授权
5. 在未配置 GitHub OAuth 客户端时，把 simulate 当作生产绑定成功标准
