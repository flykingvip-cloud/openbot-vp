# S01 Stage A Adapter Implementation 双审请求

- **请求人**: `cursor-data-governance`
- **日期**: 2026-08-30
- **基线**: `origin/main` `74ca45c144`
- **selfAccepted**: `false`
- **fillsKiroSotReviewer**: `false`
- **fillsCodexArchitecture**: `false`
- **implementationAuthorized**: `false`

这不是 Stage A Accept，不是 Implementation Unlock，也不是第二套 S01 规范。
唯一设计 SoT 仍是 `handoff-s01-trusted-principal-handle-gate.md`。错误码只承认该 handoff 的 11 个。

## 操作者裁决（本包只记录，不改写）

| 项                                    | 裁决             |
| ------------------------------------- | ---------------- |
| Stage A Contract Remediation (#834)   | Accepted         |
| Stage A Adapter Implementation (#833) | Changes Required |
| Stage B Shadow Wiring                 | Locked           |
| Implementation Unlock                 | Not issued       |
| Production Authorization              | Not issued       |

代码已在主干不等于 Accepted。`#834` evidence 仍写 `unauthorizedImplementationLanding.pr=833`、`authorized=false`、`stageAImplementation=blocked`、`implementationGate=not-met`。

## 请独立复审当前主干上的 #833 实现

审查对象是 **当前 `origin/main` 上的生产 adapter**，不是 #834 合同包，也不是未合入分支。

| 文件                                                            | blob on `74ca45c144`                       |
| --------------------------------------------------------------- | ------------------------------------------ |
| `src/gateway/data-governance/s01-steward-workspace-identity.ts` | `2ddc9c4d4eee3def3ce64ab4e5c00c2380d12f1f` |
| `src/gateway/data-governance/s01-authorized-tool-cwd.ts`        | `e0a99abf3c120acba56f3dd7cdf8dbff21e0f434` |

请写入**新的实现复审 sidecar**（不可变；合入 main 后才算数）：

| Reviewer             | 产物                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `codex-architecture` | `docs/design/evidence/memory-workspace-s01-stage-a-implementation-review-codex-architecture.json` |
| `kiro-sot-reviewer`  | `docs/design/evidence/memory-workspace-s01-stage-a-implementation-review-kiro-sot-reviewer.json`  |

**不要**把下列合同 sidecar 当作 #833 实现验收：

- `docs/design/evidence/memory-workspace-s01-stage-a-adapter-review-codex-architecture.json`（#837 若合入，范围只是 SA1–SA3 合同）
- `docs/design/evidence/memory-workspace-s01-stage-a-adapter-review-kiro-sot-reviewer.json`（合同复审槽，尚未在主干）

请勿代签对方。本包不创建、不填写上述任一 sidecar 的 `decision`。

## 至少必须验证

1. `targetIdentity` 非 null，且含 IR1 全字段（含 `expectedBindingRole=canonical`、`expectedBindingState=active`、`governanceVersion` / `contentVersion`、`fencingToken`）
2. 只使用 unique handoff 的 11 个错误码；不引入 `ERR_WORKSPACE_SUSPENDED` / `ERR_WORKSPACE_RETIRED` / `ERR_STALE_FENCING` / `ERR_OWNERSHIP_MISMATCH` / `ERR_BINDING_AMBIGUOUS`
3. Catalog-only：`WorkspaceResourceCatalog` / `S01CatalogViewPort`；无独立三表
4. membership 是 port，不是数组
5. stale fencing / retired / revoked → `ERR_WORKSPACE_ARCHIVED`
6. 路径逃逸：`..`、sibling-prefix、encoded traversal、绝对逃逸；symlink 未验证不得放行
7. `src/auto-reply/reply/get-reply.ts:164` 仍为 `resolveEmployeeBuiltinStewardWorkspaceDir`；`src/auto-reply` 零引用 Stage A adapter
8. scan `remaining=10` / `liveWriteWatchIndex=10`
9. `implementationVerified=false`；`deployAuthorized=false`；`liveDeployment=forbidden`

两份实现复审 sidecar **都合入 main** 之后，才能再次申请 **Stage A Adapter Implementation Accept only**。在此之前 Stage B Locked。
