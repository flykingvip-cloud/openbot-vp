# 未来计划：混合 Gateway 隔离（共享 + 专属 dedicated）

> **状态**：🅵 未来计划 / 已停放（parked）——**现在不启动**。
> **触发条件**：共享 Gateway（`tenant-context-propagation-plan`）P0–P4 已上线并**稳定运行一段时间** + 云端整体部署稳定 + 出现需要物理隔离的 VIP/Enterprise 需求（或对应定价层发布）。
> **短期做什么**：见 `docs/design/tenant-context-propagation-plan-2026-07-11.md`（共享 Gateway，逻辑隔离）。本文件**不影响**短期实施。
> **作者**：`kiro`（工作流 `saas-tenant-data-architecture`） · **日期**：2026-07-11
> **前置阅读**：`docs/design/openbot-saas-tenant-data-architecture.md`、`docs/design/platform-pricing-tiers-2026-06-16.md`

---

## 0. 定位与触发（先读）

采用 cell/pod 式**混合隔离**，兼顾成本与隔离：

- **普通租户** → **共享 Gateway**，靠租户 ID / 域名逻辑隔离（= 短期计划，本文件不重复）。
- **重要客户（Enterprise/VIP）** → **专属 Gateway**，进程/容器级物理隔离，更高性能、隔离性与定制能力。

**本计划刻意停放**，只有满足以下**全部**才启动：

1. 短期共享 Gateway（P0–P4）已上线、跨租户泄漏门禁长期为绿。
2. 云端整体部署（存储卷、路由、监控、备份、计费归因）已稳定。
3. 有明确的 dedicated 商业需求（VIP 合规/驻留/定制），或 Enterprise 定价层要发布该权益。

不满足即**不动手**——避免在共享路径尚未硬化时分散精力。

## 1. 目标 / 非目标

**目标**：让同一套代码在**运行拓扑**上可选 `local | shared | dedicated`，无需分叉代码库；dedicated 为付费大客户提供物理隔离与定制；shared↔dedicated 可平滑升降级。

**非目标**：不改短期共享 Gateway 的逻辑隔离设计；不在触发条件满足前编码；不做跨区域驻留细节（OQ-5 另议，仅预留字段）。

## 2. 依赖前置（必须先完成）

| 前置                                | 来源                    | 为何必须先有                                         |
| ----------------------------------- | ----------------------- | ---------------------------------------------------- |
| `TenantContext` + 权威推导 + 寻址层 | 短期 P0                 | dedicated 的「钉死租户」复用同一寻址层，只加一个分支 |
| L1/L2 per-tenant/per-user 解析      | 短期 P1–P2              | dedicated 内多用户仍需 per-user 正确解析             |
| 路径守卫 + 跨租户测试               | 短期 P4                 | shared 侧安全底座；dedicated 侧作纵深防御            |
| 稳定的 `/data/tenants/<tid>` 卷布局 | 已交付（tenant-import） | 迁移/升降级零 app 改动的前提                         |

**关键红利**：数据布局 `/data/tenants/<tid>/...` 对三种拓扑**完全一致**，所以 dedicated 与 shared 之间迁移主要是「迁卷 + 重路由」，app 层几乎零改动。

## 3. 拓扑架构

寻址层 `resolveDataRootForContext(ctx, cfg)` 在短期三态基础上把 `dedicated` 落实：

- **local**：单 `data.root`，无租户（自托管，零变化）。
- **shared**：`ctx.tenantId` 每请求从会话**权威推导**（短期 P0）。
- **dedicated**：进程启动注入 `OPENBOT_TENANT_ID=<tid>`，`ctx.tenantId` **钉死为常量**，仍按 `ctx.userId` 解析 per-user 子树。

**安全性质（重要）**：dedicated 下一个进程只服务一个租户，**跨租户隔离由进程/容器边界物理保证**——寻址即使出错也落在同租户内，不可能串租户。因此 dedicated 的正确性负担远低于 shared（后者跨租户全靠逻辑守卫）。

## 4. 未来分阶段（触发后按序）

### F0 — 拓扑抽象与钉死模式（app，小）

- 在短期寻址层加 `dedicated` 分支：读 `OPENBOT_TENANT_ID` 钉死 `TenantContext.tenantId`；无则回退 shared/local。
- 单测：dedicated 模式下任意请求只解析到 `<tenantsRoot>/<pinnedTid>/...`；无 `OPENBOT_TENANT_ID` 时行为不变。

### F1 — 隔离元数据与赋值（app）

- 控制面租户记录加 `isolation: "shared" | "dedicated"`（+ 预留 `region`）。
- `platform.tenant.provision` 支持指定 isolation；新增 `platform.tenant.setIsolation`（升降级，平台特权）。

### F2 — 路由层（infra，非本代码库）

- 租户 → Gateway 端点映射（控制面）；反向代理按子域/host 路由：`acme.openbot.cloud` → 专属实例；`app.openbot.cloud` → 共享池（租户从会话取）。
- 独立 infra 工作流，不在 app spec 内；app 侧只提供「租户→isolation/endpoint」查询接口。

### F3 — 专属实例供给（infra，非本代码库）

- 容器/进程编排：挂 `/data/tenants/<tid>` 卷 + 注入 `OPENBOT_TENANT_ID` + 该租户配置；健康检查、升级、下线生命周期。
- 可选：专属存储后端 / 专属加密密钥（合规客户）。

### F4 — 层级迁移（infra + runbook）

- **shared → dedicated（promote）**：drain 该租户在共享池的会话 → 迁/复制卷 → 起专属实例 → 切路由 → 验证 → 收尾。
- **dedicated → shared（demote）**：反向。
- 因布局一致，app 改动极小；重点是**无损切换 runbook**（drain / copy / verify / cutover / rollback）。

### F5 — VIP 定制能力（app + infra）

- 专属实例的 per-tenant 配置 / 插件 / 模型 / 密钥；数据驻留与专属密钥。
- 作为 **Enterprise/VIP 定价层显式 entitlement**（见 §6）。

### F6 — 强化与可观测（app + infra）

- 专属实例隔离测试、层级迁移 E2E（promote 后数据/会话完整、路由正确）、故障切换。
- 按租户的可观测性与**计费归因**（呼应 cost-budget-billing 的 `enterprise_id` 归因）。

## 5. 安全与隔离强度对照

| 维度       | shared（普通）                      | dedicated（VIP）                     |
| ---------- | ----------------------------------- | ------------------------------------ |
| 隔离层级   | 逻辑（TenantContext + 路径守卫）    | 物理（进程/容器，甚至独立存储/密钥） |
| 串租户风险 | 靠 P4 正确性；bug=泄漏 → **硬门禁** | 进程边界物理阻断                     |
| 合规/驻留  | 共享                                | 可满足专属驻留、专属密钥             |
| 成本       | 低（多租户共进程）                  | 高（每租户一实例）                   |
| 定制       | 受限（共享配置）                    | 高（per-instance）                   |

## 6. 与定价层挂钩

- **独立 Gateway = Enterprise/VIP 层权益**，写进 `platform-pricing-tiers`。isolation 赋值应由套餐权益驱动（订阅 VIP 层 → 自动 `isolation=dedicated` + 触发 F3 供给）。
- 计费上，dedicated 实例成本按租户归因（F6）。

## 7. 风险与务实取舍

- **R1 过早启动**：在共享路径未稳前上 dedicated 会分散精力、放大 infra 复杂度 → 用 §0 触发条件强制门禁。
- **R2 infra 复杂度**：F2/F3/F4 大头在编排与路由（infra），不是 app 逻辑；需专门 infra owner。
- **R3 迁移无损**：F4 切换必须有 drain + verify + rollback；先在 staging 演练 promote/demote 各一次。
- **务实取舍**：dedicated 先服务能付费的少数大客户（价值高、因物理隔离而正确性风险低），共享长尾继续吃成本优势——两者不互斥、可并存。

## 8. 与短期计划的关系

- 短期：`tenant-context-propagation-plan-2026-07-11.md`（共享 Gateway，**现在做**）。
- 本文件：在其之上加 dedicated 拓扑（**稳定后再做**），复用同一 `TenantContext`/寻址层/数据布局，主要新增在 infra（路由 + 实例供给 + 迁移）。
- 启动时：以本文件立 `.kiro/specs/hybrid-gateway-isolation/`，app 部分（F0/F1/F5app）签 `saas-tenant-data-architecture` 系；infra 部分（F2/F3/F4）单列 infra owner。
