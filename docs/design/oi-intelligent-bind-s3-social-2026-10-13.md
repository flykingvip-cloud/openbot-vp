# 个人私有数字身份智能化（S3）— 社媒 social_account 批量

日期：2026-10-13  
承接：S0+S1（PR #684）+ S2（PR #685 / `d3f46a60`）  
范围：七个 `registrationReady` 社媒 provider 的 `oi-bind-*` skill + 编排指针 + 契约测。

## 目标

为大白管家提供稳定 skill：

| provider | skill | path_unstable |
|----------|-------|---------------|
| xiaohongshu | oi-bind-xiaohongshu | true |
| douyin | oi-bind-douyin | true |
| weibo | oi-bind-weibo | true |
| bilibili | oi-bind-bilibili | true |
| zhihu | oi-bind-zhihu | true |
| kuaishou | oi-bind-kuaishou | true |
| x-twitter | oi-bind-x-twitter | true |

共用：`authMode=manual`，`manualKind=social_account`；字段 displayName + handle + secret（文案见 `SOCIAL_FORM_COPY`；bilibili / x-twitter 用默认「账号标识/访问凭证」）。  
回写：唯一路径 `user-operational-identity.credentials.bind`（`accountHandle` + `accessToken`）；绑后 `oi-grant-owned-bots`。  
运营动作：`publish_post` / `reply_comment` / `sync_profile_metrics`。

## 路径图诚实性

- 每 skill 含 `references/path-map.md`，元数据 `path_unstable: true`，`verified_live: false`
- 仅可写入公开已知开放平台/站点入口，标注 `public_docs`
- 菜单点击序、扫码/2FA、Token 控件一律 **UNKNOWN**；禁止伪造「已验证」
- 大白默认推荐：优先非 `path_unstable`；unstable 仍可被显式点名调用

## 非目标

- wechat-personal（本机通道）、feishu-personal（未 ready）
- 真改社交执行后端 / connector 实现
- 声称任一社媒控制台已云电脑 live 打通

## 交付清单

1. 本设计文档  
2. 七个 `skills/oi-bind-<provider>/`（SKILL + field-contract + path-map + writeback-and-bans）  
3. `oi-orchestrate-personal-identity` catalog-map + SKILL 表更新  
4. guidance / platform-ops 最小接线  
5. 扩展 `oi-intelligent-bind-s0-s1.contract.test.ts`（含 S3）  
6. 禁止直接改 OI JSON；密钥/投影禁区

## 验收闸门（独立验收 Bot）

- [ ] 七 skill + 设计契约与 catalog（registrationReady、manualKind=social_account）一致  
- [ ] 编排 catalog-map 已指向各 `oi-bind-*`（不再写「S3 未实现」）  
- [ ] 回写仅 `credentials.bind`；禁 oauth.start / 直接改 JSON  
- [ ] 密钥与 EffectiveAccess **投影**禁区声明齐全  
- [ ] 每 skill `path_unstable: true` 可测；未声称 verified_live  
- [ ] 契约测独立可绿；worktree `git rev-parse HEAD` 正常  

非阻断：path 未 live 验证、CI 门禁噪声。
