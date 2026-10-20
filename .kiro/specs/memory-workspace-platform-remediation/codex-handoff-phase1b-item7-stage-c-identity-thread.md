# Phase 1B Item 7 Stage C — Identity Thread + Managed Fail-Closed Wiring (scope A)

这是 **Item 7 Stage C 的可信身份线程接入 + managed fail-closed 接线（范围 A）**。在 `getMemorySearchManager` 分发处**一次性**解析服务端构造的结构化 `MemoryIndexAccessContext`；managed_enterprise 经已验收的 `resolveMemoryIndexWorkspaceHandle`（#687）fail-closed，并**仅**经 CogniWeave canonical handle（`createFromHandle`）绑定；非 cogniweave 后端的 managed 在分发处直接 fail-closed（`managed_backend_not_cogniweave`）。五个 op=index 定位点保持**字节冻结（未改）**，personal_local 保留 legacy 兼容路径，retirement scan / freeze 基线**未改**，**生产零退役**。仅申请技术切片审查。

任务：`kiro-data-governance-phase1b-item7-stage-c-identity-thread`，owner/agent = `kiro-data-governance`，ide = `kiro`。
worktree：`/Users/daniel/AI项目/openbot-item7-stage-c-identity-thread`，分支 `kiro-data-governance/item7-stage-c-identity-thread`，base `origin/main` `a54bf8e145`。

| Field                        | Value                                      |
| ---------------------------- | ------------------------------------------ |
| status                       | stage-c-identity-thread-managed-wiring     |
| runtimeBehaviorChanged       | true                                       |
| managedEnterpriseFailClosed  | true                                       |
| personalLocalLegacyPreserved | true                                       |
| productionRetirement         | false                                      |
| retiredThisChange            | 0                                          |
| remaining                    | 10 (canonical, post Batch 24 merge)        |
| liveWriteWatchIndex          | 10                                         |
| frozenWriteWatchIndex        | 38                                         |
| canonicalLedgerUpdated       | false                                      |
| scanModified                 | false                                      |
| freezeGreen                  | true (addedProductionCallSites=[])         |
| frozenFilesUntouched         | true                                       |
| stageCAccepted               | false                                      |
| item7                        | not-met                                    |
| phase1bExecutionBlocked      | true                                       |
| phase1bUnlock                | not-issued                                 |
| deployAuthorized             | false                                      |
| live                         | forbidden                                  |
| productionCatalogWrite       | none                                       |
| schemaV2ProductionWrite      | false                                      |
| rollbackProof                | true                                       |
| quarantineProof              | true                                       |
| origin/main (base)           | `a54bf8e145d2e5794b97f1720ee5093ccd36a181` |

## 〇、冻结约束与范围收敛（先读）

Phase 0 freeze（`docs/design/evidence/memory-workspace-phase0-inventory.mjs`）的 `freezeKey` 为
`pathId|symbol|file|line|op|profile`，**含行号**，基线 blob 由 CODEOWNERS 保护、在 workflow 里 pin 死。任何对
`backend-config.ts` / `manager.ts` / `qmd-manager.ts` 的就地改动（新 import / 新参数 / 包裹调用）都会**移动**这些行锚定的
`resolveAgentWorkspaceDir`(op=index) 调用（417/444/152/196 → 429/460/162/210），从而触发 freeze，且基线不可改、退役不在范围、
就地保行又扛不住 oxfmt。**故本切片把 managed 接线收敛到 `search-manager.ts` + 新模块 + CogniWeave `createFromHandle`**，
三个冻结文件**回退为与 origin/main 字节一致**；managed 在非 cogniweave 后端 fail-closed，其本地根隔离**延后到这些调用点的退役**
（退役时经受保护流程更新 pin 基线）。本地 `--baseline-blob` freeze 已绿：`addedProductionCallSites=[]`。

## 一、结构化身份模型（§三）

`src/memory/memory-index-access-context.ts` 定义 `MemoryIndexAccessContext`（按 securityProfile 判别）：

- **只能服务端构造**：`personalLocalAccessContext` / `managedAccessContext` / `deriveManagedAccessContextFromGovernance`。
- **frozen + branded**（`Object.freeze` + WeakSet）：wire 上的 tenantId/userId/resourceId/agentAssetId 不可覆盖；`isMemoryIndexAccessContext` 拒绝伪造对象。
- **可审计 provenance**：记录 source + ownerKind。
- **managed_enterprise** 必须携带 tenantId + userId + actor（actor.tenant/user 必须匹配）+ ownership grant/proof + 注入的 canonical resolver port；`deriveManagedAccessContextFromGovernance`：user-owned 从 proof.owner.userId 取 userId；position/group 需显式 authenticatedUserId，否则 `managed_membership_missing`；**system-owned proof 被拒**（`managed_grant_denied`，禁止伪造 operator/system auth）。
- **personal_local** 仅 profile 标记；判别联合类型结构上保证它**绝不**是 managed 的 fallback。
- **不 import gateway**：canonical resolver 以 port 注入（`CanonicalMemoryWorkspaceResolver`）。
- 已移除 `applyManagedIndexIsolation`（本切片不再就地隔离冻结文件的本地根，见 §〇）。

## 二、身份管道（§四）—— 分发处一次性解析 + managed 仅经 CogniWeave handle

`getMemorySearchManager({..., accessContext?})` 在分发前**一次性**解析：

- managed 且后端非 `cogniweave` → 立即 `return {manager:null, error:"managed_backend_not_cogniweave"}`（**不调用 resolver**、不触碰冻结的本地根）。
- managed 且后端为 `cogniweave` → `resolveMemoryIndexAccess`（走 `resolveMemoryIndexWorkspaceHandle`）；失败即 `return {manager:null,error}`（**零副作用**）；成功 → `CogniWeaveMemoryManager.createFromHandle(canonical handle)` 绑定；CogniWeave 实例 cache key 经 `buildCogniWeaveCacheKey` 按 `managed:<tenant>:<resource>` + governance 指纹 + epoch 隔离。
- 缺失 / personal_local → 走**未改动**的 legacy 路径（`resolveMemoryBackendConfig` / `MemoryIndexManager.get` / `QmdMemoryManager.create` 保持 `resolveAgentWorkspaceDir`）。

`accessContext` 为可选/附加参数，不破坏既有调用者。**未**改动 `backend-config.ts` / `manager.ts` / `qmd-manager.ts`。

## 三、五点身份来源 + managed/personal 分支 + fail-closed（§五、§六、§十一）

| 标签 | ledgerId | 文件:行                                | 本文件被本切片改动 | managed 分支                                                             | personal_local 分支                                        | legacy 调用保留 |
| ---- | -------- | -------------------------------------- | ------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------- |
| C1   | S30      | `src/memory/backend-config.ts:417`     | 否（冻结）         | 不在此线程；managed(cogniweave) 经 `createFromHandle`，此点仅 personal   | legacy `resolveAgentWorkspaceDir`（未改）                  | 是              |
| C2   | S31      | `src/memory/backend-config.ts:444`     | 否（冻结）         | managed(qmd) 在分发处 fail-closed；本地根隔离延后到退役                  | legacy `resolveAgentWorkspaceDir`（未改）                  | 是              |
| C3   | S32      | `src/memory/cogniweave-manager.ts:554` | 否（复用既有）     | managed → `getMemorySearchManager` 路由到既有 `createFromHandle(handle)` | `create`；legacy `resolveAgentWorkspaceDir`（行 554 保留） | 是              |
| C4   | S36      | `src/memory/manager.ts:152`            | 否（冻结）         | managed(builtin) 在分发处 fail-closed；本地根/缓存分区延后到退役         | legacy `resolveAgentWorkspaceDir`（未改）                  | 是              |
| C5   | S37      | `src/memory/qmd-manager.ts:196`        | 否（冻结）         | managed(qmd) 在分发处 fail-closed；本地根隔离延后到退役                  | legacy `resolveAgentWorkspaceDir`（未改）                  | 是              |

**fail-closed 结构化原因**（reject 路径零 scan/read/index-write/rebuild/fallback/mkdir/Catalog-write/config-change）：`managed_backend_not_cogniweave` / `managed_identity_required` / `managed_catalog_miss` / `managed_catalog_ambiguous` / `managed_tenant_mismatch` / `managed_grant_denied` / `managed_membership_missing` / `managed_workspace_not_indexable` / `managed_background_deferred`。managed **禁止** `resolveAgentWorkspaceDir` / host / cwd / 空串 / 默认 workspace fallback。

## 四、缓存与实例隔离（§七）

- managed（CogniWeave）cache key 经 `buildCogniWeaveCacheKey` 前置 `memoryIndexAccessCacheComponent`（`managed:<tenantId>:<resourceId>` | `personal_local`），叠加既有 `dataRoot/storePath/governance 指纹/epoch`。
- 同名 agent 跨租户 → 不同 key / 不同实例；resourceId 变化 → key 变化 → 不复用；personal 与 managed 分量永不碰撞。
- revoke/tombstone → key 含 `getMemoryGovernanceEpoch()`，epoch bump 使 key 失效；tombstoned/revoked handle 在重解析时 `managed_workspace_not_indexable` fail-closed（运行中任务 halt/quarantine）。
- 缺身份请求走 personal_local 分量，命中不了合法租户缓存。
- 注：qmd/builtin 的 managed 实例隔离随其本地根隔离一并延后到退役（当前 managed 在这些后端 fail-closed，不产生共享实例）。

## 五、background defer（§五）

managed 缺可信身份/binding 时 `getMemorySearchManager` 返回结构化 `{manager:null,error}`（**从不 throw**），与既有 `startGatewayMemoryBackend` managed-defer 一致；Gateway 不因单个 managed index 缺 binding 崩溃。

## 六、边界说明（诚实）

- **本地索引存储保留（dark handle）**：canonical `canonicalObjectKey` 是 object-store key，不是本地 FS 路径；managed(cogniweave) 经 canonical handle 授权并绑定（`createFromHandle`）。object-store 后端存储属后续独立工作。
- **managed 接线为 opt-in**：仅当线程了 managed `MemoryIndexAccessContext` 才启用；既有 governance-only 调用者保持现状（无回归）。将 gateway RPC 入口改为构造 managed access context 属独立后续（未改 gateway 入口）。
- **freeze 收敛（见 §〇）**：qmd/builtin/backend-config 三个冻结文件字节未改；managed 在这些后端 fail-closed，其就地租户/资源隔离**延后到退役**。这是为遵守 CODEOWNERS pin 的行锚定 freeze 而做的诚实收敛，非能力已完成。

## 七、测试结果（§九、§十一）

- `src/memory/memory-index-access-context.test.ts`（vitest）：**26 passed**（builders / derive user·seat·group·system / resolve managed 合法 + catalog miss·ambiguous·跨租户·membership·tombstone/revoke / cache 分量：跨租户 + resourceId 变化 + personal↔managed 不碰撞）。
- `src/memory/item7-stage-c-identity-thread.test.ts`（vitest）：**7 passed**（getMemorySearchManager managed(cogniweave) fail-closed catalog-miss/ambiguous/跨租户/tombstone；不 throw；personal_local 不触发 managed；身份被线程到 resolver；**managed 非 cogniweave 后端 fail-closed 且不调用 resolver**）。
- `docs/design/evidence/memory-workspace-phase1b-item7-stage-c-identity-thread.test.mjs`（node:test）：**3 passed**（§十 计数与 canonical retirement scan 一致 + 五点仍在册 op=index + 记忆层不 import gateway + is-ancestor a54bf8e145）。
- **freeze（关键）**：`node --import tsx docs/design/evidence/memory-workspace-phase0-inventory.mjs --mode freeze --baseline-blob 583c1fc0…` → `ok:true`，`addedProductionCallSites=[]`，`addedProductionHelpers=[]`。
- 回归：Batch 22 / S25 `steward-write-item7-s25.test.ts`（8）；Stage C #687 `memory-index-workspace-handle.test.ts`（106）；既有记忆测试（search-manager.governance-cache / backend-config / cogniweave-manager）通过。
  - 注：`manager.get-concurrency.test.ts` 在本地 worktree 环境失败，且**在 pristine base 上同样失败**（`resolveDataRoot` 本地可解析 → recall-deny 包装 → Set 12）；属**既有环境敏感**，非本切片引入，clean CI 通过。
- tsgo：本切片文件干净（其余 102 项为 origin/main 既有 ui/steward 报错，与本切片无关）。oxlint 0 error；oxfmt 通过。

## 八、SHAs（§十一）

- originMainSha：`a54bf8e145d2e5794b97f1720ee5093ccd36a181`（push 前再 `git fetch origin` 复核 forward-only）。
- branch：`kiro-data-governance/item7-stage-c-identity-thread`。
- implementationSha / reviewTipSha：见落地 PR 评论（handoff 属提交内容）。

## 九、attribution / clean tree（§十一）

- Loom：task `kiro-data-governance-phase1b-item7-stage-c-identity-thread`，owner/agent `kiro-data-governance`，ide `kiro`，session 已注册。
- 本切片实际改动文件：`src/memory/memory-index-access-context.ts`（新）+ 其测试 + 集成测试 + `src/memory/search-manager.ts` + evidence json + test + 本 handoff + `.loom/registry.yaml`。**三个冻结文件（backend-config/manager/qmd-manager）字节未改**（已回退），cogniweave-manager.ts 未改。
- `bun scripts/agent-attribution.ts` 期望：无 CONFLICT / 无 UNATTRIBUTED。
- 提交 trailers：`Task: kiro-data-governance-phase1b-item7-stage-c-identity-thread` / `Agent: kiro-data-governance`。

## 十、未做 / 禁止（§十二）

- 未删除五个 legacy 调用；未改 canonical scan；`remaining` 与 canonical 一致（合并 Batch 24 S26/S27 退役后为 10；本切片不改动它，未写 7/0）；冻结基线保持 38；**未改 Phase 0 freeze 基线**。
- **qmd/builtin 本地根的就地 managed 隔离未做**（延后到退役；当前 managed 在这些后端 fail-closed）。
- 未处理 Stage B（S01/S02/S26/S27）；未处理 Stage D（`manager-sync-ops.ts` S33/S34/S35）；未改 canonical unlock decision。
- 未启用生产 Catalog/schema v2；未 unlock Phase 1B；无 LIVE / 生产部署；未部署 side branch；未宣称 Stage C Accepted。

## 请求审查

**Item 7 Stage C Identity Thread + Managed Wiring Review only.**
