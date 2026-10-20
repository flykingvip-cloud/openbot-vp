# 本机 Gateway（高阶）

细节与命令以 `docs/gateway/index.md`、`docs/gateway/network-model.md`、`docs/gateway/configuration.md` 为准。此处只固定**易错要点**，避免臆造。

## 默认端口与绑定

- 默认端口 **18789**：`--port` → `OPENBOT_GATEWAY_PORT` → `gateway.port` → `18789`。
- 默认绑定 **loopback**（`ws://127.0.0.1:18789` / `http://127.0.0.1:18789/`）。
- 同一端口复用：WebSocket 控制面、HTTP API、Control UI、hooks、canvas host 路径等。

常用：

```bash
openbot gateway --port 18789
openbot gateway status
openbot dashboard
```

## Loopback 注意

- 本机调试优先 loopback；非 loopback（LAN/tailnet）通常**必须** token，并注意设备配对。
- 向导默认会生成 gateway token；本地 Control UI 首次连接可能要粘贴 token（见 `docs/web/control-ui.md`）。
- 个人微信 sidecar 必须是 loopback（常见 `http://127.0.0.1:3000`）。**不要**把非 loopback URL 配进 `channels.wechat.proxyUrl` / worker；LIVE/云端不要直连用户电脑上的 3000。
- Gateway webhook 入站常见本机路径与 18789 相关；**不要**把 sidecar 的 3000 与 Gateway 18789「并成同一个服务」。

## 健康信号

期望：`Runtime: running`、`RPC probe: ok`；渠道可用 `openbot channels status --probe`。更深排障见 `troubleshooting.md` 与 `docs/help/troubleshooting.md`。

## 远程访问

摘要级：SSH 隧道或 tailnet；见 `docs/gateway/remote.md`、`docs/gateway/discovery.md`、`docs/gateway/tailscale.md`。不要在未读文档时编造防火墙或云厂商控制台步骤。

## 与 Grok Bot「Computer」的区别

OpenBot Gateway 是 OpenBot 控制面进程。Grok Bot 的 box /「Update Grok Bot's Computer」是另一套宿主概念——**不要混用设置路径**。
