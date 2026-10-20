# Execution-chain Review — Constitutional Runtime Activation Checkpoint B

reviewerStableId: conversation-task-runtime:kiro-conversation-task-runtime
reviewedAt: 2026-09-28
task: constitutional-runtime-activation-readiness
pr: 183

designHeadSha: 6779fffcd71d64dade6a07381df4b6a44c60a712
reviewedMainSha: fdb47dfe4ef076201d30ae223b8dc6f8c63753ca
statusHeadSha: ff5ca33bd8e9b570f81d8a56cd2a4ba186ba4dc0
combinedDesignDigest: ebdc3bff1c7e417b1c87397ce319cae9088c18c302147e51c53c6f63034bc987
architectureReceiptSha256: 4879cbd4e070a88e238b97f4e898b7871aafe0a2c6efe2881cba433e96e2b287

decision: REVISE

conditions:

- Add `src/agents/pi-embedded-runner/run/attempt.spawn-workspace.test.ts` to
  the exact Checkpoint C implementation and test scope.
- Add `src/agents/pi-embedded-runner/run/execution-router-shadow.test.ts` to
  the exact Checkpoint C implementation and test scope.
- Require both direct `runEmbeddedAttempt` test callers to inject an explicit
  `constitutionalRuntimeShadowDeps` value. Do not make the dependency optional,
  create default dependencies inside `attempt.ts`, add a global setter, or add
  a test-only fallback.
- Add a wiring-lock test or source scan that enumerates every direct
  `runEmbeddedAttempt` caller and proves each caller supplies the required
  dependency.
- Update the test-plan mapping and exact-path scope, then re-freeze the changed
  design package under a new combined design digest. Architecture, Security,
  and Execution-chain receipts must all bind to that new digest.

securityReview: PENDING
checkpointCImplementationAuthorized: false
runtimeEnabled: false
productionProven: unknown

## Independent digest verification

The eleven frozen design files were independently read from
`designHeadSha` and hashed using the documented newline-terminated,
basename-sorted algorithm. The recomputed combined digest is:

```text
ebdc3bff1c7e417b1c87397ce319cae9088c18c302147e51c53c6f63034bc987
```

No byte drift was found in the eleven frozen files between
`designHeadSha` and the reviewed status head.

## Execution-chain findings

### 1. Candidate A placement is otherwise acceptable

Candidate A places Constitutional observation after
`buildExecutionPreflight(...)` has returned an existing authority result.
The observer is downstream of the preflight decision and is not itself an
allow, deny, capability, delivery-hold, completion, dispatch, or execution
authority.

Candidate B remains correctly rejected. Placing observation beside
`considerDispatch`, orchestration flags, enqueue, and the future live-invoke
surface would create a higher-risk mutation adjacency and flag-confusion
surface.

### 2. The proposed production dependency chain is feasible

The reviewed main has one production call from `runEmbeddedPiAgent` in
`run.ts` to `runEmbeddedAttempt`. Creating one immutable
`ConstitutionalRuntimeShadowDeps` snapshot outside the attempt retry loop and
passing that same value through the required
`EmbeddedRunAttemptParams.constitutionalRuntimeShadowDeps` field can preserve
one snapshot across every attempt in a run.

The frozen contract correctly forbids:

- default dependency creation in `attempt.ts`;
- direct `process.env` reads below the outer factory;
- mutable module dependencies;
- global setters;
- prototype patching;
- test-only backdoors.

### 3. Shadow behavior is correctly constrained

The frozen design requires a fully synchronous first slice:

- no Promise or async observer;
- no timer or timeout race;
- no background queue or detached task;
- no network or disk I/O;
- synchronous throw is caught without changing the existing business result;
- gate off performs only the boolean check;
- projection, façade, sink and metrics are not entered when off.

The observation result is discarded and may not change preflight allow/deny,
capability authorization, delivery hold, completion, tool filtering, dispatch,
enqueue, invocation, send, or user-visible output.

Receipt, trace and ledger writes remain forbidden. The production sink is a
reusable synchronous no-op, and rollback remains flag-off or a single-commit
revert.

### 4. Exact-path scope is incomplete for a required parameter change

At `reviewedMainSha`, `runEmbeddedAttempt` has three direct callers:

```text
src/agents/pi-embedded-runner/run.ts
src/agents/pi-embedded-runner/run/attempt.spawn-workspace.test.ts
src/agents/pi-embedded-runner/run/execution-router-shadow.test.ts
```

The selected design adds the following required field:

```text
EmbeddedRunAttemptParams.constitutionalRuntimeShadowDeps
```

The two direct test callers construct the parameter object themselves and do
not currently supply that field. However, the frozen `shadow-wiring-scope.md`
lists neither test file in the future Checkpoint C exact paths.

This creates an implementation contradiction:

1. keeping the field required breaks those direct callers during type checking;
2. modifying those callers exceeds the reviewed exact-path scope; or
3. making the dependency optional/defaulted violates the frozen explicit
   dependency-injection and no-default-in-`attempt.ts` rules.

The design therefore is not yet implementable within its own authorized
exact-path boundary.

### 5. Planned tests are broad but do not close this caller inventory gap

The B-01 through B-28 plan covers post-decision ordering, authority
non-mutation, flag isolation, synchronous failure, data minimization, rollback,
latency, no asynchronous residue, dependency snapshot reuse and explicit
injection.

However, no case enumerates all direct `runEmbeddedAttempt` callers or requires
every direct caller to pass the new required dependency. B-28 states the
general injection rule but does not include the two omitted test paths in the
exact scope.

A wiring-lock caller inventory is required before Checkpoint C authorization.

## Acceptance boundary

This review does not reject Candidate A's execution-chain placement or its
shadow-only behavioral contract. It requires correction of the exact
implementation scope and caller coverage before implementation can be safely
authorized.

This receipt does not authorize:

- Checkpoint C implementation;
- runtime wiring;
- flag enablement;
- SELECT or EXECUTE activation;
- gateway, orchestration, CTR, ACP, AOR, or tenant wiring;
- deployment;
- a runtime-enabled claim;
- a production-proven claim.

`checkpointCImplementationAuthorized` remains `false`.

Because the frozen design files must change to close the scope gap, the current
combined design digest and all receipts bound to it must be superseded by a new
design freeze and a new review cycle.
