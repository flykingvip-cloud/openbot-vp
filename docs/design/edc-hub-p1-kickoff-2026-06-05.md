# Enterprise Data Capability Center P1 启动说明（2026-06-05）

> 升级指令：`docs/design/openbot-enterprise-data-capability-center-upgrade-instruction-2026-06-05.md`  
> 执行内核：`docs/design/connector-action-versioning.md`（v2）  
> 供给内核：`docs/design/enterprise-knowledge-supply-kernel.md`

## P1 目标

1. **Execution Kernel**：`ConnectorAction@version` + `ConnectorRuntimeRegistry` + `SeatActionGrant`
2. **Knowledge Supply Kernel（引用冻结）**：`EnterpriseKnowledgeProjectionSpec` 存储与 `sourceActions` 校验
3. Gateway RPC 目录查询接口

## 双内核架构（冻结）

```text
┌─ Execution Governance Kernel ─────────────────────────┐
│ Connector → ConnectorAction@version → RuntimeRegistry │
│ SeatActionGrant → (P2-P4 Policy/Audit/Gateway)        │
└─────────────────────────────────────────────────────┘
                          ↑ 仅 Materializer 可调用 (P3)
┌─ Knowledge Supply Kernel ───────────────────────────┐
│ EnterpriseKnowledgeProjectionSpec (P1 存储+校验)      │
│ → ProjectionMaterializer (P3) → FeedItem (P4/P5)    │
└─────────────────────────────────────────────────────┘
                          ↓
              Knowledge Feed Adapter (P5) → Knowledge Universe (P6)
```

## 代码布局

```
src/gateway/enterprise-data/
  types.ts
  store.ts
  connector-action-store.ts
  runtime-registry.ts
  seat-action-grant-store.ts
  projection-spec-store.ts
  seeds.ts
  *.test.ts
src/gateway/server-methods/enterprise-data.ts
```

存储：独立 `openbot-enterprise-data.json`（与 seat-assets 解耦，避免 v2 测试回归）。

## P1 RPC

| 方法                                    | 说明         |
| --------------------------------------- | ------------ |
| `enterprise-data.actions.list`          | 动作目录     |
| `enterprise-data.actions.get`           | 单动作       |
| `enterprise-data.registry.list`         | Runtime 注册 |
| `enterprise-data.grants.list`           | 岗位授权     |
| `enterprise-data.grants.upsert`         | 授权         |
| `enterprise-data.grants.revoke`         | 撤销         |
| `enterprise-data.projection-specs.list` | 投影规范列表 |
| `enterprise-data.projection-specs.get`  | 投影规范详情 |

## P1 通过标准

- `crm.customer.read_summary@v1` 与 `@v2` 并存
- 未注册动作不可解析 handler
- ProjectionSpec 的 sourceActions 必须引用已存在且 active 的 Action
- 禁止 `KnowledgeProjection` 命名
