# Sync S33-S35 — controlled cutover PREP (legacy remains) (handoff)

- Task: `memory-workspace-platform-remediation:kiro-data-governance-sync-s33-s35-cutover-prep`
- Agent / owner: `kiro-data-governance` (IDE: kiro)
- Branch: `kiro-data-governance/sync-s33-s35-cutover-prep`
- Worktree: `/Users/daniel/AI项目/openbot-kiro-sync-s33-s35-cutover-prep`
- originMainSha (fork point): `e6dd9c61bc4cc0c3cf014075bfaab7adc86a6c89`
- Review requested: **Sync S33-S35 controlled cutover PREP (legacy remains) Review only**

## Why this exists

Stage D shadow is already landed: controlled `syncMemoryAssets` (#689), CR1
idempotency (#705), persistent O_EXCL/CAS store + local staging adapter + dark
canary (#721), and the production-readiness aggregator. What this PREP adds is
the **cutover input packet** for the three P8 `syncMemoryFiles` sites in
`manager-sync-ops.ts` without switching production:

| Site | Line (this SHA) | Business phase                          | Auth    | Rollback            |
| ---- | --------------- | --------------------------------------- | ------- | ------------------- |
| S33  | 1062            | admission-import                        | sync    | convergent-retry    |
| S34  | 1252            | rebuild-reindex-safe (rebuild-safe)     | rebuild | atomic-temp-db-swap |
| S35  | 1343            | rebuild-reindex-unsafe (rebuild-unsafe) | rebuild | in-place-reset      |

All three still call legacy `syncMemoryFiles`. Dark shadow
`scheduleItem7StageDMemorySyncShadow` is already fire-and-forget beside each
site. This CR does **not** replace those calls.

`src/memory/manager-sync-ops.ts` is a **shared hot file** owned by
`cursor-memory-wsc`. **No ownership request is filed** because no implementation
edit is required for this PREP. If a later Phase E cutover needs to land the
replacement, that CR must request ownership and stop rather than edit the file
without a grant.

## What changed (all new; no production switch)

- `src/memory/item7-stage-d-cutover-prep.ts` — pure PREP aggregator (markers,
  operationId mint, cutover/rollback matrix, retirement DRAFT, fail-closed
  locks).
- `src/memory/item7-stage-d-cutover-prep.test.ts` — vitest covering the
  deliverables below against the landed Stage D stack.
- Evidence: `docs/design/evidence/memory-workspace-s33-s35-cutover-prep.json`
  (+ `.test.mjs`).
- This handoff.

Reused read-only (unmodified): `item7-stage-d-readiness.ts`,
`item7-stage-d-local-adapter.ts`, `item7-stage-d-shadow-canary.ts`,
`item7-stage-d-memory-sync.ts`, `item7-stage-d-persistent-store.ts`,
`docs/design/evidence/memory-workspace-phase1b-item7-stage-d-prod-readiness.json`.

## Deliverables proven (tests; none enable cutover)

1. **Operation marker + operationId** — each site carries ledgerId, D-point,
   verified line, business/canary phase, `operationAuth`, rollback posture, and
   a safe `cutover-prep-{S33|S34|S35}-{nonce}` operationId. Empty operationId
   is denied.
2. **Idempotent execution + duplicate-submit** — same identity resubmit returns
   `idempotent-replay` with zero side effects; same operationId on a different
   resource is `operation_id_conflict`.
3. **Retry / recovery receipt** — partial copy writes a durable
   `GovernanceRecoveryReceipt` (`haltCompensation=true`, stage
   `memory_stage_d_sync`).
4. **recovery_required + quarantine** — publish/hash faults leave staging
   quarantined, destination unpublished, fence blocked until operator resolve.
5. **Tombstone / revoke propagation** — tombstoned, revoked, and
   lifecycle=retired sources deny with zero side effects.
6. **Local mirror unavailable** — clean adapter failure
   `local_mirror_unavailable` is a retryable deny (no quarantine); fail-closed
   default adapter plans and does not execute.
7. **Partial failure + process-restart recovery** — a completed operation
   replays from a fresh persistent store after "restart"; a recovery_required
   fence blocks a new operationId on the same resource.
8. **Shadow canary receipt** — dark canary match for S33/S34/S35 stays
   `productionWrite=legacy-only` / `stageDControlledWrite=shadow-only` /
   cloud+BYOS false.
9. **Cutover / rollback test matrix** — three rows, `executed=false`,
   `authorized=false`. Future cutover steps are documented only.
10. **Three-site retirement DRAFT** — proposes retiring S33/S34/S35
    (remaining 10→7) but `applied=false`, `canonicalScanTouched=false`.
    Canonical `retirement-scan.json` is byte-identical to origin/main.

## Governance posture (unchanged)

`item7 = not-met`, `retiredThisChange = 0`, `remaining = 10`,
`liveWriteWatchIndex = 10`, `implementationVerified = false`,
`deployAuthorized = false`, `live = forbidden`, `cutoverAuthorized = false`,
`productionWrite = legacy-only`, `stageDControlledWrite = shadow-only`,
`cloudSyncEnabled = false`, `byosEnabled = false`,
`phase1bUnlock = not-issued`, `productionCatalogWrite = none`.

S33/S34/S35 stay legacy. LIVE is forbidden. This packet does not mark Item 7
met, does not claim Phase 1B, and does not execute I3.

## Not requested / not claimed

Not requesting: edit of `manager-sync-ops.ts`, cloud sync, BYOS, production
cutover, canonical scan update, remaining decrement, `implementationVerified=true`,
Item 7 met, Phase 1B unlock, or merge as a live switch.
**Controlled cutover PREP (legacy remains) review only.** The real S33/S34/S35
cutover is Phase E, gated on owner coordination + unlock +
`liveWriteWatchIndex=0` + explicit operator authorization.
