# Item 7 Stage D — Persistent Sync + Local-only Shadow (handoff)

- Task: `kiro-data-governance-phase1b-item7-stage-d-persistent-sync`
- Agent / owner: `kiro-data-governance` (IDE: kiro)
- Branch: `kiro-data-governance/item7-stage-d-persistent-sync`
- Worktree: `/Users/daniel/AI项目/openbot-item7-stage-d-persistent-sync`
- originMainSha: `357a78b5896c5b2efd733c416b0a642199eb83c0` (fork point; CR1 #705 present on main)
- implementationSha: see PR head
- reviewTipSha: see PR head
- Review requested: **Item 7 Stage D Persistent Sync + Local-only Shadow Review only**

## Why this exists

The Stage D CR1 technical slice (accepted) shipped its `syncMemoryAssets` command
with a **default in-memory fencing store + recovery sink that were explicitly
valid for the dark slice only** — single-flight, idempotency, and recovery
breadcrumbs did not survive a restart or hold across workers. This change builds
the durable infrastructure that deferral requires, plus a local-only staging
adapter and a dark shadow/canary. It changes **no production behavior**: the three
P8 `syncMemoryFiles` call-sites (S33/S34/S35) stay legacy-only and un-retired, the
canonical scan is untouched (`retiredThisChange=0`, `remaining=10`, Item 7
`not-met`), and cloud/BYOS stay off.

Everything here is delivered as **new files** that implement the existing Stage D
interfaces (imported type-only). `item7-stage-d-memory-sync.ts` and
`manager-sync-ops.ts` are **not modified**.

## What changed (all new)

- `src/memory/item7-stage-d-persistent-store.ts` — persistent, cross-process
  fencing + completion store and persistent recovery-receipt store/sink.
- `src/memory/item7-stage-d-local-adapter.ts` — `local-only` staging → hash-verify
  → atomic-publish `StageDSyncAdapter`.
- `src/memory/item7-stage-d-shadow-canary.ts` — dark, isolated, read-only
  identity-comparison canary for the three points.
- Tests: `item7-stage-d-persistent-store.test.ts` (16),
  `item7-stage-d-persistent-store.crossproc.test.ts` (3, real multi-process),
  `item7-stage-d-local-adapter.test.ts` (8), `item7-stage-d-shadow-canary.test.ts`
  (9). Fixture: `src/memory/__fixtures__/stage-d-fence-worker.ts`.
- Evidence: `docs/design/evidence/memory-workspace-phase1b-item7-stage-d-persistent-sync.json`
  (+ `.test.mjs`).

## Store schema (on-disk, controlled placement)

Root: `resolveStateDir()/data-governance/stage-d-sync` (the caller never supplies
a path; only tenant/resource/operation identity, which is validated and hashed
into governed filenames — no wire path ever reaches disk unsanitized).

| Dir               | Key                      | Contents                                                                    |
| ----------------- | ------------------------ | --------------------------------------------------------------------------- |
| `held/`           | `sha256(fenceKey).json`  | `StageDHeldRecord`: fenceKey, operationId, fencingToken, state, timestamps  |
| `completed/`      | `<safeOperationId>.json` | `StageDStoredCompletion`: full identity + fencingToken + state + timestamps |
| `recovery-block/` | `sha256(fenceKey).json`  | presence = the resource is blocked until an operator resolves               |
| `recovery/`       | `<safeOperationId>.json` | `StageDRecoveryReceipt` (rich, auditable)                                   |
| `resolved/`       | `<safeOperationId>.json` | operator resolution record                                                  |

`safeOperationId` = `assertSafeRecoveryReceiptToken` (rejects `:` `/` `..`,
fail-closed). Durable writes use `writeJsonDurable` (temp + fsync + rename).

## CAS / fencing

`tryAcquire(fenceKey, operationId, fencingToken)`:

1. If a `recovery-block/` file exists for the fence → `concurrent` (halt; only an
   operator resolve lifts it).
2. Else `fs.openSync(heldPath, "wx", 0o600)` — the **O_EXCL** exclusive create is
   atomic across processes at the OS level, so exactly one caller wins; no
   check-then-write race.
3. On `EEXIST`, read the held record and classify:
   - `state === "recovery_required"` → `concurrent`
   - same `operationId` + same `fencingToken` → `acquired` (crash resume)
   - same `operationId` + different token → `stale_token`
   - different `operationId` → `concurrent`

There is **no automatic stale takeover**: a crash-held fence persists and keeps
blocking until an operator explicitly resolves it. `release()` deletes the held
record for any non-`recovery_required` state, but **never** frees a
`recovery_required` fence (because `syncMemoryAssets` calls `release()` in a
`finally`, that must not silently clear a fence that needs operator attention).
The single-winner property is proven with a real N=8 multi-process race in the
crossproc test.

## Completion identity

`markCompleted(record)` persists the full 6-field `StageDCompletionRecord`
(`operationId` + `tenantId` + `sourceResourceId` + `destinationMode` +
`manifestSha256` + `classification`) durably; `completedRecord(operationId)`
returns exactly that 6-field subset so the (unmodified) `syncMemoryAssets`
resource-bound idempotency check (identical → replay, any-field divergence →
`operation_id_conflict`) works across a restart. The stored superset also keeps
the fencing token + state + timestamps for audit.

## Recovery state machine

`recordRecoveryRequired(input)` (rich receipt: `adapterResult`,
`expected/actualSha256`, `residualStagingRef` (relative token only),
`haltCompensation:true`, `retryEligible`, `operatorAction`, `legalHold`):

1. write the rich `recovery/<op>.json`,
2. write the canonical governance A3 breadcrumb (`writeGovernanceRecoveryReceipt`),
3. write the durable `recovery-block/<fence>.json`,
4. flip the held record to `recovery_required`.

**Halt-on-write-failure**: if the durable receipt write throws, the throw
propagates (never swallowed) so the caller halts and never proceeds as if
recovery were recorded. `resolveRecovery({operator, resolution, legalHold})` is
the only sanctioned way to lift a block; under **legal hold** it lifts the block
for audit closure but does **not** physically delete held/staging artifacts.

## Local-only adapter — staging / publish flow

`custodian = "device"`; `supportsMode` returns true **only** for `local-only`
(encrypted-cloud / tenant-cloud / dedicated / byos / cold-archive all refused).
`copy({operationId, manifest, files})`:

1. refuse if already published (no double-write → `already_published_no_overwrite`),
2. operation-scoped staging under the controlled root,
3. write source content (each relative path validated; escapes refused),
4. **recompute** the staging manifest hash from the bytes actually written and
   verify it equals the source manifest **before** publishing,
5. **atomic publish** via `rename(staging → published)` on the same filesystem,
6. return `{ok:true, writtenSha256}`.

Any failure (copy exception, staging hash mismatch, publish failure) leaves
staging **quarantined** (not deleted), publishes nothing, never falls back to a
host path, and returns `{ok:false, partial:true}` so the caller records
`recovery_required` and halts.

## Dark shadow / canary scope

`runStageDLocalOnlyCanary` runs the controlled local-only sync (`syncMemoryAssets`

- persistent store + local adapter) against an **isolated fixture** and does a
  **read-only** identity comparison against the legacy/source hash. It is
  **env-gated** by the Item 7 W1 dark dual-read flag (production default = no-op /
  `null`). It never touches the three call-sites, never writes the production
  Catalog, never enables cloud/BYOS. `productionWrite=legacy-only`,
  `stageDControlledWrite=shadow-only`. A mismatch sets `quarantine=true`, keeps
  production legacy-only, performs no automatic Catalog correction, and yields an
  auditable mismatch receipt (`writeStageDCanaryReceipt`).

## The three points are NOT identical

| Point | Ledger | canonical-scan line | Business phase     |
| ----- | ------ | ------------------- | ------------------ |
| S33   | S33    | 1062                | `admission-import` |
| S34   | S34    | 1252                | `safe-rebuild`     |
| S35   | S35    | 1343                | `unsafe-rebuild`   |

`STAGE_D_CANARY_POINTS` keeps a distinct business phase and a separate receipt per
point; the canary test asserts all three phases are distinct.

## Fail-closed / crash-restart proofs (tests)

- **Cross-process single winner**: N=8 concurrent processes race the same fence;
  exactly one `acquired`, the rest `concurrent`.
- **Restart replay**: a completion written by a child process replays in a fresh
  parent store instance.
- **Restart recovery block**: a `recovery_required` block written by a child still
  blocks a fresh parent store; only an explicit resolve lifts it.
- **Stale token** rejected; **atomic CAS** single winner in-process.
- **Receipt-write-failure halt**: with the `recovery/` dir path blocked,
  `recordRecoveryRequired` throws and does **not** record a false block.
- **Adapter**: staging-hash publish, copy exception → quarantine, hash mismatch →
  quarantine + residual, publish failure → quarantine + residual, no double-write,
  raw/non-local refusal, published bytes match source.
- **Canary**: dark-off no-op, three distinct points, identity match, mismatch →
  quarantine (production legacy-only), durable receipt, cross-tenant denied,
  non-local refused (nothing published).

36 tests total (store 16, crossproc 3, adapter 8, canary 9), all green.

## Governance posture (unchanged by this change)

`item7 = not-met`, `retiredThisChange = 0`, `remaining = 10` (mirrors the
canonical scan), `liveWriteWatchIndex = 10`, `canonicalLedgerUpdated = false`,
`productionSwitch = false`, `productionWrite = legacy-only`,
`stageDControlledWrite = shadow-only`, `phase1bExecutionBlocked = true`,
`phase1bUnlock = not-issued`, `deployAuthorized = false`, `live = forbidden`,
`productionCatalogWrite = none`, `schemaV2ProductionWrite = false`,
`cloudSyncEnabled = false`, `byosEnabled = false`.

## Attribution + tree

- Loom: task `kiro-data-governance-phase1b-item7-stage-d-persistent-sync`, owner
  `kiro-data-governance`, session `8DADFB1B-72A4-45B6-911C-85D2E6873ED9`, paths
  scoped to the new store/adapter/canary/fixture files, their tests, and this
  evidence + handoff. Commits carry `Task:` / `Agent:` trailers.
- Isolated worktree; no other agent's uncommitted WIP is touched. `manager-sync-ops.ts`
  is a shared hot file but is **not** edited here (the adapter/store are new files).
- Tree is clean at hand-off except the tracked `node_modules/.bin/openclaw`
  symlinks that `pnpm install` rewrites (never staged).

## Not requested / not claimed

Not requesting: retirement of S33/S34/S35, a canonical count update, a Stage D
accepted baseline, Item 7 met, the Phase 1B unlock, LIVE, cloud/BYOS, or a
production sync switch. **Persistent-sync + local-only shadow review only.**
