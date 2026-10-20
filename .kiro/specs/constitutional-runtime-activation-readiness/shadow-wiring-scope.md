# Shadow wiring scope — exact future paths (Candidate A, freeze cycle 2)

assessedAt: 2026-09-28T20:05:00+08:00
Checkpoint: B freeze cycle 2 — **these paths are NOT modified in this PR**
Selected candidate: A (execution-preflight post-decision observe)
First slice: fully synchronous; production sink = module-level NOOP; minimal boolean deps via `EmbeddedRunAttemptParams`
Verification baseline: origin/main `fdfec5d2b36448c55e514e58b08fb647235836c9` (identical on these paths to PR base `d22acc6e0ab96df77108024b3e20a4d01ab58875`)

## 1. In scope for a future Checkpoint C implementation (exact paths)

No globs. Each path is concrete. Checkpoint C remains **BLOCKED** until `checkpointCImplementationAuthorized=true`.

Chosen injection: `run.ts` reads one flag once per run → frozen `{ runtimeShadowEnabled, sink, now }` → required `EmbeddedRunAttemptParams.constitutionalRuntimeShadowDeps` → `attempt.ts` (read params only).

### 1.1 Call site + injection surface (primary)

| Path                                           | Future role                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agents/pi-embedded-runner/run.ts`         | In `runEmbeddedPiAgent`, once per invocation and before the retry loops: `parseConstitutionalRuntimeShadowFlag(process.env.OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW)` (the only env read), `Object.freeze` the deps, pass them explicitly — after every spread — to each `runEmbeddedAttempt` call.         |
| `src/agents/pi-embedded-runner/run/types.ts`   | Extend `EmbeddedRunAttemptParams` with required `constitutionalRuntimeShadowDeps: ConstitutionalRuntimeShadowDeps`. No optional variant, no env field.                                                                                                                                                   |
| `src/agents/pi-embedded-runner/run/attempt.ts` | After `buildExecutionPreflight` returns and `applyPreflightToTools` produces `tools`: read `params.constitutionalRuntimeShadowDeps` only; boolean gate → sync `observeConstitutionalRuntimeShadow` inside a last-resort `try/catch`. **No** factory, **no** default, **no** new `process.env` reference. |

### 1.2 Direct-caller test files (Execution-chain REVISE)

| Path                                                                | Future role                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agents/pi-embedded-runner/run/attempt.spawn-workspace.test.ts` | Direct caller (line 344 at baseline). Every `runEmbeddedAttempt(` call passes an explicit frozen deps object. Hosts the attempt-level Constitutional integration cases (§1.5) by reusing this file's existing harness. |
| `src/agents/pi-embedded-runner/run/execution-router-shadow.test.ts` | Direct caller (line 410 at baseline). Its call passes an explicit frozen deps object with `runtimeShadowEnabled: false`, a NOOP or collector sink, and an injected `now`. Existing assertions stay unchanged.          |

### 1.3 New thin modules (proposed; not created this checkpoint)

| Path                                                                         | Future role                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agents/execution-preflight/constitutional-runtime-shadow-deps.ts`       | `ConstitutionalRuntimeShadowDeps` type only (`readonly runtimeShadowEnabled: boolean; readonly sink; readonly now`). No factory, no environment access.                                                                                                                      |
| `src/agents/execution-preflight/constitutional-runtime-shadow-gate.ts`       | `parseConstitutionalRuntimeShadowFlag(raw: string \| undefined): boolean` (pure) and `isConstitutionalRuntimeShadowEnabled(runtimeShadowEnabled: boolean): boolean`. No `process.env`; never receives an environment object. Does not read SELECT/EXECUTE/PATH_GAP/ORCH/CTR. |
| `src/agents/execution-preflight/constitutional-runtime-shadow-observe.ts`    | `observeConstitutionalRuntimeShadow(deps, executionPreflight): void` — sync and total: projection → façade → record build inside `try`; `catch` → `safeRecordError(sink, "observe_error")`; success → `safeRecord(sink, record)`. No async/timer/network/disk/env.           |
| `src/agents/execution-preflight/constitutional-runtime-shadow-sink.ts`       | Sink, record and error-code types; module-level immutable `NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK`; `safeRecord` / `safeRecordError` (swallow, no secondary reporting). No console/JSONL/OTel/file/network/receipt/trace/ledger.                                            |
| `src/agents/execution-preflight/constitutional-runtime-shadow-projection.ts` | Whitelist projection and record builder: fixed enums, fixed reason codes, booleans, `profileCategory: "unspecified"` literal, fixed capability categories, bounded latency buckets only.                                                                                     |

### 1.4 Existing façade (API-stable expected)

| Path                                                              | Future role                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/agents/execution-preflight/constitutional-runtime-facade.ts` | Keep report-only `observePreflightRuntimeFacade`. Wire calls it synchronously; does not add execute/select/enforce. |

### 1.5 Tests (future — planned only; not added this PR)

| Path                                                                              | Future role                                                                                                                                                       | Primary cases                                                                          |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/agents/execution-preflight/constitutional-runtime-shadow-gate.test.ts`       | Parser truthiness; gate takes the boolean only; flag isolation                                                                                                    | B-01, B-02, B-03, B-12, B-13, B-14                                                     |
| `src/agents/execution-preflight/constitutional-runtime-shadow-projection.test.ts` | Whitelist / ban fields; no dynamic IDs; `profileCategory` fixed to `unspecified`                                                                                  | B-15, B-16, B-17, B-25, B-34, B-35                                                     |
| `src/agents/execution-preflight/constitutional-runtime-shadow-sink.test.ts`       | NOOP module-level const; `safeRecord` / `safeRecordError` swallow; no fallback channel                                                                            | B-31, B-32                                                                             |
| `src/agents/execution-preflight/constitutional-runtime-shadow-observe.test.ts`    | Sync totality; fault classes; inputs not mutated; latency budget; no async residue                                                                                | B-10, B-21, B-22, B-33, B-38                                                           |
| `src/agents/execution-preflight/constitutional-runtime-shadow-wiring.test.ts`     | Source-scan locks: no ledger/migration, single env read, `attempt.ts` env baseline, injection style, caller inventory. Never calls `runEmbeddedAttempt` directly. | B-18, B-20, B-24, B-28, B-36, B-37                                                     |
| `src/agents/execution-preflight/constitutional-runtime-facade.test.ts`            | Keep existing inert/no-write locks                                                                                                                                | B-06, B-07                                                                             |
| `src/agents/pi-embedded-runner/run/attempt.spawn-workspace.test.ts`               | Attempt-level integration through the existing harness (explicit deps in every call)                                                                              | B-04, B-05, B-08, B-09, B-11, B-19, B-23, attempt-level assertions of B-31, B-33, B-38 |
| `src/agents/pi-embedded-runner/run/execution-router-shadow.test.ts`               | Explicit deps only; existing assertions unchanged                                                                                                                 | — (subject of B-36 / B-37)                                                             |
| `src/agents/pi-embedded-runner/run.overflow-compaction.test.ts`                   | Drives `runEmbeddedPiAgent` with the mocked attempt and captures the deps passed to each attempt                                                                  | B-26, B-27, B-29, B-30, B-39                                                           |
| `src/agents/pi-embedded-runner/usage-reporting.test.ts`                           | Keep existing; deps injection must not disturb usage reporting                                                                                                    | —                                                                                      |
| `src/agents/pi-embedded-runner/run/attempt.test.ts`                               | Helper-level unit tests only; **must not** add a direct `runEmbeddedAttempt(` call                                                                                | —                                                                                      |

Attempt-level integration cases run only inside `run/attempt.spawn-workspace.test.ts` so that Checkpoint C adds no direct caller outside the reviewed allowlist (§6).

## 2. Explicitly out of scope (do not touch in first wire)

| Path                                                      | Reason                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/agents/pi-embedded-runner/run/params.ts`             | `RunEmbeddedPiAgentParams` must not gain a deps, env or flag field              |
| `src/gateway/security-profile.ts`                         | No Profile resolution dependency in the first slice (`profileCategory` fixed)   |
| `src/task-orchestration/constitutional-runtime-facade.ts` | Candidate B rejected                                                            |
| `src/task-orchestration/dispatch.ts`                      | No dispatch mutation / observe                                                  |
| `src/task-orchestration/gateway-hook.ts`                  | Orch/web-read surface; not Constitutional runtime shadow                        |
| `src/agents/execution-preflight/index.ts`                 | Keep façade out of barrel unless a later design says otherwise                  |
| `src/agents/execution-preflight/resolve.ts`               | Decision maker; observe stays outside                                           |
| `src/agents/execution-preflight/trace.ts`                 | No trace write from Constitutional                                              |
| `src/auto-reply/reply/dispatch-acp.ts`                    | Secondary preflight caller; defer to a later slice                              |
| `src/acp/cli-steer-preflight-observe.ts`                  | Secondary preflight caller; defer to a later slice                              |
| `packages/constitutional-contracts/**`                    | No package behavior change required for first wire                              |
| `packages/constitutional-runtime/**`                      | Scaffold only; not a hot-path lander                                            |
| `.loom/registry.yaml`                                     | Ownership active; the takeover diff lands separately through lander `kiro-loom` |

## 3. Forbidden injection alternatives

Checkpoint C **MUST NOT** use:

- Global setter for deps / sink / flag
- Module-level **mutable** deps (reassigned after load)
- Prototype patch of runner / attempt
- The `process.env` object, a copy of it, or any env map inside deps or attempt params
- `process.env` reads inside the gate, projection, observe, sink or deps modules, or any new `process.env` reference in `attempt.ts`
- A flag value built from request, tool, model, header, config or `RunEmbeddedPiAgentParams` data
- An optional `constitutionalRuntimeShadowDeps` field, a default in `attempt.ts`, or a test-specific fallback
- Test-only backdoors (module mocks of `process.env`, hidden globals, `__testHooks`)

Allowed: module-level **immutable** `NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK` constant reused by the outer runner.

## 4. Flag surface (design only)

| Name                                    | Default | Reader location (future)                                                                                                                              |
| --------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW` | off     | One direct property read in `runEmbeddedPiAgent` (`run.ts`), parsed by `parseConstitutionalRuntimeShadowFlag`; carried as `deps.runtimeShadowEnabled` |

Not this flag: `OPENBOT_CONSTITUTIONAL_SHADOW`, `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT`, `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE`, `OPENBOT_CONSTITUTIONAL_PATH_GAP_REPORT`, any `OPENBOT_CONVERSATION_TASK_ORCH_*`, any `OPENBOT_CONVERSATION_TASK_*` CTR flag.

## 5. First-slice behavioral locks

- Fully synchronous (no Promise/await/timer/AbortController/background/network/disk).
- Production sink = module-level sync NOOP reused by the outer runner.
- Gate off → one boolean check on `deps.runtimeShadowEnabled`; **no attempt-level sink create**, no `sink.record` / `sink.recordError`, no projection, no façade, no metrics.
- Only `runEmbeddedPiAgent` reads the environment for this feature, and only the one key.
- Deps are frozen, have exactly three own keys, and are reused by every attempt of one run.
- Sink calls go through `safeRecord` / `safeRecordError`; no throw escapes; no fallback channel.
- `profileCategory` is always `"unspecified"`.
- p95 local observation overhead ≤ 2 ms when the gate is on.

## 6. Direct caller inventory (reviewed allowlist)

Direct `runEmbeddedAttempt(` call expressions in git-tracked TypeScript sources at the verification baseline:

| File                                                                | Line | Kind       |
| ------------------------------------------------------------------- | ---- | ---------- |
| `src/agents/pi-embedded-runner/run.ts`                              | 897  | production |
| `src/agents/pi-embedded-runner/run/attempt.spawn-workspace.test.ts` | 344  | test       |
| `src/agents/pi-embedded-runner/run/execution-router-shadow.test.ts` | 410  | test       |

Reproduce:

```bash
git grep -n -E '(^|[^A-Za-z0-9_])runEmbeddedAttempt[[:space:]]*\(' \
  fdfec5d2b36448c55e514e58b08fb647235836c9 -- '*.ts' '*.tsx' '*.mts' '*.cts' \
  | grep -v 'function runEmbeddedAttempt'
```

Not direct callers: `vi.mock("./run/attempt.js", …)` factories that define `runEmbeddedAttempt: vi.fn()`, `vi.mocked(runEmbeddedAttempt)`, `ReturnType<typeof runEmbeddedAttempt>` references, and Markdown examples. No `.call` / `.apply` / `.bind` invocation and no re-export of `runEmbeddedAttempt` exists at the baseline.

Locks (planned):

- B-36: every direct call expression passes `constitutionalRuntimeShadowDeps` as an explicit property of its argument object literal; the required field also makes `tsc` reject an omission.
- B-37: the set of files containing direct call expressions equals the allowlist above exactly; any new file, a `.call` / `.apply` / `.bind` invocation, or a re-export fails the test.

Changing the allowlist requires a design revision and tripartite re-review.

## 7. This checkpoint's allowed writes

| Path pattern                                                 | Allowed now?                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `.kiro/specs/constitutional-runtime-activation-readiness/**` | Yes (docs)                                                                       |
| `.loom/registry.yaml`                                        | Takeover diff only; committed separately by `kiro-loom`, not by this docs change |
| Everything else                                              | No                                                                               |
