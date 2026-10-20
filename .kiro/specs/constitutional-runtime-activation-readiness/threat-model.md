# Threat model — Checkpoint B read-only shadow wiring (Candidate A, freeze cycle 2)

assessedAt: 2026-09-28T20:05:00+08:00
Scope: future wiring of post-decision Constitutional observe on execution-preflight. Design only.
Checkpoint C unauthorized. First slice: sync, prod no-op sink, minimal boolean deps, tightened whitelist, fixed `unspecified` profile category.

## 1. Assets

| Asset                                        | Why it matters                                |
| -------------------------------------------- | --------------------------------------------- |
| Preflight allow/deny/hold decisions          | Safety and capability boundary                |
| Tool availability after preflight            | Capability boundary seen by the model         |
| Validation receipts / traces                 | Integrity of execution evidence               |
| User text / URLs / identity / tenant secrets | Confidentiality                               |
| Server process environment (secrets, keys)   | Confidentiality; must not travel with deps    |
| Profile A/B classification                   | Tenant boundary integrity; must not be forged |
| Production ledger / DB                       | Audit integrity; retention/compliance         |
| Flag defaults                                | Prevent accidental runtime enablement         |
| Cross-request correlators                    | Prevent covert tracking via observe labels    |

## 2. Actors

| Actor                     | Capability                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Operator with env access  | Can set process env on a host                                                                      |
| Compromised dependency    | Could throw or exfiltrate if observe is careless                                                   |
| Malicious prompt/content  | Already in user message path; must not amplify, control the shadow flag, or choose a profile label |
| Faulty injected sink      | Can throw from `record` / `recordError`                                                            |
| Developer adding a caller | Could add a direct `runEmbeddedAttempt` caller that skips review or relies on a fallback           |
| Insider with PR merge     | Could land unsafe Checkpoint C without review; #181 merge alone must not be treated as C auth      |

## 3. Threats and mitigations

| ID  | Threat                                                                                  | Mitigation (design)                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | Env flag flips on unexpectedly in prod                                                  | Default off; separate from SELECT/EXECUTE; ops runbook + rollback flag-off                                                                                                     |
| T2  | Observe mutates decisions                                                               | Void result; tests assert deep-equal preflight outcome and tools before/after                                                                                                  |
| T3  | Observe becomes execute                                                                 | Never pass execute opt-in; façade `executed:false`; ban EXECUTE flag in gate                                                                                                   |
| T4  | PII/URL/hash exfiltration via sink                                                      | Tightened whitelist; forbid hashes and correlatable IDs; B-15/B-25; prod sink no-op                                                                                            |
| T5  | Cross-profile projection                                                                | Fixed `unspecified` category; no tenant id; no A∪B merge                                                                                                                       |
| T6  | Fail-open used to skip preflight                                                        | Observe placed **after** preflight result and tool set; sync errors cannot skip `buildExecutionPreflight`                                                                      |
| T7  | Confusion with orch/web-read shadow                                                     | Candidate B rejected; distinct env name RUNTIME_SHADOW                                                                                                                         |
| T8  | Residual DB/migration after rollback                                                    | No schema in first impl; prod no-op sink; rollback proves no migration residue                                                                                                 |
| T9  | Draft/#181 merge treated as C authorization                                             | `checkpointCImplementationAuthorized=false`; review-status records REVISE                                                                                                      |
| T10 | Request/tool/model/header content controls the shadow flag                              | One env read in `run.ts`; only the boolean crosses; `RunEmbeddedPiAgentParams` gains no deps/env/flag field; deps property written after spreads; B-24, B-39                   |
| T11 | Async observe leaks work after attempt                                                  | First slice forbids Promise/timer/queue; B-22; latency budget B-21                                                                                                             |
| T12 | Auto logging when gate off / via NODE_ENV                                               | Gate off = one boolean check; no attempt-level sink create / no `sink.record`; module-level NOOP OK; forbid console/JSONL/OTel auto; B-23                                      |
| T13 | Full `process.env` or secret env keys carried into deps / params                        | Deps = frozen `{ runtimeShadowEnabled, sink, now }`; no env object, copy or map anywhere in the shadow path; B-29, B-30                                                        |
| T14 | Sink double fault escapes into the business path or opens a secondary reporting channel | `safeRecord` / `safeRecordError` swallow; `record` failure never calls `recordError`; no console/JSONL/OTel/disk/network/receipt/trace/ledger fallback; B-31, B-32, B-33, B-38 |
| T15 | Profile category forged from untrusted fields or synthesized as Profile A/B             | Literal `unspecified`; no Profile resolution dependency; B-34, B-35                                                                                                            |
| T16 | Unreviewed direct caller bypasses injection (optional field, default, fallback)         | Required field; no default in `attempt.ts`; exact direct-caller allowlist; B-36, B-37                                                                                          |

## 4. Trust boundaries

```
[user message] -> [existing security/preflight gates] -> [preflight result + tools]
                                                              |
run.ts (runEmbeddedPiAgent, once per run):                    |
  runtimeShadowEnabled = parse(process.env.OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW)
  deps = Object.freeze({ runtimeShadowEnabled,                |
                         sink: NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK,
                         now })  → EmbeddedRunAttemptParams (required field)
                                                              |
                                                              v
attempt.ts: shadowDeps = params.constitutionalRuntimeShadowDeps
            (no factory; no default; no env)
                                                              |
                                                              v
                     [gate: isConstitutionalRuntimeShadowEnabled(shadowDeps.runtimeShadowEnabled)]
                                                              |
                                                              v
                     [minimized projection, profileCategory "unspecified"] -> [observe façade]  (sync)
                                                              |
                                                              v
                     [safeRecord / safeRecordError] -> [prod: module-level NOOP] / [test: collector] / [dev: explicit log]
```

Observe sits **downstream** of gates. It is not a gate. Request/tool/model/header content never reaches the flag or the profile category. Only a boolean crosses from the process environment into the attempt. Deps are created once in `run.ts` and reused across attempts (B-26, B-27).

## 5. Residual risk

- Operator can still set RUNTIME_SHADOW on a host; residual is observability/latency/privacy if projection bugs exist — mitigated by whitelist tests and the review gate before Checkpoint C.
- A sink that fails silently loses shadow records without any signal; accepted for the first slice (no secondary reporting by design).
- `profileCategory` carries no Profile information in the first slice; accepted until a separate Profile design task.
- `productionProven=unknown` remains; this design does not claim live host posture.
- Cycle-2 Architecture, Security and Execution-chain reviews are still PENDING.
