# Architecture Main-Drift Addendum — Checkpoint B Cycle 2

reviewerStableId: codex-architecture
reviewedAt: 2026-09-29
task: constitutional-runtime-activation-readiness
pr: 204

architectureReceiptSha256: 6ff86b774f77a11361e5d318eaaefce7b12bbf0f18e6cd6689a9e83363d66ec1
designHeadSha: 7a87dfdfcd0ff74e069a02df78faaa54f25a4cf9
statusHeadSha: 3b1eec593ac8df871b8bf3ecf63e0ba8bd4b59e7
combinedDesignDigest: 08a12fe9ce6352ff161d22f01c026b516069b6bf7169be37bb2a68115763ce21

priorReviewedMainSha: e4576c9a6ffefd7a07d32f1bf1e638731d1aba2d
updatedReviewedMainSha: b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0

driftDecision: NON_IMPACTING
architectureDecision: AGREE_SHADOW_WIRING
conditions: none

checkpointCImplementationAuthorized: false
runtimeEnabled: false
productionProven: unknown

## Reviewed Drift

The reviewed implementation-path diff contains one modified file:

```text
src/agents/execution-preflight/resolve.ts
```

The change introduces fixedUserStop(...) and changes the fixed user-facing
binding prompts for the following existing decision codes:

```text
goal_unclear
skill_disabled
skill_ambiguous
skill_alias_unresolved
validator_unavailable
```

The change does not alter:

- buildExecutionPreflight signature
- preflight result types or fields
- decision codes
- allow, deny, or hold semantics
- capability authorization
- tool filtering
- delivery hold
- Constitutional runtime facade behavior
- the run.ts → EmbeddedRunAttemptParams → attempt.ts dependency chain
- the direct runEmbeddedAttempt caller set
- the Cycle-2 projection, sink, profile, or observability contracts

The frozen Cycle-2 design prohibits binding prompts, user-facing text, and
dynamic strings from entering the Constitutional projection, sink, logs, or
metrics. Therefore this wording-only preflight drift does not change the frozen
shadow-wiring design.

## Result

The original Architecture receipt remains valid for the frozen Cycle-2 design.

Security and Execution-chain must review the Cycle-2 design against:

```text
updatedReviewedMainSha:
b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0
```

and must also consider this addendum.

Any further change to a frozen design file or to another reviewed implementation
path requires a new drift review.
