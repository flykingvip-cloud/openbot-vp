# @openclaw/wechat

微信 (WeChat) personal channel plugin for OpenBot.

## 安装

```bash
openclaw plugins install @openclaw/wechat
```

## 配置

```bash
# 设置 API Key（必填）
openclaw config set channels.wechat.apiKey "wc_live_xxxxxxxxxxxxxxxx"

# 设置代理服务地址（必填）
openclaw config set channels.wechat.proxyUrl "http://your-proxy-server:3000"

# 设置 webhook 公网地址（云服务器部署必填）
openclaw config set channels.wechat.webhookHost "your-server-ip"

# 启用通道
openclaw config set channels.wechat.enabled true
```

### 配置选项

```jsonc
// ~/.openclaw/openclaw.json
{
  "channels": {
    "wechat": {
      "enabled": true,
      "apiKey": "wc_live_xxxxxxxxxxxxxxxx", // 必填 - 代理服务 API Key
      "proxyUrl": "http://your-proxy:3000", // 必填 - 代理服务地址

      // Webhook 配置（云服务器部署必填）
      "webhookHost": "127.0.0.1", // Mac loopback; not the cloud Gateway
      "webhookPort": 18789, // 默认: 18789
      "webhookPath": "/webhook/wechat", // 默认: /webhook/wechat

      // 可选配置
      "deviceType": "ipad", // "ipad"（默认，更稳定）或 "mac"

      // 多账户配置
      "accounts": {
        "work": {
          "apiKey": "wc_live_work_xxx",
          "webhookHost": "1.2.3.4",
        },
        "personal": {
          "apiKey": "wc_live_personal_xxx",
          "webhookHost": "1.2.3.4",
        },
      },
    },
  },
}
```

## 首次登录

首次启动 gateway 时会显示二维码，用微信扫码登录。

## 功能

- ✅ 私聊消息收发
- ✅ 群聊消息收发
- ✅ 文本消息
- ✅ 图片消息
- ✅ 二维码登录流程
- ✅ 多账户支持
- ✅ DM 策略（open/pairing/allowlist）

## 架构说明

微信通道通过代理服务连接，架构如下：

```
微信服务器 ←→ 代理服务 ←→ OpenBot Gateway
                ↑                    ↑
           (iPad/Mac 协议)     (HTTP API + Webhook)
```

- **代理服务**：处理微信协议（iPad/Mac 协议），提供 HTTP API
- **Gateway**：通过 API 发送消息，通过 Webhook 接收消息
- **API Key**：用于 Gateway 与代理服务之间的认证

## 常见问题

### 收不到消息

1. 确保 sidecar POST 到 Mac loopback `http://127.0.0.1:18789/webhook/wechat`
2. 确保 `webhookPort` 端口可从外网访问
3. 检查 gateway 是否运行：`openclaw gateway status`

### 掉线重连

代理服务会自动处理重连。如果长时间离线，可能需要重新扫码登录。

## 声明

本插件仅供学习和研究使用。微信个人号自动化存在封号风险，请谨慎使用。

## License

MIT

## Workbench 个人号绑定（本切片）

Workbench **个人设置** 可通过本地 worker 扫码绑定微信个人号。

- 需要本地 worker 在线，否则 fail-closed（不生成二维码）
- 会话文件留在 worker（chmod 600），不要把 `context_token` / 代理 apiKey 存进云端 Gateway
- 这不是公众号，也不是企微
- 本切片不含群聊 / 媒体 / 完整入站 dispatcher，也不上 LIVE
