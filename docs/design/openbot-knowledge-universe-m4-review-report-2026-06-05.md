# OpenBot 知识宇宙 M4 待审核报告

Date: 2026-06-05

权威方案：`docs/design/openbot-knowledge-universe-final-task-plan-2026-06-05.md`（v5 定稿）

## 1. 阶段目标

M4：企业接入与治理（KU-15 ~ KU-18）

- Enterprise Knowledge Feed 标准化接入
- Enterprise Data Gateway 数据能力真实调用
- Seat / Team / AgentType 可见性策略
- 权限 / 脱敏 / 审计合规注入

## 2. 交付清单

### 2.1 Knowledge Feed（KU-15）

| 文件                                                         | 任务                             |
| ------------------------------------------------------------ | -------------------------------- |
| `src/gateway/knowledge/feed/types.ts`                        | KU-15-1 扩展 `KnowledgeFeedItem` |
| `src/gateway/knowledge/feed/enterprise-feed-adapter.ts`      | KU-15-2 企业 feed 适配           |
| `src/gateway/knowledge/feed/data-capability-feed-adapter.ts` | KU-15-3 数据能力 feed 适配       |
| `src/gateway/knowledge/feed/visibility-policy-mapping.ts`    | KU-15-4 / KU-17 可见性映射       |
| `src/gateway/knowledge/sources/enterprise-source.ts`         | 委托 feed 适配层                 |
| `src/gateway/knowledge/sources/capability-catalog.ts`        | 委托数据 feed 适配层             |

### 2.2 Enterprise Data Gateway（KU-16）

| 文件                                                          | 说明                                   |
| ------------------------------------------------------------- | -------------------------------------- |
| `src/gateway/enterprise-data/policy-backed-grant-resolver.ts` | department/role 策略合成运行时 grant   |
| `src/gateway/enterprise-data/data-gateway.ts`                 | 无 seat grant 时回退策略授权并真实调用 |

知识宇宙消费层遵守 `knowledge-consumption-boundary`：**不**在 knowledge plane 直接 import/调用 EDC；数据能力真实调用由 EDC 层承担。

### 2.3 治理合规（KU-18）

| 文件                                             | 说明                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `src/gateway/knowledge/governance/compliance.ts` | 受控对象强制来源/范围/脱敏元数据                                   |
| `src/gateway/knowledge/context.ts`               | 上下文扩展 `teamLabel` / `roleCode` / `departmentId` / `agentType` |

### 2.4 UI

| 文件                                                   | 说明                    |
| ------------------------------------------------------ | ----------------------- |
| `ui/src/ui/views/knowledge-universe-detail-preview.ts` | 详情展示 `sourceSystem` |
| `ui/src/i18n/locales/zh-CN.ts` / `en.ts`               | `detail.source` 文案    |

### 2.5 测试

| 文件                                                               | 覆盖                          |
| ------------------------------------------------------------------ | ----------------------------- |
| `src/gateway/knowledge/feed/visibility-policy-mapping.test.ts`     | 席位/团队/部门/角色可见性     |
| `src/gateway/knowledge/sources/capability-access-resolver.test.ts` | department/role 数据能力授权  |
| `src/gateway/enterprise-data/policy-backed-grant-resolver.test.ts` | 策略回退 grant + EDC 真实调用 |
| `src/gateway/enterprise-data/knowledge-supply.test.ts`             | 可见性策略 department/role    |
| `src/gateway/knowledge/governance/compliance.test.ts`              | 合规元数据注入                |
| `src/gateway/knowledge/sources/enterprise-source.test.ts`          | 受限投影分组（回归）          |
| `src/gateway/knowledge/source-bundle.test.ts`                      | 企业+数据投影（回归）         |

## 3. M4 验收对照

| 验收项                     | 状态 | 证据                                                          |
| -------------------------- | ---- | ------------------------------------------------------------- |
| 企业知识可见性正确         | ✅   | `visibility-policy-mapping.ts` + `enterprise-feed-adapter.ts` |
| 数据能力真实可用           | ✅   | EDC `policy-backed-grant-resolver` + 知识 feed 授权解析       |
| 受控对象显示来源/范围/脱敏 | ✅   | `governance/compliance.ts` + 详情 `sourceSystem`              |
| Feed 标准化交换            | ✅   | `KnowledgeFeedItem` + enterprise/data adapters                |
| 审计链路                   | ✅   | 数据调用复用 EDC `data-gateway` 审计写入                      |

## 4. Department / Role 治理补齐（P1 修复）

| 项             | 实现                                                                                   |
| -------------- | -------------------------------------------------------------------------------------- |
| 可见性策略扩展 | `KnowledgeVisibilityPolicy.visibleDepartments` / `visibleRoles`                        |
| 消费上下文     | `KnowledgeSourceContext.departmentId` / `roleCode` 映射到 `KnowledgeVisibilityContext` |
| 数据能力授权   | `resolveCapabilityAccessForKnowledge` 消费 department/role `DataAccessPolicy`          |
| 真实调用       | `policy-backed-grant-resolver.ts` 为 `data-gateway` 提供策略回退 grant                 |

## 5. 风险与尾差

| 项                                           | 说明                                           |
| -------------------------------------------- | ---------------------------------------------- |
| 知识 plane 不暴露 `knowledge.data.invoke`    | 遵守 consumption boundary；调用走 EDC          |
| department/role 策略不编译为 SeatActionGrant | 运行时由 policy-backed resolver 合成执行 grant |
| UI 未单独暴露 invoke 按钮                    | M4 聚焦网关能力；员工触发可留 M5 Agent 链路    |

## 6. 审核结论

**建议：通过 M4，可进入 M5（Agent Runtime 集成）。**
