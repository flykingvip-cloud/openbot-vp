# @openclaw/dingtalk

钉钉 (DingTalk) channel plugin for OpenBot.

## 安装

```bash
openclaw plugins install @openclaw/dingtalk
```

## 配置

```bash
# 设置 Client ID（必填，来自钉钉开放平台）
openclaw config set channels.dingtalk.clientId "dingxxxxxxxxx"

# 设置 Client Secret（必填）
openclaw config set channels.dingtalk.clientSecret "your-app-secret"

# 启用通道
openclaw config set channels.dingtalk.enabled true
```

### 配置选项

```jsonc
// ~/.openclaw/openclaw.json
{
  "channels": {
    "dingtalk": {
      "enabled": true,
      "clientId": "dingxxxxxxxxx", // 必填 - 钉钉应用 AppKey
      "clientSecret": "xxx", // 必填 - 钉钉应用 AppSecret
      "connectionMode": "stream", // "stream"（推荐）或 "webhook"
      "robotCode": "dingxxxxxxxxx", // 可选 - 机器人编码，默认使用 clientId

      // Webhook 模式配置（仅 webhook 模式需要）
      "webhookPath": "/dingtalk",
      "webhookUrl": "https://your-server.com/dingtalk",

      // 多账户配置
      "accounts": {
        "sales-bot": {
          "clientId": "ding_sales_xxx",
          "clientSecret": "xxx",
        },
        "support-bot": {
          "clientId": "ding_support_xxx",
          "clientSecret": "xxx",
        },
      },
    },
  },
}
```

## 连接模式

### Stream 模式（推荐）

- 无需公网 IP
- 基于 WebSocket 长连接
- 自动重连
- 适合个人开发和内网部署

### Webhook 模式

- 需要公网可达的回调地址
- 适合已有公网服务器的场景
- 需要在钉钉开放平台配置回调 URL

## 功能

- ✅ 私聊消息收发
- ✅ 群聊消息收发（@机器人触发）
- ✅ 文本消息
- ✅ 图片/文件附件接收
- ✅ 多账户支持
- ✅ DM 策略（open/pairing/allowlist）

## 钉钉开放平台配置

1. 登录 [钉钉开放平台](https://open.dingtalk.com)
2. 创建企业内部应用
3. 获取 AppKey (Client ID) 和 AppSecret (Client Secret)
4. 在「机器人与消息推送」中启用机器人
5. 如使用 Stream 模式，无需额外配置
6. 如使用 Webhook 模式，配置消息接收地址

## License

MIT
