# 企业数据治理与供给中心 M3 数据能力建设 — 待验收报告（2026-06-05）

> 前置：M2 数据治理入口已通过专家验收。  
> 依据：`docs/design/openbot-enterprise-data-governance-and-supply-center-final-instruction-2026-06-05.md` §11 M3、§8.4  
> 总计划：`docs/design/edgsc-master-implementation-plan-2026-06-05.md`

## 〇、阶段定位

**M3 = DataCapability 编排与治理反查深化**

| 类别       | M3 交付                                             | 明确未做（禁止抢跑）                                |
| ---------- | --------------------------------------------------- | --------------------------------------------------- |
| 能力定义   | DataCapability upsert/archive、Source/Action Mapper | —                                                   |
| 治理反查   | governance-view（来源/动作/投影/开放范围/供给健康） | —                                                   |
| 运行时权限 | 仍仅 `ConnectorAction@version` → Grant → Gateway    | Capability 不替代执行授权                           |
| 供给实质   | —                                                   | ProjectionMaterializer、FeedItem、Visibility 运行时 |

## 一、硬约束自检

| #   | 约束                                            | 状态 | 证据                                         |
| --- | ----------------------------------------------- | ---- | -------------------------------------------- |
| 1   | DataCapability 不取代 ConnectorAction@version   | ✅   | `actionRefs` 为真实执行来源；Mapper 只读反查 |
| 2   | `sourceIds` 为来源展示、`actionRefs` 为执行来源 | ✅   | Source/Action Mapper 分离                    |
| 3   | Source-Action 对齐校验                          | ✅   | `assertCapabilitySourceActionAlignment`      |
| 4   | 治理 RPC 须 enterprise-admin                    | ✅   | M3 handler 统一 admin 门槛                   |
| 5   | 未启动 Materializer / Feed                      | ✅   | 无供给写入链路                               |

## 二、交付物清单

### 2.1 Store 层

| 模块                             | 变更                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `data-capability-store.ts`       | Source-Action 对齐校验；`archiveDataCapability`                               |
| `capability-governance-store.ts` | **新增** Source Mapper、Action Mapper、Governance View、Action 反查、Overview |

### 2.2 Gateway RPC（M3 新增）

| 方法                                             | 说明                       |
| ------------------------------------------------ | -------------------------- |
| `enterprise-data.capabilities.upsert`            | 注册/更新 DataCapability   |
| `enterprise-data.capabilities.archive`           | 禁用能力                   |
| `enterprise-data.capabilities.governance-view`   | 能力治理全景（§8.4）       |
| `enterprise-data.capabilities.map-sources`       | Capability Source Mapper   |
| `enterprise-data.capabilities.map-actions`       | Capability Action Mapper   |
| `enterprise-data.capabilities.resolve-by-action` | 按 Action@version 反查能力 |
| `enterprise-data.capabilities.overview`          | 租户能力总览               |

注册：`server-methods/enterprise-data-m3.ts` → `enterprise-data.ts`；已同步 `server-methods-list.ts` / `method-scopes.ts`。

### 2.3 Governance View 语义（§8.4）

`governance-view` 返回：

- **来源数据源**：`sourceMappings`（显式 `sourceIds`）
- **来源动作**：`actionMappings`（精确 `actionRefs` + Action 元数据 + handler 注册状态）
- **关联 Projection**：`projectionSpecs`（`capabilityId` 显式关联）
- **当前开放范围**：`accessScope.policies` + `accessScope.activeGrants`（与 capability 动作交集）
- **供给健康**：`supplyHealth`（enabled、projection/binding/grant/policy 计数）

## 三、测试证据

```bash
pnpm exec vitest run src/gateway/enterprise-data/
pnpm exec vitest run src/gateway/server-methods/enterprise-data-m3.test.ts
```

| 套件                            | 结果         | M3 关键覆盖                     |
| ------------------------------- | ------------ | ------------------------------- |
| `capability-governance.test.ts` | **6 passed** | Mapper、反查、对齐校验、archive |
| `enterprise-data-m3.test.ts`    | **7 passed** | handler admin/member/租户/参数  |
| M1/M2 回归套件                  | 60 passed    | 无回归                          |

**合计：73 passed**

### 关键场景验收矩阵

| 场景                                   | 预期                                     | 实测 |
| -------------------------------------- | ---------------------------------------- | ---- |
| Source Mapper 反查 CRM                 | `crm-salesforce` DataSource              | ✅   |
| Action Mapper 暴露 v1 Action + handler | `read_summary@v1`                        | ✅   |
| governance-view 含 Projection + Grant  | 非空                                     | ✅   |
| resolve-by-action 反查                 | `customer.profile` 命中 v1               | ✅   |
| source/action connector 不对齐 upsert  | `DATA_CAPABILITY_SOURCE_ACTION_MISMATCH` | ✅   |
| archive capability                     | `enabled=false`                          | ✅   |
| M3 RPC member 访问                     | admin 门槛拒绝                           | ✅   |

## 四、已知限制（M3 口径内可接受）

1. **使用统计中心**：本阶段为治理反查与计数摘要；真实调用统计留待 M5 SupplyAudit。
2. **UI 面**：交付 Gateway RPC；企业端 Data Capabilities 页面待前端对接。
3. **Materializer**：仍禁止抢跑；`resolveCapabilityActionRefs` 仅供后续 M4 声明引用。

## 五、专家复验清单

- [ ] 确认 DataCapability 不扩展运行时权限链
- [ ] 确认 Source/Action Mapper 与 governance-view 反查完整
- [ ] 确认 source-action 对齐校验生效
- [ ] 确认未启动 Materializer / Feed / Universe 对接
- [ ] 批准进入 **M4 投影与供给**

## 六、下一阶段（M4）

| 里程碑 | 内容                                                                      |
| ------ | ------------------------------------------------------------------------- |
| **M4** | ProjectionSpec Binding 深化、ProjectionMaterializer、FeedItem、Visibility |

---

**状态：M3 代码与测试已完成，提交专家验收。**
