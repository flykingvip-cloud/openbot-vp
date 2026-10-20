# Phase 1B Item 7：接线 pilot 设计契约（design-only handoff）

**设计/只读评估**，不含实现。定义 `runEmployeeStewardCutoverPilot` 如何接入已验收的 `provisionEmployeeStewardCutoverWorkspace`（#679，审查 accepted），并诚实再评估 S26/S27 现在能否退休。

- 任务：`kiro-data-governance-phase1b-item7-wire-pilot-design`，owner=`kiro-data-governance`，issue #692
- 基线：`origin/main` `49f59c3375`

## 交付物（本任务授权的 3 个路径）

- `docs/design/evidence/memory-workspace-phase1b-item7-wire-pilot-design.md` —— 设计契约 + S26/S27 退休再评估 + 分阶段门禁
- `docs/design/evidence/memory-workspace-phase1b-item7-wire-pilot-design.test.mjs` —— 只读验证（5 例，node:test）
- 本 handoff

## 核心结论

1. **现在不能诚实退休 S26/S27**。原因：pilot 未接线 provision；无持久 Catalog SoT（provision 为内存）；placement 的权威来源未定（退休 S26/S27 要求 placement 来自 Catalog，而非主机 resolver `steward-write.ts:279/280`）。
2. **provision 把 placement 当可信输入**，本身不产生 placement——仅接线 pilot 不构成退休。
3. 诚实退休的前置是**持久 Catalog SoT**（本轮最大缺口），属独立 G2 子任务。

## 分阶段门禁（每阶段独立授权 + 独立验收；本轮仅 G1）

- **G1（本任务）**：设计契约 + 再评估 + 只读验证（不实现）
- **G2**：持久 Catalog SoT 设计+实现+审查（授权写入面，默认关闭）
- **G3**：pilot 接线实现（behind flag / 非生产，经 Locator 读、复用 provision fencing；不退休）
- **G4**：G3 独立实现审查
- **G5**：退休 S26（`remaining 12→11`）+ 独立验收
- **G6**：退休 S27（`remaining 11→10`）+ 独立验收
- Item 7 met / Phase 1B unlock / 生产 Catalog / LIVE 均在所有阶段 + 显式授权后才评估

## 本任务明确不做

不接线 pilot、不改任何代码（`steward-write.ts` / `provision-steward-cutover.ts` 未改）、不退休 S26/S27、不改 retirement scan、不写生产 Catalog、不启用 schema v2、不解锁 Phase 1B、不执行 I3、不部署/切 LIVE、不申请 Item 7 met。

## 锁定状态（保持不变）

`remaining=12`、`liveWriteWatchIndex=12`、`sites.length=12`、`frozenWriteWatchIndex=38`、S26/S27=not-retired、`item7=not-met`、`phase1bExecutionBlocked=true`、`deployAuthorized=false`、`i3Executed=false`、`live=false`。

## 验证

- `node --test docs/design/evidence/memory-workspace-phase1b-item7-wire-pilot-design.test.mjs`（5/5）
- `git diff --check`、`pnpm loom lint`、`bun scripts/agent-attribution.ts --fail-on-unattributed --fail-on-conflict`

## 下一步（合入 + 独立验收后，另行进行）

G2：持久 Catalog SoT 设计——需独立 Loom 任务 + 路径授权 + worktree，且不得在授权前写生产。

— kiro-data-governance
