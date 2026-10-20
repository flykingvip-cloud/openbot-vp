# Observability contract — Checkpoint B (Candidate A, freeze cycle 2)

assessedAt: 2026-09-28T20:05:00+08:00
First implementation posture: **production default sink = module-level synchronous NOOP** (`NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK`).
Test sink = injected in-memory collector. Dev sink = **explicitly** injected structured-log sink.
All sink calls go through `safeRecord` / `safeRecordError` (cycle 2, Security S2).
Checkpoint C unauthorized; this is design only.

## 1. Metric names and units

Metrics may be recorded **only when the gate is on** and only through an injected sink/metrics adapter (never by reading `NODE_ENV` or auto-enabling).

| Metric name                                            | Type    | Unit   | Meaning                                                                                |
| ------------------------------------------------------ | ------- | ------ | -------------------------------------------------------------------------------------- |
| `constitutional_runtime_shadow_observe_calls`          | counter | calls  | Times observe wrapper entered while gate on                                            |
| `constitutional_runtime_shadow_observe_success`        | counter | calls  | Observe completed without throw                                                        |
| `constitutional_runtime_shadow_observe_error`          | counter | calls  | Projection / façade / record build **sync threw**; reported once via `safeRecordError` |
| `constitutional_runtime_shadow_observe_latency_bucket` | counter | bucket | Local overhead bucket (`le_1ms` / `le_2ms` / `le_5ms` / `gt_5ms`)                      |
| `constitutional_runtime_shadow_inert`                  | counter | calls  | Façade returned inert/non-invoked despite gate on                                      |
| `constitutional_runtime_shadow_banned_field_drop`      | counter | events | Projection omitted a non-whitelist key (test/dev only)                                 |

A throw from `sink.record` or `sink.recordError` is not counted or reported anywhere (no secondary reporting).

Removed vs prior drafts:

- `constitutional_runtime_shadow_gate_enabled` gauge used when gate off (“optional gauge=0 when gate off”) — **deleted**. Gate off must not touch metrics.
- Raw `observe_latency_ms` histogram as a cross-request correlator — replaced by **bounded latency buckets**.
- `error_class=timeout|reject` — **out of first slice** (sync throw only → `none` | `throw`).

## 2. Label whitelist

Allowed labels only:

| Label          | Values / type                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surface`      | `execution-preflight`                                                                                                                                                              |
| `result_mode`  | `inert` \| `shadow`                                                                                                                                                                |
| `error_class`  | `none` \| `throw`                                                                                                                                                                  |
| `flag_runtime` | `on` \| `off` (**`off` labels must not be emitted on the hot path when gate is off** — included only for test fixtures that explicitly record a skipped attempt under a test sink) |

Forbidden as labels: tenant id, user id, session key, skill name, profile category, URLs, path strings, free-text messages, request/trace IDs, environment names or values, any hashes of those, any dynamic strings.

## 3. Retention / sampling / cardinality

| Control         | First impl value                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Retention       | Production: none (no-op sink). Test: in-memory until cleared. Dev: only if explicitly injected sink retains logs in-process |
| Sampling        | 100% in test when gate on; no prod sampling plan until a later checkpoint                                                   |
| Max cardinality | **≤ 8** distinct label combinations (`surface`×`result_mode`×`error_class`×`flag_runtime`)                                  |
| Persistence     | None in production for first impl                                                                                           |

## 4. Forbidden fields / side effects in logs / sinks

Same ban list as `data-minimization-contract.md` §2.

Additionally forbid from observe/sink modules:

- `console.*`
- Auto JSONL / auto OTel / auto file write
- Receipt / trace / ledger write
- Network or disk access
- `NODE_ENV` or any other environment value auto-enabling logs
- Any fallback reporting channel when the sink fails

## 5. Failure / gate-off behavior

| Condition                   | Behavior                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projection / façade throws  | Observe wrapper catches → `safeRecordError(sink, "observe_error")` → return; business path continues                                                                                                                                                                                                                                    |
| `sink.record` throws        | `safeRecord` swallows; `recordError` is **not** called; nothing is reported                                                                                                                                                                                                                                                             |
| `sink.recordError` throws   | `safeRecordError` swallows; nothing is rethrown or reported                                                                                                                                                                                                                                                                             |
| Error-reporting path throws | Contained by `safeRecordError`; the call-site `catch` in `attempt.ts` swallows anything else without calling the sink                                                                                                                                                                                                                   |
| Production default sink     | Sync no-op                                                                                                                                                                                                                                                                                                                              |
| Metric backend absent       | No-op; tests use assert sink                                                                                                                                                                                                                                                                                                            |
| Gate off                    | **One boolean gate check only** on `deps.runtimeShadowEnabled` — no projection; no attempt-level sink create; no `sink.record` / `sink.recordError`; no façade; no logs; no metrics; no gauge=0. The module-level `NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK` reused by the outer runner does **not** count as attempt-level init (B-23). |

In every row, preflight allow/deny/hold, tool availability and the user-visible result are unchanged.

## 6. Explicit non-goals

- No `governance-shadow-decisions.jsonl` coupling for this Constitutional RUNTIME_SHADOW slice.
- No prod ledger append.
- No PII-bearing trace export.
- No async exporters in first slice.
- No reporting of sink failures.
