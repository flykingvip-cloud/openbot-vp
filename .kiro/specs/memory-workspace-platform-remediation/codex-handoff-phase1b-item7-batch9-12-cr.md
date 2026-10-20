# Phase 1B Item 7 Batch 9–12 CR：空路径与伪 Resolver 接线

这是 **CR**，不是新的 retirement batch。Batch 9–12 **不视为 Accepted**。

| Field                           | Value                                      |
| ------------------------------- | ------------------------------------------ |
| status                          | cr-resolver-wiring                         |
| batch9to12Accepted              | false                                      |
| remaining / liveWriteWatchIndex | 22 / 22                                    |
| retiredThisChange               | 0                                          |
| item7                           | not-met                                    |
| phase1bExecutionBlocked         | true                                       |
| phase1bUnlock                   | not-issued                                 |
| deployAuthorized                | false                                      |
| live                            | forbidden                                  |
| productionWrite                 | false                                      |
| productionCatalogWrite          | none                                       |
| schemaV2ProductionWrite         | false                                      |
| origin/main                     | `d3f59d55d82d89af8d0b9575afe5259e2366fbca` |

未改 live retirement scan。未启动 Batch 13。

## 冻结

- 暂停新的 retirement batch
- remaining / liveWriteWatchIndex 不得继续低于 22
- 本 CR 写 remaining=22，不递减
- Item 7 / Phase 1B / LIVE / Catalog / schema v2 写入继续锁定

## 逐项修复

### S10 `agents.files.get`

原先 `resolveAgentWorkspaceFileOrRespondError` 调用
`resolveWorkspaceLocator({ cfg })`，失败落到 `null` 再落到空字符串。缺
tenant 时 handler 仍返回 workspace 并继续读文件。

现在从服务端可信上下文构造完整查询：`resolveTenantContext(client)`、
`resolveEmployeeWorkbenchActor(client)`、
`loadExistingGovernedWorkspaceIdentity`（catalog / resourceId /
agentAssetId）、所有权 grant。失败立即 `respond` error 并 `return`，
`readLocalFileSafely` 不会跑。

### S11 `agents.files.set`

与 S10 共用同一 helper。原先失败路径是 `""`，随后 `fs.mkdir("")`。

现在缺 tenant / grant / catalog miss / catalog ambiguous 都在 mkdir 之前
拒绝。合法查询的 `writeFileWithinRoot` 只用 canonical locator，不会收到
`""` 或 `process.cwd()`。

### S12 `agents.update` avatar

原先顺序是先 `writeConfigFile`，再用
`params.workspace ?? resolveWorkspaceLocator({ cfg }) ?? ""` 去 mkdir。
wire 上的 `workspace` 和空字符串都能变成写路径。

现在 avatar 更新先做完整 locator。失败立即返回，不写 config、不 mkdir、
不 appendFile。成功后只用 `handle.locator`，不用 params.workspace。

### S13 `agents.delete`

原先 `resolveWorkspaceLocator({ cfg }) ?? ""` 之后立刻
`decommissionRobotWorkspace` / `writeConfigFile` / trash。

现在 locator 失败立即返回，零 config mutation、零 trash。成功后 trash
目标是 canonical locator。

## 可信查询字段（均非可伪造 wire）

- tenantContext / tenantId ← `resolveTenantContext`
- authenticated actor ← `resolveEmployeeWorkbenchActor`
- ownership grant ← Catalog `ownerScope` + actor.userId
- resourceId / agentAssetId / catalog ←
  `loadExistingGovernedWorkspaceIdentity`

禁止：`resolveWorkspaceLocator({ cfg })`、`""`、`null ?? ""`、
`process.cwd()`、默认 workspace、host root 作为授权失败结果。

## fail-before / pass-after

| 站点 | fail-before                                        | pass-after                                 |
| ---- | -------------------------------------------------- | ------------------------------------------ |
| S10  | 缺 tenant → get 拒绝，零 read                      | 完整查询 → `workspace` = canonical locator |
| S11  | 缺 tenant / miss / ambiguous → set 拒绝，零 mkdir  | write rootDir = canonical locator          |
| S12  | 缺 tenant / grant / 跨租户 → 拒绝，零 config/mkdir | locator canonical 后才 writeConfigFile     |
| S13  | 缺 tenant / grant / ambiguous → 拒绝，零 trash     | trash 使用 canonical locator               |

已删除固定空字符串行为的源码行号测试。

## 定向测试

```bash
OPENBOT_TEST_PROFILE=low pnpm exec vitest run \
  src/gateway/server-methods/agents-item7-s10.test.ts \
  src/gateway/server-methods/agents-item7-s11.test.ts \
  src/gateway/server-methods/agents-item7-s12.test.ts \
  src/gateway/server-methods/agents-item7-s13.test.ts \
  src/gateway/server-methods/agents.files-scope.test.ts
node --test \
  docs/design/evidence/memory-workspace-phase1b-item7-batch9-12-cr.test.mjs
```

结果：handler 20 passed；files-scope 2 passed；evidence packet 见同目录
test。

## 禁止本轮

- 启动 Batch 13
- 把 Batch 9–12 标成 Accepted
- 把 remaining / liveWriteWatchIndex 写成小于 22 或 0
- Item 7 met、Phase 1B unlock、LIVE、Catalog write、schema v2
  production write

## 请求审查

**Item 7 Batch 9–12 Resolver Wiring CR Review only.**
