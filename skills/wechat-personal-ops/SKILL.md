---
name: wechat-personal-ops
description: >-
  用户要把个人微信绑定、授权给某个数字人收发私聊、或桌面 sidecar
  未就绪时使用。遇到「个人微信运营」「wechat.personal」「127.0.0.1:3000」务必使用。不要在公众号、企微或「把聊天记录当知识库」场景用。不要引导普通用户去 Telegram 激活。
---

# 个人微信运营通道

这是 **运营闭环**：本机通道已有可信登录态 → 工作台 `bind-existing` → grant 给自有数字人 → 私聊入站 → 数字人回复发回微信。不是公众号，不是企微，也不是把历史记录当知识库（那用 `wechat-personal-kb`）。分流不确定时先读 `wechat-personal-catalog`。

OpenBot **不内置**微信协议。协议会话只在用户电脑 loopback 的 sidecar 上。网关永远是 `http://127.0.0.1:18789/`（或云端 Gateway + 桌面节点）。sidecar 默认 `http://127.0.0.1:3000`，两套进程不要并口。

离线探测与桌面节点：见下方「先探测 / 打通 3000」与 `references/troubleshooting.md`。sidecar HTTP 字段见 `references/sidecar-http.md`（现行 v1）。可选演进草案见 `references/sidecar-http-vnext.md`（发送三态、入站 `fromSelf`、health；Gateway 接线见 openbot **#982**，opened / not LIVE）。排障见 `references/troubleshooting.md`。 可选 wechat-use 桥适配器见 `references/adapter-wechatuse.md`（非默认）。

## 硬约束

- 只调已有 RPC：`user-operational-identity.wechat-personal.status` / `bind-existing` / `qr.start` / `qr.wait`，以及节点 `wechat.personal.probe|login.start|login.wait|logout|status|sendText`。当前前台走 `bind-existing`（本机已有登录态）；`qr.*` 保留但默认不触发。没有的名字不要 invent。
- 会话、`wechat-personal-worker.json`、sidecar 都在 **持号的那台电脑**。禁止写到 LIVE / 云端盘。禁止 `channels.wechat.proxyUrl` 指向非 loopback。
- sidecar URL 只能是 `127.0.0.1` / `localhost` / `::1`。
- 只做私聊文本。群聊、图片、文件、语音本切片忽略，不要假装发出去。
- 禁止推荐 huohuoer、crates.io `wechat-cli`、wechat-use 安装步骤、DLL 注入、内存扫密钥、UIA 点微信窗口。
- **面向普通本地用户的指引禁止**写 Telegram、`t.me/WechatCliBot`、`@WechatCliBot`、`wechat-use auth activate`。大多数用户没有 Telegram，这条不是 OpenBot 安装步骤。
- 不要和 `wechat-personal-kb` 抢同一条「连上微信」故事。
- 第三方本机桥若被运营方使用，必须经 **adapter** 露出 `sidecar-http.md` 契约；OpenBot 只认 3000，不感知取钥/AX。

## 可选旁路（仅用户明确选择）

用户**已明确**选择 wechat-use /「已登录本机微信→适配器:3000」时：按 `references/adapter-wechatuse.md` 接 18400→3000。本 ops 技能**不**把 wechat-use 安装或 Telegram 激活写进上方硬约束或「推荐默认步骤」；**禁止**把 `:18400` 写入默认 `wechat-personal-worker.json`。普通用户指引一律不走这条旁路。

## 先探测

调用 `user-operational-identity.wechat-personal.status`。

- `workerOnline` 且未登录：本机通道在、但还没有可用登录态。让用户打开 `http://127.0.0.1:18789/` → 授权 → 微信个人号，看红框即可。**不要**出码，**不要**引导注册 Telegram 或 `auth activate`。普通用户在此停住，等本机通道就绪，或改用公众号 / 邮箱 / `wechat-personal-kb`。
- `loggedIn` 且有 `wxid`：去工作台选 **接管的数字人**，点「绑定当前已登录微信」（`bind-existing`）。不要再装第三方客户端。
- 离线：按下面做，不要空转 `qr.start`。

Worker 在线仅当：

1. 云端工作台：这台电脑的 OpenBot 桌面节点已连上该 Gateway，并 advertise `wechat.personal.*`，且 **该电脑** loopback sidecar 可探活；或
2. 本机直连 Gateway：Gateway 与 sidecar 同机，才允许 Gateway 直连 3000。LIVE 永不直连。

## 打通 3000（运营侧）

默认 `~/.openbot/wechat-personal-worker.json`：

```json
{
  "proxyUrl": "http://127.0.0.1:3000",
  "command": "/absolute/path/to/operator-sidecar",
  "args": [],
  "webhookPort": 18789,
  "webhookPath": "/webhook/wechat"
}
```

- `proxyUrl` 必填，默认就是 `http://127.0.0.1:3000`。
- `command` 可选。有绝对路径时，桌面节点（或本机直连 Gateway）在 probe 遇到 **连接拒绝** 时拉起该进程；已经在听则不双开。没有 `command` 则 fail-closed（现在的空端口）。
- 协议二进制由 **运营方提供**，OpenBot 只监督进程 + 讲 HTTP 契约（详见 `references/sidecar-http.md`；演进见 `sidecar-http-vnext.md`）。
- 入站：sidecar POST `http://127.0.0.1:18789/webhook/wechat`。有桌面节点时节点优先听；否则仅本机 Gateway 在 `127.0.0.1` 听。回复走 `wechat.personal.sendText`，不要 `user-operational-identity.execute`。

## 用户步骤（工作台，普通本地用户）

只进 OpenBot，不进 Telegram，不跑激活命令。

1. 打开 `http://127.0.0.1:18789/`（本机 Gateway）。不要打开 `:3000` 或 `:18400` 当网页。
2. 「个人设置 → 授权 → 微信个人号」。有自有数字人时先选一个。
3. 若显示「已检测到本机微信：…」：点 **绑定当前已登录微信**。走 `bind-existing`。不要等二维码。
4. 若显示通道已接通但登录态未就绪：按页内三步自检操作（打开并登录本机微信 → 保持桌面端运行 → 点「重新检测」）。不要指向 Telegram / WechatCliBot / `wechat-use auth activate`。多次仍未就绪则改用公众号 / 邮箱 / 聊天记录入库。
5. 若显示通道未连接：打开本机 OpenBot 桌面端，再点「重新检测」。主 UI 不提 worker.json、3000、wechat-use。
6. 绑定成功后，identity 的 `externalAccountId` 是 `wxid`，grant 给所选 `agentId`，路由 `channel: "wechat"`。提醒：会占用平板/Mac 登录位，有掉线封号风险。

不要在主 UI 提 worker.json、3000、wechat-cli、wechat-use、Telegram。

## 不要

- 把微信网页版嵌进扫码窗
- 用开放平台网站扫码登录冒充接管个人号（那只有 OpenID）
- 知识宇宙 ingest / KE 技能当微信入口
- 扫内存、解 `MSG.db`、注入 `Weixin.exe`、UIA 点窗口
- 默认配置公网 tunnel / 把非 3000 端口写进 worker 当官方路径
- 把 Telegram / WechatCliBot / `wechat-use auth activate` 写进普通用户安装或绑定指引

## 触发样例

- 「扫码把我的微信授权给客服机器人」
- 「工作台微信二维码出不来，说 worker 离线」
- 「数字人要能回我的微信私聊」

## 完成标准

`status.online`；sidecar `loggedIn` + 非空 `wxid`；工作台 `bind-existing` 成功；所选数字人已 grant；私聊文本能入站并 `sendText` 回出。普通用户指引不把 Telegram 激活算作完成条件。
