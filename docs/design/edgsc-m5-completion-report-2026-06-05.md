# 企业数据治理与供给中心 M5 治理闭环 — 待验收报告（2026-06-05）

> 前置：M4 投影与供给已通过专家复验。  
> 依据：`docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md` §11 M5、§8.7–8.8  
> 总计划：`docs/design/edgsc-master-implementation-plan-2026-06-05.md`

## 〇、阶段定位

**M5 = 血缘解析 + 供给审计 + 治理审批中心闭环**

| 类别     | M5 交付                                                                                  | 明确未做（禁止抢跑）                                 |
| -------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 血缘     | `lineage.resolve` 全链路解析（Feed → Projection → Capability → Source → Action → Trace） | Agent Runtime 集成（M6）                             |
| 供给审计 | `KnowledgeSupplyAudit` 物化成功/失败写入                                                 | 跨租户报表、外部 SIEM 导出                           |
| 审批中心 | 三类治理审批分栏 + 审批后副作用                                                          | 执行平面 PER_REQUEST 审批（M1 已有，不混用）         |
| 消费边界 | 知识平面**不得**直连 `invokeEnterpriseDataAction`                                        | `knowledge.data.invoke`、Capability→Gateway 消费路径 |

### 0.1 与 M6 的边界说明（复验修复后）

仓库中**已存在**以下 M6 预备代码，但 M5 验收范围**不包含**其完整联调：

| 模块                                        | 状态                 | M5 边界                 |
| ------------------------------------------- | -------------------- | ----------------------- |
| `knowledge/feed/enterprise-feed-adapter.ts` | 只读 FeedItem 适配   | ✅ 不调用 Gateway       |
| `knowledge/sources/enterprise-source.ts`    | 浏览/检索装配        | ✅ 只消费 Feed + 可见性 |
| `knowledge/source-bundle.ts`                | 并入知识宇宙对象列表 | ✅ 展示层，非执行层     |

**已移除（阻塞项修复）**：

| 违规路径                                    | 处理                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `knowledge.data.invoke` RPC                 | 已从 `server-methods/knowledge.ts`、`server-methods-list.ts`、`method-scopes.ts` 删除 |
| `knowledge/router.ts` `knowledgeDataInvoke` | 已删除                                                                                |
| `knowledge/enterprise-data-gateway.ts`      | 已删除（Capability → `invokeEnterpriseDataAction`）                                   |

守卫测试：`src/gateway/knowledge/knowledge-consumption-boundary.test.ts`

## 一、硬约束自检

| #   | 约束                                                    | 状态 | 证据                                                  |
| --- | ------------------------------------------------------- | ---- | ----------------------------------------------------- |
| 1   | 血缘链落到 `ConnectorAction@version` + invocation trace | ✅   | `lineage-governance-store.ts`                         |
| 2   | 供给审计仅记录 Materializer 路径                        | ✅   | `projection-materializer.ts`                          |
| 3   | 治理审批三类分栏不混用                                  | ✅   | `governance-approval-store.ts`                        |
| 4   | 治理 RPC 须 enterprise-admin                            | ✅   | `enterprise-data-m5.ts`                               |
| 5   | 知识平面不得直连 Gateway                                | ✅   | 无 `knowledge.data.invoke`；boundary test             |
| 6   | 仅 Materializer 可调 Gateway（消费层）                  | ✅   | `knowledge/**` 无 `invokeEnterpriseDataAction` import |

## 二、交付物清单

### 2.1 Store / 内核层

| 模块                              | 说明                                     |
| --------------------------------- | ---------------------------------------- |
| `knowledge-supply-audit-store.ts` | 供给审计事件写入/列表/查询               |
| `lineage-governance-store.ts`     | 血缘链解析 + Audit & Lineage 总览        |
| `governance-approval-store.ts`    | 三类治理审批创建/决策/总览               |
| `projection-materializer.ts`      | 物化成功/失败挂钩 `KnowledgeSupplyAudit` |

### 2.2 Gateway RPC（M5 新增）

| 方法                                       | 说明                         |
| ------------------------------------------ | ---------------------------- |
| `enterprise-data.lineage.list/get/resolve` | 血缘记录与全链路解析（§8.7） |
| `enterprise-data.audit-lineage.overview`   | Audit & Lineage 运营总览     |
| `enterprise-data.supply-audit.list/get`    | 供给审计事件                 |
| `enterprise-data.governance-approvals.*`   | Approval Center（§8.8 三类） |

### 2.3 Approval Center 三类语义（§8.8）

| 类别                  | 审批通过后副作用                |
| --------------------- | ------------------------------- |
| `source_onboarding`   | DataSource `status → connected` |
| `data_access`         | 编译为 `SeatActionGrant`        |
| `capability_exposure` | DataCapability `enabled → true` |

执行平面 `ApprovalRequest`（M1）与治理平面 `GovernanceApprovalRequest`（M5）**分离**。

## 三、测试证据

```bash
pnpm exec vitest run src/gateway/enterprise-data/
pnpm exec vitest run src/gateway/server-methods/enterprise-data-m2.test.ts
pnpm exec vitest run src/gateway/server-methods/enterprise-data-m3.test.ts
pnpm exec vitest run src/gateway/server-methods/enterprise-data-m4.test.ts
pnpm exec vitest run src/gateway/server-methods/enterprise-data-m5.test.ts
pnpm exec vitest run src/gateway/knowledge/knowledge-consumption-boundary.test.ts
pnpm exec vitest run src/gateway/knowledge/sources/enterprise-source.test.ts
```

| 套件                                     | M5 关键覆盖                 |
| ---------------------------------------- | --------------------------- |
| `lineage-governance.test.ts`             | 全链路层序、供给审计        |
| `governance-approval.test.ts`            | 三类审批、副作用            |
| `enterprise-data-m5.test.ts`             | 治理 RPC handler            |
| `knowledge-consumption-boundary.test.ts` | **无知识平面→Gateway 路径** |
| M1–M4 回归                               | 无回归                      |

## 四、专家复验建议关注点

1. **消费边界**：确认 `knowledge.data.invoke` 已不可达；员工执行仍仅 `enterprise-data.invoke`（M1）。
2. **M6 预备代码**：Feed Adapter 已存在但仅只读 Feed；完整 Universe/Agent 联调留 M6。
3. **双审批平面**：治理审批与执行审批列表分离。

## 五、结论

M5 治理闭环对象已落地；**越阶段消费直连已拆除**，知识平面与执行平面边界已恢复。

**状态：待专家复验。**
