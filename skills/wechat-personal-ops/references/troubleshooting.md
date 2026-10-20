# 运营通道排障

先调 `user-operational-identity.wechat-personal.status`。不要先改 LIVE。

| 现象                         | 做什么                                                                                                            | 不要做什么                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| worker 离线、扫不出码        | 确认本机 OpenBot 桌面端已连当前 Gateway；sidecar 在持号电脑 `127.0.0.1:3000`；`command` 绝对路径可执行            | 把 sidecar 配到云端；空转 `qr.start`；推荐 wechat-cli |
| probe 连接拒绝且无 `command` | 让运营方提供协议二进制，写入 `~/.openbot/wechat-personal-worker.json` 的 `command`                                | OpenBot 仓库里塞协议栈                                |
| 桌面已连仍离线               | 云端钉在这台节点，不会扫服务器 loopback；查该 Mac 的 3000                                                         | 改 `channels.wechat.proxyUrl` 为公网                  |
| mint 401 / 工作台壳不对      | 那是桌面 embed 问题，不是本技能；loopback Gateway 可走本机 embed                                                  | 用知识宇宙技能修壳                                    |
| 已登录无回复                 | 查 grant 的 `agentId` 与 `channel: "wechat"`；入站是否到达 `/webhook/wechat`；回复是否 `wechat.personal.sendText` | `user-operational-identity.execute`；假装发群/图片    |
| 用户想入库聊天记录           | 交给 `wechat-personal-kb`                                                                                         | 用 sidecar 会话当 source                              |

主 UI 离线文案只说「请打开本机 OpenBot 桌面端」。

| 想用 wechat-use 桥接数字人 | 见 `adapter-wechatuse.md`（18400→3000）；契约见 `sidecar-http-vnext.md` | 把 18400 写进默认 worker.json |
