# Phase 1B Items 2-7 Evidence

Date: 2026-08-17  
Coordinator: `cursor-memory-platform`  
Baseline: `origin/main` `c7c5fa7961377bdd533a73ab42de36f4fcbe97f3` (#449 landed)

## Decision

**Unlock: not issued.**

#449 closed Phase 1A and opened the admission tracker. That is not write-path authorization. Items 2–7 must each have independent evidence before anyone may request an unlock.

This packet now has independent measurements for items 2–7. All six remain **not-met**. Unlock is not issued.

## Sequence

1. Measure and evidence items 2–7 one by one.
2. Keep production Catalog write, resolver write switch, schema v2, miss=deny, and LIVE forbidden while those items are open.
3. Only after 2–7 are `met`, request a dedicated unlock decision.
4. Write-path enablement stays after that unlock. Evidence collection is not enablement.

## Item 2 Stage A result

Harness: `docs/design/evidence/memory-workspace-phase1b-item2-stage-a.mjs`  
Snapshot: `docs/design/evidence/memory-workspace-phase1b-item2-stage-a.json`  
Scorecard: `docs/design/evidence/memory-workspace-phase1b-items-2-7-scorecard.json`

| Field                     | Value                            |
| ------------------------- | -------------------------------- |
| Phase 0 candidate rows    | 156 (not Catalog SoT)            |
| Quarantine ledger         | 144                              |
| Classified inventory only | 12 (not Catalog admission)       |
| Authority extract         | present / 0 classified (no dump) |
| Shadow-compare matched    | 0                                |
| Persistent Catalog        | missing / 0 workspace records    |
| `employee_private`        | fail                             |
| `agent_primary`           | fail                             |
| `group_shared`            | fail                             |
| `conflict_or_unknown`     | fail (listed, not write-blocked) |
| item 2                    | **not-met**                      |

## Items 3-7 result

Harness: `docs/design/evidence/memory-workspace-phase1b-items-3-7.mjs`
Snapshot: `docs/design/evidence/memory-workspace-phase1b-items-3-7.json`

| Item | Measured                                                                                                    | Status      |
| ---- | ----------------------------------------------------------------------------------------------------------- | ----------- |
| 3    | #429 is design-only; write-switch acceptance packet missing                                                 | **not-met** |
| 4    | no `files_v2` / schema v2; v1 root-guard only; no shared release unit                                       | **not-met** |
| 5    | design forbids path inference; `tool-cwd.ts` still synthesizes Catalog and uses `agentId` as `agentAssetId` | **not-met** |
| 6    | existing cutover SM reused; backup/fencing/rollback drill not-run                                           | **not-met** |
| 7    | `productionWriteWatchIndex=38`; Freeze=`cursor-fable`; Retirement=`cursor-data-governance`                  | **not-met** |

Item 3 change request (awaiting owner, not acceptance):

`.kiro/specs/memory-workspace-platform-remediation/phase1b-item3-write-switch-change-request.md`

## Next owners

| Item             | Next evidence                                                                       | Owner                                                    |
| ---------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 2 Stage A accept | Authority-sourced candidate + accept Stage A                                        | `codex-workspace-architecture`, `cursor-data-governance` |
| 2 Stage B        | Classified persist through existing `catalog-store.compareAndPut`; re-measure gates | `cursor-data-governance`                                 |
| 3                | Write-switch acceptance packet (not #429 design CR)                                 | `cursor-data-governance`                                 |
| 4                | Schema v2 same-release evidence; no `src/memory/**` enablement now                  | `cursor-memory-wsc`                                      |
| 5                | Membership / AgentAsset fail-closed proof without path inference                    | `cursor-data-governance`                                 |
| 6                | Existing cutover backup / fencing / rollback drill receipt                          | `cursor-fable` + `cursor-memory-wsc`                     |
| 7                | Retirement zero-call-site evidence; owner ≠ Freeze                                  | `cursor-data-governance`                                 |

## Forbidden

- Score item 2 `met` from this Stage A packet
- Write Catalog from Phase 0 inventory
- Resolver write switch
- Memory schema v2
- LIVE
- `deployAuthorized=true`
- `phase1bExecutionBlocked=false`
