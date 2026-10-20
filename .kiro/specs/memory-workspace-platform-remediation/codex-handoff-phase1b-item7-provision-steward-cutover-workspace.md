# Phase 1B Item 7：实现 provisionEmployeeStewardCutoverWorkspace（供给命令）

这是一次**实现**，落地 Batch 23 / S26 Semantic Gate CR（#677）建议的窄领域供给命令。**只新增命令 + 单元测试**：不接线 pilot、不退役 S26/S27、不改 retirement scan、baseline 维持 12、不解锁、不 LIVE、不写生产 Catalog。

任务：`kiro-data-governance-phase1b-item7-provision-steward-cutover-workspace`，owner=`kiro-data-governance`，base `origin/main` `a327d71819`（含 #677）。

## 交付物

- `src/gateway/workspace-resolver/provision-steward-cutover.ts`（新命令，静态 import，无 dynamic import）
- `src/gateway/workspace-resolver/provision-steward-cutover.test.ts`（11 例 vitest）

## §六 十点契约 → 实现映射

`provisionEmployeeStewardCutoverWorkspace(request)` 按 Catalog-first、fail-closed 顺序执行：

1. 接收服务端可信 `tenantContext`/`actor`/`ownershipProof`，任一缺失或不一致即 fail-closed（`missing_tenant_context`/`missing_actor`/`missing_ownership_proof`/`actor_owner_mismatch`/`ownership_proof_mismatch`）。
2. 由可信 scope 经 `buildWorkspaceResourceId` 生成稳定 `resourceId`。
3. source/target 根为调用方传入的**可信 placement**；命令**不调用** host-path resolver（`resolveEmployeeStewardSourceWorkspaceDir` / `resolveEmployeeStewardTargetWorkspaceDir`），因此不新增 Phase 0 冻结调用点、无隐式 host fallback；缺失即 fail-closed `missing_placement`。
4. 生成唯一 source `canonical/active` binding。
5. 生成唯一 target `compatibility/read_only` binding。
6. 生成 Catalog receipt（`StewardCutoverProvisionReceipt`）。
7. 生成 `operationId` + fencing marker（`createWorkspaceCutoverOperation`，state=`inventoried`），写入 store。
8. **Catalog 成功后**才 mkdir/copy（`verifiedCopyStewardWorkspace`），且仅当 `materialize=true`。
9. 任一步失败：返回 `recovery: "recovery_required"` + `halted: true`，并把 operation 置 `failed` 以保留 fencing。
10. 禁止无 Catalog 目录、半创建、双写、隐式 host fallback。

唯一性由 `assertSingleWritableCanonicalBinding`（拒绝 `dual_writable_canonical`）+ 单一 `compatibility/read_only` target 校验强制。

## 关键边界（本任务不做）

- **不接线** `runEmployeeStewardCutoverPilot` 使用该命令；pilot 代码未改。
- **不退役** S26/S27；`steward-write.ts:279/280` 未改，两点仍在 scan（`remaining=12`）。
- **不调用冻结的 host-path resolver**：placement（source/target 根）由调用方传入；命令不调用 `resolveEmployeeStewardSourceWorkspaceDir` / `resolveEmployeeStewardTargetWorkspaceDir`，故 Phase 0 freeze 扫描 `addedProductionCallSites=0`、无隐式 host fallback。
- **不写生产 Catalog**：命令用内存 Catalog + （默认）内存 cutover store，返回 catalog/receipt/operation；不持久化到生产 SoT。
- mkdir/copy 仅在 `materialize=true` 时执行，且作用于传入的 `stateDir`（测试用临时目录）。
- 未解锁 Phase 1B、未标 Item 7 met、未 LIVE、未启用 schema v2、未启动 Stage C/D。

「接线 pilot → 用 canonical source handle / controlled target handle」与「退役 S26/S27」是**后续、独立、受门禁**的步骤，需在本命令被独立验收后另行进行。

## 验证

- **Phase 0 freeze 扫描**（pinned baseline `583c1fc0`）→ `ok=true`、`addedProductionCallSites=0`、`addedProductionHelpers=0`（命令不调用冻结的 host-path resolver，不新增受监视调用点）。
- `vitest run provision-steward-cutover.test.ts` → **12 passed**（dry/materialize、fail-closed 各分支含 `missing_placement`、唯一性、Catalog-before-fs 顺序、fencing、placement 为可信输入）。
- `node --test .../provision-steward-cutover-workspace.test.mjs` → **3 passed**（packet 状态 + scan 保持 12 且 S26/S27 在册 + 命令导出/无 dynamic import/不调用冻结 resolver + `BASELINE=a327d71819` ancestor）。
- `pnpm tsgo`：新模块/测试 **0 error**（仓库既有 102 处错误与本改动无关）。
- `oxlint` 2 文件 **0/0**；`oxfmt` clean。
- `pnpm build` ✓，新模块无 `[INEFFECTIVE_DYNAMIC_IMPORT]`、无 error（模块 0 个 dynamic import）。
- `steward-write.ts` 未修改；scan `remaining=12` 未改。

## 状态字段

`previousAcceptedBaseline=12`、`retiredThisChange=0`、`remaining=12`、`liveWriteWatchIndex=12`、`S26Retired=false`、`S27Retired=false`、`scanModified=false`、`item7=not-met`、`phase1bExecutionBlocked=true`、`phase1bUnlock=not-issued`、`deployAuthorized=false`、`live=forbidden`、`productionCatalogWrite=none`、`schemaV2ProductionWrite=false`、`absorbsUnacceptedBatches=false`。

## Rollback

`rollbackProof=true`：删除两个新文件 / revert 提交即可；无既有运行路径、scan、S26/S27 调用点被触碰。

## SHAs

- originMainSha：`a327d71819b16d0d33e94376cad45ef1d45ec158`（#677）。
- branch：`kiro-data-governance/item7-provision-steward-cutover-workspace`。
- implementationSha / reviewTipSha：见落地 PR 评论。

## 请求审查

**provisionEmployeeStewardCutoverWorkspace 命令实现的独立验收 Review only.** 不申请：S26/S27 退役或 Accept、baseline 递减、Stage C unlock、Item 7 met、Phase 1B unlock、LIVE 或生产部署。
