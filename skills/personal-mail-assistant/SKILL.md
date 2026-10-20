---
name: personal-mail-assistant
description: 个人邮箱 skill 套件（大白管家标配）。引导用户在对话或个人设置中绑定 SMTP/IMAP，并通过 user_operational_identity 智能收发。Use when the user asks to configure personal email or send/read/search/reply to mail.
metadata:
  openclaw:
    always: false
  version: "1.0"
---

# 个人邮箱 skill（大白管家标配）

**配置与引导的默认负责人是「大白管家」**——帮用户绑定凭证、验证、说明下一步；凭证写入运营身份 store，与个人设置 UI 同源。

其它岗位机器人要在个人设置里获得 explicit grant 后才能收发，不能默认代配邮箱。授权一旦生效，任何机器人都走同一条发信路径，没有单独豁免。

## 工具

使用 `user_operational_identity`：

1. `action=resolve`, `provider=personal-email`, 可选 `email=user@126.com`（Path C 浏览器提示）
2. `action=execute` + `operationalAction`：
   - `sync_inbox` / `read_email` / `search_email`
   - `send_email` / `reply_email`

## Path C — 浏览器协驾（推荐：不懂授权码时）

用户说「网页登录配邮箱 / 不知道怎么拿授权码 / 126 授权码」：

1. `resolve` 时传 `email` → 响应含 `browserGuide`、`browserGuidanceProtocol`
2. **加载** `skills/user-guidance-protocol/references/personal-email-browser.yaml`
3. 用 `browser` 工具（profile=chrome）打开 `browserGuide.webmailLoginUrl`；用户自行登录与验证码
4. 一步一带：设置 → 开启 IMAP/SMTP → 生成授权码
5. 用户粘贴授权码到 OpenBot 表单「SMTP 授权码」→ 添加并认证（**勿存登录密码**）
6. 可选半自动：用户明确同意后，才从页面读取刚生成的授权码

表单/聊天区有 **「打开邮箱网页」** / **「浏览器获取授权码」** 按钮。

## Path B — 对话引导个人设置

见 `personal-email.yaml`：带路到【个人设置 → 授权 / 运营身份】；聊天区 **「去绑定」**。

## Path A — 个人设置手填

用户自行打开个人设置添加个人邮箱（与 B/C 表单同源）。

## 收发（已授权 agent）

本回合若列出 personal-email 的 `send_email` / `reply_email`，授权就是有效的。用户要发信或回复时：

1. 调用 `user_operational_identity`（`resolve` 然后 `execute`）
2. 不要说「还没有授权」或「这个会话没有发信通道」
3. 不要用 exec 探测或调用 `mail` / `sendmail` / `mutt`，也不要读 `OPENBOT_SMTP_*`

若列表里没有 personal-email 发信授权，直接说明当前机器人没有个人邮箱授权，并指向【个人设置 → 授权 / 运营身份】。不要改口成别的失败原因。

- 「查最近邮件」→ `sync_inbox` / `search_email`
- 「读这封」→ `read_email` + `uid`
- 「回复 / 发送」→ `reply_email` / `send_email`

禁止 exec / 环境变量直连 SMTP/IMAP。
