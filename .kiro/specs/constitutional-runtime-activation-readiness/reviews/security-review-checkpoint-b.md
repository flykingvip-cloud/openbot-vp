# Security Review — Constitutional Runtime Activation Checkpoint B

reviewerStableId: security-reviewer:profile-ab-tenant
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

- Replace the full `Readonly<Record<string, string | undefined>>` process-environment object in `ConstitutionalRuntimeShadowDeps` with a minimal immutable gate value or a frozen one-key snapshot containing only `OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW`. The outer factory may read that one server-side variable once per run, but must not retain or propagate `process.env` or unrelated credentials into `EmbeddedRunAttemptParams`.
- Specify and test double-fault containment for the injected sink. A synchronous throw from `sink.record`, `sink.recordError`, or any error-reporting path must be swallowed without a second sink call escaping, without changing preflight allow/deny/hold, and without changing tool availability or user-visible behavior.
- Bind the Profile A/Profile B category exclusively to an existing authoritative server-side resolution. Prompt text, tool arguments/results, model output, headers, caller-provided maps, and ordinary request fields must not choose the profile category. If no authoritative profile value is available in the selected Candidate A chain, the first slice must emit `unspecified`.

securityReview: REVISE
executionChainReview: PENDING
checkpointCImplementationAuthorized: false
runtimeEnabled: false
productionProven: unknown

## Digest Verification

The Security Reviewer independently recomputed the content SHA-256 values for all 11 frozen design files from `designHeadSha` and recomputed the combined digest using the frozen algorithm.

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

The recomputed combined digest is:

```text
ebdc3bff1c7e417b1c87397ce319cae9088c18c302147e51c53c6f63034bc987
```

The frozen-file diff from `designHeadSha` to `statusHeadSha` is empty.

## Security Findings

### 1. Candidate and authority placement

Candidate A is materially safer than Candidate B. Observation is designed to occur only after `buildExecutionPreflight` returns and after the existing preflight decision exists. The Constitutional result is not intended to participate in allow/deny, capability authorization, delivery hold, dispatch, completion, enqueue, or tool invocation.

The existing preflight and security decisions remain authoritative. Fail-open applies only to the optional observation and must not be interpreted as a fail-open security gate.

### 2. Environment trust boundary requires revision

The design correctly prohibits request bodies, prompts, model content, tool data, and headers from controlling the gate. It also correctly limits the `process.env` read to the outer runner.

However, the proposed dependency type retains an entire environment-shaped object:

```text
Readonly<Record<string, string | undefined>>
```

and the pseudocode constructs it from `process.env` before passing it through `EmbeddedRunAttemptParams`.

That is broader than the shadow gate requires and unnecessarily propagates credentials and unrelated host configuration into a deeper per-attempt dependency object. Type-level `Readonly` does not by itself copy, freeze, minimize, or prevent later observation of unrelated environment values.

The dependency crossing the runner-to-attempt boundary must instead contain only:

- a precomputed immutable boolean such as `runtimeShadowEnabled`, or
- a newly allocated and frozen snapshot containing only
  `OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW`.

The full `process.env` object, a shallow reference to it, or a copy of unrelated environment entries must not cross this boundary.

Tests must prove:

- unrelated secret environment keys are absent from the dependency object;
- mutation of `process.env` after construction cannot change the current run;
- request, tool, model, and caller-provided maps cannot alter the gate;
- the gate reads no environment key other than the dedicated runtime-shadow key.

### 3. Profile A/B isolation requires an authoritative source binding

The design correctly bans tenant IDs, user/session hashes, synthetic Profile A tenants, and cross-profile joins. A fixed category label is an acceptable minimized field.

The source of that category is nevertheless described only as “already resolved server-side.” Before implementation, the design must name or constrain the authoritative source.

The profile category must not be derived from:

- prompt or model text;
- tool arguments or results;
- headers or arbitrary request fields;
- session keys;
- caller-supplied environment maps;
- a Constitutional observation result.

If the Candidate A preflight chain does not already hold an authoritative profile resolution, the first slice must use `unspecified`. It must not infer or synthesize Profile A or Profile B.

A test must prove untrusted fields cannot change the projected profile category.

### 4. Data minimization

The whitelist and ban list are otherwise suitable for a first shadow slice:

- fixed enums and fixed reason codes only;
- no raw text or URLs;
- no PII or credentials;
- no request, trace, user, tenant, session, or correlatable IDs;
- no hashes of those identifiers;
- no tool arguments/results;
- no full receipt, trace, proof, or ledger rows;
- no raw latency values;
- no dynamic labels.

The rule to construct a fresh whitelist object, rather than pass through then redact, is required and should remain unchanged.

### 5. Sink and observability boundary requires an explicit double-fault lock

The production default synchronous no-op sink is an appropriate first-slice security posture. The bans on console, automatic JSONL, automatic OTel, disk, network, receipt, trace, and ledger writes are appropriate.

The contracts state that a sink throw must be swallowed, but the test plan does not separately lock failures from:

- `sink.record`;
- `sink.recordError`;
- an error-reporting attempt made after the façade or projection throws.

The implementation must not enter a sequence where the observation throws, the catch block calls an injected error sink, and that second sink throw escapes into the business path.

Add explicit planned tests proving that synchronous throws from every sink method are contained and that no fallback console, JSONL, OTel, disk, network, receipt, trace, or ledger path is used.

### 6. Gate-off behavior and flag isolation

The proposed runtime-shadow flag is separate from Constitutional SHADOW, SELECT, EXECUTE, PATH_GAP, orchestration, web-read, and ConversationTask flags.

Gate-off behavior is appropriately constrained to a boolean check at the attempt site, with no projection, façade call, sink invocation, metric emission, or request/attempt-level sink construction. Reuse of a module-level immutable no-op sink is acceptable.

The gate must not enable or forward SELECT or EXECUTE. `executed`, enforce, live invoke, Fabric default-on, readiness-to-tighten, and authority outcomes must remain false or unchanged.

### 7. Synchronous fail-open scope

A fully synchronous first slice avoids detached work and post-return leakage. The bans on Promise, async/await, timers, queues, AbortController, network, disk, and fire-and-forget work are appropriate.

Observation failures may be swallowed only after the existing preflight result exists. Existing deny and hold outcomes must remain deny and hold. Observation failure must not restore filtered tools, bypass capability ceilings, change completion state, or alter user-visible output.

### 8. Rollback

Flag-off and single-commit revert are acceptable rollback mechanisms because the first slice forbids durable writes and asynchronous residue.

Operational flag-off will apply to newly constructed per-run dependencies. The design must preserve that explicit run-snapshot behavior and must not imply that mutating the process environment changes an already-running dependency snapshot.

### 9. Claim and authorization boundary

This receipt does not authorize Checkpoint C.

The following remain unchanged:

```text
checkpointCImplementationAuthorized: false
runtimeEnabled: false
productionProven: unknown
```

Architecture acceptance alone does not authorize implementation. This Security receipt is `REVISE`; therefore the dual-review gate is not satisfied.

## Required Revision and Re-review

The three conditions above require changes to one or more frozen design files. Any such byte change invalidates:

```text
combinedDesignDigest:
ebdc3bff1c7e417b1c87397ce319cae9088c18c302147e51c53c6f63034bc987
```

After revision, the team must:

1. recompute all affected per-file SHA-256 values;
2. create a new combined design digest;
3. obtain a new Architecture receipt against that digest;
4. obtain a new independent Security review;
5. obtain the Execution-chain review against the same digest.

Until all three independent reviewers return `AGREE_SHADOW_WIRING` with `conditions: none` against the same revised digest:

- do not start Checkpoint C;
- do not modify runtime code;
- do not wire the façade;
- do not enable flags;
- do not activate SELECT or EXECUTE;
- do not deploy;
- do not claim runtime-enabled or production-proven.
