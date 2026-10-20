# C8 completion ledger consistency

Status: read-only ledger query. C8 does not Promote, Apply, or Rollback, and it does not open E5.2.

`decideEvolutionCompletionFromLedger` is the production entry. It asks a read-only `CompletionLedgerReader` for Proposal, Experiment, Application, Verification, Recheck, and ledger events. The caller cannot submit `promotion.completed` as a fact. A raw array passed to `decideEvolutionCompletion` fail-closes with `caller_promotion_rejected`.

## Snapshot

`packages/evolution-core/src/c8-ledger-replay.json` is the structured fixture. `packages/evolution-core/src/c8-ledger-replay.jsonl` is the same event list as a hash-chained control-plane ledger. `createMemoryEvolutionLedger` loads that chain.

The real A10 query is tenant `001`, proposal `evo:diag:8bee2c37b1f39478`, experiment `exp:cmd-a9-exp-down`, application `app:cmd-a9-active-up`. That chain contains `evt-a10-verification-ok` (`verification.completed` at `2026-09-22T09:53:14.997Z`) and a `STILL_OPEN` recheck. It does not contain a matching `promotion.completed`.

Foreign events in the same file are excluded by the query:

- tenant `999` (`evt-c8-foreign-tenant`)
- proposal `evo:other` (`evt-c8-foreign-proposal`)
- application `app:cmd-a9-canary-b-up` (`evt-c8-foreign-application`)

`app:c8-closed-loop` is a labeled closed loop on the same proposal and experiment. Its `promotion.completed` is `evt-c8-closed-promotion` at `2026-09-22T10:00:00.000Z`, after verification and recheck. It is not an A10 production promotion.

## A/B decisions

Both `projectDiagnosisM1Closure` and `projectC6M1Status` read the same ledger query. Compared fields: `applicationVerified`, `recheckOutcome`, `promotionEligible`, `promotionCompleted`, `userVisibleStatus`. Diagnosis also matches `recommendation` through the shared decision.

| Query                | promotionCompleted | userVisibleStatus  | reasonCode          |
| -------------------- | ------------------ | ------------------ | ------------------- |
| A10 real application | false              | 已验证，进化未完成 | finding_still_open  |
| labeled closed loop  | true               | 已完成进化         | completion_accepted |

A second `createFileCompletionLedger` read after mutating the first result returns the same decision. The judge does not keep process memory.

## Fail-closed

- `callerPromotionEvents` is rejected before the ledger is read.
- A reader that returns an event outside the query fail-closes `ledger_query_mismatch`.
- Duplicate Proposal, Experiment, Application, Verification, or Recheck rows fail-close `ledger_duplicate_object`.
- A promotion timestamp that is not later than Verification and Recheck fail-closes `promotion_event_early`.
- Application status `pending`, `failed`, and `rolled_back` fail-close `application_not_applied`.

## Shadow boundary

`executedConsumer=false`. `directMutatorsRetired=false`. `e52SwitchAllowed=false`. `singleTrack=false`. `isE52CutoverReceipt=false`.

C8 is not E5.2. Runtime tick and skill-auto are unchanged. No Adapter Apply ran.
