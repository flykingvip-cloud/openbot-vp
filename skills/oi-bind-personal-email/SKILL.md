---
name: oi-bind-personal-email
description: >-
  帮用户把个人邮箱写入私有数字身份（个人设置 → 授权 → 个人邮箱）。
  Path B：引导填写 OpenBot 表单（显示名称、发件邮箱、SMTP/IMAP、授权码）。
  Path C：浏览器协驾打开网页邮箱生成授权码（不是登录密码），再粘贴回表单。
  126/163/yeah 必须自定义 SMTP+IMAP，不要用「平台代发」。
  回写经 user-operational-identity.credentials.bind（smtp）。密钥不进聊天与 EffectiveAccess 投影。
metadata:
  openclaw:
    emoji: "✉️"
    promptPriority: 87
---

# 个人邮箱绑定（OI）

入口：**个人设置 → 授权 → 个人邮箱**。  
Guidance 资产（带路文案）：

- Path B：[`user-guidance-protocol/references/personal-email.yaml`](../user-guidance-protocol/references/personal-email.yaml)
- Path C：[`user-guidance-protocol/references/personal-email-browser.yaml`](../user-guidance-protocol/references/personal-email-browser.yaml)

字段契约：[references/field-contract.md](references/field-contract.md)

## 何时 Path B / Path C

| 情况 | 路径 |
|------|------|
| 用户已有授权码，会填表 | Path B（表单） |
| 「不知道怎么拿授权码 / 网页登录 / 126·163·QQ 授权码」 | Path C（browser 协驾）再回到表单提交 |

绑定完成后的收发运营可交给 `personal-mail-assistant`；**本 skill 只负责绑定**。

## 表单同构字段

与 `renderPersonalEmailForm` 一致：

| UI 标签 | 字段 | 说明 |
|---------|------|------|
| 显示名称 | displayName | |
| 发件邮箱 | credentialHandleId | 如 `name@126.com` |
| 平台代发 | usePlatformSmtp | 仅当 snapshot.platformSmtpConfigured；**126/163/yeah 不要勾选** |
| SMTP 主机/端口/用户名 | smtp* | 有域名 preset 时可自动填；无 preset 手填 |
| IMAP 主机/端口/用户名 | imap* | 同上；非平台代发时需要 |
| SMTP 授权码 | appSecret（表单复用该槽） | **应用专用密码 / 客户端授权码**，不是登录密码 |

Preset 主机见 `personal-email-providers` / `personal-email-presets`（163/126/yeah/qq 等）。

## 回写路径（唯一）

1. 字段齐后经 gateway **`user-operational-identity.credentials.bind`**（manualKind `smtp`），或工作台「添加并认证」。
2. 验收：`verify_credentials` 或 resolve 显示 active。
3. **禁止**直接改 OI JSON；**禁止**把授权码 / 登录密码写入聊天、EffectiveAccess 投影或浏览器密码库作为「绑定证据」。
4. Path C 验证码、滑块、二次验证必须用户本人完成。

## 铁律

1. 126 / 163 / yeah.net：**避免平台代发 SMTP**，填服务商 SMTP+IMAP + 授权码。
2. 永不要求用户把邮箱登录密码当作 SMTP 密码存进 OpenBot。
3. 未授权代配时只带路，不代提交。

## 完成标准

- 个人授权目录「个人邮箱」已配置
- resolve / 验证通过；聊天无授权码全文
