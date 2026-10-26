# 个人私有数字身份智能化（S4）— 微信个人号本机 QR 通道

日期：2026-10-13  
Repo：`upbeyond/openbot`  
承接：S0+S1（#684）+ S2（#685）+ S3（#687 / `4bbb6c826`）  
范围：`provider=wechat-personal`（authMode=`qr_channel`）  
原则：**非云电脑主路径**（本机 OpenBot 桌面节点 + loopback sidecar）；落库权威 = gateway `user-operational-identity.wechat-personal.*`；会话 / `context_token` / proxy `apiKey` 不进聊天与 EffectiveAccess 投影；不改 wechat-personal 服务端逻辑（除非明显断线最小修）；不混淆公众号 / 企微。

## 目标

为大白管家提供稳定 skill **`oi-bind-wechat-personal`**：包装既有 [`wechat-personal-worker-setup`](../../skills/wechat-personal-worker-setup/SKILL.md)，经本机桌面通道完成微信个人号绑定，回写个人运营身份。本 skill 拥有 OI 契约、深链、回写/禁区与验收信号；探测 / sidecar / 出码细节 **委派** worker-setup。

## 字段契约（与 catalog / API 对齐，勿臆造）

真相源：`user-operational-identity-providers.ts`、`user-operational-identity.wechat-personal.*` 方法。

| 项                 | 值                         |
| ------------------ | -------------------------- |
| provider           | `wechat-personal`          |
| label              | 微信个人号                 |
| category           | social                     |
| authMode           | `qr_channel`               |
| manualKind         | `null`                     |
| registrationReady  | `true`                     |
| rolloutTier        | `deferred`                 |
| operationalActions | `probe_status`（探测通道） |

回写后：`externalAccountId` = `wxid`。  
绑后数字人授权：另走 `oi-grant-owned-bots` → `grants.upsert`（本 skill 不混写）。

## 回写路径（唯一）

仅允许：

1. `user-operational-identity.wechat-personal.status` — 探活 / 登录态
2. `user-operational-identity.wechat-personal.qr.start` — 出码
3. `user-operational-identity.wechat-personal.qr.wait` — 等扫码
4. `user-operational-identity.wechat-personal.bind-existing` — 绑定当前已登录微信

**禁止**：

- `credentials.bind` / `oauth.start` / `oauth.complete`（gateway 已拒绝 wechat-personal 走这些路径）
- 直接改 `openbot-user-operational-identity.json` / `*-secrets.json`
- 声称云电脑为主路径 / verified_live 云端 LIVE
- 混淆公众号（`wechat-official`）或企微
- 发明字段或 RPC

## 本机通道（non_cloud_primary）

- 会话只在持有桌面节点的那台电脑；不进云端 Gateway / LIVE。
- Worker 在线条件见 `wechat-personal-worker-setup`（桌面节点 advertise `wechat.personal.*` + loopback sidecar，或本机直连 Gateway）。
- OpenBot **不内置 / 不下载**微信协议栈；sidecar 由操作员自备，`proxyUrl` 必须 loopback。
- 标注：`non_cloud_primary` / **非云电脑主路径**。

## 深链

- UI：个人设置 → 授权 → 微信个人号（`http://127.0.0.1:18789/` 本机工作台）
- Skill：`oi-bind-wechat-personal`；底层委派：`wechat-personal-worker-setup`
- 编排：`oi-orchestrate-personal-identity` catalog-map → 本 skill（仍标非云电脑）

## 非目标

- 社交 live-path 加固、feishu-personal、真机扫码 E2E 必须
- 改 wechat-personal 服务端逻辑（除非 skill 文档诚实性被明显断线挡住）
- 内置协议栈或推荐 huohuoer / crates.io `wechat-cli`

## 交付清单

1. 本文档
2. `skills/oi-bind-wechat-personal/`（SKILL + field-contract + local-channel-map + writeback-and-bans）
3. 更新 `oi-orchestrate-personal-identity` catalog-map + SKILL 表
4. guidance / docs / platform-ops 最小接线
5. 扩展 `oi-intelligent-bind-s0-s1.contract.test.ts`（S4 describe）

## 验收闸门（独立验收 Bot）

- [ ] S4 设计/契约与 catalog（`qr_channel`、`registrationReady`）一致
- [ ] `oi-bind-wechat-personal` 存在；编排 map 指向它且仍标非云电脑
- [ ] 回写仅 `wechat-personal.*`；禁 credentials.bind / oauth / 直改 JSON；密钥/投影禁区
- [ ] 契约测独立可绿；worktree `git rev-parse HEAD` 正常
- [ ] 明确 `non_cloud_primary` / 本机通道可测

非阻断：CI 噪声、真机扫码 E2E 未跑、`rolloutTier` 仍为 deferred。
