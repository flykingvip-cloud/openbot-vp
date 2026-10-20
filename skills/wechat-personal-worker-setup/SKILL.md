---
name: wechat-personal-worker-setup
description: 用户要绑定个人微信、让数字人接管微信号、本地 worker 离线、扫不出二维码、或不知道怎么起微信通道时使用。遇到「个人微信怎么绑」「worker 离线」「通道进程」「桌面节点」「扫码一直出不来」务必使用本技能。不要在公众号或企微场景用。
user-invocable: true
---

# 个人微信本地通道引导

完整运营闭环用 `wechat-personal-ops`。分流入口用 `wechat-personal-catalog`。本技能只管 worker 离线、桌面节点探活、以及 `wechat-personal-worker.json` / sidecar 拉起。聊天记录入库用 `wechat-personal-kb`。

本地 worker 是跑在用户电脑上的通道进程，不是手机微信「在线」。会话只存在这台电脑，不进云端 Gateway / LIVE。这不是公众号，也不是企微。OpenBot **不内置**微信协议栈，必须由用户在 loopback 上跑已有的本地协议 sidecar。

## 先探测

调用 `user-operational-identity.wechat-personal.status`。

- `workerOnline: true` 且未登录：本机通道在、但还没有可用登录态。引导去 `http://127.0.0.1:18789/`「个人设置 → 授权 → 微信个人号」查看状态。**不要**出码，**不要**引导 Telegram / WechatCliBot / `wechat-use auth activate`。普通用户等本机通道就绪，或改用公众号 / 邮箱 / `wechat-personal-kb`。
- `loggedIn` 且有 `wxid`：引导点「绑定当前已登录微信」。不要再让用户装任何第三方客户端。
- 离线或 RPC 失败：按下面引导，不要发明 `wechat.purge`、不要让用户填 `channels.wechat.proxyUrl`、不要推荐 huohuoer / crates.io `wechat-cli`。

Worker **在线**当且仅当下面之一成立：

- (a) **云端工作台**：用户电脑上的 OpenBot 桌面节点已连接到这个 Gateway，节点 advertise `wechat.personal.*`，并且**那台电脑** loopback 上的 sidecar 可探活。会话和 `~/.openbot/wechat-personal-worker.json` 都在用户电脑，不在云端。
- (b) **本机直连 Gateway**（工作台请求是 local-direct）：Gateway 与 sidecar 在同一台机器，才允许 Gateway 直连 loopback HTTP。LIVE / 云端永远不走这条。

## 离线时带用户做

1. 确认用户不是只开了云端工作台网页。个人微信通道必须在同一台电脑跑 OpenBot 桌面应用（或 Gateway 本机 sidecar）。
2. 让用户在该电脑 loopback 准备本地协议 sidecar（默认 `http://127.0.0.1:3000`）。OpenBot **不内置、不下载、不推荐** huohuoer / crates.io `wechat-cli`；协议二进制由操作员自己提供。可选配置：

```json
{
  "proxyUrl": "http://127.0.0.1:3000",
  "command": "/absolute/path/to/sidecar",
  "args": [],
  "cwd": null
}
```

`proxyUrl` 必填且必须是 loopback。可选 `command`：本机 OpenBot 桌面端（advertise `wechat.personal.*` 的节点）会在 probe 看到 connection-refused 时拉起这个绝对路径，不必用户自己先起进程。没有 `command` 时行为仍是 fail-closed（连不上就是离线）。不要把 sidecar 配到非 loopback / LIVE。

路径写在**持有会话的那台电脑**上：`~/.openbot/wechat-personal-worker.json`（`~/.openclaw/...` 仅兼容）。云端 Gateway / LIVE **不要**把这份文件放到服务器上。也可用 `OPENBOT_WECHAT_PERSONAL_PROXY_URL=http://127.0.0.1:3000`（只覆盖 URL，不代替 `command`）。禁止非 loopback / LIVE `channels.wechat.proxyUrl`。

3. 打开本机 OpenBot 桌面端，等到节点显示已连接到当前工作台 Gateway。
4. 回到「个人设置 → 微信个人号」，刷新后再调一次 `user-operational-identity.wechat-personal.status`。
5. 变为在线后回到「个人设置 → 微信个人号」刷新。有 `loggedIn` + `wxid` 再走 `bind-existing`。不要空转 `qr.start`，不要把 Telegram 激活写进用户步骤。
6. 绑定成功后 identity 的 `externalAccountId` 是 `wxid`，可给自有数字人 grant。提醒：该号的平板/Mac 登录位会被占用，有掉线封号风险。

斜杠命令与 RPC 名称不变。

## 数字人接管（仅私聊文本）

绑上且 worker `logged_in` 后，sidecar 把入站私聊 POST 到 **持会话那台电脑** 的
`http://127.0.0.1:18789/webhook/wechat`。谁听这个口：已连接且 advertise
`wechat.personal.probe` 的桌面节点优先；没有桌面节点时，本机直连 Gateway 才在
`127.0.0.1` 听（从不 `0.0.0.0`）。同一台机器抢端口时 fail-open，谁先绑上谁收。
桌面节点把入站转成 `wechat.personal.inbound`；Gateway 按 `AgentRouteBinding`
（`channel: "wechat"`）进数字人，回复走 `wechat.personal.sendText`。不要走
`user-operational-identity.execute`。群聊和图片/文件/语音本切片不做，忽略即可，
不要假装发出去。云端 Gateway **不会**开公网 webhook；云端接管需要已重建的桌面节点。

## 桌面端已连接仍离线

如实说：云端会钉在这台桌面节点上，不会改去扫服务器 loopback。若 worker json 写了绝对路径 `command`，桌面端会尝试拉起 loopback sidecar；没有 `command` 或拉起失败则 probe 仍 fail-closed。记下节点状态。不要让用户把 sidecar 配到 LIVE 主机，也不要推荐 huohuoer / `wechat-cli`。

## 禁止

- 把个人微信和公众号 / 企微流程混用
- 把会话、`context_token`、proxy `apiKey` 写进云端配置
- 知识宇宙 ingest / KE 技能当微信入口
