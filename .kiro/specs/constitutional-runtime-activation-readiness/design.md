# Design — Constitutional runtime shadow wiring (Checkpoint B freeze cycle 2)

Task: `constitutional-runtime-activation-readiness`
Agent: `kiro-constitutional-activation` (Loom takeover from `network-9aeee1a3`)
Checkpoint: **B — freeze cycle 2** (read-only shadow wiring design only)
assessedAt: 2026-09-28T20:05:00+08:00
Verification baseline: origin/main `fdfec5d2b36448c55e514e58b08fb647235836c9` (implementation surface identical to PR base `d22acc6e0ab96df77108024b3e20a4d01ab58875`)

## 1. Summary

Design a **default-off**, **read-only**, **post-decision**, **fully synchronous** Constitutional observe wire on the execution-preflight surface (Candidate A). Reject orchestration post-dispatch observe (Candidate B). This document set does not implement, enable, or deploy anything.

Freeze cycle 2 closes the cycle-1 Security REVISE (S1 minimal boolean deps, S2 sink double-fault fail-open, S3 profile category fixed to `unspecified`) and the cycle-1 Execution-chain REVISE (direct `runEmbeddedAttempt` caller scope).

Claim ceiling:

| Claim                                               | Value                                                         |
| --------------------------------------------------- | ------------------------------------------------------------- |
| Checkpoint B design                                 | **REVISE**                                                    |
| Architecture (cycle 1)                              | `AGREE_SHADOW_WIRING` on the superseded digest (no carryover) |
| Security (cycle 1)                                  | **REVISE**                                                    |
| Execution-chain (cycle 1)                           | **REVISE**                                                    |
| Architecture / Security / Execution-chain (cycle 2) | **PENDING**                                                   |
| `runtimeEnabled`                                    | `false`                                                       |
| `productionProven`                                  | `unknown`                                                     |
| `checkpointCImplementationAuthorized`               | `false`                                                       |

**Merged (#181) ≠ accepted ≠ C authorized.**

## 2. Architecture (future Checkpoint C first slice)

### 2.0 Minimal boolean deps injection chain (Security S1)

**Chosen scheme:** `runEmbeddedPiAgent` reads exactly one environment variable once per invocation, parses it to a boolean, freezes a minimal deps object, and passes that object via `EmbeddedRunAttemptParams` to every `runEmbeddedAttempt`. No environment object or map crosses into the attempt.

```ts
type ConstitutionalRuntimeShadowDeps = {
  readonly runtimeShadowEnabled: boolean;
  readonly sink: ConstitutionalRuntimeShadowSink;
  readonly now: () => number;
};

type EmbeddedRunAttemptParams = EmbeddedRunAttemptBase & {
  // existing fields unchanged
  constitutionalRuntimeShadowDeps: ConstitutionalRuntimeShadowDeps; // required
};
```

The cycle-1 shape `{ env: Readonly<Record<string, string | undefined>>; sink; now }` and the `createDefaultConstitutionalRuntimeShadowDeps({ env: process.env, … })` factory are **withdrawn**.

Outer runner (`src/agents/pi-embedded-runner/run.ts`, inside `runEmbeddedPiAgent`, once per invocation, before the profile/attempt retry loops):

```ts
const runtimeShadowEnabled = parseConstitutionalRuntimeShadowFlag(
  process.env.OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW,
);

const constitutionalRuntimeShadowDeps = Object.freeze<ConstitutionalRuntimeShadowDeps>({
  runtimeShadowEnabled,
  sink: NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK,
  now: performance.now.bind(performance),
});

// every attempt of this run:
runEmbeddedAttempt({
  // existing explicit fields and spreads …
  constitutionalRuntimeShadowDeps, // written after every spread in the object literal
});
```

Inside `attempt.ts` **only**:

```ts
const shadowDeps = params.constitutionalRuntimeShadowDeps;

if (isConstitutionalRuntimeShadowEnabled(shadowDeps.runtimeShadowEnabled)) {
  // synchronous observe — see §2.1
}
```

Requirements:

- `parseConstitutionalRuntimeShadowFlag(raw: string | undefined): boolean` is pure and receives one string value, never an environment object.
- `isConstitutionalRuntimeShadowEnabled(runtimeShadowEnabled: boolean): boolean` receives the boolean only.
- `process.env.OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW` is the only environment key read for this feature, read by direct property access in exactly one place: `runEmbeddedPiAgent` in `run.ts` (which has zero `process.env` references at the verification baseline).
- Forbidden: passing the `process.env` object into deps; copying the environment (spread, `Object.assign`, `Object.keys` / `Object.entries`, `structuredClone`, JSON round-trip, destructuring rest); passing any env map to attempt params or shadow modules; reading the environment in the gate, projection, observe or sink modules; reading the environment for this feature in `attempt.ts`; constructing or overriding the flag from request, tool, model, header, config or `RunEmbeddedPiAgentParams` data.
- `RunEmbeddedPiAgentParams` (`src/agents/pi-embedded-runner/run/params.ts`) does not gain a deps, env or flag field; `run/params.ts` is out of scope. Upstream callers of `runEmbeddedPiAgent` therefore cannot supply or override the deps.
- `attempt.ts` has two pre-existing `process.env` references at the verification baseline: `createCacheTrace({ env: process.env, … })` (line 1554) and `createAnthropicPayloadLogger({ env: process.env, … })` (line 1564). They are unrelated to Constitutional shadow and stay unchanged. Checkpoint C adds no `process.env` reference to `attempt.ts` and never passes `process.env` to shadow code (B-24).
- `attempt.ts` does not construct deps, does not call any deps factory and does not default the field.
- Deps are frozen (`Object.isFrozen(deps) === true`), have exactly the three own keys `runtimeShadowEnabled`, `sink`, `now`, and are reused by every attempt of the same `runEmbeddedPiAgent` invocation (B-26). A later `process.env` mutation does not change `runtimeShadowEnabled` for the current run (B-27).
- Tests inject a frozen `{ runtimeShadowEnabled, sink, now }` through `EmbeddedRunAttemptParams` (no module mock of `process.env`, no global setter, no env map).

Forbidden injection alternatives (Checkpoint C must not use these):

- Global setter
- Module-level mutable deps
- Prototype patch
- Environment objects or maps inside deps or attempt params
- Optional `constitutionalRuntimeShadowDeps` field
- Default deps created in `attempt.ts`
- Test-only fallbacks or backdoors (`__testHooks`, hidden globals, module mocks of `process.env`)

### 2.1 Synchronous first-slice flow

```
run.ts (runEmbeddedPiAgent)                                   # once per run
  runtimeShadowEnabled = parseConstitutionalRuntimeShadowFlag(
    process.env.OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW)        # the only env read
  deps = Object.freeze({ runtimeShadowEnabled,
                         sink: NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK,
                         now: performance.now.bind(performance) })
  runEmbeddedAttempt({ ...existing, constitutionalRuntimeShadowDeps: deps })   # every attempt

attempt.ts (runEmbeddedAttempt)
  executionPreflight = buildExecutionPreflight(...)           # existing authority, unchanged
  tools = applyPreflightToTools(policyTools, executionPreflight, ...)   # existing, unchanged
  shadowDeps = params.constitutionalRuntimeShadowDeps         # required; no factory; no env
  if isConstitutionalRuntimeShadowEnabled(shadowDeps.runtimeShadowEnabled):   # one boolean check
    try:
      observeConstitutionalRuntimeShadow(shadowDeps, executionPreflight)       # returns void; total
    catch:
      # last-resort defense only: swallow; no sink call; no rethrow
  # executionPreflight decision fields and tools are unchanged regardless of observe
```

Observe wrapper (`constitutional-runtime-shadow-observe.ts`):

```ts
export function observeConstitutionalRuntimeShadow(
  deps: ConstitutionalRuntimeShadowDeps,
  executionPreflight: ExecutionPreflight, // read-only input; never mutated
): void {
  let record: ConstitutionalRuntimeShadowRecord;
  try {
    const startedAt = deps.now();
    const projection = projectPreflightShadowObservation(executionPreflight); // sync whitelist
    const result = observePreflightRuntimeFacade({ ...projection, shadow: true }); // sync
    record = minimizeShadowRecord(result, latencyBucket(deps.now() - startedAt)); // whitelist only
  } catch {
    // projection / façade / record-build throw
    safeRecordError(deps.sink, "observe_error");
    return;
  }
  safeRecord(deps.sink, record); // a sink.record throw is swallowed; never calls recordError
}
```

The observe result is never returned to the caller and never read by preflight, tool, dispatch or reply code.

**Checkpoint C first slice is fully synchronous.**

Forbidden in the first slice (observe wrapper, gate, projection, sink and call site):

- `Promise`, `async`/`await`, `Promise.race`, timers (`setTimeout`/`setInterval`)
- `AbortController`, background queue, fire-and-forget, detached task
- Network I/O, disk I/O

Reject / runtime-timeout semantics are **out of this first slice**. Do not design first-slice observe around async reject or soft-timeout races.

Latency budget: **p95 local observation overhead ≤ 2 ms**; no network; no disk; no await.

### 2.2 Sink double-fault fail-open (Security S2)

Sink interface:

```ts
type ConstitutionalRuntimeShadowErrorCode = "observe_error";

type ConstitutionalRuntimeShadowSink = {
  record(value: ConstitutionalRuntimeShadowRecord): void;
  recordError(code: ConstitutionalRuntimeShadowErrorCode): void;
};
```

Safe wrappers (`constitutional-runtime-shadow-sink.ts`); shadow code calls sink methods only through these:

```ts
export function safeRecord(
  sink: ConstitutionalRuntimeShadowSink,
  value: ConstitutionalRuntimeShadowRecord,
): void {
  try {
    sink.record(value);
  } catch {
    // Intentionally swallow. No secondary reporting from this path.
  }
}

export function safeRecordError(
  sink: ConstitutionalRuntimeShadowSink,
  code: ConstitutionalRuntimeShadowErrorCode,
): void {
  try {
    sink.recordError(code);
  } catch {
    // Intentionally swallow. Never rethrow into the business path.
  }
}
```

Failure classes (distinct handling; see `failure-mode-analysis.md` FM2 and FM13–FM15):

| Class                       | Example                                                                                                       | Handling                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Projection / façade throw   | `projectPreflightShadowObservation` or `observePreflightRuntimeFacade` throws; `now()` or record build throws | Caught in the observe wrapper → `safeRecordError(sink, "observe_error")` → return                              |
| `sink.record` throw         | Injected sink throws on `record`                                                                              | Swallowed by `safeRecord`; **no** `recordError` call (no recursion, no secondary reporting)                    |
| `sink.recordError` throw    | Injected sink throws on `recordError`                                                                         | Swallowed by `safeRecordError`; no rethrow                                                                     |
| Error-reporting path throws | Projection/façade throw followed by a `recordError` throw                                                     | Contained by `safeRecordError`; the call-site `catch` in `attempt.ts` is last-resort defense and calls no sink |

In every class: preflight allow/deny/hold unchanged, tool availability (the `tools` array from `applyPreflightToTools`) unchanged, user-visible result unchanged. B-32 covers `safeRecordError` at unit level; B-31, B-33 and B-38 also assert these invariants at attempt level (`recordError` is reachable only after a projection/façade throw).

No fallback reporting channel exists: no console, JSONL, OTel, disk, network, receipt, trace or ledger write from any failure path.

### 2.3 Gate flag (design)

- Name: `OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW`
- Default: off (unset / empty / `0` / `false` / `no` / `off` / any other value)
- Truthy: `1` / `true` / `yes` / `on` after trim + lower
- Parser: `parseConstitutionalRuntimeShadowFlag(raw: string | undefined): boolean` (pure; gate module)
- Gate: `isConstitutionalRuntimeShadowEnabled(runtimeShadowEnabled: boolean): boolean` (receives `deps.runtimeShadowEnabled` only)
- Read location: `run.ts` (`runEmbeddedPiAgent`), once per invocation; nowhere else
- `RUNTIME_SHADOW ≠ SELECT ≠ EXECUTE ≠ ENFORCE ≠ OPENBOT_CONSTITUTIONAL_SHADOW`

### 2.4 Production sink = no-op + gate-off nuance

| Environment        | Sink                                                                        |
| ------------------ | --------------------------------------------------------------------------- |
| Production default | **Synchronous no-op** (`record` / `recordError` are empty functions)        |
| Module-level const | `NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK` — reused by the outer runner      |
| Test               | Injected in-memory collector via `EmbeddedRunAttemptParams`                 |
| Dev                | Explicitly injected structured-log sink (never auto-selected by `NODE_ENV`) |

Forbid:

- `console.*` from observe/sink modules
- Auto JSONL, auto OTel, auto file write
- Receipt / trace / ledger write
- `NODE_ENV` or any other environment value auto-enabling logs
- Deps or sink construction inside `attempt.ts`

**Gate-off accurate meaning:** when `deps.runtimeShadowEnabled` is false:

- No request-level / attempt-level sink creation
- No `sink.record` / `sink.recordError` call
- No projection
- No façade call
- No metrics
- **No work beyond one boolean gate check** on `deps.runtimeShadowEnabled`

The outer runner reuses the module-level `NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK` constant when constructing deps. A module-level no-op constant does **not** count as attempt-level / request-level sink init. Gate off must not touch metrics backends (no gauge=0).

### 2.5 Observe placement + direct caller scope (Execution-chain)

Call site and injection surface:

| Path                                           | Role                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/agents/pi-embedded-runner/run.ts`         | Read the one flag; freeze deps once per run; pass them explicitly to every `runEmbeddedAttempt` call          |
| `src/agents/pi-embedded-runner/run/types.ts`   | Add required `constitutionalRuntimeShadowDeps: ConstitutionalRuntimeShadowDeps` to `EmbeddedRunAttemptParams` |
| `src/agents/pi-embedded-runner/run/attempt.ts` | After the preflight result and tool set exist: read deps from params only; boolean gate → sync observe        |

Direct `runEmbeddedAttempt(` callers at the verification baseline (reviewed allowlist, exact):

| Caller                                                              | Line at baseline | Kind       | Required change in Checkpoint C                                                                                  |
| ------------------------------------------------------------------- | ---------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/agents/pi-embedded-runner/run.ts`                              | 897              | production | Pass the per-run frozen deps explicitly                                                                          |
| `src/agents/pi-embedded-runner/run/attempt.spawn-workspace.test.ts` | 344              | test       | Pass an explicit frozen test deps object (`runtimeShadowEnabled: false`, NOOP or collector sink, injected `now`) |
| `src/agents/pi-embedded-runner/run/execution-router-shadow.test.ts` | 410              | test       | Pass an explicit frozen test deps object (same shape)                                                            |

Not direct callers: `vi.mock("./run/attempt.js", …)` replacements (`run.overflow-compaction.mocks.shared.ts`, `model-fallback.run-embedded.e2e.test.ts`, `pi-embedded-runner.run-embedded-pi-agent.auth-profile-rotation.e2e.test.ts`), `ReturnType<typeof runEmbeddedAttempt>` type references, and Markdown examples. Mocked tests still receive deps because `run.ts` passes them to the mocked function.

Rules: the field stays required; no optional field, no default in `attempt.ts`, no global setter, no module-level mutable deps, no test-specific fallback. Checkpoint C adds no new direct caller; adding one requires a design revision and tripartite re-review. B-36 and B-37 lock the inventory.

Façade: existing `observePreflightRuntimeFacade`. Do not import the façade into `resolve.ts`, `trace.ts` or the preflight barrel in the first slice.

See `shadow-wiring-scope.md` for the exact-path list and forbidden alternatives.

### 2.6 Profile category (Security S3)

The first slice fixes `profileCategory: "unspecified"` as a literal in the projection module. The projection reads no input to decide it.

At the verification baseline, `run.ts` and `attempt.ts` contain no `resolveSecurityProfile` / `SecurityProfile` reference, so the Candidate A chain has no authoritative resolved profile to consume, and the first slice adds no Profile resolution dependency.

`profileCategory` is never derived from: prompts; model output; tool args or results; headers; ordinary request fields; `sessionKey`; tenant hints; caller env maps; the Constitutional observation result. The first slice never emits or synthesizes Profile A (`personal_local`) or Profile B (`managed_enterprise`).

Emitting a real Profile A/B category requires a separate design task that names the authoritative source, the tenant boundary, the Profile resolution point in time, any new paths, and a Security re-review.

### 2.7 Data / failure / observability / rollback

See sibling contracts:

- `data-minimization-contract.md`
- `failure-mode-analysis.md`
- `observability-contract.md`
- `rollback-plan.md`
- `threat-model.md`
- `test-plan.md` (**39** planned cases B-01..B-39; minimum 37)
- `shadow-wiring-scope.md` (exact paths)
- `candidate-comparison.md` / `design-decision.md`
- `checkpoint-b-review-status.md`

## 3. Authority unchanged

Gateway, preflight decision, CTR, Profile A/B resolution, and orchestration dispatch remain the authorities described in Checkpoint A `authority-map.md`. Constitutional observe is not an authority.

## 4. Review gate before Checkpoint C

- Cycle 1: Architecture `AGREE_SHADOW_WIRING` on the superseded digest; Security `REVISE`; Execution-chain `REVISE`.
- Cycle 2: Architecture, Security and Execution-chain **PENDING**. Each must bind to the cycle-2 `combinedDesignDigest`. The cycle-1 Architecture AGREE does not migrate to the new digest.
- `checkpointCImplementationAuthorized=false` until all three return `AGREE_SHADOW_WIRING` with `conditions: none` against the same cycle-2 digest. Do not start Checkpoint C from this PR or from the #181 merge.
