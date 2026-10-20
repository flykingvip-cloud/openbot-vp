---
name: oi-bind-bilibili
description: >-
  把哔哩哔哩账号经 social_account 写入「个人」私有数字身份（个人设置 → 授权 → 哔哩哔哩）。
  表单字段：显示名称、账号标识、访问凭证。
  经 user-operational-identity.credentials.bind（manualKind=social_account）回写；
  secret/Cookie/Token 只进 secret store，禁止进聊天或 EffectiveAccess 投影。
  路径图 path_unstable：S6 已记 live-evidence（2026-10-19），无 bind 成功，禁止伪造已打通。
  运营动作 publish_post / reply_comment / sync_profile_metrics。绑后数字人授权走 oi-grant-owned-bots。
metadata:
  openclaw:
    emoji: "📺"
    promptPriority: 89
    path_unstable: true
    oi:
      provider: bilibili
      manualKind: social_account
      authMode: manual
---

# 个人哔哩哔哩绑定（OI）

本 skill = **social_account 取证 → 回写**。`path_unstable: true` / `verified_live: false`：S6（2026-10-19）见 live-evidence——本切片无 Cloud PC bind 成功，禁止伪造已打通。大白默认推荐仅 `verified_live` 项；本 skill 仍可被**显式点名**调用。

字段契约：[references/field-contract.md](references/field-contract.md)  
路径图：[references/path-map.md](references/path-map.md)  
S6 live 证据：[references/live-evidence.md](references/live-evidence.md)  
回写与禁区：[references/writeback-and-bans.md](references/writeback-and-bans.md)

## 表单同构字段（个人设置）

与 `renderSocialAccountForm` / `SOCIAL_FORM_COPY[bilibili]`（无专属 copy 时用默认）一致：

| UI 标签 | 写入 | 必填 |
|---------|------|------|
| 显示名称 | displayName | 建议 |
| 账号标识 | accountHandle（表单 credentialHandleId） | 是 |
| 访问凭证 | accessToken（表单 appSecret）→ secret store | 是（编辑可留空保持原凭证） |
| 提交 | 「添加并认证」/「更新并认证」 | — |

运营动作（catalog）：`publish_post / reply_comment / sync_profile_metrics`。  
数字人授权：另调 `oi-grant-owned-bots`，不要混进本 bind。

无专属 SOCIAL_FORM_COPY，使用表单默认「账号标识/访问凭证」。

## 回写路径（唯一）

1. 取证完成后调用 gateway **`user-operational-identity.credentials.bind`**（`provider=bilibili`，`manualKind=social_account`），或经工作台「添加并认证」提交同一字段集。
2. RPC 字段：`displayName`、`accountHandle`、`accessToken`（UI 常把 appSecret 映射为 accessToken）。
3. **禁止**直接改 `openbot-user-operational-identity.json` / secrets JSON。
4. **禁止**把 Cookie、Access Token、密钥打进聊天或 EffectiveAccess **投影**。
5. **禁止**用云电脑会话冒充已 enrollment / 已授权。

## 流程摘要

1. 确认用户授权代配；否则 `user-guidance-protocol`，只带路到个人设置 → 授权 → 哔哩哔哩。
2. 按 path-map 打开公开文档或后台（凡 `UNKNOWN` / `path_unstable` 项须向用户说明，勿编造点击序）。
3. 收集三字段 → `credentials.bind`。
4. 刷新个人授权页；需要时再 `oi-grant-owned-bots`。

## 完成标准

- 个人设置 → 授权 → 哔哩哔哩 显示已配置 / active
- 回写只经 `credentials.bind`；聊天与投影中无密钥
- 未声称 path 已 live 打通（S6 live-evidence 仍 `verified_live: false`；除非后续单独验收翻旗）
