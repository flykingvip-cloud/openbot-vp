---
summary: "WeCom (Enterprise WeChat) AIBot long connection and corp-app callback for OpenBot"
read_when:
  - You want to connect OpenBot to WeCom / Enterprise WeChat
  - You need AIBot WebSocket or classic corp-app callback setup
title: "WeCom"
---

# WeCom

OpenBot supports **WeCom (企业微信 / Enterprise WeChat)** for enterprise messaging — not personal WeChat.

Two connection modes are supported. They use **different product surfaces and credentials** and must not be mixed.

| Mode                                        | WeCom product surface         | OpenBot fields                                           | Public Callback URL |
| ------------------------------------------- | ----------------------------- | -------------------------------------------------------- | ------------------- |
| **WebSocket long connection (recommended)** | 智能机器人 → API → 使用长连接 | `botId`, `secret`                                        | Not required        |
| **URL callback**                            | 自建应用 → 接收消息           | `corpId`, `agentId`, `secret`, `token`, `encodingAesKey` | Required            |

Gateway long-connection endpoint: `wss://openws.work.weixin.qq.com` (`aibot_subscribe`).

## Enterprise console (recommended)

Open **Enterprise console → System settings → Message channels → WeCom**.

### A. WebSocket long connection

#### Open-platform checklist

1. WeCom admin: **安全与管理 → 管理工具 → 智能机器人 → 创建机器人**.
2. Prefer **手动创建 → API 模式**.
3. Set robot name and **可见范围** (members / departments who can use the bot).
4. Save, then under API config choose **使用长连接**.
5. Copy **Bot ID**. Click **点击获取** for **Secret** (shown once — store it immediately).
6. Do **not** configure URL / Token / EncodingAESKey in this mode.

Members without admin rights can create robots from the WeCom client **工作台 → 智能机器人** with the same API + long-connection steps.

#### OpenBot checklist

1. Connection mode: **WebSocket 长连接**.
2. Fill **Bot ID** and **长连接 Secret**, then **Save**.
3. No Callback URL backfill — the gateway dials WeCom.
4. Find the bot under WeCom contacts (**企业创建的**), send `你好`.
5. Click **测试连通**. Success means AIBot subscribe auth passed.

### B. URL callback (alternate)

Use this for classic **自建应用** callbacks when you already expose a public gateway URL.

#### Open-platform checklist

1. Create a self-built app and set member visibility.
2. Under **接收消息**, generate **Token** and **EncodingAESKey** (43 chars).
3. Keep corp trusted IP / publish state ready for callback verification.

#### OpenBot checklist

1. Connection mode: **URL 回调**.
2. Fill Corp ID, Agent ID, app Secret, Token, EncodingAESKey → **Save**.
3. Copy the read-only **Callback URL** (account-scoped path such as `/wecom/a/t_<tenant>_default`).
4. Paste URL into WeCom **接收消息**, save on the WeCom side.
5. Message the app / bot with `你好`, then **测试连通**.

Order matters for callback mode: generate Token/AESKey → save in OpenBot → copy Callback URL → paste back to WeCom → save WeCom.

## CLI / config file

Plugin blurb path: `/channels/wecom`. Install when not bundled:

```bash
openbot plugins install @openclaw/wecom
```

### Long connection account

```json5
{
  channels: {
    wecom: {
      enabled: true,
      accounts: {
        default: {
          connectionMode: "websocket",
          botId: "aibXXXXXXXX",
          secret: "your-aibot-long-connection-secret",
        },
      },
    },
  },
}
```

### Callback account

```json5
{
  channels: {
    wecom: {
      enabled: true,
      accounts: {
        default: {
          connectionMode: "callback",
          corpId: "ww1234567890abcdef",
          agentId: 1000002,
          secret: "your-wecom-app-secret",
          token: "your-callback-token",
          encodingAesKey: "your43charencodingaeskey",
          webhookPath: "/wecom/a/default",
        },
      },
    },
  },
}
```

Legacy configs that only set `corpId` continue to resolve as callback mode.

## What works today

- AIBot long connection: text inbound + reply path, subscribe probe
- Corp-app callback: encrypted webhook inbound + `message/send` text replies
- Multi-account mapping via `channels.wecom.accounts`
- DM policies: `pairing`, `allowlist`, `open`

## Current scope

- Text is the primary path for enterprise onboarding
- Group chat, rich media, and advanced corp events may be incomplete depending on mode
- Personal WeChat is out of scope

## Pairing

If `dm.policy = "pairing"`, approve new senders with:

```bash
openbot pairing approve wecom <code>
```

## Troubleshooting

| Symptom                         | Check                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| Long connection probe fails     | Same mode on both sides; Bot ID / Secret trim; Secret regenerated if expired         |
| Callback URL verification fails | Token + EncodingAESKey match; public HTTPS URL reachable; gateway running            |
| Bot never replies               | Visibility / usable members; bot published; send from an in-scope user; gateway logs |
| Mode mismatch                   | WeCom long connection cannot use corp callback fields, and vice versa                |

## Related

- [Enterprise IM hub](/channels/enterprise-im)
- [Feishu](/channels/feishu) · [DingTalk](/channels/dingtalk)
- [Channel troubleshooting](/channels/troubleshooting)
