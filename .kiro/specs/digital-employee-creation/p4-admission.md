# Digital Employee Creation — P4 Factory Adapter Admission

> **性质:** 书面编码准入。  
> **日期:** 2026-09-17  
> **授权来源:** 用户「先 p3 后 p4」+ 先前书面准入授权。  
> **执笔 / 落地:** `cursor-dec-p1`  
> **依赖:** P3 确认卡已把 Session 推到 `CONFIRMED`。

## 1. 判定

| 项         | 结论                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------ |
| **批准**   | 已确认 Draft 经现有 `workspaces.create` → `agents.create` → `robots.bind-workspace` 实例化 |
| **批准**   | 新链路 `skipCapabilityAutoInstall`；只装 Draft 已解析 skill；`PARTIAL` + Creation Receipt  |
| **不批准** | 新 Digital Employee Factory、oauth/grant、自动绑账号、Task/Cron/Ledger                     |

## 2. 边界

- 未 `CONFIRMED` 不得 instantiate
- 同一 `idempotencyKey` 只对应一个 `agentId`
- `agents.create` 仍是唯一身份写点；Adapter 只编译参数 + 安装已解析 skill
- 新链路不得带入 `TEMPLATE_AUTO_SKILL_KEYS` 的账号/发信默认授权
- Receipt 可落盘为证明，运行时授权不读 Receipt

## 3. 退出

1. 设计确认后的创建走 instantiate，返回 `INSTANTIATED` 或 `PARTIAL`
2. 双击确认不创建第二个 Agent
3. 旧表单路径（无设计会话）仍走原 `agents.create`
4. 相关测试绿
