# DeliveryLane cross-bot acceptSeal (Tip D)

## Goal

Path-1（跨机）验收：外部 `agentId` 可写入 `acceptSeal`；与 collaboration `HandoffContract` 的 `kind=review|evidence` **平行互操作**，不发明第三套相位名。

## Flags（默认均 OFF）

| Flag                                                                 | Default | Role                                                                                  |
| -------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------- |
| `OPENBOT_DELIVERY_LANE_ENABLED` / `gateway.deliveryLane.enabled`     | OFF     | Lane RPC 总闸                                                                         |
| `OPENBOT_DELIVERY_LANE_PATH1` / `gateway.deliveryLane.path1CrossBot` | OFF     | 跨机路径显式 enable；ON 时拒同源 acceptSeal + implement/accept 自签                   |
| `collaboration.task.handoffContract`                                 | OFF     | Collab 写 handoff 存储；**本 tip 不打开**。`lane.sealFromHandoff` 只消费内存 snapshot |

合入 / MergePort ≠ 生产切流；本 tip 不默认打开任何上述 flag。

## Vocabulary（复用，不新建相位枚举）

| Source          | Values used                                                         |
| --------------- | ------------------------------------------------------------------- |
| `HandoffKind`   | `review`, `evidence`（`continue` / `owner_transfer` 不入 seal）     |
| `HandoffStatus` | `receiver_accepted` \| `approved` \| `applied`                      |
| `RuntimePhase`  | `draft` \| `review` \| `final`（仅写入 evidence.refs，对齐 collab） |
| Lane stages     | 仍用 Tip A `drafting`…`merged`（交付看板，非 collab phase）         |

Gate API：`canPublishLaneAcceptSeal` — 形状对齐 `canPublishDeliverable` / `canPublishFinalDecision`（`allowed` + `reason` + `details`）。

## Mapping

| Handoff kind                              | → LaneSealKind |
| ----------------------------------------- | -------------- |
| `evidence`                                | `accept`       |
| `review`（toRole=reviewer/approver/缺省） | `accept`       |
| `review`（其他 role）                     | `review`       |

Issuer = handoff `to.agentId`（他机）。

## Path-1 rules

1. `acceptSeal.issuer` 不得等于 `lane.agentId`（同源拒）
2. `acceptSeal.issuer` 不得等于 `implementSeal.issuer`（自签拒）
3. 缺 `lane.agentId` 无法证明跨机 → 拒
4. path1 OFF → 单机 weak accept 仍可用（Tip A）

## APIs

- `lane.seal` — 直接外部 agentId（path1 守卫加强）
- `lane.sealFromHandoff` — snapshot → LaneSeal

## Out of scope (Tip E+)

- `maxLaneHelpers ≤ 2` / ban personal_subagent acceptSeal
- 自动创建专科 bot / 开 orch live / 默认开 delivery-lane flag
