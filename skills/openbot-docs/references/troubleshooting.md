# 排障入口

先走 OpenBot 文档里的**症状优先**梯子；本页只列入口与常见分流。

## 两分钟梯子（先跑）

以 `docs/help/troubleshooting.md` 为准，通常顺序：

```bash
openbot status
openbot status --all
openbot gateway probe
openbot gateway status
openbot doctor
openbot channels status --probe
openbot logs --follow
```

健康粗标：Gateway `Runtime: running` + `RPC probe: ok`；doctor 无阻断；渠道 `connected`/`ready`。

更深：`docs/gateway/troubleshooting.md`、`docs/channels/troubleshooting.md`。

## 常见分流

| 症状                             | 下一步                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------- |
| 打不开 `http://127.0.0.1:18789/` | 确认 Gateway 已启动；见 gateway-local + `docs/web/control-ui.md`                  |
| Control UI `pairing required`    | `openbot devices list` → `approve`；本地 loopback 常自动批准                      |
| 个人微信不出码 / worker 离线     | → `wechat-personal-ops`（先探测）；目录见 catalog；文档 `docs/channels/wechat.md` |
| 企微/飞书/钉钉连不上             | 企业消息渠道文档 + `channels status --probe`；不是 wechat-use                     |
| 技能不生效                       | `docs/tools/skills.md` 加载顺序；工作区 vs `~/.openbot/skills`                    |
| 插件缺 `openbot.extensions`      | 见 help troubleshooting 对应节                                                    |
| 模型 429 / 长上下文              | gateway troubleshooting 对应节（以当前文档为准）                                  |

## 不要

- 发明未文档化的「重置一切」破坏性命令当第一步。
- 默认让用户装 wechat-use / 扫内存 / 注入客户端。
- 把 Grok Bot「Reset Computer」当成 OpenBot Gateway 修复。

## 仍不确定

回到 docs-first：用错误原文 2–6 词搜 `docs/help/` 与 `docs/gateway/`，打开匹配页后再给步骤。
