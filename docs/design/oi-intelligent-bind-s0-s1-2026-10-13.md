# 个人私有数字身份智能化（S0+S1）

日期：2026-10-13  
Repo：`upbeyond/openbot`  
范围：个人设置 → 授权 → 绑定账户（`user_operational_identity`）  
原则：云电脑 / 隔离浏览器只取证；落库权威 = gateway `user-operational-identity.credentials.bind` / `oauth.*` / `wechat-personal.*` / `grants.upsert`；密钥不进聊天与 EffectiveAccess 投影；与 P0–P2 单一 PDP 精神一致（个人侧经 gateway OI API，不绕过）。

## S0 — 契约冻结

### 入口 / 深链

- UI：个人设置 → `authorization` → 左栏「绑定账户」+ `registrationReady === true` 的 provider catalog（`workbench-personal-authorization-panel.ts` + `user-operational-identity-providers.ts`）
- 深链：既有个人运营身份 section；新增身份走 `add:<provider>` 导航
- 产品名「私有数字身份」= 代码 `user_operational_identity`（个人运营身份）

### 目录 → skill → 回写字段（权威映射）

字段真相源：`src/gateway/user-operational-identity-providers.ts`、`ui/.../workbench-operational-identity-forms.ts`。

| provider | skill id | 回写字段（表单同构） | 落库 API | S1 |
|----------|----------|----------------------|----------|----|
| `wechat-official` | `oi-bind-wechat-official`（委派 `wechat-official-credential`） | 显示名称、AppID、AppSecret；出口 IP 提示（不进配置项，写入微信侧白名单） | `user-operational-identity.credentials.bind`（`wechat_oa`） | 是 |
| `personal-email` | `oi-bind-personal-email`（包装 Path B/C guidance） | 显示名称、发件邮箱、可选平台代发、SMTP/IMAP*、SMTP 授权码 | `credentials.bind`（`smtp`） | 是 |
| `github-personal` | `oi-bind-github-personal`（S2） | 显示名称、可选 GitHub 用户名 | `oauth.start` / `oauth.complete` | 否 |
| `weibo` / `zhihu` / `douyin` / `xiaohongshu` / `kuaishou` / `bilibili` / `x-twitter` | `oi-bind-<provider>`（S3） | 显示名称、账号标识、访问凭证 | `credentials.bind`（`social_account`） | 否 |
| `wechat-personal` | 文档指向 `wechat-personal-worker-setup` | 本机通道 + 扫码；非云电脑主路径 | `wechat-personal.*` | 仅文档 |
| `feishu-personal` | — | — | — | 不做（`registrationReady=false`） |
| * | `oi-grant-owned-bots` | `identityId` + 自有数字人 `agentId` + `agentScope=owned` + `grantMode` | `grants.upsert`（逐个 agent） | 是 |
| * | `oi-orchestrate-personal-identity` | 编排上述 skill | 不直接写库 | 是 |

### 存储（只读约定，不改路径）

- `CONFIG_DIR/openbot-user-operational-identity.json`（元数据）
- `CONFIG_DIR/openbot-user-operational-identity-secrets.json`（密钥）

产品路径禁止「直接改这两个 JSON」；必须经 gateway OI API。

### 硬约束

1. Skill 输出必须可映射到现有 editor / API 字段；禁止旁路写 JSON 文件。
2. Secret 仅经加密 secret store；不进聊天、不进 EffectiveAccess 投影。
3. 用户未明确授权「代配」时，只走 `user-guidance-protocol`（人点界面）。
4. Grant：自有可 `auto` 倾向；`group` / `shared` 继续确认 / fail-closed，不因 bind 成功而短路。
5. 个人 OI 与企业 enrollment 分店；本 PR 不合并两套 store（双轨保留）。

### registrationReady 目录（与代码一致）

| provider | label | authMode | registrationReady |
|----------|-------|----------|-------------------|
| github-personal | GitHub（个人） | oauth | true |
| personal-email | 个人邮箱 | manual / smtp | true |
| wechat-official | 微信公众号 | manual / wechat_oa | true |
| weibo … x-twitter | 各社媒 | manual / social_account | true |
| wechat-personal | 微信个人号 | qr_channel | true（本机） |
| feishu-personal | 飞书个人账号 | oauth | **false** |

## S1 — 交付物

1. 本文档
2. Skills：`oi-orchestrate-personal-identity`、`oi-bind-wechat-official`、`oi-bind-personal-email`、`oi-grant-owned-bots`
3. 接线：`user-guidance-protocol` / `openbot-platform-ops` operational-identity / `openbot-docs` skills-routing 指向编排 skill
4. 契约测试：S1 声称的 skill 与 catalog / 字段对齐；不声称社交站 skill 已实现

### 非目标

社交站 site-map、GitHub OAuth 云电脑 skill（S2）、审批工单 UI、合并企业/个人 store。

## 验收闸门（独立验收 Bot「私有数字身份智能化验收」）

### 阻断项

- [ ] 契约文档已合入且与 providers catalog 一致（ready 项无遗漏 / 无臆造字段）
- [ ] 四份 skill 存在且字段与 forms/API 对齐
- [ ] 回写路径明确为 gateway OI API；禁止「直接改配置文件」表述
- [ ] 密钥 / 投影禁区写进 skill
- [ ] wechat-personal 标明非云电脑主路径
- [ ] 相关自动测试通过（新增契约测 + 既有不挂）

### 非阻断

- 社交 / GitHub 未实现
- 企业 / 个人 store 仍双轨
- 真机云电脑 E2E 未跑（本 PR 以 skill + 文档 + 契约测为主）

独立验收 Bot **不得改业务代码**；只审查 PR / 分支并出具书面 PASS / FAIL。
