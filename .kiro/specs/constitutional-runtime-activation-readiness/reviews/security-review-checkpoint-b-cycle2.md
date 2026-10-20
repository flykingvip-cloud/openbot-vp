# Security Review — Constitutional Runtime Activation Checkpoint B Cycle 2

reviewerStableId: security-reviewer:profile-ab-tenant
reviewedAt: 2026-09-29
task: constitutional-runtime-activation-readiness
pr: 204

designHeadSha: 7a87dfdfcd0ff74e069a02df78faaa54f25a4cf9
statusHeadSha: 3b1eec593ac8df871b8bf3ecf63e0ba8bd4b59e7

architectureOriginalReviewedMainSha: e4576c9a6ffefd7a07d32f1bf1e638731d1aba2d
updatedReviewedMainSha: b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0
latestMergedMainSha: 8bfecac4db4f9746fc9b2d085ed15ca970459fbf

combinedDesignDigest: 08a12fe9ce6352ff161d22f01c026b516069b6bf7169be37bb2a68115763ce21
architectureReceiptSha256: 6ff86b774f77a11361e5d318eaaefce7b12bbf0f18e6cd6689a9e83363d66ec1
architectureMainDriftAddendumSha256: 97ec470c53281d590457b740796a7a45e162cec2998caa7531256ec784bee73e

decision: AGREE_SHADOW_WIRING
conditions: none

securityReview: AGREE_SHADOW_WIRING
executionChainReview: PENDING
checkpointCImplementationAuthorized: false
runtimeEnabled: false
productionProven: unknown

## Digest Verification

The Security Reviewer independently recomputed the content SHA-256 values for all 11 frozen Cycle-2 design files from `designHeadSha`.

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

The recomputed combined digest is:

```text
08a12fe9ce6352ff161d22f01c026b516069b6bf7169be37bb2a68115763ce21
```

The frozen-file diff from `designHeadSha` to the reviewed PR #204 head is empty.

The independently recomputed Architecture evidence hashes are:

```text
6ff86b774f77a11361e5d318eaaefce7b12bbf0f18e6cd6689a9e83363d66ec1  architecture-review-checkpoint-b-cycle2.md
97ec470c53281d590457b740796a7a45e162cec2998caa7531256ec784bee73e  architecture-main-drift-addendum-cycle2.md
```

## Main-Drift Review

The reviewed implementation-path drift from
`architectureOriginalReviewedMainSha` to `updatedReviewedMainSha` modifies only:

```text
src/agents/execution-preflight/resolve.ts
```

The change adds `fixedUserStop(...)` and replaces fixed user-facing binding-prompt wording for existing decision codes. It does not change:

- decision codes;
- preflight result fields or types;
- allow, deny, hold, capability or tool-filtering semantics;
- the `run.ts` to `EmbeddedRunAttemptParams` to `attempt.ts` chain;
- the direct `runEmbeddedAttempt` caller set;
- the Constitutional facade;
- the proposed projection, sink, profile or observability contracts.

The frozen Cycle-2 contract prohibits binding-prompt text and other dynamic strings from entering the Constitutional projection, sink, logs or metrics.

The reviewed-path diff from:

```text
b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0
```

to:

```text
8bfecac4db4f9746fc9b2d085ed15ca970459fbf
```

is empty.

The main drift is non-impacting for this Security decision.

## Security Findings

### 1. Minimal server-side flag dependency

The Cycle-2 design no longer passes `process.env`, an environment copy or an environment-shaped map into attempt parameters or shadow modules.

`runEmbeddedPiAgent` is the sole reader for this feature and directly reads:

```text
process.env.OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW
```

once per run. The raw value is immediately parsed to a boolean and discarded.

The frozen dependency contains exactly:

```text
runtimeShadowEnabled
sink
now
```

The dependency object is frozen and reused for all attempts within the same run. Later mutation of `process.env` cannot change the current run's value.

No unrelated environment key, API key, token, credential, key name or value crosses into the attempt or observation boundary.

### 2. Untrusted input cannot control the flag

The design does not add a flag, env or deps field to `RunEmbeddedPiAgentParams`. Request data, prompts, model output, tool arguments or results, headers, configuration maps, session keys and caller-provided maps therefore cannot supply or override `runtimeShadowEnabled`.

The gate receives a boolean only. Gate, projection, observe and sink modules receive no environment object and do not read `process.env`.

B-24, B-27, B-29, B-30 and B-39 provide suitable planned locks for the environment boundary.

### 3. Profile A and Profile B remain isolated

The first slice fixes:

```text
profileCategory: "unspecified"
```

as a projection-module literal.

The projection reads no input to choose the category. It does not add a Profile resolution dependency and cannot derive or synthesize `personal_local` or `managed_enterprise` from:

- prompts or model output;
- tool arguments or results;
- headers or ordinary request fields;
- session keys;
- tenant hints;
- caller environment maps;
- Constitutional observation output.

No tenant ID or tenant/user/session hash crosses the projection or sink boundary. No synthetic tenant, cross-profile join or Profile A/B authority is introduced.

A future real Profile A/B category requires a separate design task, an identified authoritative source and a new Security review.

### 4. Data minimization

The first-slice whitelist is sufficiently constrained to:

- closed code enums;
- fixed reason codes;
- booleans;
- literal `unspecified` profile category;
- a reviewed closed capability category;
- bounded latency buckets.

The contract forbids:

- raw text, prompts and message bodies;
- URLs;
- PII and credentials;
- tool arguments, tool results and file bodies;
- user, tenant, session, request and trace identifiers;
- hashes or other correlatable identifiers;
- environment names and values;
- full receipts, traces, proofs and ledger rows;
- artifact and workspace paths;
- candidate-path and workflow strings;
- dynamic labels and free-form error text.

The projection must construct a new whitelist object. It cannot pass through and redact later.

### 5. Sink double-fault containment

The Cycle-2 design explicitly separates:

```text
safeRecord
safeRecordError
```

Both wrappers swallow synchronous sink exceptions.

A `sink.record` throw:

- is swallowed;
- does not invoke `recordError`;
- does not trigger recursive or secondary reporting.

A projection, facade, clock or record-build throw may call:

```text
safeRecordError(sink, "observe_error")
```

A subsequent `recordError` throw is swallowed. The last-resort attempt-level catch performs no sink call.

No failure path falls back to console, JSONL, OTel, disk, network, receipt, trace or ledger output.

B-31, B-32, B-33 and B-38 explicitly cover these paths and preserve preflight and tool invariants.

### 6. Production no-op and gate-off behavior

The production default sink is a synchronous module-level no-op. Test and development sinks require explicit dependency injection and are not selected through `NODE_ENV`.

When `runtimeShadowEnabled` is false, the attempt performs one boolean gate check only:

- no projection;
- no facade call;
- no sink invocation;
- no metric or log;
- no request-level or attempt-level sink construction;
- no observation side effect.

Reuse of an immutable module-level no-op sink by the outer runner does not create request-level or attempt-level output.

### 7. No durable or external side effects

The first slice forbids:

- console output;
- JSONL and OTel exporters;
- network and disk I/O;
- receipt, trace and ledger writes;
- DB schema or migration changes;
- Promise, async/await and Promise.race;
- timers and AbortController;
- queues, detached tasks and fire-and-forget work.

The observation is fully synchronous and its result is unused by the business path.

### 8. Flag isolation

`OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW` remains semantically and mechanically separate from:

- `OPENBOT_CONSTITUTIONAL_SHADOW`;
- legal-path SELECT;
- legal-path EXECUTE;
- PATH_GAP;
- orchestration and web-read shadow flags;
- ConversationTask flags;
- enforce, live invoke and Fabric defaults.

The design does not forward select or execute opt-ins. `executed`, enforce, live invoke and authority outcomes remain false or unchanged.

### 9. Fail-open does not bypass security

Fail-open applies only to the post-decision Constitutional observation.

Observation occurs after:

```text
buildExecutionPreflight
applyPreflightToTools
```

have established the decision and filtered tool set.

No projection, facade, sink or error outcome can:

- turn deny or hold into allow;
- restore a filtered tool;
- increase a capability ceiling;
- change delivery hold or completion;
- dispatch, enqueue, invoke or send;
- change user-visible output;
- change Profile A/B authority.

A synchronous shadow failure is contained while the already-decided existing path continues. Existing security gates remain fail-closed and authoritative.

### 10. Rollback

Operational rollback is correctly defined as:

- turning `OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW` off for newly created runs; or
- reverting the single future Checkpoint C wiring commit.

Because the design forbids durable writes and asynchronous residue, rollback requires no DB migration reversal, ledger cleanup, receipt cleanup or trace cleanup.

Rollback proof appropriately requires zero observation calls, unchanged preflight behavior, no persistence, flag isolation and no asynchronous residue.

## Security Decision

Security accepts the frozen Cycle-2 Checkpoint B shadow-wiring design:

```text
decision: AGREE_SHADOW_WIRING
conditions: none
```

This Security acceptance is limited to the frozen design package identified by:

```text
designHeadSha:
7a87dfdfcd0ff74e069a02df78faaa54f25a4cf9

combinedDesignDigest:
08a12fe9ce6352ff161d22f01c026b516069b6bf7169be37bb2a68115763ce21
```

It does not independently authorize Checkpoint C.

The following remain unchanged until Architecture, Security and Execution-chain all agree with `conditions: none` against the same Cycle-2 digest and the governing status is formally updated:

```text
checkpointCImplementationAuthorized: false
runtimeEnabled: false
productionProven: unknown
```

This receipt does not authorize:

- runtime implementation or wiring by itself;
- flag enablement;
- SELECT or EXECUTE activation;
- gateway, orchestration, CTR, ACP, AOR or tenant wiring;
- production logs, metrics, persistence or ledger writes;
- deployment;
- a runtime-enabled claim;
- a production-proven claim.

Any byte change to a frozen design file, any new reviewed-path drift, any new direct `runEmbeddedAttempt` caller, any widening of the deps object, any Profile A/B inference, or any new sink or persistence channel requires re-review.
