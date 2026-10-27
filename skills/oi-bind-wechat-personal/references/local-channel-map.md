# 本机通道地图（non_cloud_primary）

元数据：`non_cloud_primary: true` — **非云电脑主路径**。会话不进云端 Gateway / LIVE。

细节权威：[`wechat-personal-worker-setup`](../../wechat-personal-worker-setup/SKILL.md)。本文件只给 OI 编排用的步骤骨架。

## 探活顺序

1. 调用 `user-operational-identity.wechat-personal.status`。
2. `workerOnline: true` 且未登录 → 引导本机工作台「个人设置 → 授权 → 微信个人号」；需要出码再用 `qr.start` / `qr.wait`。
3. `loggedIn` + `wxid` → 「绑定当前已登录微信」→ `bind-existing`；不要再装第三方客户端。
4. 离线 / RPC 失败 → 按 worker-setup 引导桌面节点 + loopback sidecar；不要发明 `wechat.purge`、非 loopback `proxyUrl`、Telegram / WechatCliBot 步骤。

## Worker 在线条件（摘要）

- **(a) 云端工作台 + 用户电脑桌面节点**：节点已连当前 Gateway，advertise `wechat.personal.*`，且**那台电脑** loopback sidecar 可探活。
- **(b) 本机直连 Gateway**（local-direct）：Gateway 与 sidecar 同机，才允许 Gateway 直连 loopback。LIVE / 云端永远不走 (b) 扫服务器 loopback。

配置文件在**持会话电脑**：`~/.openbot/wechat-personal-worker.json`（`proxyUrl` 必填且必须 loopback；可选 `command` 绝对路径供桌面端拉起）。  
可选 env：`OPENBOT_WECHAT_PERSONAL_PROXY_URL`（只覆盖 URL）。

## 禁止声称

- 云电脑 / 云端 LIVE 为主路径
- OpenBot 内置或下载微信协议栈
- 与公众号 / 企微流程混用
- 把会话、`context_token`、proxy `apiKey` 写进云端配置或聊天

## 绑后接管（仅私聊文本，非本 skill 范围细节）

见 worker-setup：sidecar → 本机 `127.0.0.1:18789/webhook/wechat` → 桌面节点 / 本机 Gateway；不要走 `user-operational-identity.execute`。群聊与多媒体本切片忽略。
