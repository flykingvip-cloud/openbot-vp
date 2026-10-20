# Phase 1B Item 7 Batch 26 / S01+S02 Personal-Local Residual Acceptance

按 operator 决定 **A2**:将 S01(`src/auto-reply/reply/get-reply.ts:164`,`resolveEmployeeBuiltinStewardWorkspaceDir`)与 S02(`get-reply.ts:165`,`resolveAgentWorkspaceDir`)正式认定为 **personal_local 首次物化残留**,**不计入** Item 7 生产退役目标。这是 evidence-only CR:无代码改动、baseline 保持 10、scan 不动、Item 7 收口目标重定为 8 个托管/生产点。

任务:`kiro-data-governance-phase1b-item7-batch26-s01-s02-personal-local-residual-acceptance`,owner `kiro-data-governance`。

## 为什么"接受残留"而非"退役"(两堵墙)

- **墙 1 — 语义门(#725,已验收合并)**:personal_local 在调用点无可信 principal,只有 agentId(S02)/employeeOwnerId(S01)+cfg;`LEGACY_LOCATOR_CALLER_MATRIX` P1 规定 agentId-only 的 canonical 查询必须 fail-closed(`agent_id_slug_query_forbidden`);原则 #3 禁止用 agentId slug 推导所有权。resolver swap 循环。
- **墙 2 — freeze 合成禁令(本批实测确认)**:我实现了 `resolvePersonalWorkspacePrincipal`(用 `device-identity` 的稳定 `deviceId` 作本地安装 owner)+ `provisionPersonalWorkspace`(placement + Catalog-first 绑定 + fencing)并接进 get-reply,跑 trusted Phase 0 freeze → **ok=false**:`buildUserOwnedWorkspaceCatalogEntry` 是受监视的 `SYNTHESIS_SYMBOL`,在生产读路径 mint Catalog 绑定 = `addedCatalogSynthesis`(freeze 禁止)。**生产只能读已存在的 canonical 绑定,不能合成**;而 personal_local 无预存绑定。实现尝试已回滚,无残留。**未**用内联构造去规避受监视符号(那会规避 freeze 检测、违背治理本意)。

## Managed 侧已 fail-closed(无多租户风险)

`resolveWorkspaceDirAfterAuthorization`(`src/gateway/workspace/handler-bridge.ts:872`):trusted locator 命中则用之;否则 `managed_enterprise` 直接返回 `null`(fail-closed);仅 `personal_local` 才调用 `personalFallback`(S01/S02 所在)。故 **S01/S02 在 managed_enterprise 下永不可达**,不承载托管/多租户隔离风险。

## Item 7 收口目标重定

生产退役目标 = **8** 个托管/生产 memory index/sync 点(`backend-config.ts:417/444`、`cogniweave-manager.ts:554`、`manager-sync-ops.ts:1062/1252/1343`、`manager.ts:152`、`qmd-manager.ts:196`),经 Stage C 托管身份线程 + Stage D 持久化同步 + shadow/canary 收敛。**S01/S02 作为已接受的 personal_local 残留被排除在"归零"目标之外**(生产不能合成其绑定,managed 也永不可达)。Item 7 = met 需上述 8 点达到诚实终局。

## 诚实全零路径(A1,已推迟)

若未来要求名义上"全部归零",A1 = 持久化个人 Catalog + onboarding/首启一次性 provisioning(在**非生产读路径** mint 绑定)+ 迁移/backfill + get-reply 只读绑定。属多模块架构工程、高 blast radius(默认 personal_local 工作区路径),与本次 acceptance 分离。

## Posture(未变)

`previousAcceptedBaseline=10`;`retiredThisChange=0`;`remaining/liveWriteWatchIndex=10`;`frozenWriteWatchIndex=38`;scan 未改;get-reply.ts 未改;`item7=not-met`;`unlock=not-issued`;`phase1bExecutionBlocked=true`;`deployAuthorized=false`;`live=forbidden`;`productionCatalogWrite=none`;`schemaV2ProductionWrite=false`。S26/S27 退役、Stage C/D 状态不回退。

## 请求审查

**仅请求 S01/S02 Personal-Local Residual Acceptance Review。** 不申请退役、baseline 变更、Stage C 生产接线、Item 7 met、Phase 1B unlock 或 LIVE。
