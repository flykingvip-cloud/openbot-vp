# UX P0 · NIGHT-20261028 一夜对话审查落地（A+B）

- 日期：2026-10-29（Asia/Shanghai）
- 基线：`ea3b4e8a`（#133 squash on main）
- 分支：`fix/ux-p0-night-20261029`
- 证据：`20-UX-dialogue-review.md` + 18/19
- **NO_PROMOTE**；不 Path B；未改 WIP `/Users/daniel/AI VP/openbot`；本轮默认不切服

## A · 数字人互认

- agent↔agent peer 计划（owner 为 bot-like，且与 coordinator 不同）：`proposeCollaborationTodolist` 后由 coordinator **自动 confirm**，不推真人 Owner UI。
- coordinator 自己的计划仍走真人 Owner 人闸卡。
- 自动确认失败 → delivery anomaly（`agent_peer_auto_confirm_failed` / retryable），禁止叙事成「请再点」。

## B · P0

1. **身份投影**：`listExecutorTodolists` / `evaluateDeliveryExecGate` 用 `deliveryActorIdsEqual`（`bot` ≡ `bot:bot`，`human:` ↔ bare）。confirmed 后按投影放行 `markInProgress`；若仍找不到匹配但 board 上已有 confirmed，返回 `plan_gate_owner_projection_mismatch`（点名已确认卡 id），禁止假 `plan_gate_unconfirmed`。
2. **managed 终交**：`collaboration_board` 增 `submit_team_deliverable` / `read_team_deliverable`，网关 `submitTeamDeliverable` 回执带 `contentSha256` + `fingerprintSha16`（沙箱勿谎报 host managed 路径）。
3. **plan_confirm_advance**：wake-op `dispatch_failed` detail 附带底层 `message`；`finishAdvance` 对 dispatch 失败打 **error** + `anomaly=plan_confirm_advance_dispatch_failed`。`resolveWakeLeadBot` 对 `bot`/`bot:bot` 针归一。
4. **confirm_word_mixed**：长 @mention / 监管催促 / NIGHT-任务 / 多行载荷视为普通聊天（`not_confirm`），不再 stopped 成计划确认歧义。

## 明确没做

- 未 merge；未切 18789；未 Path B / PROMOTE。
- 未做 P1 群内交付仪表 / 静默看门狗产品化。
- 未挂沙箱只读 tenants 全树（选 gateway submit 回执路径）。

## 验证

```bash
pnpm exec vitest run \
  src/gateway/collaboration-learning/chat-plan-confirm.test.ts \
  src/gateway/collaboration-dispatch/executor-private-todolist.test.ts
```
