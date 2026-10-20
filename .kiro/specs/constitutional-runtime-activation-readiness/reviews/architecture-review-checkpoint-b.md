# Architecture Review — Constitutional Runtime Activation Checkpoint B

reviewerStableId: codex-architecture
reviewedAt: 2026-09-28
task: constitutional-runtime-activation-readiness
pr: 183

designHeadSha: 6779fffcd71d64dade6a07381df4b6a44c60a712
reviewedMainSha: fdb47dfe4ef076201d30ae223b8dc6f8c63753ca
statusHeadSha: ff5ca33bd8e9b570f81d8a56cd2a4ba186ba4dc0

combinedDesignDigest: ebdc3bff1c7e417b1c87397ce319cae9088c18c302147e51c53c6f63034bc987
digestAlgorithm: SHA-256 of the newline-terminated records shown below, sorted by basename.

```text
<file-sha256>  <basename>\n
```

decision: AGREE_SHADOW_WIRING
conditions: none

securityReview: PENDING
executionChainReview: PENDING
checkpointCImplementationAuthorized: false
runtimeEnabled: false
productionProven: unknown

## Frozen Design Files

```text
2cac0d199521ba14975c8116c9b8ecbb84942e616b093fec09e9e69b80cc9e14  candidate-comparison.md
043fe6ae3d8b9c68965c94fd1d6cd235eef849f6053020b2e0fe785f7544f758  data-minimization-contract.md
e60b052de1a6d68f3ea8eea893812569384e2f760274968bccc4a7b163834fa6  design-decision.md
69f3e7292391d1c6b8181c02cfa8b7cb7204894abb4a8c3d0c2c1fab22cc7215  design.md
c4d9dfea3851372a5fa35e3c0fb70f733e82ba1ff75ebc24bbe4ea0cd0373bfb  failure-mode-analysis.md
2b83290c3f88da414f9581fde7b1c8c1d211197626ce07c415c7cac335ee6522  observability-contract.md
e148196e39ff18cd5720ea05125207b3548919624414309c2191316cc5bf90b2  requirements.md
f8b68015496521d4e84b4365fedbaeb708035c1caedb50c16ec0f171e5ad1a26  rollback-plan.md
8f1c1357b56160290a1e72e1bf89894cad72ba2e220939a565ea2bed9c2066b2  shadow-wiring-scope.md
d3a855ea4479cdd3efc6e781d74d0ab59583429e8eaa9c2cc9b1916eee923938  test-plan.md
b28139109f577e21ab6c6ff665c90ad3f9a1b4b63dab7866e495a81c35eecd21  threat-model.md
```

## Architecture Findings

1. Candidate A is the accepted design: a read-only Constitutional observation performed only after the existing execution-preflight decision exists. Candidate B, orchestration post-dispatch observation, remains rejected.
2. The dependency-injection chain is explicit and implementable:

   ```text
   runEmbeddedPiAgent
   → create one ConstitutionalRuntimeShadowDeps snapshot per run
   → EmbeddedRunAttemptParams.constitutionalRuntimeShadowDeps
   → runEmbeddedAttempt consumes the injected deps
   ```

   attempt.ts does not create default dependencies and does not read
   process.env.

3. The design does not use a global setter, mutable module dependency, prototype patch, test-only backdoor, or request-controlled environment map. Tests inject env, sink, and now through explicit dependencies.
4. The first implementation slice is fully synchronous. It forbids Promise-based observation, async/await, timers, background queues, detached tasks, network I/O, disk I/O, JSONL, OTel, receipt writes, trace writes, and ledger writes.
5. The production default sink is a reusable synchronous no-op. When the runtime-shadow gate is off, an attempt performs only the boolean gate check: no request-level or attempt-level sink creation, no projection, no facade call, no metric emission, and no log output.
6. The proposed flag OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW is default-off and remains separate from SELECT, EXECUTE, ENFORCE, PATH_GAP, orchestration, web-read, and ConversationTask flags.
7. The observation result cannot change preflight allow/deny, capability authorization, delivery hold, completion state, dispatch, enqueue, tool invocation, user-visible output, or Profile A/Profile B authority.
8. The data-minimization contract permits only closed enums, fixed reason codes, booleans, fixed profile and capability categories, and bounded latency buckets. Raw text, URLs, PII, secrets, tool arguments, receipts, traces, hashes, request IDs, trace IDs, session keys, tenant IDs, and other correlatable identifiers are prohibited.
9. The implementation scope is concrete and includes the required outer
   dependency boundary:

   ```text
   src/agents/pi-embedded-runner/run.ts
   src/agents/pi-embedded-runner/run/types.ts
   src/agents/pi-embedded-runner/run/attempt.ts
   ```

   The scope also includes only the narrowly defined Constitutional gate,
   dependency, projection, observe, sink, facade, and test files listed in
   shadow-wiring-scope.md.

10. The planned B-01 through B-28 tests cover default-off behavior, post-decision ordering, authority non-mutation, flag isolation, data minimization, no persistence, rollback, latency, absence of asynchronous residue, no deep process.env reads, dependency snapshot reuse, mid-run environment stability, and explicit dependency injection.
11. Changes between the design baseline and reviewedMainSha do not alter the selected execution-preflight dependency chain or the frozen design. ConversationTask handoff changes are outside the selected Candidate A implementation surface.

## Acceptance Boundary

Architecture accepts the frozen Checkpoint B design only.

This receipt does not authorize:

- Checkpoint C implementation
- runtime wiring
- flag enablement
- SELECT or EXECUTE activation
- gateway, orchestration, CTR, ACP, AOR, or tenant wiring
- production logs, metrics, ledger writes, or durable persistence
- deployment
- a runtime-enabled claim
- a production-proven claim

Checkpoint C remains blocked until Security and Execution-chain independently
review the same `combinedDesignDigest` and both return:

```text
AGREE_SHADOW_WIRING
conditions: none
```

Any byte change to one of the 11 frozen design files invalidates this receipt.
