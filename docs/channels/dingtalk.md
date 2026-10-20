---
summary: "DingTalk Stream and HTTP webhook setup for OpenBot"
read_when:
  - You want to connect OpenBot to DingTalk
  - You need Stream long connection or HTTP callback setup
title: "DingTalk"
---

# DingTalk

OpenBot supports **DingTalk (钉钉)** enterprise apps with two connection modes:

| Mode                                     | DingTalk setting         | OpenBot fields                            | Public Callback URL |
| ---------------------------------------- | ------------------------ | ----------------------------------------- | ------------------- |
| **Stream long connection (recommended)** | Message receive = Stream | `clientId`, `clientSecret`                | Not required        |
| **URL / HTTP webhook**                   | Message receive = HTTP   | `clientId`, `clientSecret` + Callback URL | Required            |

`Client ID` is also called **AppKey**; `Client Secret` is also called **AppSecret**.

## Enterprise console (recommended)

Open **Enterprise console → System settings → Message channels → DingTalk**.

### A. Stream long connection

#### Open-platform checklist

1. Open [DingTalk Open Platform](https://open.dingtalk.com/) with an admin account.
2. **应用开发 → 创建应用**, add **机器人** capability, set name / description / icon.
3. **权限管理**: enable at least
   - `Card.Streaming.Write`
   - `Card.Instance.Write`
   - `qyapi_robot_sendmsg`
4. **凭证与基础信息**: copy **Client ID** and **Client Secret**.
5. Keep message receive mode on **Stream** (do not switch to HTTP for this path).
6. Create a version and **publish** the app.
7. For group use later: the group’s **归属组织** must match the app’s organization.

#### OpenBot checklist

1. Connection mode: **Stream 长连接**.
2. Fill Client ID / Client Secret → **Save**.
3. No Webhook backfill.
4. Search the robot in DingTalk and send `你好`, or @ the bot in a group.
5. Click **测试连通**.

### B. URL callback (alternate)

#### Open-platform checklist

Same app creation, permissions, and publish steps as Stream.

#### OpenBot checklist

1. Connection mode: **URL 回调**.
2. Fill Client ID / Client Secret → **Save**.
3. Copy the read-only **Callback URL**.
4. In DingTalk robot message receive config: switch **Stream → HTTP**, paste the URL as **https**, then publish.
5. Send `你好`, then **测试连通**.

## CLI / config file

```bash
openbot plugins install @openclaw/dingtalk
```

```json5
{
  channels: {
    dingtalk: {
      enabled: true,
      accounts: {
        default: {
          connectionMode: "stream",
          clientId: "dingxxxxxxxx",
          clientSecret: "your-client-secret",
        },
      },
    },
  },
}
```

Webhook mode sets `connectionMode: "webhook"` and uses the account webhook path / public URL helpers.

## Using the bot

### Direct message

Search the robot name in DingTalk and open a chat.

### Group chat

1. Create or open a group whose organization matches the app.
2. Group settings → **机器人** → add your robot.
3. @ the robot with a task or greeting.

## Troubleshooting

| Symptom                                     | Check                                                               |
| ------------------------------------------- | ------------------------------------------------------------------- |
| No reply                                    | App published; three permissions enabled; gateway running           |
| Group cannot find robot                     | Group organization matches app organization; client restarted       |
| HTTP callback fails                         | URL is `https`; DingTalk side is HTTP mode; OpenBot mode is webhook |
| Stream mode but HTTP configured on DingTalk | Modes must match on both sides                                      |

## Related

- [Enterprise IM hub](/channels/enterprise-im)
- [WeCom](/channels/wecom) · [Feishu](/channels/feishu)
- [Channel troubleshooting](/channels/troubleshooting)
