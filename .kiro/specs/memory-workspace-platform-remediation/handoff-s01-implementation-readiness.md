# S01 Implementation-Readiness Plan

> **本文件不是第二套 S01 规范。** 唯一设计 SoT 仍是
> `.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`（V1.6，`design-accepted-implementation-locked`）。
>
> - **状态**: `implementation-readiness-resubmitted`
> - **版本**: V1.8（关闭 IR1–IR4；消化 #825/#826 后仍为 `changes-required`）
> - **前次验收**: `changes-required`（#825 计划不足；#826 V1.7 仍不足）
> - **本切片**: 只修订 implementation-readiness 计划、evidence JSON 和测试。
> - **禁止**: 修改 `get-reply.ts` / `src/memory/**` / `src/gateway/workspace-resolver/**` / `src/gateway/data-governance/**` 生产代码；写生产 Catalog；改写 retirement scan；执行 I3；签发 Phase 1B unlock；`deployAuthorized=true`；LIVE。

**在 V1.8 双审通过前，不得开始生产实现。本包不自签 accepted。`selfAccepted=false`。`implementationGate=not-met`。**

## 0. IR1–IR4 整改对照

| ID  | 缺口                                                                         | V1.8 关闭方式                                                                                                                        |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| IR1 | 只按 principal / 路径找 workspace，无法锁定 builtin steward 对应的 workspace | §2 `targetIdentity`：TenantContext → slug → `agentAssetId` → Catalog `workspaceResourceId` → 唯一 canonical+active binding → locator |
| IR2 | flag off 恢复 helper，却可能已删 P5                                          | §5：Shadow 保持旧 helper + P5；Cutover 无 runtime helper fallback；回滚必须 revert + 恢复 scan                                       |
| IR3 | 计划 9/10 或把两计数强行绑死/同时改                                          | §7：两计数可不同，但当前仓库无独立 write-watch 定义，故不得计划 9/10；lander 不得改任一数值                                          |
| IR4 | 单次流程越过多个信任边界                                                     | §3：Stage A–E 各有独立 Loom task、paths、PR、evidence、reviewer、进出门禁                                                            |

废止 V1.7 中与本包冲突的表述：

- 不得按“该 principal 的唯一 canonical locator”授权
- 不得把观察期写成生产成功路径切换
- 不得把 flagOffRestoresHelperWithoutScanRewrite 设为允许
- 不得在无独立 write-watch 定义时计划 `remaining=9` 且 `liveWriteWatchIndex=10`，也不得由本包替 write-watch owner 把后者改成 9

## 1. Owner 与 Loom session

使用**现有** readiness Loom task。本切片不改 `.loom/registry.yaml`（路径/owner 未变；Stage A–E 的新 task 须先由 `kiro-loom` 注册，本包只列预留 id）。

| 角色                             | Agent                    | Loom task                                                                                      | Session                                                          | State     |
| -------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------- |
| Readiness packet owner（本切片） | `codex-architecture`     | `memory-workspace-platform-remediation:codex-architecture-s01-implementation-readiness`        | `s01-implementation-readiness-codex-architecture-20260830`       | `active`  |
| **唯一生产 owner**（实现未授权） | `cursor-data-governance` | `memory-workspace-platform-remediation:cursor-data-governance-s01-production-wiring`           | `s01-production-wiring-cursor-data-governance-reserved-20260830` | `blocked` |
| Design SoT owner（不改）         | `kiro-data-governance`   | `memory-workspace-platform-remediation:kiro-data-governance-s01-trusted-principal-handle-gate` | 既有                                                             | `active`  |
| Write-watch owner                | `cursor-data-governance` | 独立 write-watch receipt；`cursor-fable` 只拥有 Phase 0 `frozenWriteWatchIndex`                | 既有                                                             | 本包不改  |

规则：

- 保留全部历史 session 与 `ownerHistory`。
- **禁止**把 `get-reply.ts` 或生产 adapter 路径写入本 readiness task 的 `paths`。
- 现有 production-wiring task 保持 `blocked`，且 **不得**一次 claim 全部 future paths。
- Stage A–E 预留 task 见 §3；`kiro-loom` 批准前不得 `claim`。

## 2. IR1：稳定目标资源身份（targetIdentity）

当前主干只读观察（本包不得改）：

```
147  stewardException = employeeOwnerId && isBuiltinStewardAgent(agentId)
164        ? resolveEmployeeBuiltinStewardWorkspaceDir(employeeOwnerId)   // S01 / scan P5
165        : (resolveAgentWorkspaceDir(cfg, agentId) ?? DEFAULT_AGENT_WORKSPACE_DIR)  // P1，禁止改
181  scheduleItem7W4StewardHelperShadow({ ledgerId: "S01", catalogResourceId: null })
```

`targetIdentity` **不得为 null**。实现前必须写入 adapter 契约，字段如下：

| 字段                                   | 约束                                              |
| -------------------------------------- | ------------------------------------------------- |
| `tenantId`                             | 来自 Trusted TenantContext，不是 wire             |
| `employeeOwnerId`                      | 来自已验证会话 / PlatformAuth，不是 tool body     |
| `agentAssetId`                         | 权威 Registry 映射的唯一 steward asset            |
| `workspaceResourceId`                  | Data Governance Catalog 的 workspace `resourceId` |
| `expectedBindingRole`                  | `canonical`                                       |
| `expectedBindingState`                 | `active`                                          |
| `governanceVersion` / `contentVersion` | 必须与 Catalog 当前版本一致                       |
| `fencingToken` 或等价 fencing          | stale 必须拒绝                                    |

权威映射链（顺序固定，缺一即 fail-closed）：

```
Trusted TenantContext
  → builtin steward agentId/slug（仅 tenant 内 query）
  → authoritative agentAssetId
  → Data Governance Catalog workspace resourceId
  → unique canonical + active binding
  → authorized locator
```

`agentId` **只能**作为 tenant 内 slug/query。禁止把它当作 `workspaceResourceId` 或 `agentAssetId`。

禁止：

- 按 principal 取“任意唯一 workspace”
- 按 requested path / host / cwd 反推 workspace 身份
- Catalog miss 时现场创建 Catalog 条目
- host / cwd / helper fallback 充当身份
- 把 CogniWeave Memory Asset `resourceId` 当成 `workspaceResourceId`

缺失、多值、租户不一致、治理/内容版本不一致、stale fencing → fail-closed，不写 Catalog。

Handle `workspaceResourceId` 与 Memory Asset `resourceId` 独立。不得新增第二套 `MemoryWorkspaceHandle` 生产入口。

## 3. IR4：Stage A–E（禁止一次跨越全部信任边界）

每一 Stage **必须**有：独立 Loom task/owner、精确 paths、独立 PR、独立 evidence、独立 reviewer decision、明确进入/退出门禁。缺验收不得进入下一 Stage。本包不注册这些 task。

### Stage A — 生产 adapter 与身份端口

| 项        | 值                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| 预留 Loom | `memory-workspace-platform-remediation:cursor-data-governance-s01-stage-a-adapter`                                    |
| owner     | `cursor-data-governance`                                                                                              |
| paths     | `src/gateway/data-governance/s01-steward-workspace-identity.ts`、`.test.ts`、`s01-authorized-tool-cwd.ts`、`.test.ts` |
| 进入      | V1.8 双审 `accepted`；kiro-loom 已注册且未 CONFLICT                                                                   |
| 退出      | adapter/issuer/membership/Catalog 只读 resolver 齐；独立安全/治理验收 sidecar `accepted`                              |
| 禁止      | 修改 `get-reply.ts`；写 Catalog；改 scan                                                                              |

交付：生产 adapter；PlatformAuth verified-session issuer；membership SoT port；Catalog 只读 `targetIdentity` resolver。`src/` 仍不引用非生产 contract 作为生产入口。

### Stage B — Shadow 接线

| 项        | 值                                                                                            |
| --------- | --------------------------------------------------------------------------------------------- |
| 预留 Loom | `memory-workspace-platform-remediation:cursor-data-governance-s01-stage-b-shadow`             |
| owner     | `cursor-data-governance`                                                                      |
| paths     | `src/auto-reply/reply/get-reply.ts`（仅无副作用 shadow）、`get-reply-s01-steward-cwd.test.ts` |
| 进入      | Stage A 及 A 安全/治理验收 `accepted`                                                         |
| 退出      | 独立 canary/shadow 验收；用户可见 cwd 仍来自旧 helper                                         |
| 禁止      | 改变用户行为；删 P5；改 remaining / liveWriteWatchIndex；声称 S01 retired                     |

`get-reply` 只增加无副作用 shadow 对比。旧 helper **仍决定**生产 cwd。收集 identity match、Catalog miss、tenant mismatch、fencing stale。scan 保持 10/10。P5 必须留在 scan。不得签发 Item 7 / Phase 1B / LIVE unlock。

### Stage C — Cutover 准备

| 项        | 值                                                                                      |
| --------- | --------------------------------------------------------------------------------------- |
| 预留 Loom | `memory-workspace-platform-remediation:cursor-data-governance-s01-stage-c-cutover-prep` |
| owner     | `cursor-data-governance`                                                                |
| paths     | 只读 evidence / 回滚演练记录；**不**改 `get-reply.ts` 成功路径                          |
| 进入      | Stage B reviewer `accepted` + shadow receipts                                           |
| 退出      | 目标 `workspaceResourceId` 精确映射已核；回滚演练已记录；cutover flag 默认 off          |
| 禁止      | 退休 P5；改 scan；打开生产成功路径                                                      |

### Stage D — 受控 Cutover

| 项        | 值                                                                                 |
| --------- | ---------------------------------------------------------------------------------- |
| 预留 Loom | `memory-workspace-platform-remediation:cursor-data-governance-s01-stage-d-cutover` |
| owner     | `cursor-data-governance`                                                           |
| paths     | **仅** `src/auto-reply/reply/get-reply.ts` 第 164 行                               |
| 进入      | Stage C `accepted`；shadow/canary reviewer `accepted`                              |
| 退出      | 成功路径使用受授权 Handle locator；失败 fail-closed；无 helper fallback            |
| 禁止      | 修改 P1 / 第 165 行；同一 PR 改 canonical scan；flag off 静默恢复 helper           |

### Stage E — 独立退休验收

| 项        | 值                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| 预留 Loom | `memory-workspace-platform-remediation:cursor-data-governance-s01-stage-e-retirement-scan`                       |
| owner     | `cursor-data-governance`（scan 文本）；write-watch 数值另需 owner 独立签署                                       |
| paths     | retirement scan JSON / 其测试（独立 PR）                                                                         |
| 进入      | reviewer 证明 helper 不可达；freeze 防回归测试通过                                                               |
| 退出      | P5 移除、P1 保留；`remaining` 由独立 scan 验收重算为 9；`liveWriteWatchIndex` **不得**由本 Stage lander 自行改写 |
| 禁止      | 与 Stage D 同 PR；宣称 Item 7 met                                                                                |

即使 S01 退休，Item 7 仍 `not-met`，除非全部剩余站点收口。

## 4. Catalog / membership / 目标身份输入

生产 C17 `resolveAuthorizedToolCwd` **不是** S01 evaluator。Stage A 新增只读 adapter。

| 输入                  | 来源                                 | 禁止                                      |
| --------------------- | ------------------------------------ | ----------------------------------------- |
| `targetIdentity`      | §2 整份合同，不得为 null             | 路径反推；principal 任意唯一 workspace    |
| `workspaceResourceId` | 权威映射链第 4 步                    | Memory Asset `resourceId`；`agentId` 冒充 |
| `agentAssetId`        | 权威 Registry                        | 调用方注入；slug 直接当 asset             |
| `catalog`             | 现有 Catalog 的 `S01CatalogViewPort` | 新建三张表；miss 时 create                |
| `principal`           | PlatformAuth verified-session issuer | wire 身份；未 keyed JSON                  |
| `memberships`         | membership SoT port                  | 数组；duck-typed 成功器                   |
| `requestedCwd`        | **该** binding 的 authorized locator | helper 路径；sibling locator              |

## 5. IR2：Shadow 与 Cutover 分离

**A. Shadow / 观察期（Stage B，可含 A 的未接线 adapter）**

- 新 adapter、身份端口和 Catalog 查询可以存在。
- `get-reply` 可在受控 flag 下做 **shadow 对比**。
- **生产结果仍由旧 helper 提供。**
- P5 必须继续留在 scan。
- `remaining` / `liveWriteWatchIndex` 保持 **10/10**。
- 不得声称 S01 retired。
- 不得签发 Item 7、Phase 1B 或 LIVE unlock。
- `shadowFlagOffKeepsLegacyAndP5InScan=true`：flag off = 只走 legacy，P5 仍在。

**B. Cutover / 退休期（Stage D 成功路径，Stage E 才改 scan）**

- 必须先有独立 shadow/canary 证据和 reviewer `accepted`。
- 切换成功路径后 **不得**再保留自动 helper fallback。
- `cutoverHasNoRuntimeHelperFallback=true`。
- feature flag **不得**在 off 时静默恢复 helper。
- 回滚只能是：经审批的 Git revert；已记录 release rollback；若 scan 已删 P5，必须恢复 P5 行并重新计算计数。
- `rollbackRequiresRevertAndScanRestoration=true`。
- 只有旧 helper 分支真正不可达、freeze 防回归测试通过后，才允许申请 Stage E 移除 P5。

废止 flagOffRestoresHelperWithoutScanRewrite；该开关不得再作为回滚手段。

本切片不加开关、不改代码。

## 6. 测试矩阵（按 Stage；本切片只锁定清单）

契约测试必须持续绿：

`bun test docs/design/contracts/s01-trusted-principal-handle-contract.test.ts`

| ID  | Stage | 场景                                                    | 期望                                                    |
| --- | ----- | ------------------------------------------------------- | ------------------------------------------------------- |
| T1  | A     | 完整 `targetIdentity` + 唯一 canonical/active           | 授权该 Handle                                           |
| T1b | A     | 同一员工多个 workspace                                  | 只授权目标 `workspaceResourceId`                        |
| T1c | A     | 同一租户多个 steward / agent asset                      | slug 不得误绑；缺精确 asset 则拒绝                      |
| T1d | A     | slug 冲突                                               | 拒绝；`agentId` 不是 identity                           |
| T1e | A     | `workspaceResourceId` 与 Memory Asset `resourceId` 混淆 | 拒绝                                                    |
| T1f | A     | duplicate canonical binding                             | 拒绝                                                    |
| T1g | A     | stale `governanceVersion` / `contentVersion`            | 拒绝                                                    |
| T1h | A     | stale fencing token                                     | 拒绝                                                    |
| T1i | A     | Registry miss / 多值 / 租户不一致                       | 拒绝                                                    |
| T2  | A     | 同租户其他 owner                                        | `ERR_WORKSPACE_OWNER_DENIED`                            |
| T3  | A     | 跨租户                                                  | `ERR_TENANT_MISMATCH`                                   |
| T4  | A     | retired / revoked                                       | `ERR_WORKSPACE_ARCHIVED`                                |
| T5  | A     | 路径越界                                                | `ERR_INVALID_PATH` / `ERR_PATH_OUTSIDE_WORKSPACE`       |
| T6  | A     | Catalog miss                                            | not-found；**不 create**                                |
| T7  | A     | membership 数组                                         | `ERR_TENANT_BINDING_REQUIRED`                           |
| T8  | A     | 无密钥 attestation                                      | `ERR_PRINCIPAL_REQUIRED`                                |
| T9  | A     | 未接 get-reply                                          | `:164` 仍为 helper；scan 含 P5；10/10                   |
| T10 | B     | shadow flag off                                         | legacy helper 决定 cwd；P5 在；10/10                    |
| T11 | B     | shadow flag on + Catalog miss                           | **生产 cwd 仍 helper**；记录 miss；不 fail 用户路径     |
| T12 | B     | shadow receipts                                         | identity match / miss / tenant mismatch / fencing stale |
| T13 | C     | 回滚演练                                                | 已审计 revert 记录；P5 仍在；10/10                      |
| T14 | D     | cutover 成功                                            | 仅目标 Handle locator；无 helper fallback               |
| T15 | D     | cutover 失败                                            | fail-closed；flag off **不**恢复 helper                 |
| T16 | D     | 与 scan 同 PR                                           | 禁止                                                    |
| T17 | E     | helper 已不可达                                         | freeze 通过后再独立改 scan；`remaining=9`               |
| T18 | E     | write-watch                                             | `liveWriteWatchIndex` 仅 owner 独立签署；lander 不得改  |

本切片 evidence 只证明：V1.8 计划已 resubmitted、生产未动、scan 仍 10/10、IR1–IR4 已写入、复审已请求、未自签。

## 7. IR3：scan 计数定义

当前权威实现仍是 `docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.mjs`。它把 `remaining` 与 `liveWriteWatchIndex` 都落到同一 `sites` 集合（`production && op !== "read"`）。**这不是**两套独立定义的机器证据。

因此本包规定：

1. **`remaining`**：canonical retirement scan 中仍存在的未退休调用点数。owner：Stage E scan PR + `kiro-sot-reviewer`。当前值 **10**。站点：P5 write、P1 write、8 个 index。
2. **`liveWriteWatchIndex`**：write-watch owner（`cursor-data-governance`）冻结的生产写路径风险指数。它**可以**与 `remaining` 不同，但必须另有：独立站点集合、计算规则、owner、变更 receipt、机器测试。当前仓库 **没有** 这套独立证据。
3. 在独立定义落地前，**不得计划 9/10**。本包锁定：
   - Shadow（A/B/C）：**10/10**
   - Cutover 后、scan 未独立接受（D）：**10/10**
   - scan 独立接受后（E）：`remaining=9`
   - `liveWriteWatchIndex` 只能由 write-watch owner 的独立签署决定，**本包不预写 9**
4. evidence test 锁定当前 scan JSON 为 10/10，防止 implementation lander 自行修改任一数值。

| 阶段                | P5          | remaining | liveWriteWatchIndex        | Item 7     |
| ------------------- | ----------- | --------- | -------------------------- | ---------- |
| 本包 / A / B / C    | 必须在 scan | 10        | 10                         | not-met    |
| Stage D cutover     | 必须在 scan | 10        | 10                         | not-met    |
| Stage E scan 接受后 | 删除        | 9         | write-watch owner 独立签署 | 仍 not-met |

Batch 26 `productionRetirementRemaining=8` 是政策叠加，不是第二个 scan 计数器。

`frozenWriteWatchIndex=38` 属 `cursor-fable` Phase 0 冻结基线，禁止改写。

## 8. 回滚与 quarantine

| 阶段       | 允许的回滚                                                                                   | 禁止                                   |
| ---------- | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| Shadow     | flag off 停 shadow；生产仍 helper；P5 必须仍在 scan                                          | 删 P5；改计数；声称退休                |
| Cutover 后 | **仅**经审批 Git revert，或已记录 release rollback；若 P5 已从 scan 删除则必须恢复该行并重算 | flag off 静默恢复 helper；长期隐形双轨 |
| 任何阶段   | W4 保持 `catalogResourceId=null` / quarantine                                                | 写生产 Catalog；I3；LIVE               |

## 9. 各 Stage freeze / attribution / forward-only

```
git fetch origin
git merge-base --is-ancestor origin/main HEAD
bun scripts/agent-attribution.ts --fail-on-unattributed --fail-on-conflict
node --test docs/design/evidence/memory-workspace-s01-implementation-readiness.test.mjs
bun test docs/design/contracts/s01-trusted-principal-handle-contract.test.ts
node scripts/verify-single-sot.mjs
```

- Stage A：`get-reply.ts:164` 仍为 helper；P5 在；10/10
- Stage B：164 仅 shadow；helper 仍决定 cwd；P5 在；10/10
- Stage C：成功路径未切；P5 在；10/10
- Stage D：164 为授权 locator；165/P1 未变；scan **尚未**改；10/10
- Stage E：独立 scan；`remaining=9`；`liveWriteWatchIndex` 非 lander 自改

不得把本 readiness 包当成 LIVE 候选。

## 10. 部署前置条件

1. V1.8 双审 sidecar `accepted`（本包不自签）。
2. `kiro-loom` 按 Stage 注册并 claim，无 attribution CONFLICT。
3. 新 worktree 基于当时最新 `origin/main`。
4. Stage A 使用 PlatformAuth / Registry 密钥与端口，不是测试常量。
5. Catalog 只读；无独立三张表；无 Aliyun RDS DDL。
6. 未完成 A 安全/治理验收前禁止 Stage B。
7. 未完成 B/C 前禁止 Stage D。
8. 未证明 helper 不可达前禁止 Stage E。
9. `implementationGate` 不由本包翻转。
10. 保持：Item 7 not-met、Phase 1B blocked、I3 not executed、`deployAuthorized=false`、LIVE forbidden。

## 11. 双 reviewer 复审请求

请对 **V1.8 / IR1–IR4** 独立复审（不得代签，不得沿用 #825/#826 结论）：

| Reviewer             | 范围                                                            | 请求产物                                                                                            |
| -------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `kiro-sot-reviewer`  | `targetIdentity`、scan 两计数定义、Shadow/Cutover、Catalog 只读 | `docs/design/evidence/memory-workspace-s01-implementation-readiness-review-kiro-sot-reviewer.json`  |
| `codex-architecture` | 映射链、Stage A–E 门禁、cutover 无 helper fallback              | `docs/design/evidence/memory-workspace-s01-implementation-readiness-review-codex-architecture.json` |

本包 **不** 自签 `accepted`。通过前不得开始 Stage A。

## 12. 守住的状态

```
acceptanceFinding: changes-required
status: implementation-readiness-resubmitted
selfAccepted: false
thisPacketStartsProductionImplementation: false
implementationGate: not-met
S01 retirement: blocked
Item 7: not-met
remaining = 10
liveWriteWatchIndex = 10
Phase 1B: blocked
productionCatalogWrite: none
deployAuthorized: false
I3: not executed
LIVE: forbidden
```
