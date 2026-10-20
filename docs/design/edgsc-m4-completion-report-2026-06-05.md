# 企业数据治理与供给中心 M4 投影与供给 — 待验收报告（2026-06-05）

> 前置：M3 数据能力建设已实施。  
> 依据：`docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md` §11 M4、§5.3–5.5、§7.5–7.7  
> 总计划：`docs/design/edgsc-master-implementation-plan-2026-06-05.md`

## 〇、阶段定位

**M4 = Projection Studio 深化 + ProjectionMaterializer 供给链路**

| 类别     | M4 交付                                                | 明确未做（禁止抢跑）            |
| -------- | ------------------------------------------------------ | ------------------------------- |
| 投影治理 | ProjectionSpec/Binding upsert、Visibility Policy 管理  | —                               |
| 供给内核 | `ProjectionMaterializer` 唯一 Gateway 调用路径         | Agent/Universe 直连 Gateway     |
| 认知对象 | `EnterpriseKnowledgeObjectFeedItem` 写入               | Knowledge Feed Adapter（M6）    |
| 可见性   | `KnowledgeVisibilityPolicy` 运行时评估 + feed 列表过滤 | 员工平面消费 RPC（M6）          |
| 血缘     | 基础 `KnowledgeLineageRecord` 物化写入                 | KnowledgeSupplyAudit 闭环（M5） |

## 一、硬约束自检

| #   | 约束                                               | 状态 | 证据                                                                                                   |
| --- | -------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------ |
| 1   | 只有 `ProjectionMaterializer` 可走供给侧 Gateway   | ✅   | `projection-materializer.ts` 内 `invokeEnterpriseDataAction`；`projection-materializer-v1` attestation |
| 2   | `sourceActions` 显式声明，禁止 Capability 隐式推导 | ✅   | 复用 `projection-spec-store` 校验                                                                      |
| 3   | ProjectionStudio 声明式五类模板                    | ✅   | `projection-template-engine.ts`                                                                        |
| 4   | Knowledge Universe / Agent 不得直连 Gateway        | ✅   | 无 M6 消费适配器；仅 FeedItem 写入                                                                     |
| 5   | 双授权：执行 Grant + 可见性 Policy 并存            | ✅   | Materializer 用 `seat-projection-materializer` Grant；Feed 列表可按 Visibility 过滤                    |
| 6   | 治理 RPC 须 enterprise-admin                       | ✅   | M4 handler 统一 `requireResolvedEnterpriseAdminTenantId`                                               |

## 二、交付物清单

### 2.1 Store / 内核层

| 模块                                   | 说明                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `projection-template-engine.ts`        | **新增** Normalize/Aggregate/Trend/RiskDetection/Forecast 声明式模板                 |
| `projection-materializer.ts`           | **新增** `runProjectionMaterialization` — 唯一供给 Gateway 调用                      |
| `knowledge-feed-item-store.ts`         | **新增** FeedItem 写入/列表/新鲜度计算                                               |
| `knowledge-visibility-policy-store.ts` | **新增** Visibility upsert + `evaluateKnowledgeVisibility`                           |
| `knowledge-lineage-store.ts`           | **新增** 物化时写入基础血缘                                                          |
| `knowledge-supply-store.ts`            | **新增** 供给运营总览                                                                |
| `enterprise-data-seat-context.ts`      | 扩展 `projection-materializer-v1` attestation + `createMaterializerExecutionContext` |
| `seeds.ts`                             | Materializer Seat Grant、客户画像 Visibility Policy、Binding 关联                    |

### 2.2 Gateway RPC（M4 新增）

| 方法                                                  | 说明                                             |
| ----------------------------------------------------- | ------------------------------------------------ |
| `enterprise-data.projection-specs.upsert`             | 声明式投影规格注册/更新                          |
| `enterprise-data.projection-bindings.upsert`          | 供给绑定（模式/SLA/可见性策略）                  |
| `enterprise-data.visibility-policies.upsert/list/get` | 消费可见性策略治理                               |
| `enterprise-data.feed-items.list/get`                 | Feed 供给列表（可选 seat/team/agent 可见性预览） |
| `enterprise-data.projection-materializer.run`         | 触发物化（admin 运维入口）                       |
| `enterprise-data.knowledge-supply.overview`           | 供给健康总览                                     |

注册：`server-methods/enterprise-data-m4.ts` → `enterprise-data.ts`；已同步 `server-methods-list.ts` / `method-scopes.ts`。

## 三、测试证据

```bash
pnpm exec vitest run src/gateway/enterprise-data/
pnpm exec vitest run src/gateway/server-methods/enterprise-data-m2.test.ts
pnpm exec vitest run src/gateway/server-methods/enterprise-data-m3.test.ts
pnpm exec vitest run src/gateway/server-methods/enterprise-data-m4.test.ts
```

| 套件                              | 结果         | M4 关键覆盖                                           |
| --------------------------------- | ------------ | ----------------------------------------------------- |
| `projection-materializer.test.ts` | **4 passed** | Gateway 物化、draft 拒绝、disabled binding、Risk 模板 |
| `knowledge-supply.test.ts`        | **2 passed** | Visibility 评估、overview 计数                        |
| `enterprise-data-m4.test.ts`      | **6 passed** | admin/member、物化、可见性过滤、伪造 tenant           |
| M1–M3 回归套件                    | 73 passed    | 无回归                                                |

**合计：85 passed**

### 关键场景验收矩阵

| 场景                                 | 预期                               | 实测             |
| ------------------------------------ | ---------------------------------- | ---------------- |
| Materializer 物化 `customer.profile` | FeedItem + Lineage + Gateway trace | ✅               |
| draft `sales.churn-risk` 物化        | `PROJECTION_NOT_ACTIVE`            | ✅               |
| 无 Materializer Grant                | `PROJECTION_GATEWAY_DENIED`        | ✅（种子已授予） |
| Visibility：华东团队可见             | feed-items.list 过滤通过           | ✅               |
| Visibility：华北团队不可见           | 空列表                             | ✅               |
| 非 admin 调用 materializer.run       | 治理拒绝                           | ✅               |

## 四、复验阻塞项修复（2026-06-05 第二轮）

| 阻塞项                               | 修复                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Materializer 执行上下文可被 RPC 改写 | 移除 `materializerSeatId`/`teamLabel` 入参；`assertNoMaterializerRunOverrides`；scope 仅来自 binding.`materializationTeamLabel` + 固定 `MATERIALIZER_SEAT_ID` |
| 多源 Projection 伪多源               | M4 冻结**单源**：`PROJECTION_SINGLE_SOURCE_REQUIRED`；lineage 仅记录实际执行的 1 个 action + 1 个 trace                                                       |
| Visibility agent 语义不一致          | `visibleAgentTypes` 按 **agent type** 匹配 `context.agentType`；`feed-items.list` 预览用 `agentType`（拒绝 `agentId`）；upsert 校验 `KNOWLEDGE_AGENT_TYPES`   |

**合计：91 passed**

## 五、专家复验建议关注点

1. **Materializer Seat 授权边界**：`seat-projection-materializer` 仅用于供给物化，不与员工 invoke RPC 混用。
2. **模板扩展**：M4 为声明式骨架；复杂编排仍须走新模板类型而非脚本/SQL。
3. **M5 衔接**：Lineage 已写入；SupplyAudit / Approval Center 闭环待 M5。
4. **M6 衔接**：Feed Adapter 应只读 `knowledgeFeedItems` + Visibility 评估，禁止 Gateway。

## 六、结论

M4 投影与供给链路已落地：**ProjectionMaterializer 作为唯一 Gateway 供给路径**，可写入 `EnterpriseKnowledgeObjectFeedItem` 与基础 `KnowledgeLineageRecord`，并具备 `KnowledgeVisibilityPolicy` 运行时 enforcement 与供给运营视图。

**状态：待专家验收。**
