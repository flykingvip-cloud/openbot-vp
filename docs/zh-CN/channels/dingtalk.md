---
summary: OpenBot 钉钉 Stream 长连接与 HTTP 回调接入指南
read_when:
  - 需要把 OpenBot 接到钉钉
  - 需要配置 Stream 或 HTTP 回调
title: 钉钉
---

# 钉钉

OpenBot 支持钉钉企业内部应用，两种连接模式：

| 模式                      | 钉钉侧            | OpenBot 字段                    | 公网 Callback |
| ------------------------- | ----------------- | ------------------------------- | ------------- |
| **Stream 长连接（推荐）** | 消息接收 = Stream | `clientId`、`clientSecret`      | 不需要        |
| **URL / HTTP 回调**       | 消息接收 = HTTP   | Client ID/Secret + Callback URL | 需要          |

Client ID 又称 **AppKey**；Client Secret 又称 **AppSecret**。

## 企业控制台（推荐）

路径：**企业控制台 → 系统设置 → 消息通道 → 钉钉**。

### A. Stream 长连接

#### 开放平台检查

1. 打开 [钉钉开放平台](https://open.dingtalk.com/)，使用管理员登录。
2. **应用开发 → 创建应用**，添加 **机器人** 能力。
3. **权限管理** 开通：`Card.Streaming.Write`、`Card.Instance.Write`、`qyapi_robot_sendmsg`。
4. **凭证与基础信息** 复制 Client ID / Client Secret。
5. 消息接收保持 **Stream**（此路径不要切 HTTP）。
6. 创建版本并 **发布**。
7. 群聊使用时：群的 **归属组织** 须与应用组织一致。

#### 本页配置

1. 连接模式选 **Stream 长连接**。
2. 填写 Client ID / Secret 并保存。
3. 无需回填 Webhook。
4. 搜索机器人私聊发送「你好」，或在群里 @ 机器人。
5. 点击 **测试连通**。

### B. URL 回调（备选）

1. OpenBot 选 **URL 回调**，填写凭证并保存。
2. 复制只读 Callback URL。
3. 钉钉机器人消息接收：**Stream → HTTP**，粘贴 **https** 地址后发布。
4. 发送「你好」，再 **测试连通**。

## CLI / 配置文件

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

## 使用方式

- **单聊**：顶部搜索机器人名称后发消息。
- **群聊**：群设置 → 机器人 → 添加；@ 机器人下发任务。

## 故障排除

| 现象             | 排查                                            |
| ---------------- | ----------------------------------------------- |
| 无回复           | 应用已发布；三项权限已开；网关运行中            |
| 群里找不到机器人 | 群归属组织与应用一致；重启钉钉客户端            |
| HTTP 回调失败    | URL 为 https；钉钉侧为 HTTP；OpenBot 为 webhook |
| 模式不一致       | 两侧必须同为 Stream 或同为 HTTP                 |

## 相关文档

- [企业 IM 接入](/channels/enterprise-im)
- [企业微信](/channels/wecom) · [飞书](/channels/feishu)
