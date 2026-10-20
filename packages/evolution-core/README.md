# OpenBot Evolution Core

Internal domain package for the unified evolution control plane.

This package is the **only** source of Proposal v2, Experiment, Application,
Verification, Surface, and accept-gate types. It has no Gateway, Diagnosis, or
domain-store dependency.

Diagnosis Proposal v1 remains the live write model in `src/diagnosis/evolution-proposal.ts`.
This package provides the v2 model plus a read-only v1 projection.

`EvolutionTimelineItem` is a read-only projection of that control plane (Ledger,
Proposal, Application, Verification). It is not a second write store and not a
new state machine. Each item records `proposalSchema` (`1` or `2`) and `legacy`.
`projectEvolutionTimeline` builds the list from a Ledger sequence. `system`
domain items stay out of `digitalHumanLearnedTimeline`.

Phase P1 (`perception.ts`) is a read-only projection on that list:
weekly digest, pending decisions, automatic actions (autonomy budget copied
from the caller snapshot when present), and Da Bai intent binding. Answers
are template sentences that must cite a ledger event id. `system` domain
items stay in `platformItems`. Nothing here writes Ledger, opens a second
fact store, or changes autonomy defaults. Claim level: `code-present`.
See `docs/design/openbot-evolution-perception-execution-plan-2026-09-25.md`.

Phase P2 (`perception-p2.ts`) stays on that same projection. The observation
queue is the timeline `observing` bucket. The trigger catalog is the five
diagnosis inspection kinds plus dedupe and cooldown classification. Delivery
tiers copy the Da Bai `dlv:<factId>:<slot>` id shape: major changes are
immediate, ordinary changes are weekly. No receipt store, no live delivery,
no autonomy change. Claim level: `code-present`.

Phase D1 (`decision-surface/`) freezes the decision-surface DTOs, router,
authority resolver, audience projection, and the map from a decision command
to an existing control-plane method. It does not write Ledger, does not call
Adapters, and does not change Perception. An `accepted` receipt from
`judgeEvolutionDecisionCommand` means the command is admissible, not that it
ran. Claim level: `code-present`. Not runtime-enabled. Not production-proven.

Phase D2 (`decision-surface/employee-surface.ts`) projects the employee list
and submit over those contracts. The weekly comparison reads two read-only
snapshots (`current`, `prior`), each routed and filtered through the same D1
router and visibility; without a usable prior snapshot it is
`history-unavailable`, never zero counts. There is no history store: runtime
snapshots must come from the existing Timeline/Ledger read projection. The
mount gate `EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED` is `false`, and no
client input can change it. Claim level: `code-present`. Not runtime-enabled.
Not production-proven. Not E5.2.

Phase D3 (`decision-surface/enterprise-surface.ts`) projects the enterprise
list and submit for the enterprise admin of the trusted tenant; anyone else
gets `denied` with no rows or ids. Both surfaces share one snapshot path
(`decision-surface/snapshot.ts`). A row offers exactly the actions the D1
judge accepts. Changes to an employee's personal asset and platform canaries
that affect the tenant appear only as redacted participation views, and
hidden decisions leave no trace in the view. The gate
`EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED` is `false`. Claim level:
`code-present`. Not runtime-enabled. Not production-proven. Not E5.2.

## Local checks

```bash
pnpm --dir packages/evolution-core run test
pnpm --dir packages/evolution-core run typecheck
```
