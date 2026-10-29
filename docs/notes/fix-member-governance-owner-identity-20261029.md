# fix/member-governance · owner 被判 member → 添加/邀请消失（2026-10-29 Asia/Shanghai）

## 症状
数字人战队协作小组「成员管理」面板：群主看不到「添加成员 / 添加机器人 / 邀请」入口。功能未删，面板 `readOnly`。

## 根因
1. `workbench-stage-collaboration.ts`：`isReadOnly = activeGroupRole === "member" || isInvitee`；readOnly 时隐藏添加/邀请。
2. `resolveWorkbenchSettingsGroupRole` 用 `matchesWorkbenchActorIdentity(ownerUserId, actorIdentities)`。
3. 数字人战队 `operating-state.governance.ownerUserId` 常为 null，fallback 到 `memberRoleMap` 里 `governanceRole=owner` 的 `memberId = human:<uuid>`。
4. `buildWorkbenchActorIdentities` 只放裸 userId/email，**不含 `human:${userId}`** → 群主被判 member → 入口「没了」。

## Fix（最小）
- `buildWorkbenchActorIdentities` / `matchesWorkbenchActorIdentity`：对齐 `human:` ↔ 裸 uuid（与 delivery-actor-binding 同语义）。
- `resolveWorkbenchCollaborationSpaceOwnerUserId`：解析结果去 `human:`，与 roster `userId` / actor 一致。
- `buildBaseMemberGovernanceEntries` 本地 actor set 改走同一 helper。

## 约束
NO_PROMOTE；不 Path B；未切 gateway 18789；未改 WIP `/Users/daniel/AI VP/openbot`；独立 PR（未叠 #137）。
