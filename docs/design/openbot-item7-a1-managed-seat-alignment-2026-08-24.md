# OpenBot Item 7 · A1 Managed Seat-Path Workspace Binding Alignment (方案一)

Status: DESIGN — investigation complete, NO production code changed. Awaiting operator + CODEOWNERS confirmation before any edit.

Addendum to: `docs/design/openbot-item7-a1-canonical-workspace-binding-2026-08-26.md` (A1 design, PR #759, merged `576dabda2e`). This document supersedes the "managed side (α)" description in #759, which framed the managed change as a one-line builder swap. Investigation shows the managed path is a seat-owned projection-contract change plus a create-transaction re-key, not a swap. Operator selected 方案一 (full managed seat-path alignment) at the re-checkpoint.

Baseline: worktree `kiro-data-governance/item7-a1-inc0-managed-id-align`, HEAD `576dabda2e` (clean ancestor of `origin/main` `2adc2934b5`, 1 commit behind — trivial rebase before push).

---

## 1. Goal (unchanged from A1, managed half)

A managed (seat-owned) agent workspace must:

1. Carry a **canonical plain resource id** `ws:<tenant>:seat:<seatId>:asset:<agentAssetId>` (same shape the plain builder already emits at `src/gateway/workspace-resolver/builders.ts:13`), instead of the opaque `sha256(...).slice(0,32)` id.
2. **Project through the governed-identity projection** so the managed tool-cwd path resolves, i.e. `loadExistingGovernedWorkspaceIdentity` (`src/gateway/data-governance/workspace-catalog-projection.ts:139`) returns the workspace for a seat-owned agent, which is what `tenant-context.ts:786` (managed branch) feeds into `resolveAuthorizedAgentToolWorkspaceCwd`.

This is the prerequisite for later retiring the memory index/sync sites. This CR does **not** retire any site; Item 7 stays not-met.

---

## 2. Verified current-state mechanics (file:line)

### 2.1 Three id producers

- **Producer A** `resolveAgentGovernanceIds` — `src/gateway/data-governance/runtime-catalog.ts:455`. Emits `workspaceResourceId = sha256("ws:"+tenant+":"+agentId+":"+workspaceLocator).slice(0,32)`. Keyed by **agentId + locator**. **agentAssetId-free.** Sole caller: `beginAgentGovernanceRegistration` (the create path).
- **Producer B** `buildWorkspaceResourceId` — `src/gateway/workspace/resource-resolver.ts:429`. Emits `sha256(tenant+":"+scopeKey).slice(0,32)`, where `scopeKey` for a seat is `position:<seatId>:<agentAssetId>`. Keyed by **seatId + agentAssetId**. Sole (access-path) caller: `ensureCatalogResource` at `src/gateway/workspace/handler-bridge.ts:155`.
- **Producer C** `buildWorkspaceResourceId` (plain) — `src/gateway/workspace-resolver/builders.ts:4`. Seat form → `ws:<tenant>:seat:<seatId>:asset:<agentAssetId>`. This is the target canonical shape. Not currently on the managed create/access hot path.

Consequence: for the **same** workspace, the create path (A) and the access path (B) compute **different** ids today, from **different inputs**. Any format change must converge both onto one function driven by one set of inputs.

### 2.2 Create transaction ordering (`src/gateway/server-methods/agents.ts`)

- `beginAgentGovernanceRegistration(...)` at `:747` returns `{ agentResourceId, workspaceResourceId }` (sha256, agentAssetId-free) and — internally (`runtime-catalog.ts:469`) — **persists two pending rows** (agent + workspace) keyed by those sha256 ids, with owner `{ kind:"position", seatId }` for managed, **before** any physical materialization.
- Physical materialization (`ensureAgentWorkspace`, `mkdir`, `writeConfigFile`) runs at `:770`–`:800`.
- The create tx runs at `:806`–`:896`: `upsertOwnershipRecord` `:810`, `bindAgentAssetToSeatForTenant` `:821`, **`createAgentAsset` `:830` → `registryAssetId = asset.agentAssetId`** (this is the first moment `agentAssetId` exists), `setPrimaryOwner` `:839`, `saveAgentRegistryStore` `:846`, audits `:855`–`:880`, IDENTITY.md `:882`–`:892`, `activateAgentGovernanceRegistration(governanceIds)` `:894`.
- `governanceIds.workspaceResourceId` is **not read or persisted anywhere** between `:747` and `:830` (confirmed: config write uses agent config; ownership/seat/registry are keyed by tenant/agent/seat, never by workspaceResourceId; the success payload at `:930` does not include it). It lives only in a local var, consumed at `activate` `:894` and, on failure, at `compensateAgentCreateFailure`.
- `activateAgentGovernanceRegistration` (`runtime-catalog.ts:519`) **reuses** the begin ids (pending→active on those exact rows); it does not recompute.
- Abort/rollback: `compensateAgentCreateFailure` (`src/gateway/data-governance/create-compensate.ts:125`) → `abortAgentGovernanceRegistration` (`runtime-catalog.ts:552`) drives the **begin ids** through recovery_required → quarantine.

Implication for WALL 2: the plain seat id needs `agentAssetId`, which only exists at `:830`, i.e. **after** begin's pending write at `:747`. The reason begin can write before `agentAssetId` exists is precisely that the current id is agentAssetId-free (sha256 of agentId+locator).

### 2.3 Two projection paths, two consumers

- **`loadExistingGovernedWorkspaceIdentity`** — `src/gateway/data-governance/workspace-catalog-projection.ts:139`. **USER-ONLY**: `USER_OWNED_ASSET_ID = /^ws:([^:]+):user:([^:]+):asset:(.+)$/` (`:20`), `projectActiveWorkspace` returns `null` when `owner.kind !== "user"` (`:48`), and `parseUserOwnedAsset` requires `userId === params.userId`. Consumers: `tenant-context.ts:786` (managed branch → `resolveAuthorizedAgentToolWorkspaceCwd`) and the read-only phase1b diagnostics. **This is where the managed goal is blocked.**
- **`projectDurableWorkspaceToResolver`** — `src/gateway/data-governance/runtime-catalog.ts:335` + `mapCatalogOwnerToWorkspaceOwnerScope` (position → `{ kind:"position_owned", seatId, agentAssetId:"catalog:<resourceId>" }`, a synthetic placeholder). Consumer: `handler-bridge.ts:188` (access path). Already tolerates seat owners, so the access path resolves managed today (on its own sha256 idB).

So the managed goal is specifically about the **governed-identity path** (`loadExistingGovernedWorkspaceIdentity` / tool-cwd), which is user-only and cannot see seat-owned rows.

### 2.4 Store rekey mechanics (`src/gateway/data-governance/catalog-store.ts`)

- Surface: `get` / `put` / `compareAndPut` / `remove` / `list`. **No in-place resourceId rename.** `resourceId` is the record map key AND is embedded in the envelope; `compareAndPut` rejects `resource_id_mismatch` (`:257`). Terminal-lifecycle rows are immutable (`:210`, `:246`).
- Therefore a format change is a **two-key operation**: `put(newRecord)` at the plain id, then retire/`remove` the old sha256 id — the same compensating dual-write shape `begin` already uses.
- `upsertWorkspaceGovernanceRecord` (`runtime-catalog.ts:271`) maps owner via `mapOwnerAndScope` and `put`s a record; it **never rekeys**. It is **not a freeze-watched symbol** (freeze-safe mint mechanism).

### 2.5 Freeze scanner (`docs/design/evidence/memory-workspace-phase0-inventory{,-scan}.mjs`)

- Watched **synthesis** symbols: `createEmptyWorkspaceCatalog`, `buildUserOwnedWorkspaceCatalogEntry` (`inventory-scan.mjs:8`). Full watched set `ALL_NAMES` = P1–P8 (`inventory-scan.mjs:14`). Helper regex `HELPER_NAME = /^(?:__resolve[A-Za-z0-9]+|resolve\w*WorkspaceDir)$/` (`inventory-scan.mjs:7`).
- `evaluateFreeze` (`inventory.mjs`): `freezeKey` includes **file + line**; `added` = production call sites whose key is not in the pinned baseline; `addedHelpers` = new resolver-helper defs; `ok = added.length===0 && addedHelpers.length===0`. Baseline is a CODEOWNERS-pinned git blob; a working-tree baseline is refused.
- Freeze-relevant facts for this change:
  - `buildWorkspaceResourceId` (both A/C module copies), `upsertWorkspaceGovernanceRecord`, `beginAgentGovernanceRegistration`, `activateAgentGovernanceRegistration`, and the store API are **not watched** → safe to add call sites.
  - Editing `workspace-catalog-projection.ts` with pure regex/branch logic is invisible to the scanner **provided** it does not call a watched symbol and does not define a `resolve*WorkspaceDir`/`__resolve*` helper.
  - **Gotcha:** `builders.ts:105` already contains a watched `buildUserOwnedWorkspaceCatalogEntry` call site pinned by line number. If a new export is inserted **above** line 105, that watched call shifts to a new line → new `freezeKey` → freeze FAILS. Any new builder must be appended **below** the existing watched call sites, and must **not** itself call `buildUserOwnedWorkspaceCatalogEntry`.

### 2.6 Backfill pattern (`src/conversations/source-identity-migration.ts`)

- Idempotent: existence-check-before-write plus an alias side-table (`migrateLegacySourceBindings:99` → `getSourceIdentity`; if absent `saveSourceIdentity` + `saveLocatorAlias`). Legacy rows are **not** hard-deleted.
- Invoked as a service method via lazy dynamic import (`src/conversations/service.ts:1498`), not `openbot doctor` and not a standalone one-shot.
- Catalog enumerate pattern: `getSharedDataGovernanceCatalog(...).list("workspace")` (used read-only by `phase1b-item5-registry-catalog-mismatch.ts:90`).

### 2.7 seatId → agentAssetId recovery gap

- `resolveExactGovernedAgentAssetId` (`exact-agent-asset-id.ts:15`) and `resolveLegacyAgentAssetId` (`classify-registry.ts:36`) key off **(tenant, legacy agentId)**, not seatId. A position envelope carries `{ kind:"position", seatId }` only — no `agentAssetId`, no `agentId`.
- To recover `agentAssetId` for an existing seat-owned row, the migration must enumerate the registry: open seat bindings (`ownerType==="seat" && ownerId===seatId && !endedAt`) or seat-store default assets. **This can be ambiguous** (a seat may hold multiple assets), and must fail closed (skip + report) exactly like the existing `DUPLICATE_LEGACY_AGENT_MAPPING` guard.

---

## 3. The five walls (all verified)

| #   | Wall                                                                                                                              | Evidence                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| W1  | Two producers (A create, B access) key the same workspace differently, from different inputs                                      | runtime-catalog.ts:455 vs resource-resolver.ts:429   |
| W2  | Plain seat id needs `agentAssetId`, minted at `:830`, after begin's pending write at `:747`                                       | agents.ts:747 vs :830                                |
| W3  | Governed-identity projection is user-only; seat-owned managed rows return `{}`                                                    | workspace-catalog-projection.ts:20,48                |
| W4  | Existing seat rows can't be re-keyed from row data alone; `agentAssetId` recovery needs a registry seat-join (ambiguity possible) | exact-agent-asset-id.ts:15; classify-registry.ts:36  |
| W5  | `sourceWorkspaceResourceId` soft pointers reference the old sha256 id and orphan on format change                                 | memory-register.ts:149; types.ts:188; envelope.ts:85 |

---

## 4. 方案一 architecture (plan per wall)

Design principle: **converge on the plain id, add a seat-owned read contract, migrate existing rows non-destructively (retain old rows for rollback), and touch no freeze-watched symbol.**

### W1 — one id function, one input set

Introduce a single seat/user id resolver that both paths call. The access path (Producer B, `resource-resolver.ts`) already has `seatId + agentAssetId`, so it switches to the plain builder directly. The create path (Producer A) must obtain `agentAssetId` first (W2). End-state: both paths emit `ws:<tenant>:seat:<seatId>:asset:<agentAssetId>` for the same workspace.

### W2 — defer the workspace mint to after `createAgentAsset` (two-phase within the existing transaction)

Keep `begin`'s **agent** pending row unchanged (it is `agent:<tenant>:<agentId>`, plain, agentAssetId-free — no change needed). For the **workspace** row, split into:

- `begin` still writes a **workspace pending row keyed by the agentAssetId-free provisional id** (so abort/quarantine during materialization keeps working — this preserves the current safety envelope).
- After `createAgentAsset` at `:830`, **promote/re-key** the workspace row to the plain seat id: `put` the plain-id active row, then transition the provisional-id row to a retained non-canonical state (see W4 rollback). `activate` and `abort` id sources move to the plain id for the workspace row (agent row unchanged).

Alternative considered and rejected: fully moving `begin`'s workspace pending write to after `createAgentAsset`. Rejected because it leaves materialization (`:770`–`:800`) with no workspace catalog row, so a materialization-time abort has nothing to quarantine at the catalog layer — a regression in the create-failure safety envelope.

### W3 — add a seat-owned read contract to the governed-identity projection

Extend `workspace-catalog-projection.ts` with a `SEAT_OWNED_ASSET_ID = /^ws:([^:]+):seat:([^:]+):asset:(.+)$/` branch and a seat-keyed lookup (`tenant + seatId → row`, or `tenant + agentId → seat → row`), because the managed caller in `tenant-context.ts:786` currently passes `userId`; the seat contract must be keyed on the seat/agent, not the acting user. Pure regex/branch logic — freeze-safe. The existing user-owned path is untouched (no personal regression).

### W4 — non-destructive backfill with registry seat-join

A migration enumerates `list("workspace")`, selects active seat-owned sha256 rows, recovers `agentAssetId` from the registry seat binding / seat-store default assets, computes the plain id, `put`s the plain-id row, and marks the old sha256 row retained-but-non-canonical (rollback anchor). Idempotent (skip if plain row already exists), fail-closed (ambiguous/unrecoverable seat → skip + report, never guess). No hard delete.

### W5 — reconcile `sourceWorkspaceResourceId` soft pointers

During backfill, for each re-keyed workspace, update memory rows whose `sourceWorkspaceResourceId` equals the old sha256 id to point at the plain id (or write an alias), so soft pointers do not orphan. Fail-closed and idempotent.

---

## 5. Freeze-safety summary

All new call sites land on **non-watched** symbols (`buildWorkspaceResourceId`, `upsertWorkspaceGovernanceRecord`, store API, registry reads). Projection edits are pure regex/branch. If a new builder is added to `builders.ts`, it goes **below** line 105 and does not call `buildUserOwnedWorkspaceCatalogEntry`. Expected freeze verdict: `ok=true`, `addedProductionCallSites=[]`, `addedCatalogSynthesis=[]`. Freeze is run with the trusted pinned baseline blob (no baseline JSON edit in this CR).

---

## 6. Landable increment sequencing (each its own operator-approved CR)

- **CR-M1 — forward-path + read contract (new managed agents correct).** W1 (access path → plain), W2 (create-path re-key after `createAgentAsset`), W3 (seat-owned projection read contract, tolerant of legacy sha256 rows during migration). New managed agents get plain, projectable rows; existing sha256 rows continue to resolve via the access path + legacy-tolerant read. No data migration. Freeze-safe.
- **CR-M2 — backfill existing rows.** W4 (registry-join re-key, idempotent, fail-closed, retain old rows) + W5 (soft-pointer reconcile). Ships as a migration in the `source-identity-migration.ts` idempotent style, invoked explicitly (not auto-run on hot path).

Rationale for the split: create-path and access-path ids must agree, so W1+W2+W3 are one coherent unit; the destructive-adjacent data migration (W4/W5) is isolated into CR-M2 with its own rollback story and operator approval.

---

## 7. Open decisions requiring operator / CODEOWNERS sign-off

1. **Cross-agent ownership.** `runtime-catalog.ts`, `resource-resolver.ts`, `workspace-catalog-projection.ts` are cursor-data-governance core; `agents.ts` create-tx is high-stakes. Confirm the owner-coordination path (Loom takeover / co-owner sign-in) for editing these.
2. **W2 approach:** confirm the two-phase "begin provisional + post-createAgentAsset re-key" over the rejected "move begin's workspace write later" (safety-envelope tradeoff in §4-W2).
3. **W3 lookup key:** confirm keying the seat read contract on `tenant + agentId → seat` (so `tenant-context.ts`'s existing `userId`-carrying call can be adapted) vs adding a new seat-keyed call site.
4. **W4 ambiguity policy:** confirm fail-closed skip+report for seats resolving to >1 asset (no heuristic pick).
5. **Freeze baseline:** confirm the change stays off watched symbols (no baseline regeneration needed). If any watched call site proves unavoidable, that requires a CODEOWNERS baseline regen (@gmood2008 / @flykingvip-cloud).
6. **Scope guard:** confirm no memory site is retired in CR-M1/CR-M2 and Item 7 stays not-met this cycle.

---

## 8. Test plan (per CR)

- CR-M1: managed create mints a plain-id, seat-owned, projectable row; `loadExistingGovernedWorkspaceIdentity` resolves a seat-owned managed workspace; `tenant-context.ts` managed branch resolves tool-cwd; legacy sha256 rows still resolve via access path; user-owned/personal path unchanged; cross-tenant isolation; create-failure abort still quarantines.
- CR-M2: backfill re-keys an existing seat sha256 row to plain (idempotent on re-run); ambiguous seat is skipped + reported; soft-pointer reconcile updates `sourceWorkspaceResourceId`; old rows retained for rollback.
- Gates (both): `pnpm tsgo` (0 in touched files), `oxlint` 0/0, repo-wide `pnpm format:check` clean, `pnpm build` no `[INEFFECTIVE_DYNAMIC_IMPORT]`, trusted freeze `ok=true` / `addedProductionCallSites=[]` / `addedCatalogSynthesis=[]`, retirement scan unchanged (`remaining=10`), Item 7 not-met.

## 9. Risks & rollback

- **Blast radius:** managed agent-create is a hot path; a create-path re-key bug affects new managed agents. Mitigation: keep `begin`'s provisional pending row + abort envelope intact; re-key is additive (`put` plain) with the old row retained.
- **Data migration:** CR-M2 rewrites production Catalog rows. Mitigation: idempotent, fail-closed, retain old rows (rollback = repoint projection at retained row / delete plain rows), dry-run report first.
- **Ambiguity:** seats with multiple assets. Mitigation: skip + report, never guess.

## 10. Owner-coordination asks

- cursor-data-governance: review the projection seat contract + producer convergence.
- Owner of `agents.ts` create-tx: review the two-phase workspace re-key ordering.
- CODEOWNERS (@gmood2008 / @flykingvip-cloud): confirm freeze stays green with no baseline change.
