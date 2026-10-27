# TEAM-REAL：双根冗余路径删除清理

- 日期：2026-10-27（Asia/Shanghai）
- 分支：`fix/team-real-collab-activation-confirm-deliverable`
- PR：https://github.com/flykingvip-cloud/openbot-vp/pull/128
- Loom：`team-real-collab-loop:f1f3` / owner=`协作对话验收测试`

## 策略

| 根 | 角色 |
| --- | --- |
| `$OPENBOT_TENANTS_ROOT/<tid>/collaboration` | **唯一团队 SoT**（managed_enterprise） |
| `~/.openbot/collaboration`（`STATE_DIR/collaboration`） | 遗留 / personal_local 非团队 SoT；**团队 API 不得静默落到此** |

不做 A/B 双向同步；不另建平行成果权威；不挂整租户树进沙箱；不改 claim/formal-root。

## 代码变更（删除 / 硬拒）

| 符号 | 文件 | 行为 |
| --- | --- | --- |
| `resolveTeamDeliverableStores` | `team-resource-auth.ts` | **删除**对 `createWorkspaceCollaborationStores` 的团队回退；改走 auth / explicit `trusted` / `resolveTrustedGroupLocator` |
| `createTrustedGroupStores` | 同上 | 扩展为含 group/learning/memory/metadata stores，供激活 OS sync |
| `isHostLegacyCollaborationPath` | 同上 | 检测 host legacy collaboration 路径 |
| `LEGACY_COLLABORATION_ROOT_REJECTED` | 同上 | managed 却指向 host legacy → 硬拒 |
| `TRUSTED_GROUP_LOCATOR_REQUIRED` | 同上 | managed 无 tenant/auth → 硬拒 |
| `assertTaskBelongsToGroup` | 同上 | **删除**无 stores 时落到 `createWorkspaceCollaborationStores` |
| `activateCollaborationTask` | `activate-collaboration-task.ts` | task/OS 读写改 `resolveTeamDeliverableStores`；接受 `auth`/`trusted` |
| `resolveTrustedMembersForGroup` OS | `collaboration-task-activation.ts` | OS 读改 trusted locator；activate 传入 `auth` |
| `submitTeamDeliverable` / `readTeamDeliverable` | `team-deliverable-submit.ts` | stores Result 失败直接返回；支持 `trusted` |

## 测试

- managed 无 tenant/auth → 拒绝，不写 legacy
- legacy+managed 并存 → 写只进 tenants 根；读不得把 legacy 冒充团队成果
- 既有两租户同局部 ID、不可变版本等用例保持

## 缩小范围

- 未改 `shared.ts` / `group-locator.ts` / claim / formal-root 热文件（personal_local 全局 stores 工厂仍存在，供非团队路径）
- 未 rm 本机生产协作目录
- 不合入 main / 不切 18789 / 不做 F4
