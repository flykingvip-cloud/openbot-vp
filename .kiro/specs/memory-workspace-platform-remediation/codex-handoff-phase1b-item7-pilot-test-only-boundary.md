# Phase 1B Item 7：强制 Batch 24 pilot test-only 边界

修复 kiro-sot-reviewer 对 Batch 24(S26+S27 退休,PR #696)提出的**唯一阻断项**:`runEmployeeStewardCutoverPilot` 经公开 barrel 暴露、test-only 前提缺机器门禁。本任务只做该整改,**不改退休逻辑、不改 evidence 数值、不固化 baseline**。

- 任务:`kiro-data-governance-phase1b-item7-pilot-test-only-boundary`,owner=`kiro-data-governance`
- 基线:`origin/main`(集成后)

## 整改内容

1. `src/gateway/workspace-resolver/index.ts`:**删除** `runEmployeeStewardCutoverPilot` 的再导出;**保留** `provisionEmployeeStewardCutoverWorkspace` 及其类型(`StewardCutoverProvisionReceipt/Request/Result`)。index.ts 现**不含**该符号(仅一条不含符号名的说明注释)。
2. `src/gateway/workspace-resolver/provision-steward-cutover.ts`:给 pilot 加 `@internal` / TEST-ONLY JSDoc(注明"生产不得 import/re-export/调用;机器门禁强制,注释非唯一门禁")。
3. 新增 `src/gateway/workspace-resolver/pilot-test-only-boundary.test.ts`(机器门禁):
   - 遍历 `src/**`(排除 `*.test.*`、`*.test-harness.*`、`__tests__/__fixtures__/__mocks__/fixtures/test-fixtures`、以及**定义模块** `provision-steward-cutover.ts`);
   - 剥离注释与字符串后,任何生产文件 **import / re-export / 调用** `runEmployeeStewardCutoverPilot` 即 **fail**(附违规文件名);
   - 断言 `index.ts` **不含**该符号;
   - **动态遍历**(断言扫描文件数 >100),不写死当前调用数量,自动覆盖新增生产文件。
4. 测试仍直接从 `./provision-steward-cutover.js` 导入 pilot(唯一使用者 `steward-write.test.ts` 本就如此,无需改)。

## 验证(全绿)

- vitest:`pilot-test-only-boundary.test.ts` 3/3、`provision-steward-cutover.test.ts` 15/15、`steward-write.test.ts` 5/5
- node:test:Batch 24 evidence、retirement-scan real-code
- Phase 0 freeze scanner、`pnpm tsgo`、`pnpm check`、`pnpm build`、`git diff --check`、`pnpm loom lint`、agent-attribution

## 保持不变(本任务不动)

`batch24Accepted=false`(等原 kiro-sot-reviewer 复验)、accepted baseline **不**固化为 10、`retiredThisChange=2`、`remaining=10`、`liveWriteWatchIndex=10`、`sites.length=10`、Item 7=not-met、`phase1bExecutionBlocked=true`、`deployAuthorized=false`、`productionCatalogWrite=none`、`schemaV2Write=disabled`、`i3Executed=false`、`live=forbidden`。

## 明确不做

不改退休实现/scan 数值、不 `batch24Accepted=true`、不固化 baseline、不开 Batch 25、不 I3、不签发 Phase 1B unlock、不写生产 Catalog、不 LIVE。

## 下一步

通知同一个 kiro-sot-reviewer **只复验原阻断项**(test-only 机器门禁是否成立)。通过后方可由操作者接受 Batch 24。

— kiro-data-governance
