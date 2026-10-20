# Legacy migration: inventory and dry-run only (handoff)

- Task: `memory-workspace-platform-remediation:kiro-data-governance-legacy-migration-dry-run`
- Agent / owner: `kiro-data-governance`
- Branch: `kiro-data-governance/legacy-migration-dry-run`
- Worktree: `/Users/daniel/AI项目/openbot-kiro-legacy-migration-dry-run`
- originMainSha (fork point): `61c3cb90e4199ee765089631ea5fb70f8ba12652`
- Review requested: **Legacy migration inventory + dry-run only. Do not accept execution, Catalog write, cutover, or Item 7 met.**

## Why this exists

Item 7 still has `remaining=10` / `liveWriteWatchIndex=10`. A1 canonical workspace
binding is design-only. Persistent Data Governance Catalog coverage is still 0%.
Before any live migration, this packet inventories legacy data locators from the
repo tree (committed Phase 0 catalog-candidate + LIVE summary + retirement scan +
design layout) and runs a **read-only dry-run** of migration decisions.

This CR does **not** migrate data, mint Catalog rows, move/delete production
files, wire `get-reply.ts`, edit `manager-sync-ops.ts`, or change the retirement
scan.

## What changed (all new)

- `docs/design/evidence/memory-workspace-legacy-migration-dry-run.mjs` — read-only simulator (stdout only; no `writeFileSync`).
- `docs/design/evidence/memory-workspace-legacy-migration-dry-run.json` — evidence packet with locks.
- Replayable manifests:
  - `memory-workspace-legacy-migration-dry-run.manifest.json`
  - `memory-workspace-legacy-migration-dry-run.rollback.json`
  - `memory-workspace-legacy-migration-dry-run.quarantine.json`
- `docs/design/evidence/memory-workspace-legacy-migration-dry-run.test.mjs` — `node --test` locks.

## Coverage

Each record has: `sourceLocator` `resourceId` `tenantId` `ownerScope` `ownerId`
`agentAssetId` `classification` `canonicalBinding` `contentHash` `fileCount`
`byteCount` `migrationDecision` `blocker`.

Domains: Workspace, Agent, Memory, Knowledge, Conversation Archive, known legacy
roots, compatibility bindings (Item 7 remaining 10 sites as compatibility
locators).

## Rules (fail-closed)

1. Unknown ownership → **quarantine** (do not guess). Directory-inferred user ids
   stay unknown unless Phase 0 `classification=classified`.
2. Duplicate canonical binding → **block**.
3. Cross-tenant locator vs `resourceId` tenant → **block**.
4. Missing Catalog binding → **do not mint**. Persistent Catalog still absent.
5. Legal hold / retention / tombstone → **preserve** (W1 dark tombstone + tenant
   archive retention).

Dry-run never emits `migrationDecision=migrate`. Rollback is an identity no-op.

## Locks

`productionWrite=false` `catalogMutation=false` `migrationExecuted=false`
`delete=false` `cutover=false` `remaining=10` `liveWriteWatchIndex=10`
`implementationVerified=false` `deployAuthorized=false` `live=forbidden`
`item7=not-met`

## Reuse (read-only)

- `src/gateway/item7-stage-c-identity-shadow.ts`
- `src/memory/item7-stage-d-readiness.ts`
- Stage A identity/cwd adapters
- `docs/design/evidence/memory-workspace-phase1b-item7-retirement-scan.json`
- Phase 0 catalog-candidate + LIVE summary
- Item 7 shadow-dry-run / W1 tombstone packets
- A1 canonical workspace binding design

## Not done

Did not write Catalog; move/delete/modify production files; modify
`get-reply.ts`, `s01-get-reply-steward-cwd-shadow.ts`, Stage B shadow evidence,
`retirement-scan.json`, or `manager-sync-ops.ts`; set
`implementationVerified=true` / `deployAuthorized=true` / Item 7 met / Phase 1B
unlocked / I3 / LIVE; mint missing bindings; guess unknown ownership; merge;
self-accept.
