---
summary: OpenBot 企业微信 AIBot 长连接与自建应用回调接入指南
read_when:
  - 需要把 OpenBot 接到企业微信
  - 需要配置智能机器人长连接或自建应用回调
title: 企业微信
---

# 企业微信

OpenBot 支持 **企业微信** 企业消息接入（不支持个人微信）。

两种连接模式对应不同的企微产品面与凭证，**不可混用**：

| 模式                         | 企微入口                      | OpenBot 字段                                             | 公网 Callback |
| ---------------------------- | ----------------------------- | -------------------------------------------------------- | ------------- |
| **WebSocket 长连接（推荐）** | 智能机器人 → API → 使用长连接 | `botId`、`secret`                                        | 不需要        |
| **URL 回调**                 | 自建应用 → 接收消息           | `corpId`、`agentId`、`secret`、`token`、`encodingAesKey` | 需要          |

长连接网关：`wss://openws.work.weixin.qq.com`（`aibot_subscribe`）。

## 企业控制台（推荐）

路径：**企业控制台 → 系统设置 → 消息通道 → 企业微信**。

### A. WebSocket 长连接

#### 开放平台检查

1. 管理后台：**安全与管理 → 管理工具 → 智能机器人 → 创建机器人**。
2. 优先 **手动创建 → API 模式**。
3. 填写名称，并设置 **可见范围**。
4. 保存后，在 API 配置选择 **使用长连接**。
5. 复制 **Bot ID**；点击 **点击获取** 得到 **Secret**（仅显示一次，立即保存）。
6. 此模式不要配置 URL / Token / EncodingAESKey。

普通成员可在客户端 **工作台 → 智能机器人** 按同样步骤创建 API 长连接机器人。

#### 本页配置

1. 连接模式选 **WebSocket 长连接**。
2. 填写 Bot ID、长连接 Secret 并保存。
3. 无需回填 Callback；网关会主动连接企微。
4. 在通讯录「企业创建的」中找到机器人，发送「你好」。
5. 点击 **测试连通**（成功表示 AIBot subscribe 鉴权通过）。

### B. URL 回调（备选）

适用于已有公网网关的自建应用回调。

#### 开放平台检查

1. 创建自建应用并设置成员可见范围。
2. 在「接收消息」生成 Token 与 43 位 EncodingAESKey。
3. 确认可信 IP / 发布状态满足回调校验。

#### 本页配置

1. 连接模式选 **URL 回调**。
2. 填写五项凭证并保存。
3. 复制只读 Callback URL（账户级路径，如 `/wecom/a/t_<tenant>_default`）。
4. 回填到企微「接收消息」并保存。
5. 发送「你好」，再点 **测试连通**。

回调顺序：企微生成 Token/AESKey → 填入 OpenBot → 复制 URL → 回填企微 → 保存企微。

## CLI / 配置文件

```bash
openbot plugins install @openclaw/wecom
```

长连接示例：

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

仅配置了 `corpId` 的旧配置仍按回调模式解析。

## 当前能力与范围

- 长连接：文本入站/回复、subscribe probe
- 回调：加密 webhook 入站 + `message/send` 文本回复
- 多账户：`channels.wecom.accounts`
- 以文本为主；群聊/富媒体视模式可能尚未完整

## 故障排除

| 现象              | 排查                                                      |
| ----------------- | --------------------------------------------------------- |
| 长连接测试失败    | 两侧模式一致；Bot ID/Secret 无空格；Secret 是否需重新获取 |
| 回调 URL 校验失败 | Token/AESKey 一致；HTTPS 可达；网关在运行                 |
| 机器人不回复      | 可见范围；已发布；发送方在范围内；查网关日志              |
| 模式不一致        | 长连接凭证不能用于回调字段，反之亦然                      |

## 相关文档

- [企业 IM 接入](/channels/enterprise-im)
- [飞书](/channels/feishu) · [钉钉](/channels/dingtalk)
