---
name: oi-grant-owned-bots
description: >-
  将已绑定的个人私有数字身份授权给自有数字人（agentScope=owned）。
  薄封装 user-operational-identity.grants.upsert；不代替 credentials.bind。
  协作/共享机器人需额外确认且可能 fail-closed，不要因 bind 成功而短路。
metadata:
  openclaw:
    emoji: "🤝"
    promptPriority: 86
---

# 自有数字人授权（个人 OI grant）

前置：目标身份已在个人设置中 bind 且可用。  
本 skill **不取证、不写凭证**。

## API

对每个目标数字人调用 gateway：

`user-operational-identity.grants.upsert`

必填参数（与 server-methods 一致）：

| 参数       | 值                                       |
| ---------- | ---------------------------------------- |
| identityId | 已绑定身份 id                            |
| agentId    | 数字人 id                                |
| agentScope | 自有场景用 `owned`（须与服务器认定一致） |
| grantMode  | `auto` 或 `explicit`（用户确认后）       |

可选：`sessionKey`。多个数字人 → **逐个** upsert（API 单次一个 agentId）。

## 规则

1. 仅当用户明确要「授权给某某机器人」时执行。
2. `agentScope` 为 `group` / `shared`：先说明风险与座席约束，用户确认后再调；服务器可能返回 `USER_IDENTITY_GRANT_NOT_SEAT_OWNED` — fail-closed，不要绕过。
3. 客户端申报的 scope 必须与服务器 `trustedAgentScope` 一致，否则刷新后重试。
4. 禁止把 grant 成功说成「又绑了一次凭证」；禁止改 JSON 文件；禁止把凭证或授权码写入聊天 / EffectiveAccess 投影。

## 完成标准

- 个人设置该身份的授权列表含目标自有数字人
- 无密钥进入聊天或 EffectiveAccess 投影
