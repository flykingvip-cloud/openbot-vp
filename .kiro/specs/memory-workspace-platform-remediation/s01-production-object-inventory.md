# S01 read-only production object inventory

- **Owner**: `cursor-data-governance`
- **Task**: `memory-workspace-platform-remediation:cursor-data-governance-s01-production-object-inventory`
- **Date**: 2026-08-31
- **Baseline**: `origin/main` `d2e23e0e3162018dde9cbbd979b6d222f0a6c788` (CR3)
- **selfAccepted**: `false`
- **Review**: request from `flykingvip-cloud`. Author must not self-merge.

This is NOT Stage B Implementation Accept, NOT Stage C Accept, NOT Stage D cutover, NOT LIVE.
`productionReceiptsObserved` stays `0`. Do not scan Aliyun.

## Gap

`migration-inventory.ts` classifies already-observed sources. The repo-tree dry-run
(`docs/design/evidence/memory-workspace-legacy-migration-dry-run.*`) inventories the
tree, not actual store objects. This slice reads actual objects from injected
controlled-store / BYOS / local-root ports.

## Shipped

| Item                                                              | Status                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/gateway/data-governance/production-object-inventory.ts`      | scanner + ports                                                                  |
| `src/gateway/data-governance/production-object-inventory.test.ts` | fixture tests                                                                    |
| Owner                                                             | sidecarProof or matching Catalog envelope only                                   |
| Missing proof                                                     | quarantine `unknown_owner`; `proposedResourceId`/`proposedCanonicalBinding` null |
| Hash                                                              | sha256 of object bytes (`mtime` ignored)                                         |
| Duplicate canonical / cross-tenant                                | conflict                                                                         |
| BYOS adapter default                                              | fail-closed, zero invented objects                                               |
| Writes                                                            | `writes:0` `catalogMutation:false` `moved:0` `deleted:0`                         |
| LIVE scan                                                         | `productionScanExecuted: false`                                                  |

## Locks

- schema: `memory-workspace-s01-production-object-inventory/v1`
- productionScanExecuted: false
- catalogWrite: false
- catalogMutation: false
- moved: false
- deleted: false
- productionWrite: false
- cutover: false
- stageC: prepared-not-accepted
- authorizesStageCAccept: false
- implementationVerified: false
- deployAuthorized: false
- phase1bExecutionBlocked: true
- item7: not-met
- remaining: 10
- liveWriteWatchIndex: 10
- LIVE: forbidden
- productionReceiptsObserved: 0
- byosEnabled: false
- guessesOwnerFromDirectoryName: false
- readsActualObjects: true

## Explicitly forbidden

Catalog write, move/delete, Stage C Accept, Stage D, LIVE, guess owner from dirname,
treat repo-tree dry-run as production inventory, enable BYOS, change retirement scan,
change get-reply helper cwd.

## Notes

Reuse `inventoryMigrationCandidates`. Do not follow directory names such as
`/users/alice/` or `/tenants/T/`. Do not touch CR3 evidence, get-reply, or the
retirement scan remaining 10/10.
