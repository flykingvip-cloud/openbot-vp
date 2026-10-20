# Memory C1–C5 Index Cutover PREP (legacy remains)

Task: `memory-workspace-platform-remediation:kiro-data-governance-memory-c1-c5-cutover-prep`
Owner/agent: `kiro-data-governance`
SHA baseline: `origin/main` `e6dd9c61bc4cc0c3cf014075bfaab7adc86a6c89`

This is **PREP only**. C1–C5 stay on `resolveAgentWorkspaceDir`. Production cutover is independently rollbackable and is **not executed**. Canonical retirement scan is **not modified**.

| Field                   | Value     |
| ----------------------- | --------- |
| remaining               | 10        |
| liveWriteWatchIndex     | 10        |
| frozenWriteWatchIndex   | 38        |
| retiredThisChange       | 0         |
| implementationVerified  | false     |
| deployAuthorized        | false     |
| LIVE                    | forbidden |
| item7                   | not-met   |
| productionSwitch        | false     |
| scanModified            | false     |
| i3Executed              | false     |
| phase1bExecutionBlocked | true      |

## 1. Call-chain + trusted identity source matrix

Verified on this SHA. All five sites are `op=index`, `symbol=resolveAgentWorkspaceDir`, `trustedIdentityAtCallSite=false`.

| Label | ledgerId | File:line                              | Enclosing                                 | Callers                                                                                   | Identity at site                    | Missing                                                             |
| ----- | -------- | -------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| C1    | S30      | `src/memory/backend-config.ts:417`     | `resolveMemoryBackendConfig` (cogniweave) | `getMemorySearchManager`, `getMemorySearchManagerFromHandle`, `startGatewayMemoryBackend` | cfg + agentId                       | tenant/user/actor/grant/resourceId/Catalog/fencing                  |
| C2    | S31      | `src/memory/backend-config.ts:444`     | `resolveMemoryBackendConfig` (qmd)        | `getMemorySearchManager`, `startGatewayMemoryBackend`                                     | cfg + agentId                       | same                                                                |
| C3    | S32      | `src/memory/cogniweave-manager.ts:554` | `CogniWeaveMemoryManager` ctor            | `create` (legacy) **and** `createFromHandle` (managed — still hits 554)                   | cfg + agentId + optional governance | userId/actor/resourceId/Catalog                                     |
| C4    | S36      | `src/memory/manager.ts:152`            | `MemoryIndexManager.get`                  | builtin fallback, QMD fallbackFactory                                                     | cfg + agentId                       | tenant/resource/epoch; cache key is `agentId:workspaceDir:settings` |
| C5    | S37      | `src/memory/qmd-manager.ts:196`        | `QmdMemoryManager` ctor                   | `QmdMemoryManager.create` (no accessContext)                                              | cfg + agentId                       | same                                                                |

C3 residual: `createFromHandle` already stores a branded Handle, but the constructor still executes `resolveAgentWorkspaceDir` at line 554. That is the C3 cutover, not this PREP.

Background path: `startGatewayMemoryBackend` is cfg+agentId only and already defers managed CogniWeave until call-entry ownership proof exists (`managed_background_deferred` / `managed_identity_required`).

## 2. managed_enterprise switch plan (canonical Handle) — not executed

Reuse (do **not** turn SHADOW into a production switch):

- `src/gateway/item7-stage-c-identity-shadow.ts` + evidence packet
- `resolveMemoryIndexAccess` / `resolveMemoryIndexWorkspaceHandle`
- `resolveMemoryWorkspaceHandle` injected port
- `CogniWeaveMemoryManager.createFromHandle`

Plan per site (future independently-authorized CR):

- C1/C2: `resolveMemoryBackendConfig` accepts `MemoryIndexAccessContext`; managed collections from Handle locator/namespace; never `resolveAgentWorkspaceDir` / cwd / cfg-only.
- C3: constructor uses Handle locator when `workspaceIdentity` is a branded Handle; drop the unconditional line 554 call.
- C4: cache key = `managed:<tenantId>:<resourceId>:epoch:<epoch>:fence:<token>:<agentId>`; workspaceDir from Handle.
- C5: constructor takes access context; managed stays fail-closed until qmd roots are Handle-scoped (today `getMemorySearchManager` already fail-closes managed non-cogniweave).

Fail-closed: Catalog miss, tenant mismatch, ownership mismatch, membership/grant missing, stale epoch/fencing, workspace not indexable, background identity defer. No host fallback. No Catalog write on the hot path.

## 3. personal_local compatibility plan — keep legacy behavior

- Reachable **only** when server-resolved `securityProfile === personal_local`.
- Locator = today's `resolveAgentWorkspaceDir` (explicit profile-gated compat).
- Never a `managed_enterprise` fallback (discriminated union).
- `startGatewayMemoryBackend` personal arming, CogniWeave `create()`, QMD/builtin `INDEX_CACHE` stay as they are until a dedicated personal CR (A1 INC1/INC2 bindings) lands.

## 4. Cache isolation (tests only; not wired into `manager.ts`)

Planned managed key binds tenant + resource + governance epoch + fencing token + agentId so same-named agents, resource rebinds, and stale fencing never share an instance. personal_local key never collides.

## 5. Batch tests (shared foundation; production cutover independently rollbackable)

Covered in `src/gateway/item7-c1-c5-cutover-prep.test.ts` against the Stage C SHADOW evaluator, applied across C1–C5 ledger ids: Catalog miss; tenant mismatch; ownership mismatch (system-owned proof); membership/grant missing; stale epoch/fencing; workspace not indexable; background identity defer; personal-local regression. No production writes.

## 6. Per-site cutover / rollback / retirement checklist

See `C1_C5_PER_SITE_CHECKLIST` in `src/gateway/item7-c1-c5-cutover-prep.ts`. Every row has `executed=false`. Rollback of a future site CR = restore `resolveAgentWorkspaceDir` at that line; the SHADOW evaluator stays independently rollbackable. This PREP rolls back by reverting its own commit; C1–C5 source files and the canonical scan are untouched.

## 7. Retirement scan expected-change DRAFT only

**DO NOT modify** `docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json`.

If a future authorized cutover retired all five C1–C5 sites, remaining/liveWriteWatchIndex would project to 5 (S01/S02 personal-local residual + S33/S34/S35 Stage D). That is a math projection, not a new accepted baseline. This PREP leaves remaining=10.

## Not done / forbidden

No production cutover; no scan mutation; no `memory-tool.ts` wiring; no `get-reply.ts` / Stage B CR1 / `manager-sync-ops.ts`; no remaining decrement; `implementationVerified=false`; `deployAuthorized=false`; LIVE=forbidden; Item 7 not-met; Phase 1B blocked; I3 not executed; not merged.

## Request

**C1–C5 Cutover PREP Review only.** Does not request production switch, scan change, Item 7 met, Phase 1B unlock, or LIVE.
