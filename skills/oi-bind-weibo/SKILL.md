---
name: oi-bind-weibo
description: >-
  把微博账号经 social_account 写入「个人」私有数字身份（个人设置 → 授权 → 微博）。
  表单字段：显示名称、微博账号、Access Token / Cookie。
  经 user-operational-identity.credentials.bind（manualKind=social_account）回写；
  secret/Cookie/Token 只进 secret store，禁止进聊天或 EffectiveAccess 投影。
  路径图 path_unstable：S5 已测 GeeTest/111001；S6 live-evidence 复核仍未 bind 成功，禁止伪造已打通。
  运营动作 publish_post / reply_comment / sync_profile_metrics。绑后数字人授权走 oi-grant-owned-bots。
metadata:
  openclaw:
    emoji: "📰"
    promptPriority: 89
    path_unstable: true
    oi:
      provider: weibo
      manualKind: social_account
      authMode: manual
---

# 个人微博绑定（OI）

本 skill = **social_account 取证 → 回写**。`path_unstable: true` / `verified_live: false`：S5 云电脑已实测 GeeTest「请先验证身份」与错误码 **111001**，但 Token 绑定未成功；S6（2026-10-19）复核仍无 bind 成功（见 live-evidence），禁止伪造已打通。大白默认推荐仅 `verified_live` 项；本 skill 仍可被**显式点名**调用。

字段契约：[references/field-contract.md](references/field-contract.md)  
路径图：[references/path-map.md](references/path-map.md)  
S6 live 证据：[references/live-evidence.md](references/live-evidence.md)  
回写与禁区：[references/writeback-and-bans.md](references/writeback-and-bans.md)

## 表单同构字段（个人设置）

与 `renderSocialAccountForm` / `SOCIAL_FORM_COPY[weibo]`（无专属 copy 时用默认）一致：

| UI 标签 | 写入 | 必填 |
|---------|------|------|
| 显示名称 | displayName | 建议 |
| 微博账号 | accountHandle（表单 credentialHandleId） | 是 |
| Access Token / Cookie | accessToken（表单 appSecret）→ secret store | 是（编辑可留空保持原凭证） |
| 提交 | 「添加并认证」/「更新并认证」 | — |

运营动作（catalog）：`publish_post / reply_comment / sync_profile_metrics`。  
数字人授权：另调 `oi-grant-owned-bots`，不要混进本 bind。

开放平台应用创建与 Token 控件仍有 UNKNOWN；登录前人机验证（GeeTest / 111001）已云电脑实测，见 path-map。

## 回写路径（唯一）

1. 取证完成后调用 gateway **`user-operational-identity.credentials.bind`**（`provider=weibo`，`manualKind=social_account`），或经工作台「添加并认证」提交同一字段集。
2. RPC 字段：`displayName`、`accountHandle`、`accessToken`（UI 常把 appSecret 映射为 accessToken）。
3. **禁止**直接改 `openbot-user-operational-identity.json` / secrets JSON。
4. **禁止**把 Cookie、Access Token、密钥打进聊天或 EffectiveAccess **投影**。
5. **禁止**用云电脑会话冒充已 enrollment / 已授权。

## 流程摘要

1. 确认用户授权代配；否则 `user-guidance-protocol`，只带路到个人设置 → 授权 → 微博。
2. 按 path-map 打开公开文档或后台（凡 `UNKNOWN` / `path_unstable` 项须向用户说明，勿编造点击序）。
3. 收集三字段 → `credentials.bind`。
4. 刷新个人授权页；需要时再 `oi-grant-owned-bots`。

## 完成标准

- 个人设置 → 授权 → 微博 显示已配置 / active
- 回写只经 `credentials.bind`；聊天与投影中无密钥
- 未声称 path 已 live 打通（`verified_live` 仍为 false；S5 仅记录 111001 实测；S6 未翻旗）
