# 企业数据治理与供给中心 M3 验收收口（2026-09-27）

> 基线：`origin/main` `39c8fce85bd50e0f050c9e831b3dbdc9b11ef6d3`（M2 验收文档合入之后）。  
> 依据：最终指令 §7.2、§8.4、§11 M3、§12。  
> 本文只说明 M3 可以交给专属验收机器人。**验收机器人批准前，M3 不是通过。** M4–M6 不在本文验收范围内。红线 5 仍是 OPEN GAP。

## 1. 结论

M3 的 DataCapability、Capability Source Mapper、Capability Action Mapper，以及治理反查（来源、动作、关联投影、供给健康、开放范围），在上述基线上已经落在代码里。本分支只修了一处能力管理面 RPC 门禁：管理员拒绝之后又回了一帧参数错误。

未改 ProjectionMaterializer、FeedItem、Knowledge Universe，也未改 Agent 直接调用 Gateway 的路径。

## 2. 对照

| 条款                             | 核对                                                                                                                                                                                                                          | 代码                                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| §7.2 DataCapability 是能力抽象   | `sourceIds` 只表示来源数据源。`actionRefs` 是 `{connectorId, actionKey, version}`。缺任一项或引用未注册 Action 时拒绝写入。                                                                                                   | `types.ts` 的 `DataCapability` / `ConnectorActionRef`；`data-capability-store.ts`                      |
| §7.2 / §12 红线 2 不取代执行授权 | Gateway 仍按 `connectorId + actionKey + version` 找 Action 和 `SeatActionGrant`。Capability 不出现在 `data-gateway.ts` 的授权判断里。`grant-seat` 展开的也是逐条 Action@version 的 Grant。                                    | `data-gateway.ts` 的 `findSeatActionGrant`；`seat-capability-access.ts` 的 `grantDataCapabilityToSeat` |
| §8.4 / §11 Source Mapper         | `map-sources` 只按显式 `sourceIds` 反查 DataSource。                                                                                                                                                                          | `capability-governance-store.ts` 的 `resolveCapabilitySourceMapper`                                    |
| §8.4 / §11 Action Mapper         | `map-actions` 返回精确 `actionRefs`，并带上 Action 元数据与 handler 注册状态。v1 与 v2 不互相命中。                                                                                                                           | `resolveCapabilityActionMapper`、`resolveCapabilitiesByActionRef`                                      |
| §8.4 治理反查                    | `governance-view` 返回来源、动作、按 `capabilityId` 关联的 Projection、开放范围（策略与未撤销 Grant 的动作交集）、供给健康计数。v1 策略和 Grant 不会出现在只引用 v2 的能力上。                                                | `resolveCapabilityGovernanceView`                                                                      |
| §11 M3 RPC 管理员门禁            | `enterprise-data-m3.ts` 的 handler 在管理员拒绝后直接返回。`capabilities.grant-seat` 原先把 `!tenantId` 和参数缺失写在一起，现已分开。                                                                                        | `enterprise-data-m3.ts`、`enterprise-data.ts`                                                          |
| §12 红线 5                       | **OPEN GAP，本分支不修。** 路径仍是 `src/agents/tools/data-capability-tool.ts` → `capability-agent-invoke-runtime.ts` → `invokeEnterpriseDataAction`。底层仍按 Action@version 查 Grant，但这条 Agent 入口本身不符合冻结指令。 | 差距审计 §2                                                                                            |

执行主体仍是 Seat。Gateway 没有 `seatId` 时返回 `NO_SEAT_CONTEXT`。本分支不新增 DigitalHuman 或 KnowledgeObject 权限主体。

## 3. 本分支修的缺口

`enterprise-data.capabilities.grant-seat` 原先把 `!tenantId`、`seatId`、`capabilityId` 写在同一个判断里。

`requireResolvedEnterpriseAdminTenantId` 在非管理员时已经回复管理员拒绝。随后的判断仍为真，于是再发一帧 `seatId and capabilityId are required`。Gateway 的 `respond` 会把两帧都发出去。

这条现在与 `enterprise-data-m3.ts` 一致：管理员拒绝后直接返回，参数校验只在管理员通过之后发生，并且只回复一次。授权语义没有变：通过后仍按 `actionRefs` 逐条写入 `SeatActionGrant`。

## 4. 留给验收机器人、本分支不改的行为

`capability-agent-invoke-runtime.ts` 仍可按 capability 触发 `invokeEnterpriseDataAction`。`isCapabilityGrantedForSeat` 要求每条 `actionRef` 都有 Seat Grant，执行落点仍是 Action@version。这不把红线 5 变成 PASS。本分支不改这条路径。

使用统计留在 M5 SupplyAudit。本阶段的供给面是 `supplyHealth` 计数，不写入 FeedItem，也不启动 Materializer。

## 5. 验收机器人应核对

1. `DataCapability.actionRefs` 含 `connectorId`、`actionKey`、`version`。缺版本、未知 Action、或 Action 的 `connectorId` 对不上已链接 DataSource 时，`upsert` 失败。
2. Source Mapper 只走 `sourceIds`。Action Mapper 与 `resolve-by-action` 按完整版本键区分 v1 / v2。同一 `actionKey` 的 v1 能力不会被 v2 引用命中。
3. `governance-view` 含来源、动作、按 `capabilityId` 关联的 Projection、开放范围和供给健康。只引用 v2 的能力看不到 v1 策略和 v1 Grant。
4. 成员调用 `enterprise-data-m3.ts` 里的治理 RPC，以及 `capabilities.grant-seat`，只收到一次管理员拒绝。
5. diff 不包含 Materializer、Feed、Universe 行为变更。红线 5 仍是 OPEN GAP。批准前不要把 M3 写成通过，也不要把 M4–M6 写成通过。

## 6. 测试

```bash
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm exec vitest run \
  src/gateway/server-methods/enterprise-data-m3.test.ts \
  src/gateway/enterprise-data/capability-governance.test.ts \
  src/gateway/knowledge/seat-capability-access.test.ts
```

`seat-capability-access.test.ts` 覆盖 `grant-seat` 展开成 `SeatActionGrant` 的存储行为。Gateway 单测覆盖管理员拒绝只回复一次。

结果：**3 files, 19 tests passed**（2026-09-27，分支 `cursor-grok/edgsc-m3-acceptance-close`，基线 `39c8fce85`）。其中 `enterprise-data-m3.test.ts` 9 条，含成员调用 `capabilities.grant-seat` 只收到一次管理员拒绝；`capability-governance.test.ts` 7 条，含 v2 能力看不到 v1 开放范围。
