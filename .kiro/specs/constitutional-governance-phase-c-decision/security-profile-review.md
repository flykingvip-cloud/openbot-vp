# Security profile review（Profile A / B）

> Reviewer 槽：`security-reviewer:profile-ab-tenant`（≠ Owner `grok-bot`）  
> 架构槽：`codex-architecture` · 执行链槽：`conversation-task-runtime:kiro-conversation-task-runtime`  
> 依据：`SECURITY.md`（`personal_local` / `managed_enterprise`）；Phase A 双 Profile 不变量

## Profile A — `personal_local`

| 项              | 判定                                                              |
| --------------- | ----------------------------------------------------------------- |
| sessionKey      | 路由控制，**不是**逐用户授权边界 / Path                           |
| 插件安装        | 受信计算基座 ≠ 能力授权                                           |
| `/tools/invoke` | 有 gateway auth + HTTP deny list；**无**预检完成包络（FC-01）     |
| Fail Closed     | 局部（危险工具 deny）；聊天不因 Fabric 关而 DENY（Fabric 默认关） |
| 本轮 D 影响     | 不批准合并 A/B；不把 A 的受信插件模型套用到 B                     |

## Profile B — `managed_enterprise`

| 项            | 判定                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------- |
| 租户边界      | CTR `openTenantScopedDb` / ACL fail-closed 存在；enterprise capability invoke 有席位 grant 链 |
| 预检对齐      | capability / node / HTTP 入口仍不共享 attempt 预检（FC-03）                                   |
| 插件          | 不得因安装获得全部租户数据无限制进程内访问                                                    |
| CTR 误 closed | FC-02 在 B 下可能导致企业流程误前进（协议缺口）                                               |

## 租户边界结论

- **不得**用 sessionKey 充当 Path 或 authz 边界。
- **不得**合并 Profile A/B 合同。
- 推荐路径：旁路表按 Profile 分列补全「复用预检 / 显式豁免」；CTR 关闭咨询 delivery（C/A）。
- **安全槽对 GO 的意见：** 在 D 无独特收益且有限 GO 不闭合旁路的前提下，**不同意 GO**；同意 **NO-GO**（透镜保留）。

## 显式未做

未启旗、未部署、未探测生产容器、未改安全运行时。
