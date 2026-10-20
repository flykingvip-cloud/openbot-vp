---
name: oi-bind-wechat-personal
description: >-
  把微信个人号经本机 QR 通道写入「个人」私有数字身份（个人设置 → 授权 → 微信个人号）。
  委派 wechat-personal-worker-setup 做桌面节点探活、sidecar 与出码循环；本 skill 固定
  bindTarget=personal，经 user-operational-identity.wechat-personal.* 回写。
  非云电脑主路径（non_cloud_primary）：本机 OpenBot 桌面节点 + loopback sidecar；
  会话不进云端 Gateway。禁止 credentials.bind / oauth.start；不要与公众号或企微混用。
metadata:
  openclaw:
    emoji: "💬"
    promptPriority: 89
    oi:
      provider: wechat-personal
      authMode: qr_channel
      manualKind: null
      non_cloud_primary: true
---

# 个人微信个人号绑定（OI）

本 skill = **个人店包装器**（`non_cloud_primary`）。探测 / sidecar / 扫码细节 **委派** [`wechat-personal-worker-setup`](../wechat-personal-worker-setup/SKILL.md)；此处只钉死 OI 契约、深链、回写 API 与禁区。

字段契约：[references/field-contract.md](references/field-contract.md)  
本机通道地图：[references/local-channel-map.md](references/local-channel-map.md)  
回写与禁区：[references/writeback-and-bans.md](references/writeback-and-bans.md)

## 路径声明（硬约束）

- **非云电脑主路径** / `non_cloud_primary`：必须在用户电脑跑 OpenBot 桌面应用（或本机直连 Gateway）+ loopback sidecar。  
- 会话与 `~/.openbot/wechat-personal-worker.json` 在持会话那台电脑，**不进**云端 Gateway / LIVE。  
- 这不是公众号（`oi-bind-wechat-official`），也不是企微。  
- OpenBot **不内置、不下载**微信协议栈。

## 表单 / 工作台同构

个人设置 → 授权 → 微信个人号（本机工作台常为 `http://127.0.0.1:18789/`）：

| UI / 动作 | API | 备注 |
|-----------|-----|------|
| 刷新 / 探测通道 | `wechat-personal.status` | `probe_status` |
| 扫码绑定 | `wechat-personal.qr.start` → `qr.wait` | worker 在线且未登录时 |
| 绑定当前已登录微信 | `wechat-personal.bind-existing` | `loggedIn` + `wxid` 时 |

落库后：`externalAccountId` = `wxid`。  
运营动作（catalog）：`probe_status`。  
数字人授权：另调 `oi-grant-owned-bots`，不要混进本 bind。

## 回写路径（唯一）

1. 先调 **`user-operational-identity.wechat-personal.status`**；离线则委派 `wechat-personal-worker-setup` 拉起本机通道，**不要**空转 `qr.start`。  
2. 未登录且 worker 在线：`qr.start` → 用户扫码 → `qr.wait`。  
3. 已 `loggedIn` 且有 `wxid`：引导「绑定当前已登录微信」→ **`bind-existing`**。  
4. **禁止** `credentials.bind` / `oauth.start` / `oauth.complete`（gateway 已拒绝；勿当产品路径）。  
5. **禁止**直接改 `openbot-user-operational-identity.json` / secrets JSON。  
6. **禁止**把 `context_token`、proxy `apiKey`、会话密钥打进聊天或 EffectiveAccess **投影**。

## 流程摘要

1. 确认用户授权代配；否则 `user-guidance-protocol`，只带路到「个人设置 → 授权 → 微信个人号」。  
2. 加载并执行 `wechat-personal-worker-setup`（status → 离线引导 sidecar/桌面节点 → 再 status）。  
3. 按 status 走 qr 或 bind-existing；回写只经 `wechat-personal.*`。  
4. 需要给数字人授权时另调 `oi-grant-owned-bots`。  
5. 提醒：该号的平板/Mac 登录位会被占用，有掉线封号风险。

## 完成标准

- 个人设置 → 授权 → 微信个人号 显示已配置；identity `externalAccountId` 为 `wxid`  
- 回写只经 `wechat-personal.*`；聊天与投影中无密钥 / context_token  
- 未声称云电脑为主路径；编排 catalog-map 已指向本 skill 且仍标非云电脑
