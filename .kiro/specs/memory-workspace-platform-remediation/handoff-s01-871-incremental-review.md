# S01: #871 incremental security review (not deploy auth)

- **Owner / Agent**: `kiro-data-governance`
- **Role**: independent incremental reviewer
- **Loom**: `memory-workspace-platform-remediation:kiro-data-governance-s01-871-incremental-review`
- **日期**: 2026-08-31 (Asia/Shanghai)
- **reviewedTip / origin/main**: `aa44194ac07261763314be345ed9352ee7f05399`
- **PR**: [#871](https://github.com/gmood2008/openbot/pull/871) mergeSha=`aa44194ac07261763314be345ed9352ee7f05399`
- **selfAccepted**: `false`
- **decision**: `conditions-not-met`
- **authorizesProductionObservationDeploy**: `false`
- **authorizesStageBImplementationAccepted**: `false`
- **authorizesStageC**: `false`
- **authorizesStageD**: `false`
- **authorizesStageE**: `false`
- **implementationVerified**: `false`
- **deployAuthorized**: `false`
- **LIVE**: `forbidden`
- **remaining / liveWriteWatchIndex**: `10 / 10`
- **productionReceiptsObserved**: `0`
- **thisPacketModifiesGetReply**: `false`
- **thisPacketModifiesHandlerBridge**: `false`
- **cr3ReviewDoesNotCoverThisChange**: `true`

Independent incremental security review of already-merged #871 after CR3.
Does NOT authorize observation deploy, Stage C Accept, LIVE, or implementationVerified.
Do not merge as cutover.

本包不修改 `get-reply.ts`、`handler-bridge.ts`、retirement-scan、或 `manager-sync-ops.ts`。

## 1. Why this review exists

CR3 independent Accept (#865 sidecar) pinned get-reply blob `1b5d0fe96fc4ccf877af4086fe4f6f635aad5a45` at #860 tip `d2e23e0e3162018dde9cbbd979b6d222f0a6c788`. It explicitly does **not** cover later main.

#871 (`aa44194`) changed `get-reply.ts` and `handler-bridge.ts` **after** that review.

| item                      | CR3 (#860 / #865)                          | current origin/main (#871)                 |
| ------------------------- | ------------------------------------------ | ------------------------------------------ |
| origin/main / reviewedTip | `d2e23e0e`                                 | `aa44194ac07261763314be345ed9352ee7f05399` |
| get-reply.ts blob         | `1b5d0fe96fc4ccf877af4086fe4f6f635aad5a45` | `118872a485795e2518ad2cf4c7a35682cdf476b1` |
| handler-bridge.ts blob    | (not the #871 locator skip)                | `21f31e4bd26c5a4fec83f86a16cf7f8dc28932b2` |

Blobs differ → prior CR3 Accept must not automatically cover #871.

## 2. User red lines (verified on CURRENT main blobs)

| #   | requirement                                                                | verdict  | evidence                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | managed path still decided by controlled Handle?                           | **FAIL** | `resolveAuthorizedToolCwd` stewardException branch sets `locator = helper` and **skips** `resolveTrustedAgentLocator` (`handler-bridge.ts:915-928`). Handle is derived from the helper path, not independently deciding managed cwd.                                                                                      |
| 2   | legacy helper only for shadow comparison, MUST NOT be authorization basis? | **FAIL** | get-reply passes `stewardWorkspaceDir: stewardHelperCwd` (`get-reply.ts:173-183`). Bridge comment: helper path "is authorized as the tool cwd locator" (`handler-bridge.ts:900-904`). Helper is production authorization basis.                                                                                           |
| 3   | missing tenant context strictly fail-closed?                               | **PASS** | `authorizeWorkspaceRootAccess` still returns `missing_tenant` when `managed_enterprise && !tenantCtx?.tenantId` (`handler-bridge.ts:624-629`). After-auth `resolveWorkspaceDirAfterAuthorization` returns null on managed when unauthorized (`handler-bridge.ts:884-885`). Test: "true missing tenant still fail-closed". |
| 4   | NO managed → personal/local helper fallback?                               | **FAIL** | Post-auth `personalFallback()` is not invoked on managed (closed). But managed steward **locator selection** uses the helper path, so production managed cwd **is** the personal/local helper. Tests assert "helper remains cwd".                                                                                         |

Honest decision: **`conditions-not-met`**. Do not rubber-stamp `accepted`. Do not set `deployAuthorized=true` or `authorizesStageC=true`.

## 3. #871 as shipped (re-read)

- `get-reply.ts:149` `cwdUserId = knowledgeContext.userId ?? (stewardException ? employeeOwnerId : null)`
- `personalFallback` still `resolveEmployeeBuiltinStewardWorkspaceDir` (`get-reply.ts:164`)
- passes `stewardWorkspaceDir: stewardHelperCwd` into `resolveAuthorizedToolCwd`
- `handler-bridge.ts` `resolveAuthorizedToolCwd`: if `stewardException`, locator = helper (`stewardWorkspaceDir`), SKIP `resolveTrustedAgentLocator`; if !helper return null; else `authorizeWorkspaceRootAccess` on helper path

Vitest (worktree, maxWorkers=1): 3 files / 18 tests passed. Passing tests encode helper-as-managed-cwd; they do not satisfy red lines 1/2/4.

## 4. Locks

```
decision: conditions-not-met
authorizesProductionObservationDeploy: false
authorizesStageBImplementationAccepted: false
authorizesStageC: false
authorizesStageD: false
authorizesStageE: false
implementationVerified: false
deployAuthorized: false
live: forbidden
remaining: 10
liveWriteWatchIndex: 10
productionReceiptsObserved: 0
cr3ReviewDoesNotCoverThisChange: true
openFindings: >=1 (F871-1 helper used as managed authorization locator)
```

Do not merge as cutover.
