# Phase 1B Item 7 retirement batch 22 (S25)

This round retires **one** live ledger site: `src/gateway/workspace-resolver/steward-write.ts` `resolveEmployeeStewardTargetWorkspaceDir` at the writable-dir call site (S25). It does **not** mark Item 7 met.

Executor takeover: Item 7 retirement handed from Cursor (`cursor-data-governance`, historical owner of batch 1–21) to Kiro (`kiro-data-governance`) via verify-then-take. Cursor batch 1–21 sessions are preserved in `.loom/registry.yaml`.

| Field                           | Value               |
| ------------------------------- | ------------------- |
| status                          | retirement-batch-22 |
| sites retired                   | S25                 |
| remaining / liveWriteWatchIndex | 12 / 12 (proposed)  |
| previousAcceptedBaseline        | 13 (S24 / #665)     |
| item7                           | not-met             |
| phase1bExecutionBlocked         | true                |
| phase1bUnlock                   | not-issued          |
| deployAuthorized                | false               |
| live                            | forbidden           |
| productionCatalogWrite          | none                |
| schemaV2ProductionWrite         | false               |
| rollbackProof                   | true                |
| quarantineProof                 | true                |
| absorbsUnacceptedBatches        | false               |

## Controlled target-binding capability required by S25

S25 is the cutover **target** locator. The existing controlled resolvers (`resolveWorkspaceLocator`, `resolveWorkspaceResource`) only ever return the unique **canonical/active** binding, which pre-cutover is the **source**. Reading the target through them would collapse target→source and break the accepted `steward-write.test.ts` "routes writable cwd to D1e target after cutover" test. So this batch adds a narrow, controlled resolver:

- **`resolveWorkspaceTargetBinding`** (`src/gateway/workspace-resolver/strict-locator.ts`) — reads the unique `role=compatibility`, `state=read_only` **target binding** already present in the Catalog SoT for the same `resourceId`.
- It shares **all** identity/authorization validation with `resolveWorkspaceLocator` via the extracted `validateWorkspaceLocatorQuery` helper (tenantContext, tenantId, actor, grant, resourceId, agentAssetId, membership SoT, tenant match, ownerScope, ambiguity). Only the final binding **selection** differs (target instead of canonical source).
- Uniqueness: `0` target bindings → `catalog_miss` fail-closed; `>1` → `multi_binding` fail-closed. Never selects the first match; **never falls back to the canonical/source binding**.
- Returns a restricted result (`WorkspaceLocatorResult`): `ok=true` exposes only the target locator; `ok=false` carries a stable `reasonCode`. It performs **no** mkdir / copy / write / delete / Catalog mutation.

`resolveWorkspaceLocator` behavior is unchanged (proven by the 25-case strict-locator contract suite). The source/target **ownership model and `resourceId` scheme are unchanged**.

## Fixed single-point list

| Item                  | Value                                                                                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| batch                 | 22                                                                                                                                                                                                                   |
| ledgerId              | S25                                                                                                                                                                                                                  |
| file                  | `src/gateway/workspace-resolver/steward-write.ts`                                                                                                                                                                    |
| symbol (retired)      | `resolveEmployeeStewardTargetWorkspaceDir`                                                                                                                                                                           |
| line                  | 153 (unchanged; S26/S27 stay at 279/280)                                                                                                                                                                             |
| original locator      | `resolveEmployeeStewardTargetWorkspaceDir({ tenantId, userId, stateDir })` — host path builder under `stateDir`                                                                                                      |
| replacement           | `resolveWorkspaceTargetBinding({ catalog, cfg, tenantId, tenantContext, actor:{ userId, grant }, agentAssetId: steward:builtin, resourceId })` narrowed to `handle.locator`                                          |
| host/steward fallback | **removed** — no host root, `stateDir`, `process.cwd()`, empty string, or default workspace fallback; the now-unused local `stateDir` was deleted (hoisted `stewardResourceId` keeps line count so S26/S27 stay put) |

## Authorization fields (server-trusted only)

- `tenantContext` = `{ tenantId, userId, domain: "enterprise" }`, `tenantId` from `resolveWorkspaceActorTenantId`.
- `actor` = `{ userId, grant }`; `grant` is the caller-supplied user/seat/group grant.
- `resourceId` = `buildWorkspaceResourceId({ tenantId, scope: user_owned steward:builtin })`.
- `agentAssetId` = `steward:builtin`.
- Membership SoT (platform-auth) enforced for seat/group grants by the shared validator.

## Fail-closed evidence (per S25 unit test + integration test)

- missing tenant context / tenantId / actor / grant → fail-closed (`missing_*`).
- target binding missing → `catalog_miss`; the writable resolver as a whole returns `{ ok:false, reason:"catalog_record_required" }` with **no `cwd`**, no source fallback, no target dir creation.
- duplicate target binding → `multi_binding` (ambiguous, fail-closed).
- cross-tenant resourceId → `tenant_mismatch` fail-closed.
- missing grant → `missing_grant`; grant subject ≠ owner → `auth_failure`.
- canonical source binding missing → whole `resolveEmployeeStewardWritableWorkspaceDir` fail-closes (`catalog_record_required`).
- On every deny path: zero mkdir/copy/write/stat/list/trash and no Catalog mutation.

## Rollback / quarantine proof

- `rollbackProof=true`: `restoreFromGit=true`; revert `steward-write.ts`, `strict-locator.ts`, `index.ts`, and `retirement-scan.json`; `productionWriteBack=forbidden`; `rewriteFreezeBaselineToZero=false`.
- `quarantineProof=true`: design-only; `quarantineNormalWrites=0`; `rewriteIntoNormalCatalog=false`.

## Tests and results

- Fresh-worktree prerequisite: `pnpm build:collaboration:packages` (builds the `@openbot/collaboration-*` workspace `dist/` that the test import graph transitively needs; not part of this batch's diff).
- `OPENBOT_TEST_PROFILE=low node_modules/.bin/vitest run` on `strict-locator.test.ts`, `steward-write.test.ts`, `steward-write-item7-s25.test.ts`, `steward-write-item7-s23.test.ts`, `steward-write-item7-s24.test.ts` → **44 passed / 5 files** (25-case strict-locator contract + D1e cutover integration + S25 8-case suite + s23/s24 pins).
- `node --test` on the batch 20 / 21 / 22 evidence `.test.mjs` → **3 passed**.
- `pnpm tsgo` → **zero errors in any batch 22 file** (pre-existing repo-wide errors elsewhere are unrelated and predate this batch).
- `oxlint` on the 7 changed source files → **0 warnings / 0 errors**.
- `bun scripts/agent-attribution.ts --fail-on-unattributed --fail-on-conflict` → `unattributed=0`, `conflict=0` (exit 0).
- Matrix **fail-before** evidence (recorded, not hand-waved): `src/gateway/data-governance/item7-retirement-preflight-matrix.test.ts` fails on the pre-batch tree at `originMainSha ae7168f7` with `expected 36 to be 37` (line 237, `failBefore.liveWriteWatchIndex`) — the ledger test expects `37` while the locator contract constant `ITEM7_LOCATOR_LIVE_WRITE_WATCH_INDEX` is `36`. This batch's diff vs `origin/main` touches **neither** that test / `item7-retirement-preflight-matrix.ts` (empty diff) **nor** `deny()` / the constant / `LEGACY_LOCATOR_CALLER_MATRIX` in `strict-locator.ts`, so fail-before == fail-after (identical); it is a pre-existing red unrelated to S25.

## SHAs / tree / attribution

- originMainSha: `ae7168f7a54a96a23aa77171dce5cce8af160b2e` (#669; carries the official Loom `kiro-data-governance-phase1b-item7-retirement-batch22-s25` ownership over #665 batch 21 S24). Re-fetched immediately before push; if `origin/main` advances again the push is halted, not force-rewritten.
- branch: `kiro-data-governance/item7-retirement-batch22-s25-replay-v2` (clean replay from origin/main; the interim registry/takeover commits and node_modules `.bin` shim churn were NOT replayed).
- implementationSha: `2a9dfd1771f2d55087eb9a72ecd3463975e3deec` (DGV2 code commit; evidence and tasks/handoff follow in per-landing-stream commits).
- reviewTipSha: `e87e1ed72a2834e28d7957e7fe5d2f57a21191a4` (content tip after code + evidence + tasks/handoff; this follow-up handoff-pin commit records it — a commit cannot record its own SHA).
- clean tree: the replay worktree held only origin/main + this batch's files (no other agent WIP; installed node_modules `.bin/openclaw` shim churn reverted before any commit).
- attribution (`bun scripts/agent-attribution.ts --fail-on-unattributed --fail-on-conflict`): **unattributed=0, conflict=0 (exit 0)** on the committed clean tree. origin/main #669 added `landerTask` overrides naming `kiro-data-governance-phase1b-item7-retirement-batch22-s25` the authorized lander for the shared retirement hot files (`retirement-scan.json`, `steward-write.ts`, s23/s24 tests, batch20 `.test.mjs`), so historical merged Cursor batch tasks do not form a second active lander.

## Not done this round (explicit)

- **Source/target ownership model unchanged**; no `resourceId`/`agentAssetId` scheme change; source binding NOT promoted/demoted.
- **No production Catalog row created**; `productionCatalogWrite=none`; Catalog miss=deny stays off.
- **S26 / S27 not processed** (still at lines 279 / 280).
- **Batch 23 not started.**
- Item 7 not marked met; Phase 1B not unlocked; no LIVE cutover; no schema v2 production write; `liveWriteWatchIndex` not written to 0; Phase 0 freeze baseline stays 38.
- `proposedRemaining=12` becomes the canonical accepted baseline only after Codex accepts Batch 22 (this PR merges to `main`).

## Forbidden this round

- retiring any of the remaining 12 sites in this packet
- shifting S26 / S27 watched line numbers
- writing `liveWriteWatchIndex=0`
- rewriting the Phase 0 freeze baseline
- Item 7 met, LIVE, schema v2 production write, production Catalog write, I3

## Requested review

**Item 7 Retirement Batch 22 / S25 Review only.**
