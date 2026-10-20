# Execution-chain Review — Constitutional Runtime Activation Checkpoint B Cycle 2

reviewerStableId: conversation-task-runtime:kiro-conversation-task-runtime
reviewedAt: 2026-09-29
task: constitutional-runtime-activation-readiness
pr: 204

remoteHeadSha: b74f802c7a7add4e93ff24774a293ae361ee89f6
designHeadSha: 7a87dfdfcd0ff74e069a02df78faaa54f25a4cf9
statusHeadSha: 3b1eec593ac8df871b8bf3ecf63e0ba8bd4b59e7
updatedReviewedMainSha: b6f83ce98b9d0bbf69f1f3cf8be4fcd3567366a0
latestMergedMainSha: 8bfecac4db4f9746fc9b2d085ed15ca970459fbf

combinedDesignDigest: 08a12fe9ce6352ff161d22f01c026b516069b6bf7169be37bb2a68115763ce21
architectureReceiptSha256: 6ff86b774f77a11361e5d318eaaefce7b12bbf0f18e6cd6689a9e83363d66ec1
architectureMainDriftAddendumSha256: 97ec470c53281d590457b740796a7a45e162cec2998caa7531256ec784bee73e

decision: AGREE_SHADOW_WIRING
conditions: none

checkpointCImplementationAuthorized: false
runtimeEnabled: false
productionProven: unknown

## Independent digest verification

The eleven Cycle-2 frozen design files were independently read from
`designHeadSha` and hashed using the documented newline-terminated,
basename-sorted algorithm.

The recomputed per-file values are:

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

No byte drift was found in the eleven frozen files between `designHeadSha`
and the reviewed PR head.

The Architecture receipt and main-drift addendum were independently hashed and
match the SHA-256 values bound above.

The reviewed execution-chain paths have no change between
`updatedReviewedMainSha` and `latestMergedMainSha`.

## Independent Execution-chain Findings

### 1. Candidate A is correctly placed after existing authority decisions

Candidate A observes only after:

1. `buildExecutionPreflight(...)` has returned the existing preflight result;
2. `applyPreflightToTools(...)` has produced the existing filtered tool set.

The proposed observer is downstream of the preflight decision and tool
filtering. It is not part of deciding allow, deny, hold, capability
authorization, tool visibility, or tool availability.

The observation result is returned as `void` and is not consumed by preflight,
tool filtering, dispatch, completion, reply, or user-visible output logic.

The wording-only drift in `src/agents/execution-preflight/resolve.ts` changes
fixed binding-prompt text but does not alter preflight result fields, decision
codes, allow/deny/hold semantics, capability authorization, tool filtering, or
the selected injection chain. The Architecture main-drift determination is
consistent with the execution-chain evidence.

### 2. Candidate B remains correctly rejected

The orchestration post-dispatch candidate remains outside the design.

No change is authorized in:

```text
src/task-orchestration/constitutional-runtime-facade.ts
src/task-orchestration/dispatch.ts
src/task-orchestration/gateway-hook.ts
```

Keeping the observation away from `considerDispatch`, enqueue, node/browser
selection, orchestration flags, and the future live-invoke surface reduces
mutation adjacency and avoids confusion with ORCH and WEB_READ shadow
semantics.

### 3. The dependency injection chain is explicit and minimal

The accepted future chain is:

```text
runEmbeddedPiAgent
→ read OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW once
→ parse to runtimeShadowEnabled: boolean
→ freeze { runtimeShadowEnabled, sink, now }
→ EmbeddedRunAttemptParams.constitutionalRuntimeShadowDeps
→ runEmbeddedAttempt consumes the required dependency
```

Only the parsed boolean crosses the attempt boundary. The full process
environment, an environment copy, an environment-shaped map, and the raw flag
string do not cross that boundary.

`RunEmbeddedPiAgentParams` gains no feature flag, environment, or dependency
field, so prompts, request fields, model output, tool input, headers, config
maps, session keys, and upstream callers cannot override the server-side
snapshot.

`attempt.ts` receives required dependencies through its params and is forbidden
from creating defaults, reading the feature environment value, using a global
setter, using mutable module state, using a prototype patch, or using a
test-only fallback.

### 4. The same frozen dependency snapshot is reused across a run

The design requires construction inside `runEmbeddedPiAgent`, once per
invocation and before its attempt retry loop.

Every attempt in that invocation receives the same frozen dependency object.
Changing `process.env` after construction cannot change the current run's
`runtimeShadowEnabled` value. A later run obtains a new snapshot.

The B-26, B-27 and B-29 tests explicitly lock object identity, freezing,
minimal own keys, and mid-run stability.

### 5. The direct caller scope is now complete

At `updatedReviewedMainSha`, excluding the function definition, the direct
`runEmbeddedAttempt(...)` call expressions are exactly:

```text
src/agents/pi-embedded-runner/run.ts
src/agents/pi-embedded-runner/run/attempt.spawn-workspace.test.ts
src/agents/pi-embedded-runner/run/execution-router-shadow.test.ts
```

All three files are now included in the exact Checkpoint C scope.

The two direct test callers must pass an explicit frozen dependency object.
The field remains required and cannot be replaced by an optional field, an
`attempt.ts` default, a global setter, mutable module state, or a test-specific
fallback.

Mocked functions, `vi.mocked(...)` values and return-type references do not
constitute additional direct production calls. The production caller in
`run.ts` passes the dependency to mocked attempts as part of the same argument
object.

B-36 and B-37 require both:

- explicit dependency injection at every direct call expression; and
- an exact caller-file allowlist that fails on an added caller, alternate
  `.call` / `.apply` / `.bind` invocation, or re-export.

The Cycle-1 caller-scope gap is closed by the Cycle-2 design.

### 6. The observe path is fully synchronous

The first slice forbids:

- Promise-returning observation;
- `async` / `await`;
- `Promise.race`;
- timers;
- `AbortController`;
- queues;
- fire-and-forget or detached work;
- network I/O;
- disk I/O;
- JSONL or OTel emission;
- durable persistence.

The observe path is a synchronous gate, projection, façade call, minimized
record build, and safe sink call. No asynchronous residue may remain after an
attempt continues.

B-21 and B-22 lock the local latency budget and absence of asynchronous work.

### 7. Gate-off behavior is limited to one boolean check

When `deps.runtimeShadowEnabled` is false:

- no projection is built;
- the façade is not called;
- `sink.record` and `sink.recordError` are not called;
- no request-level or attempt-level sink is constructed;
- no metric or log is emitted;
- no receipt, trace, ledger, file, network, JSONL, or OTel path is entered.

The module-level immutable no-op sink may exist in the frozen dependency
object, but this is not an attempt-level initialization.

The gate receives a boolean only and does not read SELECT, EXECUTE, PATH_GAP,
ORCH, CTR, `OPENBOT_CONSTITUTIONAL_SHADOW`, or any environment map.

### 8. Observation cannot mutate execution authority

The design requires the existing `executionPreflight` decision and filtered
`tools` array to remain unchanged across observation.

The observer cannot:

- change allow or deny;
- lift or add delivery hold;
- change capability authorization;
- change tool visibility or availability;
- invoke a tool;
- enqueue work;
- dispatch;
- send a message;
- complete a task;
- mutate completion lifecycle;
- change a user-visible response;
- select or execute a Constitutional Path;
- enable enforcement, live invoke, or Fabric.

The observation result is not returned to or read by authority-bearing code.
Fail-open applies only to shadow observation and cannot bypass a preflight or
security denial.

### 9. Receipt, trace and ledger writes remain prohibited

The selected path imports no receipt writer, trace writer, ledger writer,
migration, database, file writer, network exporter, or fallback reporting
channel.

The existing façade remains report-only with `wroteReceipt:false`,
`wroteTrace:false`, `wroteLedger:false`, `executed:false`, `blocked:false`,
`enforce:false`, and `liveInvoke:false`.

Production persistence remains none.

### 10. Sink double faults are contained

All sink calls go through `safeRecord` or `safeRecordError`.

The failure classes are independently defined:

- projection, façade, clock or record-build throw:
  `safeRecordError("observe_error")`, then return;
- `sink.record` throw:
  swallowed without calling `recordError`;
- `sink.recordError` throw:
  swallowed without further reporting;
- projection/façade failure followed by `recordError` failure:
  contained, with the call-site catch as last-resort defense.

No failure path falls back to console, JSONL, OTel, disk, network, receipt,
trace, or ledger reporting. No shadow failure may escape into the business
path.

B-31, B-32, B-33 and B-38 cover these distinct cases.

### 11. Profile and projected data cannot affect execution

The first slice emits only the literal profile category `unspecified` and adds
no Profile-resolution dependency.

It cannot infer or synthesize Profile A or Profile B from request content,
session keys, tenant hints, headers, model output, tools, configuration or
observation results.

The projection and sink permit only closed enums, fixed reason codes,
booleans, fixed capability categories, the literal profile category, and
bounded latency buckets. Raw text, URLs, PII, credentials, tool arguments or
results, receipts, traces, hashes, request IDs, trace IDs, session keys,
tenant IDs, environment data, dynamic strings and other correlatable
identifiers remain prohibited.

### 12. Test and rollback coverage is sufficient for design approval

The planned B-01 through B-39 cases cover:

- default-off and truthiness behavior;
- post-preflight and post-tool-filter ordering;
- allow/deny/hold/capability/tool non-mutation;
- no receipt, trace or ledger writes;
- fail-open without gate bypass;
- SELECT, EXECUTE, ORCH, CTR and PATH_GAP isolation;
- projection minimization;
- flag-off and single-commit rollback;
- latency and synchronous execution;
- no asynchronous residue;
- one environment read and minimal boolean dependencies;
- same-run snapshot reuse;
- secret-environment exclusion;
- sink double-fault containment;
- fixed `unspecified` profile behavior;
- all three direct callers supplying required dependencies;
- exact caller allowlist locking;
- protection against untrusted input controlling the flag.

Rollback is bounded to either:

1. flag off for new runs, with in-flight runs retaining their frozen snapshot;
   or
2. a single-commit revert covering the wiring, direct-caller edits, thin
   modules and tests.

The design creates no database, migration, ledger or durable residue requiring
separate cleanup.

## Acceptance Boundary

Execution-chain accepts the frozen Checkpoint B Cycle-2 shadow-wiring design.

This receipt does not authorize:

- Checkpoint C implementation by itself;
- merging Draft PR #204;
- runtime wiring before the full review gate closes;
- flag enablement;
- SELECT or EXECUTE activation;
- gateway, orchestration, CTR, ACP, AOR, tenant or secondary-preflight wiring;
- production sinks, logs, metrics, receipts, traces, ledgers or persistence;
- deployment;
- a runtime-enabled claim;
- a production-proven claim.

`checkpointCImplementationAuthorized` remains `false` until the remaining
required independent review also returns:

```text
AGREE_SHADOW_WIRING
conditions: none
```

against the same Cycle-2 `combinedDesignDigest`.

Any byte change to one of the eleven frozen design files, or an impacting
change to a reviewed implementation path, invalidates this receipt and
requires re-freeze or drift adjudication.
