# Phase 1 路径原子切换计划（书面）

- **日期**: 2026-08-12
- **Spec**: `workspace-isolation-wip`
- **Agent**: `cursor-grok`
- **批准依据**: [daibai-conversation-isolation-conditional-approval-2026-08-12.md](./daibai-conversation-isolation-conditional-approval-2026-08-12.md) §2
- **实施基线**: [workspace-directory-isolation-audit-2026-08-10.md](./workspace-directory-isolation-audit-2026-08-10.md) 仍标「实施基线不通过」（C1–C19）；**本阶段不得宣称审计已签收**。

## 1. 范围

| 阶段    | 内容                                                                  | 路径写入                                      |
| ------- | --------------------------------------------------------------------- | --------------------------------------------- |
| **1.0** | 只读 inventory + 脱敏证据 + 本文件 + `tasks.md` 登记                  | **零**                                        |
| **1.1** | 仅 **A_employee（大白 steward）** 单类试切至 `resolver_write_cutover` | 仅本地受控 `OPENBOT_STATE_DIR`；禁止生产 live |

**明确不做**：B_flat_l2 / C_agent_main / D_skill_l2 / E_skill_host / F_canvas cutover；企业共享机器人路径；直接 `mv` / `cp -a` 当发布。

## 2. 状态机与禁令

批准管道（不可跳步）：

```text
inventory → quarantine → verified copy/adoption → write freeze → cutover → read-only compatibility → retirement
```

| 禁令                             | 对齐                                                    |
| -------------------------------- | ------------------------------------------------------- |
| 禁止直接搬目录当 cutover         | 批准 §2；cutover `copied_or_adopted` 必须 verified copy |
| 禁止双写                         | C3 / one-writer；`gateCutoverWrite`                     |
| 禁止 unknown 写                  | C14；`requireProvedOwnerScopeForWrite`                  |
| 禁止 cutover 后把旧根标回 writer | C16 / D1e 回滚铁律                                      |
| raw inventory 不进仓             | D14；仅脱敏 summary + evidence-id                       |

## 3. Steward 试切路径（A_employee）

| 角色                     | 当前写根（源）                                        | 目标（审计 D1e）                                                             |
| ------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| employee_private steward | `{stateDir}/agents/main/employees/<userId>/workspace` | `{stateDir}/tenants/<tenantId>/users/<userId>/OpenBot/agents/main/workspace` |

铁律：cutover 后**仅目标可写**；源最多只读兼容；回滚不得恢复旧根为 writer。

## 4. 按根类的 cutover 候选表

| 类            | inventory `normalizedRootClass` | Phase 1.1                               |
| ------------- | ------------------------------- | --------------------------------------- |
| A_employee    | `employee_isolation_root`       | **唯一试点**（proved + cutover 状态机） |
| B_flat_l2     | `data_space_flat_workspace`     | 仅 quarantine，不 cutover               |
| C_agent_main  | `legacy_agent_workspace`        | 仅 quarantine                           |
| D/E skill     | `host_skill_risk`               | 仅 quarantine                           |
| F_canvas      | `canvas_risk`                   | 仅 quarantine                           |
| agent-assets  | `agent_assets_user`             | 仅 quarantine                           |
| collaboration | `collaboration_group`           | 仅 quarantine                           |

## 5. 回滚

| 时机       | 动作                                                                  |
| ---------- | --------------------------------------------------------------------- |
| cutover 前 | 恢复单一源 writer；丢弃未 verified 的 target 草稿副本                 |
| cutover 后 | **禁止**把旧根重新标为 writer；从前滚 verified snapshot 或修复 target |

## 6. 验收闸门

### 6.1 Phase 1.0

- [x] 脱敏 summary：`docs/design/evidence/workspace-inventory-phase1-001.summary.json`
- [x] quarantine / duplicate groups 显式列出
- [x] 无 raw tenant/user UUID 进仓；`summarySha256` 可复算
- [x] `src/gateway/workspace-inventory/workspace-inventory.test.ts` 绿

### 6.2 Phase 1.1

- [x] 至少一个 A_employee 候选本地完成至 `resolver_write_cutover`
- [x] 旧根写入被拒；unknown 写阻断（C14）
- [x] `pnpm lint:gateway:isolation-fail-closed` + `node scripts/check-isolation-fail-closed.mjs --daibai-frame` 仍通过

## 7. 接线点（1.1）

- 写 cwd：`resolveEmployeeStewardWritableWorkspaceDir`（`src/gateway/workspace-resolver/steward-write.ts`）+ `resolveEmployeeBuiltinStewardWorkspaceDir(..., { workspaceDirOverride })`；`get-reply` 在有 tenant hint 时优选 cutover writer
- 读：现有 `steward-read.ts`（可短暂多根）
- 门禁：`gateCutoverWrite` / `resolveWorkspaceResource(..., cutoverOperations)`
- 试点：`runEmployeeStewardCutoverPilot`（verified copy，禁止 mv）

## 8. 本机 inventory 实测类（phase1-001）

本机 `OPENBOT_STATE_DIR` 出现：`employee_isolation_root`, `legacy_agent_workspace`, `host_skill_risk`, `canvas_risk`, `managed_space_mirror`, `registered_store_binding`。未出现 `data_space_flat_workspace` / `agent_assets_user`（环境无对应根，不视为闸门失败；对照样本见 workspace-isolation-20260810-001）。

## 9. 证据索引

| evidence-id                      | 文件                                                               |
| -------------------------------- | ------------------------------------------------------------------ |
| workspace-inventory-phase1-001   | `docs/design/evidence/workspace-inventory-phase1-001.summary.json` |
| workspace-isolation-20260810-001 | 对照样本（生产脱敏，非本机）                                       |
