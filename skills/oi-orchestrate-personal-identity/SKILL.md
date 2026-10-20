---
name: oi-orchestrate-personal-identity
description: >-
  大白管家入口：帮用户配置「个人设置 → 授权 → 绑定账户」里的私有数字身份。
  遇到「配数字身份」「绑定账户」「完善我的授权」「帮我配公众号/邮箱/GitHub/社媒身份」
  「个人运营身份」「私有数字身份」务必使用。按授权目录编排 oi-bind-* /
  oi-grant-owned-bots；不直接改配置文件；密钥不进聊天。
  用户只要自己点界面时改走 user-guidance-protocol。
metadata:
  openclaw:
    emoji: "🪪"
    promptPriority: 88
---

# 个人私有数字身份编排

产品入口：**个人设置 → 授权 → 绑定账户**（`user_operational_identity`）。  
本 skill **不写库**；只选型、确认授权闸门、委派子 skill，再刷新 snapshot。

权威契约：[docs/design/oi-intelligent-bind-s0-s1-2026-10-13.md](../../docs/design/oi-intelligent-bind-s0-s1-2026-10-13.md)；S2：[docs/design/oi-intelligent-bind-s2-github-2026-10-13.md](../../docs/design/oi-intelligent-bind-s2-github-2026-10-13.md)；S3：[docs/design/oi-intelligent-bind-s3-social-2026-10-13.md](../../docs/design/oi-intelligent-bind-s3-social-2026-10-13.md)；S4：[docs/design/oi-intelligent-bind-s4-wechat-personal-2026-10-13.md](../../docs/design/oi-intelligent-bind-s4-wechat-personal-2026-10-13.md)；S5：[docs/design/oi-intelligent-bind-s5-live-path-2026-10-13.md](../../docs/design/oi-intelligent-bind-s5-live-path-2026-10-13.md)；S6：[docs/design/oi-intelligent-bind-s6-social-verified-live-2026-10-19.md](../../docs/design/oi-intelligent-bind-s6-social-verified-live-2026-10-19.md)  
目录表：[references/catalog-map.md](references/catalog-map.md)

## 授权闸门

1. 用户未明确说「帮我配 / 你来操作 / 代绑定」→ 只加载 `user-guidance-protocol`（人点界面），不要代填密钥。
2. 用户明确授权代配 → 再开隔离浏览器 / 云电脑取证，取证结果经 **gateway OI API** 回写。
3. 禁止：直接编辑 `openbot-user-operational-identity.json` / `*-secrets.json`；禁止把 AppSecret、授权码、Cookie 打进聊天或投影。

## 主流程

```
用户意图
  → list / resolve 个人 OI snapshot（缺绑则 needsBinding）
  → 对照 registrationReady 目录问要配哪一项（或按未配置项排队）
  → 委派子 skill（见下表）
  → 用户确认后 credentials.bind / oauth.* / wechat-personal.* / grants.upsert
  → resolve / 刷新「已配置」导航
```

| 目录项 | 动作 |
|--------|---------|
| 微信公众号 | 加载 `oi-bind-wechat-official`（`verified_live`；云电脑证据） |
| 个人邮箱 | 加载 `oi-bind-personal-email`（`verified_live`） |
| 自有数字人授权 | 加载 `oi-grant-owned-bots` |
| GitHub（个人） | 加载 `oi-bind-github-personal`（OAuth 样板；`verified_live`） |
| 小红书 | 加载 `oi-bind-xiaohongshu`（`path_unstable`；S6 live-evidence 2026-10-19，未 verified_live） |
| 抖音 | 加载 `oi-bind-douyin`（`path_unstable`；S6 live-evidence，未 verified_live） |
| 微博 | 加载 `oi-bind-weibo`（`path_unstable`；S5 GeeTest/111001；S6 复核仍未 verified_live） |
| 哔哩哔哩 | 加载 `oi-bind-bilibili`（`path_unstable`；S6 live-evidence，未 verified_live） |
| 知乎 | 加载 `oi-bind-zhihu`（`path_unstable`；S6；#827 登录 detect ≠ OI bind） |
| 快手 | 加载 `oi-bind-kuaishou`（`path_unstable`；S6 live-evidence，未 verified_live） |
| X | 加载 `oi-bind-x-twitter`（OAuth2+PKCE；S6 live-evidence 仍 `verified_live: false`） |
| 微信个人号 | 加载 `oi-bind-wechat-personal`（**非云电脑主路径**；委派 `wechat-personal-worker-setup`） |
| 飞书个人账号 | `registrationReady=false`，不做 |


## 默认推荐（S5–S6）

- **默认推荐**：仅 `verified_live: true` 的目录项（见 catalog-map）。
- **跳过**：一切 `path_unstable: true`（含 weibo 等社媒），除非用户显式点名。
- **禁止**：把未测 provider 标成 / 口头称为已 `verified_live`。
- **S6**：七站均有 live-evidence；本切片 0/7 翻旗；残余人机/云电脑步骤见设计文档与各站证据。

## 与现有 skill 关系

- 用户自己点界面：`user-guidance-protocol` + 对应 yaml（`wechat-oa` / `personal-email` / `personal-email-browser` / `platform-settings`）
- 公众号扫码代写：底层仍是 `wechat-official-credential`；本编排经 `oi-bind-wechat-official` 固定 **personal** 回写店
- 邮箱收发运营：绑定完成后可用 `personal-mail-assistant`；绑定本身用本编排 / `oi-bind-personal-email`

## 完成标准

- 目标 provider 在个人授权左栏显示已配置（或用户明确取消）
- 回写只经 gateway API；无密钥泄漏到聊天
- 若还需授权数字人：再走 `oi-grant-owned-bots`，不把 grant 混进 bind 字段
