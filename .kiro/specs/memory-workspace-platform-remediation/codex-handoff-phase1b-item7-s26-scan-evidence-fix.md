# Phase 1B Item 7：S26 Semantic Gate evidence-only 修正

这是一次**仅证据（evidence-only）**修正，收敛 Batch 23 / S26 Semantic Gate CR（#677）落地后遗留的一处**过期快照**：retirement scan 账本把 `retiredThisChange` 记为 `1`，而真实代码扫描与 CR packet 都是 `0`。本 PR **只**对齐这处数值并补一条一致性测试，**不改任何代码、不退休、不实现 provision、不解锁、不 LIVE**。

- 任务：`kiro-data-governance-phase1b-item7-s26-scan-evidence-fix`，owner=`kiro-data-governance`
- 基线：`origin/main` `c014b0247e`（含 #677 CR 及后续合并）

## 为什么这是诚实修正（非硬改数字）

- `docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.test.mjs:27` 断言 `measured.retiredThisChange === 0`——即真实代码扫描（`buildInventory()`）算出的当前变更退休数就是 **0**。
- S26 CR packet `memory-workspace-phase1b-item7-batch23-s26-semantic-gate.json` 也是 `retiredThisChange: 0`（这是一次零退休的变更请求）。
- 因此 `retirement-scan.json` 里的 `1` 是 S25 批次遗留的**过期快照**，与真实扫描 + CR 都不一致。改为 `0` 是让快照对齐真实代码输出，符合"以真实扫描为准、不伪造"的治理原则。

## 交付物（本任务授权的 3 个路径）

- `docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json`：仅 `retiredThisChange` `1`→`0`；其余字节不变。
- `docs/design/evidence/memory-workspace-phase1b-item7-s26-scan-packet-consistency.test.mjs`（新，node:test）：断言 scan 与 CR packet 在 `retiredThisChange(=0)`、`remaining(=12)`、`liveWriteWatchIndex(=12)` 三项**完全一致**，并复核 scan 内部不变量（`sites.length===remaining===liveWriteWatchIndex===12`、`frozenWriteWatchIndex===38`、`item7===not-met` 等）。
- 本 handoff。

> 注：`tasks.md` 不在本任务授权路径内，故任务记录写入本 handoff，不改 `tasks.md`。

## 修正后权威状态（保持不变）

- `retiredThisChange=0`（对齐真实扫描 + CR）
- `remaining=12`、`sites.length=12`、`liveWriteWatchIndex=12`、`frozenWriteWatchIndex=38`
- `item7=not-met`、`phase1bExecutionBlocked=true`、`deployAuthorized=false`、`i3Executed=false`、`live=false`
- S26/S27：not-retired（`steward-write.ts:279/280` 未改，仍在 scan）

## 本 PR 明确不做

- 不改 `src/gateway/workspace-resolver/steward-write.ts`（或任何生产代码）
- 不实现 `provisionEmployeeStewardCutoverWorkspace`
- 不退休 S26/S27、不修改 retirement scan 的 `sites[]`/`remaining`/`liveWriteWatchIndex`
- 不执行 I3、不解锁 Phase 1B、不写生产 Catalog、不启用 schema v2 生产写、不切 LIVE
- 不改 Phase 0 冻结基线

## 验证

- `node --test docs/design/evidence/memory-workspace-phase1b-item7-s26-scan-packet-consistency.test.mjs`
- `node --test docs/design/evidence/memory-workspace-phase1b-item7-batch23-s26-semantic-gate.test.mjs`（CR 门禁仍绿）
- `node --test docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.test.mjs`（实测 `measured.retiredThisChange===0` 仍绿，改 JSON 不影响 measured）
- `git diff --check`
- `pnpm loom lint`
- `bun scripts/agent-attribution.ts --fail-on-unattributed --fail-on-conflict`

## 下一任务（合入并独立验收后，另行进行）

`provisionEmployeeStewardCutoverWorkspace 设计合同与只读验证`——仍**不得**直接实现生产写入；须先通过独立架构 + 数据治理审查。

— kiro-data-governance
