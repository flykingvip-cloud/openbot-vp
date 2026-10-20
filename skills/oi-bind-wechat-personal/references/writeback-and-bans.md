# 回写 API 与禁区（wechat-personal）

## 允许

- `user-operational-identity.wechat-personal.status`
- `user-operational-identity.wechat-personal.qr.start`
- `user-operational-identity.wechat-personal.qr.wait`
- `user-operational-identity.wechat-personal.bind-existing`
- 绑后：`oi-grant-owned-bots` → `grants.upsert`
- 通道细节委派：`wechat-personal-worker-setup`

## 禁止

1. 直接编辑 `openbot-user-operational-identity.json` 或 `openbot-user-operational-identity-secrets.json`
2. 对 `wechat-personal` 调用 `credentials.bind` 或 `oauth.start` / `oauth.complete`（会错配 / 被拒；**不是**产品路径）
3. 把 `context_token`、proxy `apiKey`、会话密钥、cookie 写入聊天、日志摘要或 EffectiveAccess **投影**
4. 声称云电脑 / LIVE 为主路径，或把 sidecar 配到非 loopback / 云端主机
5. 与公众号（`wechat-official`）或企微流程混用；发明 RPC / 字段
6. 内置、下载或推荐 huohuoer / crates.io `wechat-cli` 当作 OpenBot 交付物
