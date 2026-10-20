# Phase 1B Item 7 Batch 9–12 CR2：Catalog 选择与企业授权

这是 **CR2**，不是新的 retirement batch。Batch 9–12 **不视为 Accepted**。本 CR **不吸收** 未单独验收的后续批次，包括已单独接受的 Batch 14/S15。

`git fetch origin` 后绑定实际最新主干：`origin/main` = `candidateSha` = `697c65c905c624ec80aba2a3386a00a7d0cc818a`。这是 evidence rebind only。

| Field                           | Value                                      |
| ------------------------------- | ------------------------------------------ |
| status                          | cr2-evidence-rebind                        |
| evidenceRebindOnly              | true                                       |
| batch9to12Accepted              | false                                      |
| absorbsUnacceptedBatches        | false                                      |
| lastAcceptedRetirementBaseline  | 29                                         |
| remaining / liveWriteWatchIndex | 29 / 29                                    |
| retiredThisChange               | 0                                          |
| item7                           | not-met                                    |
| phase1bExecutionBlocked         | true                                       |
| phase1bUnlock                   | not-issued                                 |
| deployAuthorized                | false                                      |
| live                            | forbidden                                  |
| productionWrite                 | false                                      |
| productionCatalogWrite          | none                                       |
| schemaV2ProductionWrite         | false                                      |
| origin/main                     | `697c65c905c624ec80aba2a3386a00a7d0cc818a` |
| candidateSha                    | `697c65c905c624ec80aba2a3386a00a7d0cc818a` |

未改 live retirement scan。未启动下一 retirement batch。

## 冻结

- 继续冻结所有新 retirement batch
- remaining / liveWriteWatchIndex 使用最后已接受基线 29，不递减
- 本 CR 写 remaining=29，不吸收 live scan 的 22
- Item 7 / Phase 1B / LIVE / Catalog / schema v2 写入继续锁定

## CR2 修复

### Catalog 资源选择

`selectTrustedCatalogResource` 要求 **tenantId + owner scope + agentAssetId** 共同匹配。

- `matching.length === 0` → 完整查询 `resourceId=null` → `catalog_miss`
- `matching.length > 1` → `selectFirstCanonical=true` → `first_canonical_selection_forbidden`（等价 fail-closed，不使用 first-match）
- 唯一命中后才构造 grant，禁止 `matching[0]` 先取后授权

`user_owned` 还匹配 actor `userId`。`group_owned` 用 `groupId === agentAssetId`。跨租户行不会入选。

### 企业授权

- `position_owned`：服务端加载可信 Platform Auth + tenant-scoped seat membership SoT
- `group_owned`：服务端加载可信 group membership SoT（`loadAuthoritativeGroupMembers`）
- membership **不来自 wire**（不读 handler params / client）
- 缺失 SoT → `missing_membership_sot`
- 过期 / 非成员 / 不匹配 → `auth_failure`
- 跨租户 Catalog 行 → `catalog_miss` 或 `tenant_mismatch`

`user_owned` 不需要 membership SoT，合法路径继续通过。

### 真实 handler 测试

S10–S13 均覆盖：

- 同 `agentAssetId` 多资源（含跨 owner）→ 拒绝且零文件操作
- position 合法 seat member → canonical locator
- position 非成员 / 跨租户 / 缺 SoT → 拒绝且零文件操作
- group 合法成员 → canonical locator
- group 非成员 / 缺 SoT → 拒绝且零文件操作
- user-owned 合法路径继续通过

拒绝路径零 read / write / mkdir / trash / config mutation。

## 不得声称

- Item 7 met
- Phase 1B unlock
- Batch 9–12 Accepted
- LIVE / Catalog / schema v2 production write
- 下一 retirement batch 已启动
