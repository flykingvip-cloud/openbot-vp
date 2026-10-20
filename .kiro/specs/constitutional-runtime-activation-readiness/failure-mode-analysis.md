# Failure-mode analysis — Checkpoint B (Candidate A, freeze cycle 2)

assessedAt: 2026-09-28T20:05:00+08:00
Design only. Fail-open applies to **Constitutional observe**, never to preflight/security gates.
First slice: **synchronous** only. Checkpoint C remains unauthorized.
Cycle 2 adds the Security S1–S3 and Execution-chain caller-scope failure modes (FM13–FM19).

## 1. Definitions

| Term                             | Meaning                                                                                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fail-open (observe, first slice) | Any **synchronous throw** in the observe path (projection, façade, `sink.record`, `sink.recordError`, error reporting) is contained; the existing flow continues |
| Fail-closed (preflight/sec)      | Unchanged: existing preflight deny/hold and security gates remain authoritative                                                                                  |
| Already-approved path            | The business outcome after preflight (and other gates) already decided — observe must not reopen that choice                                                     |
| Safe sink wrappers               | `safeRecord` / `safeRecordError`: the only way shadow code calls the sink; each swallows its own throw and reports nothing further                               |
| Out of first slice               | Async reject, runtime soft-timeout / `Promise.race`, background work — **not** part of Checkpoint C first slice                                                  |

## 2. Failure modes

| ID   | Failure                                                                                                | Detect                                 | Containment                                                                                                                                                    | User-visible effect                                    |
| ---- | ------------------------------------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| FM1  | Gate flag mis-parsed as on                                                                             | Truthiness table + tests B-01..B-03    | `parseConstitutionalRuntimeShadowFlag`: only `1/true/yes/on` (trim+lower) enable; everything else off                                                          | None if still off                                      |
| FM2  | Projection or façade throws (sync)                                                                     | `try/catch` in the observe wrapper     | Caught → `safeRecordError(sink, "observe_error")` → return; nothing rethrown into the attempt (B-10)                                                           | None                                                   |
| FM3  | Observe exceeds latency budget                                                                         | B-21 injected `now`                    | Design budget p95 ≤ 2 ms; no network/disk/await; sync path only — **no** first-slice soft-timeout race                                                         | None (may add ≤2 ms locally if budget held)            |
| FM4  | Projection includes banned field                                                                       | Projection unit tests + review         | Whitelist builder; CI asserts keys ⊆ tightened whitelist; B-25                                                                                                 | None if caught in test                                 |
| FM5  | Observe result fed into allow/deny                                                                     | Wiring lock tests                      | Observe wrapper returns `void`; the call is a statement whose result is never read                                                                             | Would be severity-high                                 |
| FM6  | Observe writes receipt/trace                                                                           | Façade hard-false + tests              | Façade returns `wroteReceipt:false` / `wroteTrace:false`; no writer imports                                                                                    | Would be severity-high                                 |
| FM7  | Flag confuses SELECT/EXECUTE                                                                           | Flag inventory + gate module isolation | Separate env name; gate receives only `deps.runtimeShadowEnabled`; never reads SELECT/EXECUTE                                                                  | None if isolated                                       |
| FM8  | Fail-open misread as gate bypass                                                                       | Requirements R9 + review checklist     | Docs + tests: preflight deny still denies when observe also errors                                                                                             | Would be severity-critical                             |
| FM9  | Prod ledger / console / JSONL / OTel from sink                                                         | Observability + sink contract          | Production default = module-level **NOOP**; test/dev sinks only when explicitly injected; no fallback channel on sink failure; gate-off no `sink.record`; B-23 | None if contract held                                  |
| FM10 | Rollback incomplete                                                                                    | Rollback plan proofs                   | Flag off OR single-commit revert; prove zero observe calls                                                                                                     | None after rollback                                    |
| FM11 | `process.env` read outside the single `run.ts` read site                                               | B-24 source scan                       | Only `runEmbeddedPiAgent` reads the one key; shadow modules have no `process.env`; `attempt.ts` keeps exactly its two pre-existing, unrelated references       | None if held                                           |
| FM12 | Async work after attempt returns                                                                       | B-22                                   | Forbid Promise/timer/queue in first slice                                                                                                                      | Would be severity-medium (latency/leak)                |
| FM13 | `sink.record` throws                                                                                   | B-31                                   | `safeRecord` swallows; `recordError` is **not** called (no recursion, no secondary reporting); business path continues                                         | None                                                   |
| FM14 | `sink.recordError` throws                                                                              | B-32                                   | `safeRecordError` swallows; nothing rethrown                                                                                                                   | None                                                   |
| FM15 | Error-reporting path throws (projection or façade throw, then `recordError` throws)                    | B-33 (façade), B-38 (projection)       | Contained by `safeRecordError`; the call-site `catch` in `attempt.ts` is last-resort defense and calls no sink                                                 | None                                                   |
| FM16 | Full `process.env`, an env copy or secret env keys reach deps or attempt params                        | B-24, B-29, B-30                       | Deps are the frozen `{ runtimeShadowEnabled, sink, now }`; the raw flag string is parsed in `run.ts` and discarded                                             | None if held; would be severity-high (secret exposure) |
| FM17 | Untrusted request/tool/model/header/config input sets or flips `runtimeShadowEnabled`                  | B-39                                   | Single env read in `run.ts`; `RunEmbeddedPiAgentParams` gains no deps/env/flag field; explicit deps property written after every spread                        | None if held                                           |
| FM18 | `profileCategory` spoofed from untrusted fields, or Profile A/B synthesized                            | B-34, B-35                             | Literal `unspecified` in the projection module; no Profile resolution dependency                                                                               | None if held                                           |
| FM19 | New unreviewed direct `runEmbeddedAttempt` caller, or a caller that omits deps or relies on a fallback | B-36, B-37                             | Required field (`tsc` rejects omission); no default in `attempt.ts`; exact caller allowlist source scan                                                        | None if held                                           |

## 3. Severity ranking (if containment fails)

1. FM8 gate bypass mis-implementation — critical
2. FM5 decision mutation — high
3. FM6 receipt/trace write — high
4. FM4 data leak via banned fields — high
5. FM16 environment / secret exposure through deps — high
6. FM13–FM15 observe-path throw escaping into the turn — high (would fail a user turn)
7. FM17 untrusted control of the shadow flag — medium
8. FM18 fabricated profile category — medium
9. FM19 unreviewed caller / fallback — medium
10. FM9 prod residue / auto logging — medium
11. FM12 async after return — medium
12. FM2/FM3 observe instability — low (if fail-open + budget held)

## 4. Non-failures (explicit)

- Preflight deny while RUNTIME_SHADOW is on → still deny. Observe may run after the result exists but must not flip deny→allow.
- Constitutional façade inert when RUNTIME_SHADOW off → expected; not a failure.
- A `sink.record` failure leaves no trace anywhere → expected (no secondary reporting by design).
- `profileCategory` reported as `unspecified` for a Profile B tenant → expected in the first slice.
- Production probe unknown (`productionProven=unknown`) → not remediated by Checkpoint B.
- PR #181 merge without Architecture acceptance → expected revise path; not a runtime failure (docs only; no rollback needed).
