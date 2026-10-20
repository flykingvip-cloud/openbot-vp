# Phase 1B Item 2 Dispatch: §5.4 Catalog Bootstrap

Date: 2026-08-17  
From: `cursor-memory-platform`  
Prerequisite: #448 landed; #449 admission tracker open. Unlock is **not** issued.

## 0. One sentence

Start the #448 item 2 admission work only: governed offline bootstrap into the **existing** Data Governance Catalog. This dispatch is not a Phase 1B unlock and is not write-path authorization.

## 1. Facts that still hold

| Field                       | Value                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `origin/main`               | `6ede51e10bdc56394d349bc48dd23bee8c0b69f4` (#448)                                               |
| Admission tracker           | `.kiro/specs/memory-workspace-platform-remediation/phase1b-admission-gate-20260817.md`          |
| `phase1bExecutionBlocked`   | `true`                                                                                          |
| `deployAuthorized`          | `false`                                                                                         |
| Persistent Catalog coverage | `0%`                                                                                            |
| Catalog SoT                 | `src/gateway/data-governance/catalog-store.ts`                                                  |
| Phase 0 candidate           | `docs/design/evidence/memory-workspace-phase0-20260814.catalog-candidate.json` (inventory only) |

Phase 0 candidate coverage remains fail: `employee_private` 0 classified; `agent_primary` 12/40 exact; `group_shared` 0 tenant bindings; `conflict_or_unknown` listed but not write-blocked.

## 2. Owners

| Role                     | Agent                          | Duty                                                                        |
| ------------------------ | ------------------------------ | --------------------------------------------------------------------------- |
| Design / candidate rules | `codex-workspace-architecture` | Keep WS-A contracts; define authority-sourced candidate + quarantine rules  |
| Catalog persist          | `cursor-data-governance`       | Use existing `catalog-store` `compareAndPut`; no second Catalog             |
| Authority proof          | `cursor-data-governance`       | Read `platform-auth` membership + tenant-scoped AgentAsset / group Registry |
| Coordinator              | `cursor-memory-platform`       | Score item 2 after evidence; do not implement; do not unlock                |

## 3. Authorized now: Stage A (offline only)

1. Extract tenant-scoped authority from Registry / seat / user / group / AgentAsset. Path, realpath, `agentId`, and display name are not identity.
2. Generate a **new** governed candidate. Persistent key is `resourceId`. Do not copy Phase 0 inventory into Catalog.
3. Shadow-compare the new candidate against the Phase 0 candidate. Record adds / drops / conflicts.
4. Send `unknown` / `conflict` / `pending_authority` / unproven rows to a quarantine ledger. They must not enter the normal Catalog.
5. Add a coverage harness that measures the **persistent** Catalog, not candidate counts. Today it must still report `0%` / `fail` until Stage B persist.

Stage A acceptance:

- New candidate + shadow-compare + quarantine ledger exist as evidence.
- Catalog contract still reports `writable=false` and coverage `0%` until Stage B.
- No production Catalog write.
- No resolver, memory, or LIVE change.

## 4. Not authorized yet: Stage B (persist)

Stage B may start only after Stage A evidence is accepted by `codex-workspace-architecture` **and** `cursor-data-governance`.

Then, and only then:

- Persist **classified** records into the existing Catalog through `compareAndPut`.
- Keep quarantine out of the normal Catalog.
- Re-measure §5.4 P0 gates against the persistent store.

§5.4 gates (all required before item 2 can be scored `met`):

- `employee_private`: 100% Catalog records
- `agent_primary`: 100% exact `agentAssetId` (no `agentId` impersonation)
- `group_shared`: 100% tenant-scoped group binding
- `conflict` / `unknown`: 100% write-blocked and listed

Stage B still does **not** unlock Phase 1B. Completing item 2 does not authorize items 3–7, miss=deny, or a write switch.

## 5. Forbidden in both stages

- Treat Phase 0 inventory / candidate as Catalog SoT
- `WorkspaceResourceCatalog` durable writes or request-path synthesis
- Second WorkspaceIdentity / membership / Catalog SoT
- Edit `src/gateway/workspace-resolver/**` for a write switch
- Edit `src/memory/**` for schema v2
- Catalog miss=deny
- LIVE directory / overlay migration
- `deployAuthorized=true`
- Flip `phase1bExecutionBlocked`

## 6. Required reading

- `docs/design/memory-workspace-identity-remediation-2026-08-14.md` §5.4
- `docs/design/evidence/memory-workspace-phase1a-catalog-contract.json`
- `.kiro/specs/memory-workspace-platform-remediation/phase1a-wsa-design-deliverables-2026-08-17.md`
- `.kiro/specs/memory-workspace-platform-remediation/phase1b-admission-gate-20260817.md`
- `src/gateway/data-governance/catalog-store.ts`

## 7. Report back

```text
agent: <id>
PR: #<n>
item: 2
stage: A | B
production Catalog write: none | classified-only
coverage: employee_private=… agent_primary=… group_shared=… conflict_or_unknown=…
unlock: not issued
Phase 1B: blocked
LIVE: forbidden
```
