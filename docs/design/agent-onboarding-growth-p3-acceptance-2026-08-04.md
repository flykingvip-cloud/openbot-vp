# P3 验收清单 — 机巢只读成长聚合

Date: 2026-08-04  
Status: **验收通过（2026-08-04，含租户隔离）**  
Parent: `docs/design/agent-onboarding-growth-p0-tech-plan-2026-08-04.md`  
Mesh 边界: `docs/design/robot-workspace-and-mesh-boundary-plan-2026-08-02.md` §5 / §7.2  
Rule: **租户隔离未通过前不得关闭 P3**

---

## 1. 本阶段目标

在**不改机巢入口**（仍为 `enterpriseMesh` → 运营/绩效 Tab）的前提下：

1. 企业端 **只读** 聚合机器人成长速度与企业统计（个体档案仍在员工端「我的机器人 → 成长」）
2. Gateway 提供 `growth.aggregate` + facade `mesh.performance.growthSummary`（READ scope）
3. 绩效 Tab UI 消费真实 Gateway 数据（成长摘要 + 生命周期分布 + Working DNA 企业观测 + Top 排行）
4. **多租户 Gateway 上严格 tenant 隔离** — 禁止跨企业汇总

---

## 2. 已交付改动

### 2.1 Gateway

| 项       | 文件                                                   | 说明                                                       |
| -------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| 聚合核心 | `src/gateway/agent-growth/mesh-growth-aggregate.ts`    | activation/operational/lifecycle/成长速度/Working DNA 统计 |
| 租户筛选 | `src/gateway/agent-growth/mesh-growth-tenant-scope.ts` | membership 解析 + ownership/seat/runtime 绑定的 agent 列表 |
| RPC      | `src/gateway/server-methods/agent-growth.ts`           | `growth.aggregate`                                         |
| Facade   | `src/gateway/server-methods/mesh-boundary-facade.ts`   | `mesh.performance.growthSummary`                           |
| 注册     | `method-scopes.ts` / `server-methods-list.ts`          | READ scope                                                 |

### 2.2 企业 UI

| 项       | 文件                      | 说明                                                                                            |
| -------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| 绩效排行 | `ui/.../ranking-page.ts`  | 成长摘要 + lifecycle 条形图 + DNA 观测 + Top5 成长速度                                          |
| 运营嵌入 | `ui/.../assets-page.ts`   | 绩效 Tab 成长速度摘要（非 embed 路径）                                                          |
| API      | `ui/.../governanceApi.ts` | `fetchGrowthSummary()` → `mesh.performance.growthSummary`（空 params；tenant 由连接上下文解析） |

### 2.3 测试

| 文件                                   | 覆盖                                                         |
| -------------------------------------- | ------------------------------------------------------------ |
| `mesh-growth-aggregate.test.ts`        | 成长速度、lifecycle、false-ready、Working DNA 聚合           |
| `mesh-growth-tenant-isolation.test.ts` | 双租户 agent 筛选、A 不含 B 统计、platform-auth 关闭时空聚合 |
| `mesh-growth-rpc.test.ts`              | RPC 注册、无 tenant 空聚合、忽略伪造 params                  |

---

## 3. 专家验收 Checklist

### 3.1 只读边界

- [x] 聚合仅 **读取** `growth-status.json` / Working DNA 文件，无反向写入
- [x] 机巢 UI **无** Identity / Prompt 编辑入口
- [x] 机巢 UI **无** Skill 安装/启停入口

### 3.2 功能结构

- [x] 企业摘要：已跟踪机器人数、平均激活分/实战分/成长速度、虚假就绪计数
- [x] 生命周期分布（诞生 → 进化）可视化
- [x] Working DNA 企业观测：DNA 档案数、近期行为调整、有效改善率
- [x] 成长速度排行（Top N，按综合分/创建天数）
- [x] 员工端个体档案（P2/P2.1）与机巢企业统计职责分离

### 3.3 租户隔离（阻塞项 — 必须通过）

- [x] `growth.aggregate` **不接收**可信 `tenantId` RPC 参数；从 `resolveAuthoritativeEnterpriseScopeForClient` 解析
- [x] Agent 列表经 ownership + seat assetBindings + seat defaults + runtime `tenantCoverage` 筛选
- [x] `botCount`、状态读取、Working DNA 聚合 **仅** 处理筛选后的 agent IDs
- [x] 无 authoritative membership / platform-auth 未启用 → **空聚合**（`botCount: 0`），非全局 `listAgentsForGateway`
- [x] multitenant 模式下 growth / Working DNA 文件经 `resolveAgentDirForClient` 读取
- [x] 双租户单测：A 的响应不含 B 的名称、分数或计数

### 3.4 RPC / Facade

- [x] `growth.aggregate` 与 `mesh.performance.growthSummary` 已注册且为 READ scope
- [x] Facade 转发至同一 handler 逻辑（无第二套汇总）
- [x] `mesh.performance.growthSummary` 已登记于 `robot-workspace-and-mesh-boundary-plan-2026-08-02.md` §7.2

### 3.5 测试

- [x] `mesh-growth-aggregate.test.ts` 通过
- [x] `mesh-growth-tenant-isolation.test.ts` 通过
- [x] `mesh-growth-rpc.test.ts` 通过

---

## 4. 明确不在本阶段

| 项                      | 说明                                                                    |
| ----------------------- | ----------------------------------------------------------------------- |
| 协作组成长聚合          | P3 仅机器人；小组 growth 仍走 `collaboration.spaces.*-growth-status`    |
| 企业成本 × 成长联合排行 | 成本仍由 `governance.metrics.*` / mesh KPI；未合并到 `growth.aggregate` |
| 员工端治理控件          | 禁止在机巢编辑 Identity/Prompt（Strong Separation 不变）                |
| 前端传 tenantId         | 不信任；tenant 仅来自 Gateway 连接 membership                           |

---

## 5. 验收结论模板

| 维度     | 结论                                           |
| -------- | ---------------------------------------------- |
| 功能结构 | ✅ 机巢绩效 Tab 可读企业成长统计               |
| 只读边界 | ✅ 无写入、无员工端治理控件                    |
| 租户隔离 | ✅ membership + 资产绑定筛选；无 tenant 空聚合 |
| 测试     | ✅ 11 项 scoped 单测（3 文件）                 |

**P3 已关闭（2026-08-04）。**

---

## 6. 后续可选（非 P3 阻塞）→ P3.1 已交付（2026-08-04）

- [x] 岗位维度筛选（`positionId`）扩展 `growth.aggregate`（tenant 内 filter；仍不传 tenantId）
- [x] 协作组企业成长摘要：`growth.groupAggregate` + `mesh.performance.groupGrowthSummary`
- [x] 成本与成长联合仪表：`governance.metrics.dashboard` + `growth.aggregate` UI 层合并（`blendPerformanceGrowth`）

### P3.1 Gateway

| 项         | 文件                             | 说明                                                          |
| ---------- | -------------------------------- | ------------------------------------------------------------- |
| 岗位筛选   | `mesh-growth-tenant-scope.ts`    | `positionId` 过滤 ownership / seat binding / seat default     |
| 协作组聚合 | `mesh-group-growth-aggregate.ts` | alignment + lifecycle + 成长速度排行                          |
| RPC        | `agent-growth.ts`                | `growth.groupAggregate`；`growth.aggregate` 接受 `positionId` |
| Facade     | `mesh-boundary-facade.ts`        | `mesh.performance.groupGrowthSummary`                         |

### P3.1 UI

| 项         | 文件                                 | 说明                      |
| ---------- | ------------------------------------ | ------------------------- |
| 岗位筛选   | `ranking-page.ts`                    | 机器人 Tab 下拉筛选       |
| 协作组摘要 | `ranking-page.ts` / `assets-page.ts` | 协作组 Tab + 运营绩效 Tab |
| 成本×成长  | `governanceApi.ts` + 上述页面        | `blendPerformanceGrowth`  |

### P3.1 测试

| 文件                                   | 覆盖                                  |
| -------------------------------------- | ------------------------------------- |
| `mesh-group-growth-aggregate.test.ts`  | 租户 group 筛选、alignment 聚合、排行 |
| `mesh-growth-tenant-isolation.test.ts` | positionId 筛选                       |
| `mesh-growth-rpc.test.ts`              | 4 方法注册 + READ scope               |
