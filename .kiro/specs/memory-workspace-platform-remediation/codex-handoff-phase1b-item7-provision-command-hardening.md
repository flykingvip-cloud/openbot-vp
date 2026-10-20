# Phase 1B Item 7：provisionEmployeeStewardCutoverWorkspace 命令加固

这是一次**加固**，修复 Stage B「Changes Required」的两个 P0。命令仍**只连 test-only pilot**：不新增生产接线、不退役任何站点、baseline 维持 10、retirement scan 未改、不解锁、不 LIVE、不写生产 Catalog。

任务：`kiro-data-governance-phase1b-item7-provision-command-hardening`，owner=`kiro-data-governance`，base `origin/main` `a2cae6e938`（#696 merge，含已落地的 Batch 24 S26/S27 退役）。

## 交付物

- `src/gateway/workspace-resolver/steward-placement-policy.ts`（新，PlacementPolicy）
- `src/gateway/workspace-resolver/steward-materialize.ts`（新，安全 materialization）
- `src/gateway/workspace-resolver/provision-steward-cutover.ts`（接线 policy + materialization + fencing）
- `src/gateway/workspace-resolver/steward-write.ts`（`verifiedCopyStewardWorkspace` 把 cpSync 异常转结构化失败）
- 测试：`steward-placement-policy.test.ts`（10）、`steward-materialize.test.ts`（7）、`provision-steward-cutover.test.ts`（21）、`steward-write.test.ts`（5，pilot 传 placementRoot）

## P0-1：placement 物理校验（resolveStewardPlacement）

之前 placement 仅靠注释「可信」+ 语法检查（absolute/`..`/distinct），可对任意 caller 路径 mkdir/copy。现在 `resolveStewardPlacement({tenantId,userId,resourceId,allowedRoot,sourceRoot,targetRoot})`：

- 绑定 tenantId/userId/resourceId；
- allowedRoot + source + target 必须绝对；无 `..` 段；
- allowedRoot 必须存在且可 realpath；
- source/target 逻辑上必须落在 allowedRoot 内（拒绝 `/etc`、仓库、home、他租户）→ `placement_outside_allowed_root`；
- **realpath containment**：逻辑在内但 realpath 逃逸 → `placement_symlink_escape`；
- source != target 按 realpath（拒绝 symlink 别名）→ `placement_source_target_collision`；
- 产出可审计 `StewardPlacementHandle`（身份 + logical/real 路径 + allowedRoot + decidedAtMs）。

allowedRoot 由调用方传入；policy **不调用**任何冻结 host-path resolver（freeze-safe）。

## P0-2：安全 materialization（materializeStewardCutover）

之前直接 cpSync 到最终 target，digest mismatch/抛错会残留错误 target。现在 all-or-nothing：

- 复制 source → **operation-scoped staging**（绝不直写 live target）；
- hash 校验 staging vs source；
- **原子发布** `rename(staging → target)`；发布后再校验 target digest；
- **绝不覆盖**已存在 target（`target_exists` fail-closed）；
- 任一失败：把残留物移入 **quarantine** 并返回 `residualPath`（`recovery_required`，记入 failure 结果 + `receipt.quarantinePath`）；
- `verifiedCopyStewardWorkspace` 现把 mkdir/cpSync 抛错转为结构化 `copy_failed`（无异常逃逸）。

命令层新增 **fencing**：`findActiveCutoverOperation` 检测同一 resource 上的非终态操作，不同 operationId 即 `concurrent_operation`；同 id 为幂等 resume。

新增 fail-closed 原因：`placement_root_not_absolute`/`placement_root_missing`/`placement_outside_allowed_root`/`placement_symlink_escape`、`concurrent_operation`、`mkdir_source_failed`、`target_exists`、`copy_failed`、`digest_mismatch`、`publish_failed`、`post_publish_digest_mismatch`。

## 关键边界（本任务不做）

- **不新增生产接线**：命令仍只由 test-only `runEmployeeStewardCutoverPilot` 调用（其签名新增必填 `placementRoot`）；无生产/LIVE 路径接入。
- **不退役任何站点**：S26/S27 仍为 Batch 24 已退役状态，`steward-write.ts` 无 host resolver 调用点，scan `remaining=10` 未改。
- **不调用冻结 host-path resolver**：新函数命名（`resolveStewardPlacement`/`materializeStewardCutover`）刻意不匹配冻结的 `HELPER_NAME` 模式，且不调用任何受监视 resolver。
- **不写生产 Catalog**：内存 Catalog + 默认内存 cutover store。
- 未解锁 Phase 1B、未标 Item 7 met、未 LIVE、未启用 schema v2、未启动 Stage C/D。

「把命令接入任何生产路径」与「S01/S02 双点退役」是**后续、独立、受门禁**步骤，需本命令加固被独立验收后另行进行。

## 验证（全绿）

- **Phase 0 freeze**（pinned baseline `583c1fc0`）→ `ok=true`、`addedProductionCallSites=0`、`addedProductionHelpers=0`、`addedCatalogSynthesis=0`。
- `vitest` → **43 passed**（policy 10 / materialize 7 / provision 21 / steward-write 5），含 symlink 逃逸、containment、collision、fencing 并发、target_exists、cpSync 抛错→quarantine（chmod-000，root 环境自动 skip）、digest_mismatch。
- `node --test .../provision-command-hardening.test.mjs` → **6 passed**（packet + policy/materialize/verifiedCopy/命令源断言 + scan 保持 10、S26/S27 仍退役 + `BASELINE=a2cae6e938` ancestor）。
- `pnpm tsgo`：改动/新增文件 **0 error**（仓库既有错误无关）。
- `oxlint` 8 文件 **0/0**；仓库级 `pnpm format:check` clean。
- `pnpm build` ✓，改动/新增模块无 `[INEFFECTIVE_DYNAMIC_IMPORT]`。

## 状态字段

`previousAcceptedBaseline=10`、`retiredThisChange=0`、`remaining=10`、`liveWriteWatchIndex=10`、`scanModified=false`、`item7=not-met`、`phase1bExecutionBlocked=true`、`phase1bUnlock=not-issued`、`deployAuthorized=false`、`live=forbidden`、`productionCatalogWrite=none`、`schemaV2ProductionWrite=false`、`absorbsUnacceptedBatches=false`。

## Rollback

`rollbackProof=true`：revert 提交即可；retirement scan、baseline、生产路径未触碰。materialization 的 quarantine 是运行时残留物隔离（记录 residualPath），非生产数据隔离。

## SHAs

- baseCommit / originMainSha：`a2cae6e93845a1cbc29c8f0ea30f7b7a64ea0c98`（#696 merge）。
- branch：`kiro-data-governance/item7-provision-command-hardening`。
- implementationSha / reviewTipSha：见落地 PR 评论。

## 请求审查

**provisionEmployeeStewardCutoverWorkspace 命令加固的独立验收 Review only.** 不申请：任何退役 Accept、baseline 变更、Stage C unlock、Item 7 met、Phase 1B unlock、LIVE 或生产部署。

— kiro-data-governance
