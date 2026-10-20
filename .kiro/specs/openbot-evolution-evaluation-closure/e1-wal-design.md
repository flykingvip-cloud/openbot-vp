# E1 WAL Design Freeze

Gateway `previewDiagnosisCandidate` is zero-write. `submitDiagnosisCandidate` is the recoverable writer.
Live diagnose auto-submit, client Candidate RPC, `startExperiment`, and Adapter.apply stay unwired.

## Public submit vs server-resolved admit

Public E1 command:

```
submitDiagnosisCandidate({ commandId, candidate, trustedContext, grantId })
```

That public DTO does **not** accept `grantActive`, `targetKnown`, or `claimedTenantId`.
Those fields exist only on the server-resolved admit view and must come from Gateway membership / ownership / grant resolvers.

Gateway builds every authoritative field (`proposalId`, `candidateRef`, `tenant`, `target`, initial status).
Client `tenantId` / `proposalId` / candidate payload are not authority.

## States (forward only)

`pending` → `proposal_written` → `candidate_written` → `ledger_written` → `committed`

- Interrupt resumes from the last durable state and applies only missing steps.
- Append-only Ledger rows are never deleted (`deleteLedger: false`).
- `commandId` is idempotent.
- The only Ledger event is `proposal.created` with eventId `led:<commandId>:proposal.created`.
- `committed` does not produce a Ledger event.
- `ledgerEventIds` stores only events that were actually appended.
- If `proposal.created` already exists, `ledger_written` advances the receipt only and does not append again.
- Same `commandId` cannot rebind a different candidate (`command_rebind`).
- Dedup key: `tenant + surface + target + mechanism + candidateVersion`. `reportId` is source only.

## Fail-closed (zero writes)

| Condition                          | code                  |
| ---------------------------------- | --------------------- |
| missing grant                      | `grant_missing`       |
| inactive / expired / revoked grant | `grant_inactive`      |
| claimed tenant ≠ trusted tenant    | `cross_tenant`        |
| unknown / empty target             | `unknown_target`      |
| forbidden surface                  | `forbidden_surface`   |
| not first-period surface           | `unsupported_surface` |

First-period admitted surfaces: **`agent.working-dna`** and **`capability.skill-installation`**.
`capability.skill-spec` and other inventoried surfaces still return `unsupported_surface`.
Skill installation WAL admits only after Track A `SkillInstallationCandidate` validation (existing `skillId`, `operation: "install"`). Submit still does not call `startExperiment` or Adapter.apply.

Naked proposal registration is not a transaction interface. The WAL module must not import or call it.

## Fault-injection fixtures

Covered in `packages/evolution-core/src/diagnosis-ingest-wal.test.ts`:

1. no grant / inactive grant → zero writes
2. cross-tenant → zero writes
3. unknown target → zero writes
4. forbidden surface → zero writes
5. skill-spec / capsule during E3 → `unsupported_surface`; skill-installation with known target → admit
6. reportId ignored by dedup key
7. commandId replay same candidate → ok
8. commandId replay different candidate → `command_rebind`
9. resume from `candidate_written` applies `ledger_written` + `committed`
10. existing `proposal.created` → receipt only, no second append
11. `committed` never emits a Ledger event
12. source guard: no live submit / diagnosis import
