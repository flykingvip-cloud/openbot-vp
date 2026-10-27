---
name: oi-bind-wechat-official
description: >-
  把微信公众号 AppID + AppSecret 写入「个人」私有数字身份（个人设置 → 授权 → 微信公众号）。
  委派 wechat-official-credential 做隔离浏览器取证与扫码循环；本 skill 固定 bindTarget=personal，
  经 user-operational-identity.credentials.bind 回写。出口 IP 写入微信侧白名单，不是 OpenBot 配置项。
  正确配置只要 AppID + AppSecret + IP 白名单，不要收 Token。企业身份改走 wechat-official-credential 的 enterprise 路径。
metadata:
  openclaw:
    emoji: "🔑"
    promptPriority: 89
    path_unstable: false
    verified_live: true
    verified_live_date: "2026-10-13"
    requires:
      config:
        - browser.enabled
---

# 个人微信公众号绑定（OI）

本 skill = **个人店包装器**。取证与扫码细节 **委派** [`wechat-official-credential`](../wechat-official-credential/SKILL.md)；此处只钉死个人回写与表单字段。

字段契约：[references/field-contract.md](references/field-contract.md)  
控制台地图：复用 [`wechat-official-credential/references/console-map.md`](../wechat-official-credential/references/console-map.md)  
云电脑 live 证据：[references/cloud-pc-live-evidence.md](references/cloud-pc-live-evidence.md)（`verified_live: true`，2026-10-13）  
回写细则：[`wechat-official-credential/references/openbot-bind.md`](../wechat-official-credential/references/openbot-bind.md)（选 **personal**）

## 表单同构字段（个人设置）

与 `renderWechatOfficialForm` 一致：

| UI 标签   | 写入                                                      | 必填                                   |
| --------- | --------------------------------------------------------- | -------------------------------------- |
| 显示名称  | displayName                                               | 是（用后台昵称，勿只留「微信公众号」） |
| AppID     | appId（`wx` 开头）                                        | 是                                     |
| AppSecret | appSecret → secret store                                  | 是                                     |
| 出口 IP   | **不进** OI 配置项；抄工作台 egress IP 写入微信 IP 白名单 | 微信侧                                 |

**不要**创建或向用户要 Token。`access_token` 是换票结果，不是配置项。

## 回写路径（唯一）

1. 取证完成后调用 gateway **`user-operational-identity.credentials.bind`**（manualKind `wechat_oa`），或经工作台「添加并认证」提交同一字段集。
2. 验收：`verify_credentials` / 换票成功；刷新个人授权页 lastVerify。
3. **禁止**直接改 `openbot-user-operational-identity.json` / secrets JSON。
4. **禁止**把 AppSecret、access_token、cookie 打进聊天或投影。

`bindTarget` 私有清单固定：`personal`。用户要企业公众号时改走 `wechat-official-credential` 且 `bindTarget=enterprise`，不要写进个人店。

## 流程摘要

1. 确认用户授权代配；否则 `user-guidance-protocol` + `wechat-oa.yaml`。
2. 加载并执行 `wechat-official-credential`（SCAN_MP → SCAN_DEV → SECRET → BIND → IP → PROBE）；云电脑步骤见 cloud-pc-live-evidence。
3. BIND 步骤写入 **个人** 身份店。
4. 需要给数字人授权时另调 `oi-grant-owned-bots`。

## 完成标准

- 个人设置 → 授权 → 微信公众号 显示已配置
- AppID + AppSecret 已 bind；白名单含全部出口 IP（或确认无需改）
- 换票通过；聊天中无密钥
- 未把 AppSecret/token 写入聊天或投影；路径标注与 cloud-pc-live-evidence 一致（`verified_live`）
