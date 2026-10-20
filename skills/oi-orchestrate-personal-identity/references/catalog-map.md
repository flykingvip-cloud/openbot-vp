# 授权目录 ↔ skill（S0 冻结 + S2–S6 更新）

与 `listUserOperationalIdentityProviderCatalog()` 对齐。

| provider | registrationReady | skill | 落库 | path_unstable | verified_live |
|----------|-------------------|-------|------|---------------|---------------|
| wechat-official | true | oi-bind-wechat-official | credentials.bind (wechat_oa) | false | **true**（S5 云电脑 2026-10-13） |
| personal-email | true | oi-bind-personal-email | credentials.bind (smtp) | false | **true**（S1 Path B/C） |
| github-personal | true | oi-bind-github-personal | oauth.start / oauth.status / callback | false | **true**（S2 OAuth 样板） |
| xiaohongshu | true | oi-bind-xiaohongshu | credentials.bind (social_account) | **true**（S6 证据 2026-10-19，无 bind 成功） | false |
| douyin | true | oi-bind-douyin | credentials.bind (social_account) | **true**（S6 证据 2026-10-19，无 bind 成功） | false |
| weibo | true | oi-bind-weibo | credentials.bind (social_account) | **true**（S5 GeeTest/111001；S6 复核仍未绑成） | false |
| bilibili | true | oi-bind-bilibili | credentials.bind (social_account) | **true**（S6 证据 2026-10-19，无 bind 成功） | false |
| zhihu | true | oi-bind-zhihu | credentials.bind (social_account) | **true**（S6；#827 登录 detect ≠ OI bind） | false |
| kuaishou | true | oi-bind-kuaishou | credentials.bind (social_account) | **true**（S6 证据 2026-10-19，无 bind 成功） | false |
| x-twitter | true | oi-bind-x-twitter | oauth.start / oauth.status / callback (PKCE) | false（应用内 OAuth；门户点击序可为 UNKNOWN） | false（S6 仍待 OHBE/真机） |
| wechat-personal | true | oi-bind-wechat-personal（非云电脑；委派 wechat-personal-worker-setup） | wechat-personal.* | n/a（non_cloud_primary） | n/a（本机通道，非云电脑 verified_live） |
| feishu-personal | false | 不做 | — | — | — |

Grant 薄封装：`oi-grant-owned-bots` → `user-operational-identity.grants.upsert`。

**默认推荐（S5–S6）**：只推荐 `verified_live=true` 的 registrationReady 项。  
`path_unstable=true` 一律跳过，除非用户显式点名该 provider / skill。  
禁止把未测社媒标成 `verified_live: true`。  
S6 七站各有 `references/live-evidence.md`；本切片 **0/7** 翻为 verified_live（诚实增量）。
