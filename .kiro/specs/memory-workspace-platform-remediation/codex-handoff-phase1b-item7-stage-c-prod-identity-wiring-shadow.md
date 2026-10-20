# Phase 1B Item 7 Stage C — Production Identity Wiring (SHADOW)

Phase C（Stage C 生产身份接入准备）：新增一个**门控、只读的 SHADOW**,在具备服务端可信 `MemorySearchGovernance` 的入口评估"managed_enterprise canonical-handle 路径（Stage C #709）是否会成功解析",并记录指标（managed_success / managed_deny / managed_defer）。**不切生产**、不建 manager、不建目录、不写 Catalog、不删 legacy locator。依赖已落地的 #709。

任务:`kiro-data-governance-phase1b-item7-stage-c-prod-identity-wiring-shadow`,owner `kiro-data-governance`。

## 交付

- 新增 `src/gateway/item7-stage-c-identity-shadow.ts`:
  - `isStageCIdentityShadowEnabled(env)` — 由 `OPENBOT_ITEM7_STAGE_C_IDENTITY_SHADOW`(+ `OPENCLAW_*`)门控,**默认关**。
  - `evaluateStageCManagedIdentityShadow(...)` — 用 #709 `deriveManagedAccessContextFromGovernance`(注入 `resolveMemoryWorkspaceHandle` 作为 canonical 端口)构造 managed 上下文 → `resolveMemoryIndexAccess`（只读）→ 结构化结果 {outcome, reasonCode, managedLocator}。
  - `runStageCManagedIdentityShadowIfEnabled(...)` — 门控入口;关时 no-op(返回 null);开时永不向生产抛错(catch + 记录脱敏指标)。
- **live-entrypoint 接线推迟**：`src/agents/tools/memory-tool.ts` 是 codex-runtime-safety 拥有的共享热文件（agent-attribution CONFLICT），本 CR **不修改它**以避免跨 agent 热文件冲突。evaluator 已 ready-to-wire —— 后续在协调下（或随 Phase E cutover）在 `memory_search` 加一行门控 `void runStageCManagedIdentityShadowIfEnabled({ governance, agentId, cfg, authenticatedUserId })`（fire-and-forget、不影响其后 manager）。

## 为什么 freeze-safe（与 Phase A 的墙相反）

SHADOW **读取**既有 canonical 绑定(`resolveMemoryWorkspaceHandle` —— 是 replacement 符号,既非冻结 legacy resolver,也非 `SYNTHESIS_SYMBOL`),从不 **mint** 绑定。因此不新增 Phase 0 受监视调用点:trusted freeze `ok=true` / `addedProductionCallSites=[]` / `addedProductionHelpers=[]` / `addedCatalogSynthesis=[]`。（Phase A 撞墙正是因为在生产读路径 mint 绑定 = `addedCatalogSynthesis`。）

## 身份与语义

- 身份仅服务端可信:managed 上下文源自 `MemorySearchGovernance`(ownershipProof + tenantId);seat/group-owned proof 通过 `authenticatedUserId`(来自 `gatewayClientUser`)补充 acting user。**绝不**从 wire 取 tenantId/userId/resourceId。
- defer(非覆盖缺口):`managed_identity_required` / `managed_background_deferred` / `managed_membership_missing`。deny(真实拒绝):catalog miss / tenant mismatch / grant denied / workspace-not-indexable。跨租户 handle 被拒。

## SHADOW ONLY（不动 C1-C5,不宣称生产 placement）

五个 C1-C5 index 点(`backend-config.ts:417/444`、`cogniweave-manager.ts:554`、`manager.ts:152`、`qmd-manager.ts:196`)**仍走 legacy、仍留在 retirement scan**;物理 placement 标记 `legacy-local-shadow`;不宣称生产 placement 完成。真正切换 C1-C5（把 call-entry 身份 thread 进这些 constructor/config-time 点并翻到 canonical handle）是 **Phase E cutover**,不在本次。

## 验证

- tsgo 我方文件 0;oxlint 0/0;format:check clean;`pnpm build` 成功且无**新增** INEFFECTIVE_DYNAMIC_IMPORT(现存告警均与本改动无关)。
- vitest 新套件 9 passed;Stage C 回归(item7-stage-c-identity-thread + memory-index-access-context)33 passed。
- trusted freeze `ok=true` / added\*=[]。
- retirement scan **未改**(`remaining=10`、`liveWriteWatchIndex=10`、`frozenWriteWatchIndex=38`);`item7=not-met`。

## Posture（未变）

`unlock=not-issued`、`phase1bExecutionBlocked=true`、`deployAuthorized=false`、`live=forbidden`、`productionCatalogWrite=none`、`schemaV2ProductionWrite=false`;`retiredThisChange=0`;baseline 保持 10。产出为 Phase E cutover 的**可观测输入**,非 Item 7 进度。

## 请求审查

**仅请求 Stage C Production Identity Wiring (shadow) Review。** 不申请 C1-C5 退役、baseline 变更、生产切换、Item 7 met、Phase 1B unlock 或 LIVE。
