# 回写 API 与禁区（bilibili）

## 允许

- `user-operational-identity.credentials.bind`（`provider=bilibili`，`manualKind=social_account`）
- 参数：`displayName`、`accountHandle`、`accessToken`（及更新时的 `identityId`）
- 绑后：`oi-grant-owned-bots` → `grants.upsert`

## 禁止

1. 直接编辑 `openbot-user-operational-identity.json` 或 `openbot-user-operational-identity-secrets.json`
2. 对本 provider 调用 `oauth.start`（会 manual/oauth 错配）
3. 把 Cookie、Access Token、密钥、session 写入聊天、日志摘要或 EffectiveAccess **投影**
4. 用云电脑会话 cookie 冒充已 enrollment / 已授权
5. 声称 path 已 live 打通（当前 `path_unstable: true`）
