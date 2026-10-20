# 回写 API 与禁区（x-twitter）

## 允许

- `user-operational-identity.oauth.start`（`provider=x-twitter`）
- `user-operational-identity.oauth.status` / `oauth.cancel`
- 既有 OAuth callback（authorization code + PKCE）
- 绑后：`oi-grant-owned-bots` → `grants.upsert`（发布类动作受 `tweet.write` 过滤）

## 禁止

1. 直接编辑 `openbot-user-operational-identity.json` 或 `openbot-user-operational-identity-secrets.json`
2. 对本 provider 调用 `credentials.bind`（authMode=oauth，会返回 OAuth required）
3. 把 access_token、refresh_token、code、cookie、client_secret 写入聊天、日志摘要或 EffectiveAccess **投影**
4. 用云电脑会话 cookie 冒充已 enrollment / 已授权
5. 声称已 `verified_live`（当前为 false，待验收）
6. 在未授予 `tweet.write` 时声称可以代发帖
