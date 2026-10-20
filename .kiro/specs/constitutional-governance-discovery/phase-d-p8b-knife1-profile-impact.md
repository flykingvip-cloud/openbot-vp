# Phase D P8b Knife1 — Profile A / B 冲击证据（书面）

> 配套开工令：`phase-d-p8b-knife1-scope.md`（`phase_d_p8b_knife1_select_only`）。  
> 上级要求：`phase-d-p8b-written-scope.md` §3.4（开工前必须书面写出冲击分析）。  
> 日期：2026-09-26（Asia/Shanghai）  
> 本页只记录冲击边界。不合并 Profile，不授权跨租户放开，不把 Path 选中写成授权替代品。

## 1. 范围

本页覆盖 **Knife1（登记 + 选中，`executed` 恒 false）** 对 SECURITY.md 中 Profile A / B 合同的冲击。不覆盖后续执行刀、P8c、或 Gate 收紧。

## 2. Profile A（路由身份 ≠ 逐用户授权）

| 问题 | 本刀结论 |
| --- | --- |
| Path 选中是否替代 session 路由授权？ | **否。** `selectedPath` 是宪法合法轨迹上的可审计选中决策；`sessionKey` 仍是路由身份，且在非涂装清单中被显式丢弃。 |
| 是否引入逐用户授权边界？ | **否。** Knife1 不读取用户身份商店，不签发 grant，不改 tool-policy / capability-governance。 |
| 默认行为 | 旗标默认关；无热路径 import；不能把「代码里出现了 Path id」读成「生产已按 Path 授权」。 |

**主张：** Path 选中 ≠ session 路由授权；不得把 Path 写成逐用户授权边界替代品（继承书面范围 §3.4）。

## 3. Profile B（插件不得无限制访问全部租户数据）

| 问题 | 本刀结论 |
| --- | --- |
| 是否借 Path 给插件打开全租户进程内访问？ | **否。** 本刀仅在 `@openbot/constitutional-contracts` 增加纯函数选中 API；不改插件 loader、不改租户隔离、不新增跨租户读面。 |
| 是否合并 Profile A/B？ | **禁止。** A 的受信插件基座与 B 的租户隔离合同保持互斥；本刀不提供合并开关或共享授权账。 |
| 插件安装与 Path | 插件已安装 ≠ Path 已选中 ≠ 能力已授权（ADR-3 仍冻结）。 |

## 4. 与 `executed` / 回滚

- Knife1 `executed` 恒 false → 无生产副作用可冲击租户数据面。
- 回滚旗标 `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT` 默认关 → 有效合法集空，与 P8a 行为面对齐。
- 任何未来执行刀必须另写 Profile 冲击修订；不得默认继承「已评估完毕」。

## 5. 非主张

- 不声称 Profile 合规审计已通过生产证明。
- 不声称 C5 / C10 pass。
- 不授权 enforce、live invoke、Fabric default-on。
