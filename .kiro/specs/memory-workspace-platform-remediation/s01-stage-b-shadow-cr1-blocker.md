# S01 Stage B Shadow CR1 Blocker

- **Owner**: `cursor-data-governance`
- **Task**: `memory-workspace-platform-remediation:cursor-data-governance-s01-stage-b-shadow`
- **日期**: 2026-08-30
- **基线**: `origin/main` `e6dd9c61bc`（#850）
- **selfAccepted**: `false`
- **申请**: S01 Stage B Shadow CR1 Review

这不是 Stage B Implementation Accept，不是 Stage C，不是 production cutover。

CR1-A 要求从 `get-reply` 注入真实生产：

Trusted server context → Registry → WorkspaceResourceCatalog → Stage A identity → Stage A authorized cwd → observational receipt

仓库当前 **没有可用的生产 Catalog / Registry adapter**。按指令停止伪造依赖，提交本 blocker。

## 已做（不伪造依赖）

| 项                          | 状态                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CR1-A 生产端口注入          | **blocked** — 见下                                                                                                                                                         |
| CR1-B 授权 fail-closed 收据 | 已改 evaluator：缺 principal/membership/secret → `fail_closed_missing_authorization`；cwd 拒绝 → `authorization_denied`；两者都成功才 → `identity_and_authorization_match` |
| CR1-C 动态导入隔离          | `get-reply` 对 import 与执行都 `.catch`；`scheduleS01StewardCwdShadow` 吞掉 rejection                                                                                      |
| CR1-D 锁                    | 保持 landed-not-accepted / helper cwd / flag off / 10/10 / P5 / LIVE forbidden                                                                                             |

## 缺失的生产依赖

| 依赖                       | 现状                                                                                                                                                                                                                                                              | 为何不能伪造                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `WorkspaceResourceCatalog` | 唯一实现是 `InMemoryWorkspaceResourceCatalog`。`loadExistingGovernedWorkspaceIdentity` 投影到 InMemory，且 registry 未 resolve 时用 **unique-row fallback**（路径猜测）。`getSharedDataGovernanceCatalog` 是另一套 durable API，不是 `WorkspaceResourceCatalog`。 | 禁止第二套 Catalog；禁止 InMemory 作生产实现；禁止按路径猜 binding |
| `S01StewardRegistryPort`   | 只有 `createInMemoryS01StewardRegistryPort`。生产 `resolveLegacyAgentId` 对 steward `"main"` 返回 `builtin-universal`（ADR：无 enterprise `agentAssetId`）。                                                                                                      | 禁止 always-success Registry；把 `main` 映射成 asset 是发明语义    |
| `S01TrustedPrincipal`      | 有 `issueS01TrustedPrincipal`，无 PlatformAuth verified-session 接线；`GatewayClient` 无 sessionId                                                                                                                                                                | 禁止从 wire 读身份                                                 |
| `S01MembershipPort`        | 只有 InMemory factory。platform-auth `findUniqueMembershipByUserId` 未适配为 S01 port                                                                                                                                                                             | 同上                                                               |
| attestation secret         | `src/config` / env 无 S01 生产 secret。platform-auth `store.secret` 签的是 cookie，不是 `s01-trusted-principal-v1`                                                                                                                                                | 禁止挪用未授权 secret                                              |
| fencing                    | 可从 Catalog binding 读取，但依赖上面的 Catalog adapter                                                                                                                                                                                                           | 下游                                                               |

## 解阻需要（本 CR 不发明）

1. 现有 Data Governance Catalog 的 **只读** `WorkspaceResourceCatalog` 包装（非 InMemory、无 unique-row 猜测）。
2. 经设计接受的 steward `"main"` → `agentAssetId` 政策，或明确 steward 永不进入 identity match。
3. PlatformAuth session → `issueS01TrustedPrincipal` + `S01MembershipPort`。
4. 专用 S01 attestation secret / 受控验证端口。

## 收据矩阵（evaluator；生产入口仍无端口）

| 条件                               | receipt                                                      |
| ---------------------------------- | ------------------------------------------------------------ |
| flag off                           | `null`（不解析依赖）                                         |
| 非 steward                         | `not_steward`                                                |
| 缺 tenant/registry                 | `fail_closed_missing_identity`                               |
| 缺 catalog                         | `fail_closed_missing_catalog`                                |
| Catalog miss                       | `catalog_miss`                                               |
| tenant mismatch                    | `tenant_mismatch`                                            |
| stale fencing                      | `fencing_stale`                                              |
| 缺 principal / membership / secret | `fail_closed_missing_authorization`（不得 `identity_match`） |
| cwd 拒绝                           | `authorization_denied`                                       |
| identity + cwd 都成功              | `identity_and_authorization_match`                           |

生产 `get-reply` 仍只传 identity 字段。flag on 时 steward 得到 `fail_closed_missing_identity`。这是诚实 fail-closed，不是伪造 match。

## 无副作用 / scan

- `get-reply.ts:164` 仍是 `resolveEmployeeBuiltinStewardWorkspaceDir`
- shadow 不写 Catalog、不 mkdir、不改返回值
- scan `remaining=10` / `liveWriteWatchIndex=10`；P5 仍在
- `implementationVerified=false`；`implementationGate=not-met`；Item 7 not-met；Phase 1B blocked；LIVE forbidden
