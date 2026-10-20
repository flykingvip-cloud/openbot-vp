# S01 Stage B Shadow CR2 / production-ports

- **Owner**: `cursor-data-governance`
- **Task**: `memory-workspace-platform-remediation:cursor-data-governance-s01-stage-b-shadow`
- **日期**: 2026-08-30
- **基线**: `origin/main` `0f787d41ee`（#851）
- **selfAccepted**: `false`
- **申请**: S01 Stage B Shadow CR2 / production-ports Review

这不是 Stage B Implementation Accept，不是 Stage C，不是 production cutover。

## 已做

| 项                     | 状态                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 生产只读 Catalog 视图  | `S01ReadOnlyDurableCatalogView`：prefetch durable `list("workspace")` 后同步评估；从 resourceId 解析 `agentAssetId`；不用 `InMemoryWorkspaceResourceCatalog`；不用 `loadExistingGovernedWorkspaceIdentity` unique-row 猜测 |
| 生产 Registry 端口     | `createProductionS01StewardRegistryPort`：只接受 `resolveLegacyAgentId` 的 `resolved` 且 `agentAssetId !== agentId`；steward `"main"` → `null`                                                                             |
| 入口组合               | `runS01GetReplyStewardCwdShadowFromEntry`：flag 关时返回 `null` 且不解析依赖；flag 开时注入上述端口                                                                                                                        |
| membership / principal | 仅当注入 `platformStore` 且同时具备 userId+tenantId+sessionId+`OPENBOT_S01_ATTESTATION_SECRET` 才签发；get-reply 不传 sessionId，生产 steward `"main"` 诚实落到 `catalog_miss`                                             |
| 锁                     | helper 仍决定 cwd；flag 默认关；scan 10/10；P5 仍在；landed-not-accepted                                                                                                                                                   |

## steward `"main"` 政策

ADR：`"main"` 是 universal builtin，没有 enterprise `agentAssetId`。生产 Registry wrap 返回 `null`。identity resolver 得到 `ERR_WORKSPACE_NOT_FOUND`，收据为 `catalog_miss`。这就是“到达 identity resolver”，不是伪造 match。

## 无副作用 / scan

- `get-reply.ts:164` 仍是 `resolveEmployeeBuiltinStewardWorkspaceDir`
- 不写 Catalog、不 mkdir、不改返回值
- `S01_PRODUCTION_WIRED_TO_GET_REPLY = false`
- `implementationVerified=false`；`implementationGate=not-met`；Item 7 not-met；LIVE forbidden
