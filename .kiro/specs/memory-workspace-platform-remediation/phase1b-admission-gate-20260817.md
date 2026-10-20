# Phase 1B Admission Gate

Date: 2026-08-17  
Coordinator: `cursor-memory-platform`  
Baseline: `origin/main` `6ede51e10bdc56394d349bc48dd23bee8c0b69f4` (#448 landed)

## Decision

**Unlock: not issued.**

Phase 1A close (#448) is not write-path authorization. `section141Signed=true` is not a Phase 1B unlock. `phase1bExecutionBlocked` stays `true`. `deployAuthorized` stays `false`. No resolver write switch, memory schema v2, Catalog production write, or LIVE work is authorized by this file.

This document only opens the admission tracker. Implementation owners must not start write-path work until an independent unlock decision records all ten #448 conditions as met.

Item 2 is now dispatched as Stage A only:

`.kiro/specs/memory-workspace-platform-remediation/phase1b-item2-catalog-bootstrap-dispatch-20260817.md`

That dispatch is not an unlock. Stage B persist, items 3–7, miss=deny, and the resolver write switch remain unauthorized.

## #448 ten conditions

| #   | Condition                                                                                                                                              | Status      | Evidence                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dedicated Phase 1B unlock decision                                                                                                                     | **not-met** | This file is the admission tracker, not the unlock                                                                                        |
| 2   | Persistent workspace records admitted into the existing Data Governance Catalog through governed offline bootstrap, with §5.4 coverage gates satisfied | **not-met** | Catalog contract still reports coverage `0%`; `employee_private` / `agent_primary` / `group_shared` / `conflict_or_unknown` remain `fail` |
| 3   | `cursor-data-governance` accepts a resolver write-switch change                                                                                        | **not-met** | WS-B accepted the design change request only; write switch remains forbidden                                                              |
| 4   | Memory schema v2 ships in the same release unit as that write switch                                                                                   | **not-met** | No schema v2 implementation; WS-C runtime is v1 root-guard only                                                                           |
| 5   | Membership + AgentAsset can fail closed without path inference                                                                                         | **not-met** | Design accepted; production fail-closed on membership/AgentAsset is not proven                                                            |
| 6   | Cutover extends the existing record/guard; backup / fencing / rollback drill is green                                                                  | **not-met** | Binding/cutover design accepted; drill not run                                                                                            |
| 7   | Retirement: production old call-sites are zero before I3                                                                                               | **not-met** | Retirement still unimplemented and must stay a different owner from Freeze                                                                |
| 8   | Forward-only release gate still holds                                                                                                                  | **holding** | Standing constraint; not an unlock by itself                                                                                              |
| 9   | `deployAuthorized` stays false until a separate LIVE authorization                                                                                     | **holding** | Currently `false`; must remain false                                                                                                      |
| 10  | No LIVE migration and no Catalog SoT write from Phase 0 inventory                                                                                      | **holding** | Standing prohibition; inventory remains read-only                                                                                         |

§5.4 P0 coverage gates that item 2 must satisfy before miss=deny:

- `employee_private`: 100% Catalog records
- `agent_primary`: 100% exact `agentAssetId` mapping (no `agentId` impersonation)
- `group_shared`: 100% tenant-scoped group binding
- `conflict` / `unknown`: 100% write-blocked and listed

## Forbidden until unlock

- Edit `src/gateway/workspace-resolver/**` for a production write switch
- Edit `src/memory/**` to enable schema v2
- Write production Catalog from Phase 0 inventory / candidate
- LIVE migration
- `deployAuthorized=true`
- Flip `phase1bExecutionBlocked` to false

## Next owners

| Item                                                                         | Owner                                                                      | Authorization             |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------- |
| 2 Stage A offline candidate / shadow-compare / quarantine / coverage harness | `codex-workspace-architecture` + `cursor-data-governance`                  | **dispatched now**        |
| 2 Stage B persist classified records into existing Catalog                   | `cursor-data-governance`                                                   | after Stage A accept only |
| 3 write-switch acceptance evidence                                           | `cursor-data-governance`                                                   | before unlock             |
| 4 schema v2 same-release evidence                                            | `cursor-memory-wsc` with item 3                                            | before unlock             |
| 5 membership / AgentAsset fail-closed evidence                               | `cursor-data-governance`                                                   | before unlock             |
| 6 cutover drill evidence                                                     | `cursor-fable` + SRE (`cursor-memory-wsc`)                                 | before unlock             |
| 7 Retirement zero-call-site evidence                                         | `cursor-data-governance` (must stay distinct from Freeze / `cursor-fable`) | before unlock             |
| 1 unlock decision                                                            | independent reviewer / coordinator after 2–7 are evidenced                 | not issued                |
