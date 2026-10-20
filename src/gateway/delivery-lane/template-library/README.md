# DeliveryLane template library (Tip F / P2)

| Id | Label | Notes |
| -- | ----- | ----- |
| `cloud-computer-experience` | 云电脑体验轨 | 体验 tip 交付 |
| `collab-dual-gate` | 协作双门禁 | 双钥合入守卫 |

## Hosted CI 计费挡 → 本机 must-green

两模板均声明 `ciPolicy.hostedCiBillingBlocked=true` 且 `mustGreenLocally=true`：

- **不要**把付费 hosted CI 当作唯一合入绿灯
- **要**在本机跑定向 vitest / format 作为 must-green
- merge main ≠ 打开 delivery-lane flag / 生产切流

`attach(templateId)` 仍走 `lane.attach`；**禁止**用 tip-prompt 代替 attach。
