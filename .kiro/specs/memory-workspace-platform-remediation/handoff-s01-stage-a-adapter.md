# S01 Stage A: Adapter 合同（修订）

- **状态**: `stage-a-contract-resubmitted`
- **implementationAuthorized**: `false`
- **Owner**: `cursor-data-governance`
- **基线**: `origin/main` `74ca45c144`（含未授权合入的 #833，以及 #834 合同修订）
- **本切片**: 只修订 Stage A handoff / evidence / 测试，关闭 SA4（IR1 `targetIdentity` 全字段 + catalog/registry 端口）。
- **禁止**: 创建或修改生产 adapter；写 Catalog；接线 `get-reply.ts`；改 scan；把 #833 当作已授权实现。

本文件不是第二套 S01 规范。唯一设计 SoT 仍是
`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。
可执行契约仍是 `docs/design/contracts/s01-trusted-principal-handle-contract.ts`。
V1.8 阶段划分见 `handoff-s01-implementation-readiness.md`。

**双审通过前不得接受 Stage A 实现，也不得开始后续阶段。本包不自签 accepted。#833 生产文件落地未经本合同双审，authorized=false。**

## 0. 验收整改

| ID  | 缺口                                                                | 关闭方式                                                                                                                    |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| SA1 | 独立表 `workspace_handles` / `authorized_cwds`                      | 删除 table 语义。唯一输入是现有 `WorkspaceResourceCatalog` 的 typed view / `S01CatalogViewPort`                             |
| SA2 | `resolveAuthorizedToolCwd(handle, toolName): Promise<string>`       | 改为已签发 `TrustedPrincipal` + `workspaceResourceId` + membership port + canonical/active binding + fencing/contentVersion |
| SA3 | miss 返回 null / 多授权取第一条                                     | Catalog miss、重复 binding、租户不匹配、membership 缺失、stale fencing 一律 fail-closed                                     |
| SA4 | handoff `targetIdentity` 缩成 4 字段，身份函数省略 catalog/registry | 恢复 V1.8 IR1 全字段；`resolveStewardWorkspaceIdentity` 必须注入 `S01CatalogViewPort`、Registry 端口与 fencing              |

禁止独立三表：`workspace_handles`、`authorized_cwds`、`tenant_memberships`。不得为它们编写独立 SQL。

## 1. 范围

Stage A **只准备** adapter / 身份端口合同。本修订包 **不创建、不修改** 下列生产文件（#833 已抢跑落地，本包不接受）：

```
src/gateway/data-governance/s01-steward-workspace-identity.ts
src/gateway/data-governance/s01-steward-workspace-identity.test.ts
src/gateway/data-governance/s01-authorized-tool-cwd.ts
src/gateway/data-governance/s01-authorized-tool-cwd.test.ts
```

不修改 `get-reply.ts`、`src/memory/**`、`src/gateway/workspace-resolver/**`。
不把 S01 塞进生产 C17 `resolveAuthorizedToolCwd`（`handler-bridge.ts`）。
`src/` 不得把非生产 contract 当作生产入口。

后续阶段（实现未授权）：B shadow → C cutover 准备 → D 受控 cutover → E 独立 scan。
**不是** Catalog schema 部署，也不是新建三张表。

## 2. Catalog 输入（唯一 SoT）

唯一 Catalog 输入：

- 生产：现有 `WorkspaceResourceCatalog` 的只读包装
- 端口：`S01CatalogViewPort`（`getResource`、`listBindingsForResource`、`snapshot`）
- 测试：已批准的 `InMemoryWorkspaceResourceCatalog`

禁止：

- 把 Catalog 访问写成独立 table 字段
- 独立表 `workspace_handles` / `authorized_cwds` / `tenant_memberships`
- Catalog miss 时现场 create
- 把 Memory Asset `resourceId` 当成 `workspaceResourceId`

## 3. Steward Workspace Identity 合同

权威映射链（缺一即拒绝）：

```
Trusted TenantContext
  → builtin steward agentId/slug（仅 tenant 内 query）
  → authoritative agentAssetId
  → Data Governance Catalog workspaceResourceId
  → unique canonical + active binding
  → authorized locator
```

`targetIdentity` **不得为 null**。字段必须与 V1.8 IR1 一致，缺一即 fail-closed：

```typescript
type S01StewardTargetIdentity = {
  tenantId: string;
  employeeOwnerId: string;
  agentAssetId: string;
  workspaceResourceId: string;
  expectedBindingRole: "canonical";
  expectedBindingState: "active";
  governanceVersion: number;
  contentVersion: string;
  fencingToken: { contentVersion: string; bindingId: string };
};

function resolveStewardWorkspaceIdentity(input: {
  tenantId: string;
  userId: string; // employeeOwnerId；来自 Trusted TenantContext，不是 wire
  agentId: string; // tenant 内 slug only，不是 resourceId / agentAssetId
  catalog: S01CatalogViewPort;
  registry: S01StewardRegistryPort; // 仅 tenant 内解析唯一 agentAssetId
  expectedFencing?: { contentVersion: string; bindingId: string };
}): S01StewardTargetIdentity; // miss / multi / stale fencing → fail-closed，不返回 null 当成功
```

`agentId` 不是 `resourceId`，也不是 `agentAssetId`。不得按 principal 取任意唯一 workspace，不得从 path/host/cwd 反推身份。

## 4. Authorized Tool Cwd 合同

生产 adapter 必须实现与 D1–D4 相同的输入形状，而不是 `(handle, toolName) => path`。

```typescript
function evaluateS01AuthorizedToolCwd(params: {
  catalog: S01CatalogViewPort;
  principal: TrustedPrincipal; // 已签发；缺失/伪造/过期 → ERR_PRINCIPAL_REQUIRED
  memberships: S01PlatformAuthMembershipPort; // 禁止数组
  targetResourceId: string; // 权威 workspaceResourceId
  requestedCwd: string; // 仅该 resource 的 authorized locator
  operation: WorkspaceCapability;
  expectedFencing?: { contentVersion: string; bindingId: string };
  attestationSecret: string;
}): EvaluateS01AuthorizedToolCwdResult;
```

还必须校验：

- `expectedBindingRole = canonical`
- `expectedBindingState = active`
- `governanceVersion` / `contentVersion` 与 Catalog 一致
- fencing token 或等价 `expectedFencing`；stale → 拒绝

成功：该 binding 的 locator。失败：typed error，`failClosed: true`，无 helper / host / cwd fallback。

## 5. Fail-closed

| 条件                                | 结果                                                    |
| ----------------------------------- | ------------------------------------------------------- |
| Catalog miss / unavailable          | `ERR_WORKSPACE_NOT_FOUND` / `ERR_CATALOG_UNAVAILABLE`   |
| 0 条或多条 canonical+active binding | `ERR_BINDING_NOT_CANONICAL` / `ERR_WORKSPACE_NOT_FOUND` |
| 租户不一致                          | `ERR_TENANT_MISMATCH`                                   |
| membership 缺失或传入数组           | `ERR_TENANT_BINDING_REQUIRED`                           |
| stale fencing / contentVersion      | `ERR_WORKSPACE_ARCHIVED` 或等价 fail-closed             |
| 无 / 伪造 principal                 | `ERR_PRINCIPAL_REQUIRED`                                |
| 路径越界                            | `ERR_INVALID_PATH` / `ERR_PATH_OUTSIDE_WORKSPACE`       |

禁止：返回 `null` 当成功、多授权取第一条、path 反推身份、helper fallback。

## 6. 实现前测试清单（代码未开始）

身份：完整 `targetIdentity`；同员工多 workspace；slug 冲突；Registry miss/多值。
Cwd：目标 resource 授权；sibling 拒绝；duplicate canonical；Catalog miss 不 create；membership 数组；stale fencing/version；跨租户。
隔离：`get-reply.ts:164` 仍为 helper；本包不改生产 adapter；#833 落地未授权；scan 10/10。

## 7. 双审

请对 **本修订合同** 独立复审。通过前不得接受 Stage A 实现，也不得接线 `get-reply.ts`。

| Reviewer             | 请关注                                                       | 产物                                                                                       |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `codex-architecture` | 无独立表；resolver 输入完整；#833 未授权；Stage A 仍 blocked | `docs/design/evidence/memory-workspace-s01-stage-a-adapter-review-codex-architecture.json` |
| `kiro-sot-reviewer`  | Catalog 唯一 SoT；fail-closed；scan/生产锁未变               | `docs/design/evidence/memory-workspace-s01-stage-a-adapter-review-kiro-sot-reviewer.json`  |

## 8. 守住的状态

```
Stage A implementation: blocked
status: stage-a-contract-resubmitted
selfAccepted: false
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
