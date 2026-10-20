# Design: 企业数据能力中心 IA 重构

> Task: `enterprise-data-capability-ia-redesign` · Agent: `cursor-enterprise-data-ia` · 2026-07-20

## 1. 现状审计

### 1.1 入口与壳

| 项       | 位置                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| 一级 Tab | `enterpriseDataGovernanceCenter`（文案「企业数据能力中心」）                                                     |
| 路由     | `/enterprise/.../data-governance`（`navigation.ts`）                                                             |
| Surface  | `ui/src/ui/ports/enterprise/views/enterprise-data-governance-center-surface.ts`（~4764 LOC，编排+全部表单/表格） |
| 状态     | module-local `Map`，key = `tenantId + client 实例`（`buildSurfaceKey`）                                          |
| 重渲染   | `refreshEnterpriseSurface()` → `requestEnterpriseAppRerender` / popstate                                         |

### 1.2 当前一级 Section（用户可见）

| Section id      | 文案         | 加载触发                                  | 主要 RPC                                                                                                                                                                                               |
| --------------- | ------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `home`          | 首页         | `ensureLoaded` → `loadDataCapabilityHome` | `dashboard.summary` / `capability-rows` / `authorization-cards` / `source-health` / `asset-landscape.graph` / `knowledge-supply.overview` / `audit-lineage.overview` / `governance-approvals.overview` |
| `sources`       | 数据源管理   | 切段 lazy                                 | `sources.list` / connectors._ / credentials._ / `sources.test-connection` / `sources.sync-log` / upsert/archive                                                                                        |
| `authorization` | 数据授权管理 | 切段 lazy                                 | `access-policies.*` / `actions.list` / `scope.list` / `approval.policies.list`                                                                                                                         |
| `capabilities`  | 数据能力目录 | 切段 lazy                                 | `capabilities.*` / `capabilities.grant-seat` / org targets                                                                                                                                             |
| `projections`   | 投影工作室   | 切段 lazy                                 | `projection-specs.*` / `projection-bindings.*` / `projection-materializer.run`                                                                                                                         |
| `approvals`     | 审批中心     | 切段 lazy 或 `#approvals`                 | `governance-approvals.list/get/decide`                                                                                                                                                                 |

**缺失**：无独立「记忆范围」一级段；`enterprise-data.scope.*` 仅在授权策略编辑中出现。需求中的 `memory` 兼容目标映射到「权限与治理」子区，并展示 scope 列表。

### 1.3 用户操作 ↔ 对象

- **数据源**：建连 / OAuth / 测连 / 重连 / 归档 / 同步日志（`ManagedDataSourceRecord`）
- **连接器动作**：`actions.list` → 绑定到能力 / 投影 sourceActions
- **数据能力**：upsert / archive / grant-seat / governance-view（内部类型仍为 `DataCapability` / `ManagedCapabilityRecord`）
- **授权策略**：access-policy upsert / compile / revoke grant（运行时粒度 **seat**）
- **审批**：governance-approvals decide；首页待办条
- **投影 / 物化**：projection spec/binding + materializer → feed / knowledge 对象
- **数字人调用**：`enterprise-data.invoke` + audit（本 surface 未直接暴露 invoke UI）

### 1.4 价值链（代码已具备的对象链）

```
数据源 (sources)
  → 连接器/凭证/动作 (connectors, credentials, actions)
  → 数据能力/产品 (capabilities)
  → 访问策略 / seat grant (access-policies, grants)
  → 治理审批 (governance-approvals)
  → 投影规格/绑定/物化 (projection-specs/bindings/materializer)
  → 知识对象 / feed (feed-items, knowledge-supply)
  → 审计血缘 (audit-lineage, lineage.resolve)
  → 数字人调用 (invoke + audit.invocations)  [UI 缺口：工作台未闭环展示调用侧]
```

### 1.5 痛点

1. **技术对象一级并列**：能力目录 / 投影工作室 / 授权 / 审批拆成互跳页面，用户需理解内部实现名。
2. **能力目录顶栏大型组织选择器**：岗位授权与产品目录耦合（`org-target-picker` 在 capabilities 段）。
3. **首页信息过载**：全景图 + 多卡并列；KPI 文案仍偏「能力」而非「数据产品」。
4. **审批双入口**：首页待办 + 独立审批中心，上下文丢失。
5. **Surface 巨石**：4764 LOC，路由/状态/表单/表格同文件，难测难演进。
6. **记忆范围孤立**：scope RPC 存在但无一级工作台入口。
7. **Hash 兼容仅半成品**：仅 `#approvals` 特殊处理；无 query/section 路径规范。

### 1.6 RPC 是否够用（结论：优先复用）

现有 `enterprise-data.*`（M1–M6 + dashboard 聚合）已覆盖四 Tab 所需列表/详情/突变。

| 新 Tab     | 复用                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| 总览       | `dashboard.summary`、`capability-rows`、`source-health`、`governance-approvals.overview`、`audit-lineage.overview` |
| 数据资产   | sources / connectors / credentials / sync-log / test-connection                                                    |
| 数据产品   | capabilities._ + projection-_ + grant-seat（详情内开放范围）                                                       |
| 权限与治理 | access-policies._、governance-approvals._、scope.\*、authorization-cards、audit-lineage                            |

**暂不新增 RPC**。仅当总览「需要处理」队列出现明确 N+1 或口径缺口时，再评估只读薄聚合。

## 2. 目标 IA

### 2.1 一级 Tab

| PrimaryTab   | 文案       | 默认子区  | 旧 section 映射                        |
| ------------ | ---------- | --------- | -------------------------------------- |
| `overview`   | 总览       | —         | `home`                                 |
| `assets`     | 数据资产   | `sources` | `sources`                              |
| `products`   | 数据产品   | `catalog` | `capabilities`, `projections`          |
| `governance` | 权限与治理 | `matrix`  | `authorization`, `approvals`, `memory` |

### 2.2 兼容策略

- URL hash：`#home|#sources|#capabilities|#projections|#authorization|#approvals|#memory` → 对应 PrimaryTab + 子区。
- Query（可选增强）：`?edc=capabilities` 等同 hash。
- 旧链接落入新壳正确子区；不 404。
- 内部类型 / RPC 名保持 `DataCapability` / `enterprise-data.capabilities.*`；UI 文案统一「数据产品」。

### 2.3 代码结构目标

```
ui/.../views/enterprise-data-capability/
  section-routing.ts      # 纯函数映射 + 测试
  state.ts                # surface state 类型/工厂（逐步抽出）
  overview-page.ts
  assets-page.ts
  products-page.ts
  product-detail.ts
  product-editor.ts
  governance-page.ts
  approval-work-queue.ts
enterprise-data-governance-center-surface.ts  # 仅编排 + 保留未抽出的编辑器直至后续 CP
```

## 3. 非目标

- 不改存储模型 / 不重命名 RPC。
- 不引入营销式大卡与手绘 SVG。
- 不触碰其他 agent 的脏文件。
