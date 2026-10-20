# S01 Stage B Shadow CR3

- **Owner**: `cursor-data-governance`
- **Task**: `memory-workspace-platform-remediation:cursor-data-governance-s01-stage-b-shadow`
- **日期**: 2026-08-31
- **基线**: `origin/main` `ad0ac93decae6dacbea5bb8bbbff7e5f91d31b8e`（#859 Plan A accepted）
- **selfAccepted**: `false`
- **申请**: S01 Stage B Shadow CR3 Review

这不是 Stage B Implementation Accept，不是 Stage C Accept，不是 Stage D cutover，不是 LIVE。

## 已做

| 项                          | 状态                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan A Registry 解析        | `resolveS01StewardAgentAssetIdFromRegistry`：tenant + slug `main` 唯一 active asset；`agentAssetId` 不得等于 slug/`agentId`；空库/冒充/歧义 → `null` |
| 不改 `resolveLegacyAgentId` | builtin-universal 短路径仍给其他调用方；S01 端口对 steward slug 不再走该短路径                                                                       |
| session                     | get-reply 在 `initSessionState` 之后调用 FromEntry 并传入 `sessionId`                                                                                |
| membership                  | `loadS01StageBShadowProductionDeps` 在未注入 `platformStore` 时从 PlatformAuth SoT 加载                                                              |
| helper cwd                  | `get-reply.ts:164` 仍是 `resolveEmployeeBuiltinStewardWorkspaceDir`                                                                                  |
| 锁                          | flag 默认 off；scan 10/10；P5；landed-not-accepted                                                                                                   |

## 不发明 asset id

Registry 没有唯一稳定 slug 记录时仍 `catalog_miss`。不允许 always-success adapter。

## 无副作用 / scan

- 不写 Catalog、不 mkdir、不改用户可见 cwd
- `S01_PRODUCTION_WIRED_TO_GET_REPLY = false`
- `implementationVerified=false`；LIVE forbidden
