# Architecture Review — Constitutional Runtime Activation Checkpoint B Cycle 2

reviewerStableId: codex-architecture
reviewedAt: 2026-09-28
task: constitutional-runtime-activation-readiness
pr: 204

designHeadSha: 7a87dfdfcd0ff74e069a02df78faaa54f25a4cf9
reviewedMainSha: e4576c9a6ffefd7a07d32f1bf1e638731d1aba2d
statusHeadSha: 3b1eec593ac8df871b8bf3ecf63e0ba8bd4b59e7

combinedDesignDigest: 08a12fe9ce6352ff161d22f01c026b516069b6bf7169be37bb2a68115763ce21
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
bc58bcf2df0541174af84cf1092e32b2940bb3f912cafe8eb6bccda4e56c9ec7  data-minimization-contract.md
9525fb1f87b0f287ffc5eb93a50537746005be7d6f4eb88d7fab66d3013a9b06  design-decision.md
71e34a004a6357ef18f04041b31df8ebc973c861125d07e9cb3bb3f6b6c90673  design.md
0aee9f9d0e38a30061faa7ba2726f97e33c347ecfe70e9d85298a156229fb103  failure-mode-analysis.md
b41f1708b33dab6ed5820dbed82f1f6d00a9d8a24a43bde053f3ee9043da25b3  observability-contract.md
d6b914cea9437d9bb67d320591b6171e690315c982ff804f8014c7b7c75f94a5  requirements.md
782215f7f210e197f83bfe73c2edae9e60f77b4dad02fd1748ae3a3d4bb99424  rollback-plan.md
7c690dcb944260089b8c00aa4531033d63074324b3d8291972b775cc9f98500e  shadow-wiring-scope.md
912558b3dff03170cf15cb74afdad50d129b0577b3097dcca2f778ece76107cf  test-plan.md
f75646716e51b927a16dd1f8296ec431f3728afedce60d112c2dd7fab039e0ba  threat-model.md
```

## Architecture Findings

1. Candidate A remains the accepted design: a read-only Constitutional
   observation performed only after the existing execution-preflight decision
   and tool filtering have completed. Candidate B remains rejected.

2. The dependency boundary is minimal and explicit:

   ```text
   runEmbeddedPiAgent
   → read OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW once
   → parse to runtimeShadowEnabled: boolean
   → freeze { runtimeShadowEnabled, sink, now }
   → EmbeddedRunAttemptParams.constitutionalRuntimeShadowDeps
   → runEmbeddedAttempt consumes the injected dependency
   ```

   The full process environment, an environment copy, or an environment-shaped
   map does not cross into attempt parameters or shadow modules.

3. `runtimeShadowEnabled` cannot be controlled by request content, prompts,
   model output, tool arguments or results, headers, config maps, session keys,
   or caller-provided environment maps.

4. `EmbeddedRunAttemptParams.constitutionalRuntimeShadowDeps` remains required.
   It is not optional, has no default in `attempt.ts`, and cannot be supplied
   through a global setter, mutable module dependency, prototype patch, or
   test-only fallback.

5. The exact direct caller scope is complete:

   ```text
   src/agents/pi-embedded-runner/run.ts
   src/agents/pi-embedded-runner/run/attempt.spawn-workspace.test.ts
   src/agents/pi-embedded-runner/run/execution-router-shadow.test.ts
   ```

   Each caller must explicitly provide the required dependency. The B-36 and
   B-37 wiring locks must fail if a caller is added or omits the dependency.

6. The first implementation slice remains fully synchronous. It does not
   permit Promise-based observation, async/await, timers, queues,
   AbortController, detached work, network, disk, JSONL, OTel, receipt writes,
   trace writes, ledger writes, or durable persistence.

7. The production default sink is a reusable synchronous no-op. All sink calls
   are contained by `safeRecord` and `safeRecordError`.
   - A `sink.record` throw is swallowed and does not trigger recursive error
     reporting.
   - A projection or facade throw may call `safeRecordError`.
   - A `sink.recordError` throw is swallowed.
   - No secondary fallback reporting channel is allowed.
   - No shadow failure can escape into the business path.

8. The first-slice profile category is the literal `unspecified`. The design
   adds no Profile resolution dependency and cannot infer or synthesize
   Profile A or Profile B from untrusted input.

9. Gate-off behavior remains limited to one boolean check. It does not construct
   a request-level or attempt-level sink, build a projection, call the facade,
   emit metrics, or write logs.

10. The observation result cannot change preflight allow/deny, capability
    authorization, tool availability, delivery hold, completion, dispatch,
    enqueue, invocation, send behavior, user-visible output, or Profile A/B
    authority.

11. The data-minimization contract continues to prohibit raw text, URLs, PII,
    credentials, tool arguments or results, full receipts or traces, hashes,
    request IDs, trace IDs, session keys, tenant IDs, dynamic strings, and
    other correlatable identifiers.

12. The B-01 through B-39 test plan covers default-off behavior, ordering,
    authority non-mutation, flag isolation, data minimization, no persistence,
    rollback, latency, absence of asynchronous residue, minimal boolean
    dependencies, sink double-fault containment, fixed `unspecified` profile,
    explicit dependency injection, and complete caller inventory.

13. Changes on `main` after the prior review do not alter the frozen Candidate A
    implementation surface or its direct caller set.

## Acceptance Boundary

Architecture accepts the frozen Checkpoint B Cycle-2 design only.

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
