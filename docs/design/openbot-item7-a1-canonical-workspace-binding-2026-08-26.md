# Item 7 A1: Canonical Workspace Binding for All Profiles (design)

Status: DRAFT for operator/CODEOWNERS review. Design-only. No production code lands with this doc.

Owner: kiro-data-governance. Task: `kiro-data-governance-phase1b-item7-a1-canonical-workspace-binding`.

Related: `docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json`, the Phase 0 freeze
(`docs/design/evidence/memory-workspace-phase0-inventory*.mjs`, baseline
`memory-workspace-phase0-20260814.call-sites.json`), and the accepted S01/S02 personal-local residual
CR (#741).

## 1. Problem

Item 7 (retire the legacy host-path workspace resolver from the managed/production memory index and
sync path) has 8 remaining watched call-sites, all of `resolveAgentWorkspaceDir` (P1) or
`syncMemoryFiles` (P8) in `src/memory/`:

| Ledger   | Site                                   | Symbol                                              | Phase |
| -------- | -------------------------------------- | --------------------------------------------------- | ----- |
| S30 (C1) | `src/memory/backend-config.ts:417`     | `resolveAgentWorkspaceDir` (cogniweave branch)      | index |
| S31 (C2) | `src/memory/backend-config.ts:444`     | `resolveAgentWorkspaceDir` (qmd branch)             | index |
| S32 (C3) | `src/memory/cogniweave-manager.ts:554` | `resolveAgentWorkspaceDir` (ctor)                   | index |
| S36 (C4) | `src/memory/manager.ts:152`            | `resolveAgentWorkspaceDir` (MemoryIndexManager.get) | index |
| S37 (C5) | `src/memory/qmd-manager.ts:196`        | `resolveAgentWorkspaceDir` (ctor)                   | index |
| S33 (D1) | `src/memory/manager-sync-ops.ts:1062`  | `syncMemoryFiles` (admission-import)                | index |
| S34 (D2) | `src/memory/manager-sync-ops.ts:1252`  | `syncMemoryFiles` (rebuild-safe)                    | index |
| S35 (D3) | `src/memory/manager-sync-ops.ts:1343`  | `syncMemoryFiles` (rebuild-unsafe)                  | index |

`liveWriteWatchIndex = 10` today (these 8 managed/production sites plus the two accepted personal-local
residuals S01/S02). Item 7 is met only when the managed/production index reaches 0.

The canonical replacement is `resolveWorkspaceLocator` / `resolveMemoryWorkspaceHandle`, which resolve
a workspace from the Data Governance Catalog SoT. The retirement is blocked because **no workspace
row resolves through them today, for either profile**:

- **personal_local** has no Catalog workspace binding at all. Agent create for a non-managed device
  does not mint one (`server-methods/agents.ts`: `governanceRequired = false` for personal), and the
  hot-path fallback (`get-reply.ts` `personalFallback`) only calls `resolveAgentWorkspaceDir`. So
  `loadExistingGovernedWorkspaceIdentity` returns `{}` and the memory resolver denies
  `missing_workspace_resource`.
- **managed** DOES mint durable workspace rows, but with a **sha256** `resourceId`
  (`resolveAgentGovernanceIds` at `src/gateway/data-governance/runtime-catalog.ts:461`, and
  `buildWorkspaceResourceId` at `src/gateway/workspace/resource-resolver.ts:429`). The projection
  (`src/gateway/data-governance/workspace-catalog-projection.ts`) only surfaces rows whose id matches
  `USER_OWNED_ASSET_ID` (`ws:<tenant>:user:<userId>:asset:<assetId>`) or `SEAT_OWNED_ASSET_ID`
  (`ws:<tenant>:seat:<seatId>:asset:<assetId>`). A sha256 id matches neither, so managed rows never
  project and the resolver denies `missing_workspace_resource` for managed too.

Net: **all profiles fall back to the legacy `resolveAgentWorkspaceDir`, which is exactly why the 8
sites cannot be retired.** Closing Item 7 to zero requires that the canonical workspace binding
resolve for both personal_local and managed.

## 2. Root cause (evidence)

1. Resolver/projection contract (the canonical id shape). `workspace-catalog-projection.ts`:
   `USER_OWNED_ASSET_ID = /^ws:([^:]+):user:([^:]+):asset:(.+)$/`, `SEAT_OWNED_ASSET_ID =
/^ws:([^:]+):seat:([^:]+):asset:(.+)$/`; `projectActiveWorkspace` only projects `owner.kind` of
   `user` or `position` with a matching id. It has no id-alias mechanism (the envelope
   `projection.sourceWorkspaceResourceId` links memory assets to a workspace, it does not alias the
   workspace id itself).
2. Two `buildWorkspaceResourceId` implementations:
   - `src/gateway/workspace-resolver/builders.ts` -> plain canonical id (matches the contract).
   - `src/gateway/workspace/resource-resolver.ts:429` -> `sha256(...).slice(0,32)` (does not).
     The durable managed mint (`runtime-catalog.ts` `resolveAgentGovernanceIds` +
     `beginAgentGovernanceRegistration`, and `handler-bridge.ts` `ensureCatalogResource` via
     `resource-resolver.buildWorkspaceResourceId`) writes the sha256 form.
3. Freeze constraint (why the earlier attempt looked blocked). The freeze watches the SYNTHESIS
   symbols `buildUserOwnedWorkspaceCatalogEntry` and `createEmptyWorkspaceCatalog` (the IN-MEMORY
   resolver-catalog builders) plus P1-P8. It does NOT watch the durable SoT writer
   `upsertWorkspaceGovernanceRecord` (`runtime-catalog.ts:271` -> `buildRecord` -> `catalog.put`),
   which is already a production call-site (`handler-bridge.ts:168/177`). So a durable, provisioning
   time mint through `upsertWorkspaceGovernanceRecord` is freeze-invisible; only the hot-path
   in-memory synthesis is forbidden.

## 3. Decisions

- D1 personal identity model (proposed; confirm at review). personal_local has no userId today. Use:
  `tenantId = "local"`, `userId =` a stable local user id (the gateway client user id when present,
  else a persisted device-scoped local user id), `agentAssetId =` the agent stable id. One canonical
  binding per (local user x agent). The binding `locator` is the EXISTING workspace dir
  (`resolveAgentWorkspaceDir`), so no files move.
- D2 governance posture (proposed; confirm at review). Minting a durable workspace binding via
  `upsertWorkspaceGovernanceRecord` is the SAME mechanism the managed create path already runs in
  production without the Phase 1B unlock. It is not the forbidden LIVE / schema-v2 / production
  Catalog write the unlock decision guards. So A1 mints do not require the unlock. Item 7 stays
  not-met until INC3 lands and the scan reaches 0; the unlock stays not-issued.
- D3 = alpha (confirmed by operator). Unify on the plain canonical id everywhere (personal new mint
  AND managed id alignment), rather than teaching the projection to read sha256 ids.

## 4. Target architecture

One canonical, projectable workspace binding per agent workspace, for every profile:

- resourceId = plain `ws:<tenant>:user:<userId>:asset:<agentAssetId>` (personal/user-owned) or
  `ws:<tenant>:seat:<seatId>:asset:<agentAssetId>` (managed/position-owned), via
  `workspace-resolver/builders.buildWorkspaceResourceId`.
- durable row minted via `upsertWorkspaceGovernanceRecord` (freeze-safe), `ownerScope` = user_owned /
  position_owned, `locator` = the existing workspace dir, classification `agent.workspace`.
- Result: `loadExistingGovernedWorkspaceIdentity` projects the row -> `resolveMemoryWorkspaceHandle`
  and `resolveWorkspaceLocator` resolve for all profiles -> the 8 sites can drop
  `resolveAgentWorkspaceDir`/`syncMemoryFiles` in favor of the canonical handle/locator.

No file/data movement: bindings point at the existing on-disk workspace dir. The only migration is
Catalog rows (adding personal rows; re-keying managed rows to the plain id).

## 5. Increment plan (each its own operator-approved CR)

- INC0 managed id alignment. Replace the sha256 workspace id in `resolveAgentGovernanceIds`
  (`runtime-catalog.ts:461`) and `resource-resolver.buildWorkspaceResourceId`
  (`workspace/resource-resolver.ts:429`) with the plain canonical id; new managed rows become
  projectable. Idempotent re-key backfill of existing managed rows: recover `agentAssetId` via the
  agent registry (`loadAgentRegistryStore` by legacyAgentId), write the plain-id canonical row, retire
  the sha256 row. Cross-agent: these files are cursor-data-governance / shared; requires their
  coordination. De-risked: managed LIVE is not deployed (`deployAuthorized=false`), so existing
  durable managed rows are few or none. Verify: managed `resolveMemoryWorkspaceHandle` resolves;
  freeze ok (no watched symbol added); no id left as sha256 after backfill.
- INC1 personal provisioning mint. In the personal branch of agent-create
  (`server-methods/agents.ts`), after `ensureAgentWorkspace`, call `upsertWorkspaceGovernanceRecord`
  with the plain id + user_owned scope + `locator` = the workspace dir. Fail-open for personal (a mint
  failure must not block agent create; log + continue on legacy). Tests: personal create mints a
  projectable binding; idempotent; cross-tenant isolation; no managed regression.
- INC2 unified backfill. An idempotent doctor/migration that enumerates existing agent workspace dirs
  (`agents/workspace-dirs.ts`) and upserts the plain-id binding for personal (and any residual managed
  rows), modeled on `agent-registry/backfill.ts` + `second-wave-migrate.ts`. Dry-run + apply; report
  created/already-present/skipped.
- INC3 retire the 8 sites. With bindings resolving for all profiles, replace
  `resolveAgentWorkspaceDir`/`syncMemoryFiles` at C1-C5 (+S33-S35) with the canonical
  handle/locator, keeping a fail-closed path (deny rather than legacy fallback) once the binding is
  guaranteed by INC1/INC2. Per-site or per-small-group CRs. Cross-agent (cursor-\* own the site
  files). Each drops `liveWriteWatchIndex`; the CODEOWNERS-pinned freeze baseline is updated as the
  count decreases. When the managed/production index reaches 0, Item 7 is scored met (separate
  governance step, not this project).

Ordering: INC0 and INC1 are independent and can proceed in parallel; INC2 depends on the plain-id
convention from INC0/INC1; INC3 depends on INC1+INC2 (personal) and INC0+INC2 (managed) so no profile
falls back at a retired site. INC3 must not land for a site until that site is proven to resolve for
BOTH profiles in production-equivalent tests.

## 6. Freeze and governance safety

- Mint (INC0/INC1/INC2) uses `upsertWorkspaceGovernanceRecord`, not a watched symbol -> freeze
  `ok=true`, `addedProductionCallSites=[]`, `addedCatalogSynthesis=[]`.
- Retirement (INC3) removes watched P1/P8 calls -> a removal, not an addition -> freeze stays green;
  the baseline JSON is lowered under CODEOWNERS review (@gmood2008 / @flykingvip-cloud).
- Item 7 stays not-met and the Phase 1B unlock stays not-issued until INC3 completes and an
  independent governance step scores it. No LIVE, no schema v2, no production cutover in this project.

## 7. Risks and mitigations

- R1 managed re-key data migration (INC0). Existing managed rows change resourceId. Mitigation:
  idempotent backfill, keep the old row retired (not deleted) for rollback, and gate on "managed LIVE
  not deployed" (few/no rows). Rollback: restore from the retired rows.
- R2 personal identity churn. If the chosen personal userId is not stable across restarts/devices, a
  user could get duplicate bindings. Mitigation: persist the local user id; D1 must pick a stable
  source; INC2 backfill is idempotent on (tenant,user,asset).
- R3 index location change. If a binding locator ever differs from the legacy dir, memory would
  re-index at a new path. Mitigation: bind to the EXISTING dir (locator = `resolveAgentWorkspaceDir`);
  no file move; add a test asserting locator equals the legacy dir.
- R4 cross-agent hot files (INC0 core Catalog, INC3 site files). Mitigation: coordinate/loom-takeover
  under operator authorization; per-CR review; keep each CR minimal and reversible.
- R5 personal mint failure blocking agent create. Mitigation: personal mint is best-effort/fail-open
  (agent create still succeeds on legacy); INC2 backfill repairs any misses.

## 8. Owner coordination and decisions required

- Cross-agent: INC0 touches `runtime-catalog.ts` / `workspace/resource-resolver.ts`
  (cursor-data-governance and shared); INC3 touches the C1-C5 site files
  (cursor-conversation-lifecycle / cursor-data-governance) and S33-S35 (`manager-sync-ops.ts`,
  cursor-memory-wsc). Each needs the owner coordinated + operator per-CR approval.
- Operator/CODEOWNERS: confirm D1 (personal identity model) and D2 (governance posture); approve the
  freeze-baseline lowering at each INC3 site (@gmood2008 / @flykingvip-cloud).

## 9. Non-goals

Not in this project: scoring Item 7 met, issuing the Phase 1B unlock, LIVE / production cutover,
schema v2 write path, cloud/BYOS. Those remain gated and separate.
