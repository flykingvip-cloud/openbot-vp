# 企业数据治理与供给中心 M2 数据治理入口 — 待验收报告（2026-06-05）

> 前置：M1 执行治理基线已通过专家验收。  
> 依据：`docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md` §11 M2  
> 总计划：`docs/design/edgsc-master-implementation-plan-2026-06-05.md`

## 〇、阶段定位

**M2 = 数据治理入口（DataSource + DataAccessPolicy + Access Governance）**

| 类别           | M2 交付                                                  | 明确未做（禁止抢跑）                                              |
| -------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| 数据资产治理   | DataSource CRUD、治理反查视图                            | —                                                                 |
| 访问治理管理面 | DataAccessPolicy 深化、编译/归档、Access Governance 矩阵 | —                                                                 |
| 运行时权限     | 仍仅 `SeatActionGrant` → Gateway（Policy 仅编译产物）    | 禁止 Policy/Capability 直连 invoke                                |
| 供给实质       | —                                                        | ProjectionMaterializer、FeedItem、Visibility、Universe/Agent 对接 |

## 一、硬约束自检

| #   | 约束                                        | 状态 | 证据                                                     |
| --- | ------------------------------------------- | ---- | -------------------------------------------------------- |
| 1   | DataSource ≠ Connector 别名                 | ✅   | `sourceId` 独立；`connectorId` 仅关联技术 Connector      |
| 2   | DataAccessPolicy 编译为 SeatActionGrant     | ✅   | `compileDataAccessPolicy()` + `archive` 撤销 Grant       |
| 3   | Access Governance 可反编译到 Action@version | ✅   | `runtimeActionRefs` 显式暴露精确版本                     |
| 4   | 运行时不得只授权到 DataSource               | ✅   | 矩阵/详情均落到 `ConnectorAction@version`                |
| 5   | 治理 RPC 须 enterprise-admin                | ✅   | M2 handler 统一 `requireResolvedEnterpriseAdminTenantId` |
| 6   | 未启动 Materializer / Feed                  | ✅   | 本阶段无供给写入链路                                     |

## 二、交付物清单

### 2.1 Store 层

| 模块                          | 变更                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `data-source-store.ts`        | `upsert` 校验 Connector 已注册 Action；`archiveDataSource`                                              |
| `data-access-policy-store.ts` | `scopePolicyId`/`approvalPolicyId` 引用校验；`resolveDataAccessPolicyDetail`；`archiveDataAccessPolicy` |
| `access-governance-store.ts`  | **新增** Overview / Matrix / Target 反查 / DataSource 治理视图                                          |

### 2.2 Gateway RPC（M2 新增）

| 方法                                               | 说明                                                 |
| -------------------------------------------------- | ---------------------------------------------------- |
| `enterprise-data.sources.upsert`                   | 注册/更新 DataSource（须已有 Connector Action）      |
| `enterprise-data.sources.archive`                  | 归档为 `disconnected`                                |
| `enterprise-data.sources.governance-view`          | 反查 Capability / Projection / Policy + 供给健康摘要 |
| `enterprise-data.access-policies.get`              | Policy 详情 + 运行时 Action 反编译 + 已编译 Grant    |
| `enterprise-data.access-policies.archive`          | 禁用 Policy 并撤销已编译 Grant                       |
| `enterprise-data.access-governance.overview`       | 企业数据资产与访问治理总览                           |
| `enterprise-data.access-governance.matrix`         | 按 source / seat / department / role 维度展示        |
| `enterprise-data.access-governance.resolve-target` | 给定 target 反查 Policy → Action@version → Grant     |

注册：`server-methods/enterprise-data-m2.ts` → `enterprise-data.ts`；已同步 `server-methods-list.ts` / `method-scopes.ts`。

### 2.3 Access Governance 语义

- **UI 可按 Source / Department / Role / Seat 展示**（`matrix` RPC）
- **运行时授权仍落到 `ConnectorAction@version`**（`runtimeActionRefs` + `compiledGrants`）
- `department` / `role` 目标策略可登记，但 `compilationSupported: false`（编译仍仅 seat，与 M1 一致）

### 2.4 DataSource 治理反查（§8.2）

`governance-view` 返回：

- 关联 `DataCapability` 列表
- 关联 `EnterpriseKnowledgeProjectionSpec` 列表（**仅**经已绑定本 `sourceId` 的 `DataCapability`；禁止 `connectorId` 兜底）
- 关联 `DataAccessPolicy` 列表
- `supplyHealth`：连接状态、能力数、投影数、启用策略数、活跃 Grant 数

## 三、测试证据

```bash
pnpm exec vitest run src/gateway/enterprise-data/
pnpm exec vitest run src/gateway/server-methods/enterprise-data-m2.test.ts
```

| 套件                             | 结果          | M2 关键覆盖                                                              |
| -------------------------------- | ------------- | ------------------------------------------------------------------------ |
| `access-governance.test.ts`      | **9 passed**  | 治理反查、department/role 登记、Projection 非 connector 兜底、矩阵反编译 |
| `enterprise-data-m2.test.ts`     | **15 passed** | M2 RPC handler：admin 通过、member 拒绝、参数/租户校验                   |
| `connector-action-store.test.ts` | 10 passed     | 种子顺序调整回归                                                         |
| 其余 M1 套件                     | 36 passed     | 无回归                                                                   |

**合计：60 passed**（store 45 + handler 15）

### 关键场景验收矩阵

| 场景                                          | 预期                                     | 实测 |
| --------------------------------------------- | ---------------------------------------- | ---- |
| DataSource governance-view 反查 CRM           | capabilities + projections + policies    | ✅   |
| seat 维度 matrix                              | 暴露 `crm.customer.read_summary@v1`      | ✅   |
| source 维度 matrix                            | 按 sourceId 分组 policies                | ✅   |
| resolve-target seat                           | runtimeActionRefs + compiledGrants       | ✅   |
| archive DataAccessPolicy                      | 禁用 + 撤销 Grant                        | ✅   |
| upsert DataSource 无 Action 的 connector      | `DATA_SOURCE_CONNECTOR_UNREGISTERED`     | ✅   |
| archive DataSource                            | `status=disconnected`                    | ✅   |
| department/role policy upsert                 | 可登记、`compiledGrantIds=[]`            | ✅   |
| department policy compile                     | `DATA_ACCESS_POLICY_COMPILE_UNSUPPORTED` | ✅   |
| 同 connector 多 DataSource 的 Projection 反查 | 仅 capability 绑定 source 命中           | ✅   |
| M2 RPC member 访问                            | `GOVERNANCE_ADMIN_REQUIRED_MESSAGE`      | ✅   |
| M2 RPC 伪造 tenantId                          | 租户不匹配拒绝                           | ✅   |

## 四、已知限制（M2 口径内可接受）

1. **department / role 编译**：`upsert` 允许登记；`compile` 仅 `seat`（`DATA_ACCESS_POLICY_COMPILE_UNSUPPORTED`）。
2. **DataSource 创建顺序**：须先有 Connector Action 注册，再登记 DataSource（执行建模先于资产入口，业务方已接受）。
3. **供给健康**：基于连接状态与 Grant 计数，不含真实 Connector 探活（真实适配器属后续集成）。
4. **UI 面**：本阶段交付 Gateway RPC；企业端 Access Governance 页面待前端对接。
5. **M3 DataCapability 深化**：Capability Source/Action Mapper 统计面留待 M3。

## 五、专家复验清单

- [ ] 确认 DataSource 治理视图可反查 Capability / Projection / Policy
- [ ] 确认 Access Governance 矩阵可反编译到 `ConnectorAction@version`
- [ ] 确认 archive Policy 会撤销已编译 Grant，不残留运行时权限
- [ ] 确认未启动 Materializer / Feed / Universe 对接
- [ ] 批准进入 **M3 数据能力建设**

## 六、下一阶段（M3）

按总计划：

| 里程碑 | 内容                                                               |
| ------ | ------------------------------------------------------------------ |
| **M3** | DataCapability 编排、Capability Source/Action Mapper、治理反查深化 |

---

## 七、复验修复记录（2026-06-05 第二轮）

| #   | 专家 Finding                               | 修复                                                                                             |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| R1  | department/role 报告可登记但 `upsert` 拒绝 | 移除 `upsert` 的 seat-only 限制；`compile` 仍仅 seat（`DATA_ACCESS_POLICY_COMPILE_UNSUPPORTED`） |
| R2  | Projection 反查按 `connectorId` 兜底       | 改为仅经绑定本 `sourceId` 的 `DataCapability` 关联                                               |
| R3  | M2 RPC 缺 handler 级测试                   | 新增 `enterprise-data-m2.test.ts`（admin/member/参数/租户）                                      |
| R4  | admin 拒绝后被参数错误覆盖                 | M2 handler 统一 `if (!tenantId) return` 先于参数校验                                             |

---

**状态：M2 复验阻塞项已修复，提交专家复验。**
