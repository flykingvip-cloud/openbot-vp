# C7 completion contract

Status: shared judge only. C7 does not Promote, Apply, or Rollback, and it does not open E5.2.

`decideEvolutionCompletion` in `packages/evolution-core` is the only evolution-completion judge. A's receipt projection `projectDiagnosisM1Closure` and B's evaluation projection `projectC6M1Status` both call it. C6 no longer keeps a second completion formula.

## Evidence

`EvolutionCompletionEvidence` carries:

- tenant
- Proposal, Experiment, Application, Verification
- `DiagnosisRecheckResult` and the time it was recorded
- `EvaluationDecision` supplied by the caller
- structured `promotion.completed` events
- target, surface, and candidate
- authority result (`authorityOk`)
- guardrail result (`guardrailDegraded`)

## Decision

`EvolutionCompletionDecision` returns:

- `applicationVerified`
- `recheckOutcome`
- `promotionEligible`
- `promotionCompleted`
- `recommendation`
- `reasonCode`
- `userVisibleStatus`

`已完成进化` is returned only when `promotionCompleted` is true.

## Hard rules

1. Application status must be the explicit applied status `applied`. `pending`, `failed`, and `rolled_back` fail-close.
2. Verification must name the current Application.
3. Recheck must name the current Verification, and the rest of the object chain.
4. The `promotion.completed` event must be unique and bind tenant, Proposal, Experiment, Application, Verification, target, surface, and candidate. Another proposal's event is ignored.
5. The event timestamp must be later than both Verification and Recheck. A missing timestamp is not later.
6. `authorityOk` must be true.
7. `guardrailDegraded` must be false.
8. Only `RESOLVED` plus recommendation `promote` plus that single bound event may complete.
9. A conflict, duplicate, wrong binding, or missing required object fail-closes. A missing promotion event can remain eligible and must not complete.
10. This contract does not execute Promote, Apply, or Rollback.

## Boundary

`executedConsumer` stays false. `directMutatorsRetired` stays false. `e52SwitchAllowed` stays false. A receipt still does not write `promotion.completed`. C7 is not E5.2, and the system is not single-track.
