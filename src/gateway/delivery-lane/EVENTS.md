# Tip F — Lane events + template library (P2)

## Board advance

| Event                               | Suggested stage |
| ----------------------------------- | --------------- |
| `tip.opened`                        | drafting        |
| `tip.pushed`                        | implementing    |
| `pr.opened` / `pr.review_requested` | reviewing       |
| `pr.approved` / `pr.checks_green`   | accepting       |
| `pr.merged`                         | merged          |

API: `lane.event.apply` (flag ON). Stages never regress via events. **Does not** call MergePort.

Webhook adapters may forward GitHub tip/PR payloads into this internal event shape.

## Shadow observation

`lane.event.observeShadow` / `observeLaneEventShadow` — orchestration plane **observe-only**.
`ORCHESTRATION_LIVE_INVOKE` must stay `false`. No enqueue / live invoke.

## Templates

See `template-library/` — 「云电脑体验轨」`cloud-computer-experience`、「协作双门禁」`collab-dual-gate`.
Both declare hosted CI billing blocked → **本机 must-green**.

## Explicit non-goals

- tip-prompt 代替 attach
- Floor 替 Legacy 生产执行器
- 默认打开 `OPENBOT_DELIVERY_LANE_ENABLED` / delivery-lane flag
- orch live invoke
