# S01 Stage C: Cutover PREP (awaiting independent accept)

- **Owner**: `kiro-data-governance`
- **Role**: Stage C cwd cutover PREP
- **Loom**: `memory-workspace-platform-remediation:kiro-data-governance-s01-stage-c-prep`
- **日期**: 2026-09-01
- **基线**: `origin/main` `60c34606053aa45930da0b342f9e8d6b08d4d2bb` (#851 CR1; #857 CR2; #860 CR3 landed; #865 CR3 independent review landed; #871 managed tenantContext; #877 policy-revision history; #878 independent Stage B Implementation Accept request merged `feb282af`; no Stage C Accept)
- **CR3 baseline (history)**: `8be667b41e60987c7b886e4a6327b168130b8717`
- **selfAccepted**: `false`
- **signedAsCodexArchitecture**: `false`
- **signedAsKiroSotReviewer**: `false`
- **stageC**: `prepared-awaiting-independent-accept`
- **requestsStageCAccept**: `true`
- **authorizesStageCAccept**: `false`
- **stageCAccepted**: `false`
- **stageCPrepAccepted**: `false`
- **stageBImplementationAccepted**: `true` (via independent #878 merge; this packet does not self-grant Stage B)
- **authorizesStageBImplementationAccepted**: `false`
- **cutoverFlag**: `off`
- **implementationVerified**: `false`
- **remaining / liveWriteWatchIndex**: `10 / 10`
- **LIVE**: `forbidden`
- **isolatedReplicaReceiptsObserved**: `103`
- **productionLiveReceiptsObserved**: `0`
- **isolatedReplicaAcceptanceMet**: `true`
- **productionReceiptsAcceptanceMet**: `false`
- **requiredReviewer**: `flykingvip-cloud`

- **policyRevisionId**: `propose-minSampleSize-60-keep-active-100` (history from #877; this packet is NOT another 60-policy proposal)
- **activePolicy.minSampleSize**: `100` (#866; still the active gate)
- **proposedPolicy.minSampleSize**: `60` (inactive until independent approval + NEW window)
- **proposedPolicy.status**: `proposed-not-active`

这不是 Item 7 C1–C5，也不是 Stage D 成功路径切换。
唯一设计 SoT 仍是 `handoff-s01-trusted-principal-handle-gate.md`。
Stage 边界仍是 V1.8 `handoff-s01-implementation-readiness.md`。

本包 **申请** Stage C Cutover Prep Accept（`requestsStageCAccept=true`），**不**自授（`authorizesStageCAccept=false`）。本包不修改 `get-reply.ts`、shadow evaluator、retirement scan、或生产 Catalog/Registry。不修改 Stage B CR3 sidecar。不改写 #878 sidecar。

## Verdict (English, binding)

> Isolated-replica window2 n=103 over 2h08m46s met the active 100-receipt gate. Independent reviewer flykingvip-cloud merged Stage B Implementation Accept request #878 (feb282af). This packet REQUESTS Stage C Cutover Prep Accept only. authorizesStageCAccept=false; selfAccepted=false. productionLiveReceiptsObserved=0. proposedPolicy.minSampleSize=60 remains inactive. remaining=10. implementationVerified=false. cutoverFlag=off. LIVE forbidden. Does not authorize Stage D, deleting P5, or production cwd cutover.

本包记录 #878 独立合并即 Stage B Implementation Accept，并 **申请** Stage C Prep Accept。**不**把 `authorizesStageCAccept` 置 true，**不**授权 Stage D / LIVE / `implementationVerified=true`。`proposedPolicy.minSampleSize=60` 仍 inactive。现行门仍是 `activePolicy.minSampleSize=100`。

## 1. 范围

只准备只读证据：精确映射、**复合 observation gate** 验收标准、Stage C 进入/退出条件、preflight、回滚演练文档。绑定 isolated-replica window2 n=103 与独立 #878 合并。

禁止：

- 改 `src/auto-reply/reply/get-reply.ts`
- 改 `src/gateway/data-governance/s01-get-reply-steward-cwd-shadow.ts`
- 改 Stage B shadow evidence / CR3 sidecar / #878 sidecar
- 改写 `memory-workspace-phase1b-item7-retirement-scan.json`
- 伪造生产 Catalog / Registry adapter（InMemory 仅测试）
- 打开用户可见 cwd 成功路径
- 自授 Stage C Accept / Stage D / LIVE
- 在 LIVE 打开 `OPENBOT_S01_STAGE_B_STEWARD_CWD_SHADOW`
- 声称 LIVE production receipts 已完成或 LIVE `productionReceiptsAcceptanceMet=true`
- 把 excluded n=42 / 历史 n=39 标为通过

## 2. 主干观察（60c34606 / #860+#865+#871+#878）

| 项                                            | 观察                                                                                                                                                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get-reply.ts:164`                            | 仍 `resolveEmployeeBuiltinStewardWorkspaceDir`                                                                                                                                                                                                |
| P5                                            | 仍在 scan `sites[0]`                                                                                                                                                                                                                          |
| flag `OPENBOT_S01_STAGE_B_STEWARD_CWD_SHADOW` | 默认 off；LIVE 禁止打开                                                                                                                                                                                                                       |
| `S01_PRODUCTION_WIRED_TO_GET_REPLY`           | `false`                                                                                                                                                                                                                                       |
| shadow 调用                                   | `runS01GetReplyStewardCwdShadowFromEntry`；传入 stewardException / employeeOwnerId / stewardAgentId / tenantId / userId / **sessionId** / helperCwd；调用点**不**注入 catalog/registry/principal；由 `loadS01StageBShadowProductionDeps` 加载 |
| Stage B #850                                  | landed; Implementation Accept 经由独立 #878                                                                                                                                                                                                   |
| Stage B CR2 #857                              | 诚实 `S01ReadOnlyDurableCatalogView` + `createProductionS01StewardRegistryPort`                                                                                                                                                               |
| Stage B CR3 #860 / review #865                | Plan A Registry slug 查找 + verified `sessionId` + PlatformAuth membership/principal 已落地；CR3 Review accepted                                                                                                                              |
| #871                                          | managed tenantContext landed (`aa44194a`)                                                                                                                                                                                                     |
| #878                                          | independent Stage B Implementation Accept **request** merged `feb282af` (reviewer `flykingvip-cloud` APPROVED `a5b1dd01`). Independent merge of that request IS Stage B Implementation Accept. This packet records it; does not self-grant.   |

因此 **没有** 真实生产 LIVE shadow receipts。`productionLiveReceiptsObserved=0` / `productionReceiptsObserved=0`。不得把 InMemory / 合成 / 测试收据当作生产观察。不得再写「缺生产 adapter」：CR3 已落地。isolated-replica window2 n=103 已满足 active 100 门，但那不是 LIVE。

## 3. 映射

见 `s01-stage-c-identity-mapping.md`。链来自 Stage A，生产接线来自 CR3：

`tenantId → employeeOwnerId → steward slug (main) → agentAssetId → workspaceResourceId → unique canonical+active binding → locator → governanceVersion / contentVersion / fencingToken`

测试例（**InMemory only**）：`ent-456` / `usr-123` / `main` / `asset-steward-1` → `ws:ent-456:user:usr-123:asset:asset-steward-1`。

生产端口（CR3 现实，不是 missing）：

- Catalog：`S01ReadOnlyDurableCatalogView`
- Registry：`createProductionS01StewardRegistryPort` / `resolveS01StewardAgentAssetIdFromRegistry`
- Membership：`loadPlatformAuthStore` + `findUniqueMembershipByUserId`
- Principal：`issueS01TrustedPrincipal`（需要 userId + tenantId + sessionId + attestation secret）

## 4. 两层 observation gate（删除 24h 硬阻断作为验收门）

**不要删除** observation-window 门。把它从「部署前固定 24h 硬阻断」改成复合门。旧键 `observationWindowHours: 24` **不再**作为验收门；验收门键是 `observationWindowMinHours: 2`。

### 4.1 Layer 1 — Stage B Implementation Accept

**现行门（active）仍是 `minSampleSize=100`（#866）。** `proposedPolicy.minSampleSize=60` 在独立批准前 **不是** 现行门，也不得追溯套用到任何窗口。

通过 Stage B observation gate **仅当全部满足**：

- 连续观察 ≥ `observationWindowMinHours` = **2** 小时
- ≥ `minSampleSize` = **100** 条真实 shadow receipts（**不是**合成/测试收据；仅 canary 真实流量）
- ≥ `minDistinctTenants` = **2** 个企业租户
- ≥ `minDistinctEmployeesPerTenant` = **2** 名员工 / 租户
- 跨租户成功 = `zeroCrossTenantTolerance` = **0**
- 非预期错误率 ≤ `maxUnexpectedErrorRate` = **0.001**（0.1%）
- 覆盖：success（`identity_and_authorization_match`）、Catalog miss、tenant mismatch、fencing stale、missing authorization、authorization denied
- **flag off 与 flag on** 都有证据
- shadow **没有**改变用户可见 cwd、response、authz、或生产写入
- ≥ `minObservationBuckets` = **4** 个连续 `bucketDurationMinutes` = **30** 分钟桶，落在 2h 窗口内（禁止几分钟内倾倒 100 条测试请求）

当前：isolated-replica window2 **n=103** 已满足 active 100（`isolatedReplicaAcceptanceMet=true`，`flagOffEvidenceObserved=true`，`flagOnEvidenceObserved=true`，`observationBucketsObserved=4`）。LIVE `productionReceiptsObserved=0`，`productionReceiptsAcceptanceMet=false`。独立 #878 已合并，Layer 1 Stage B Implementation Accept 由独立审查落地。本包 **不** 自称 LIVE 观察完成。

### 4.2 Layer 2 — Production Cutover（Stage D，本包不授权）

上线后仍要求 **24h** shadow telemetry + auto-rollback 监控。立即停止/回滚如果：任一跨租户成功；任一未授权成功；Catalog/Registry 异常率超阈值（然后关闭 shadow/cutover flags）。Receipts 必须持久化且可审计。

本包 **不** Stage D cutover。NOT LIVE cutover。NOT flag-on LIVE。

## 5. Stage C 进入 / 退出

- **进入 Stage C PREP**：CR3 #860+#865 已落地；#871 managed tenantContext；#878 independent Stage B Implementation Accept request merged；isolated replica window2 n=103 met active 100 gate。本包满足进入 PREP。
- **退出 Stage C PREP → Stage C Accept**：REQUESTED, not granted。Independent reviewer `flykingvip-cloud` must approve this PR。`authorizesStageCAccept=false`，`stageCAccepted=false`，`stageCPrepAccepted=false`。Does not authorize Stage D/LIVE。
- **Production Cutover / Stage D**：未授权。Layer 2 的 24h 是 cutover **之后**的 telemetry，不是本包验收门。

## 6. 阻断

- **CR3 / #860+#865**：status `landed-reviewed`。不再是「缺生产 adapter」。诚实端口 + sessionId + PlatformAuth 已落地。
- **Stage B Implementation**：`accepted-via-independent-review-pr-878`（keep pr 878 fields）。本包不自授 Stage B。
- 无真实生产 LIVE shadow receipts（`noRealProductionShadowReceipts=true`；LIVE=0）。
- 复合 observation gate：isolated replica `compositeObservationGateNotMet=false` / `isolatedReplicaCompositeObservationGateMet=true`；LIVE production `liveProductionCompositeObservationGateMet=false`。
- `preflight.readyForStageCAccept=true`（prep accept **request**，not cutover）。`preflight.stageCAccept=false`。`preflight.cutoverFlagOff=true`。
- 本包申请 Stage C Prep Accept，不自授，不授权 Stage D/E。

## 7. 守住的状态

```
stageC: prepared-awaiting-independent-accept
requestsStageCAccept: true
authorizesStageCAccept: false
stageCAccepted: false
stageCPrepAccepted: false
stageBImplementationAccepted: true
authorizesStageBImplementationAccepted: false
cutoverFlag: off
implementationVerified: false
remaining = 10
liveWriteWatchIndex = 10
P5 present
Item 7: not-met
Phase 1B: blocked
deployAuthorized: false
I3: not executed
LIVE: forbidden
isolatedReplicaAcceptanceMet: true
productionReceiptsAcceptanceMet: false
productionLiveReceiptsObserved: 0
isolatedReplicaReceiptsObserved: 103
authorizesStageD: false
proposedPolicy.status: proposed-not-active
```

## 8. 政策修订提案（未激活；需独立批准；历史 #877，本包不再提案）

**activePolicy.minSampleSize=100**（#866 复合门，现行）。**proposedPolicy.minSampleSize=60**（提案，未生效）。

本包 **不是** 又一次 60-policy proposal。#877 字段保留作历史。

### 8.1 保留不变（KEEP）

- `observationWindowMinHours=2`
- `minObservationBuckets=4`
- `bucketDurationMinutes=30`
- `consecutiveBucketsRequired=true`
- `zeroCrossTenantTolerance=0`
- `maxUnexpectedErrorRate=0.001`
- `flagOffAndFlagOnEvidenceRequired=true`

### 8.2 提案变更（PROPOSED；独立批准 + 新窗口之前不是现行门）

- `minSampleSize`: 100 → **60**
- `minReceiptsPerBucket`: **15**（硬门槛；不能靠单个胖桶累计 60 通过）
- `fail_closed_missing_authorization` ≥ 1
- `authorization_denied` ≥ 1
- 每个 tenant、每个 employee 都必须同时有 success 与 deny 样本
- `managed` **AND** `personal_local` 都必须有样本

### 8.3 理由（rationale）

速度 vs 突发风险。把 100 降到 60 可以加快 observation gate，但会提高短窗口 / 单租户 / 人工扎堆看起来“绿”的风险。**60 只有在同时具备**：均匀 per-bucket 地板（15）+ 强制 deny/authz 覆盖 + managed/personal_local 样本 + 非追溯新窗口时才可讨论。**若没有统计/运维上的清楚理由，100 仍然更保守。Glen：if no clear reason keep 100。**

### 8.4 风险分析与缓解

**风险**：更低 n 增加短窗口 / 单租户 / 人工扎堆窗口看起来 green 的机会。

**缓解**：per-bucket 15（硬）；2h；4 个连续桶；zero cross-tenant；error-rate 0.001；flag-off/flag-on 证据；强制 `fail_closed_missing_authorization` + `authorization_denied`；每 tenant/employee 都要 success+deny；managed + personal_local；**只适用于批准后的 NEW window**。

### 8.5 新验收公式（提案；ALL 必须同时成立；批准前 inactive）

提案政策 **inactive**，直到本修订被独立批准 **并且** 跑一个 **NEW** observation window。批准前不得把 60 套到任何已发生窗口。ALL must hold：

- 连续观察 ≥ 2h
- ≥ 60 条真实 shadow receipts（非合成/测试）
- 4 个连续 30min 桶，每桶 ≥ 15（禁止一个胖桶凑 60）
- ≥ 2 tenants；每 tenant ≥ 2 employees
- 每 tenant、每 employee 都有 success 与 deny
- managed 与 personal_local 都有样本
- 跨租户成功 = 0
- 非预期错误率 ≤ 0.001
- `fail_closed_missing_authorization` ≥ 1 且 `authorization_denied` ≥ 1
- 覆盖 identity_and_authorization_match / catalog_miss / tenant_mismatch / fencing_stale / fail_closed_missing_authorization / authorization_denied
- flag off 与 flag on 都有证据
- shadow 未改变用户可见 cwd / response / authz / 生产写入
- 窗口必须开始于本修订独立批准 **之后**（non-retroactive）

### 8.6 非追溯：旧 isolated-replica 窗口记 FAIL；currentWindow 是 window2 n=103

历史 isolated-replica FLAG-ON 窗口（2026-08-31 ~19:08–21:13 CST，excluded n=42；#877 快照 n=39 as of bucket 5 ~19:08–21:01 CST，4 consecutive buckets，~1h53m）：

```
excludedWindow: {label:"old-window-19:08-21:13", n:42, counted:false, failsActive100:true, notRetroactiveUnderProposed60:true, missingCoverage:["fail_closed_missing_authorization","authorization_denied"]}
historical n=39 from #877: coverage holes fail_closed_missing_authorization=0, authorization_denied=0
```

MUST 记为 FAIL under the active 100 policy。**不要**把 n=42 / n=39 标为通过。**也不要把这 39/42 条当成 proposed 60 已通过**（新政策只适用于批准后的 NEW window；not retroactive）。诚实 coverage holes on the excluded window：`fail_closed_missing_authorization=0`，`authorization_denied=0`。LIVE 仍 forbidden；这不是 LIVE / flag-on LIVE。

**currentWindow** 是 isolated-replica **window2**（#878）：

```
currentWindow: {environment:"isolated-replica", notLive:true, live:"forbidden", window:"window2", flag:"on", n:103, nShadow:103, elapsed:"2h08m46s", acceptanceMet:true, acceptanceMetUnderActive100:true}
firstCst 2026-08-31T22:00:02.192+08:00
lastCst 2026-09-01T00:08:48.720+08:00
fourConsecutive30minBuckets ["22:00","22:30","23:00","23:30"]
perBucketNShadow 22:00=24 22:30=24 23:00=26 23:30=26 close-2h=3 kind catalog_miss
requiredCoveragePresent true coverageKindsMissing []
```

### 8.7 独立审查（本包不得自接受）

- `selfAccepted=false`
- `signedAsCodexArchitecture=false`
- `requiredReviewer=flykingvip-cloud`
- 本包 `thisPacketActivatesProposedPolicy=false`
- 本包 `requestsStageCAccept=true` 且 `authorizesStageCAccept=false`

### 8.8 新证据身份

schema 从 `memory-workspace-s01-stage-c-prep/v1.1-policy-revision-60` bump 到 `memory-workspace-s01-stage-c-prep/v1.2-window2-bound`（packetRevision=3）。`policyRevisionId=propose-minSampleSize-60-keep-active-100` 保留作 #877 历史。`evidenceShaPendingMerge` 在合并后等于本 JSON 文件的 git blob SHA（identity bump；不是 n=39 窗口）。previousEvidenceFileSha=`2b3b652f9172e305cda22f1e6efaa8473a4f30cd`。#877 基线 main=`56a17e7f83338900e6f19fa2bd2d510b37696fe6`。本包从 origin/main HEAD `60c34606053aa45930da0b342f9e8d6b08d4d2bb` 分支。

### 8.9 守住的状态（本修订不改变这些锁）

```
stageCPrepAccepted=false
stageCAccepted=false
authorizesStageCAccept=false
authorizesStageD=false
implementationVerified=false
deployAuthorized=false
remaining=10
liveWriteWatchIndex=10
LIVE=forbidden
productionReceiptsAcceptanceMet=false
不编辑 Stage B #865 sidecar
不创建 s01-stage-c-prep.md
不授权 nginx / LIVE cutover
```

`isolatedReplicaAcceptanceMet=true` 仅表示 isolated replica 在 active 100 下数字已满足。LIVE production acceptance 仍未满足。Stage C 未被接受。
