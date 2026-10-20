# Rollback plan — Checkpoint B / future Candidate A wire

assessedAt: 2026-09-28T20:05:00+08:00
Applies after a future Checkpoint C lands. This checkpoint ships **docs only** (freeze cycle 2).
Checkpoint C is currently **BLOCKED** (`checkpointCImplementationAuthorized=false`).

## 1. Rollback options (either is sufficient)

### Option 1 — Flag off (preferred operational)

1. Set `OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW` unset / `0` / `false` / `off` / `no` in the server process environment.
2. Restart or reload env as required by the host. `runEmbeddedPiAgent` reads the flag once per invocation, so every new run picks up the change; an in-flight run keeps its frozen `runtimeShadowEnabled` snapshot until it ends.
3. Prove zero observe calls (§3). With the gate off, runtime does **one boolean check only** on `deps.runtimeShadowEnabled` (no attempt-level sink create / no `sink.record` / no metrics). The module-level NOOP const may still exist.

### Option 2 — Single-commit revert

1. Revert the single Checkpoint C wiring commit (or equivalent revert PR). It covers `run.ts`, `run/types.ts`, `run/attempt.ts`, the new shadow modules, the explicit-deps edits in `run/attempt.spawn-workspace.test.ts` and `run/execution-router-shadow.test.ts`, and the new tests.
2. Deploy/restart as required.
3. Prove §3. Prefer this if the wire itself is defective (mutation, data leak), not merely noisy.

## 2. What rollback must NOT require

- DB migration down
- Ledger purge
- Manual receipt/trace cleanup
- Changes to SELECT/EXECUTE/PATH_GAP/ORCH/CTR flags
- Clearing correlatable IDs from sinks (first slice forbids them; prod sink is no-op)
- Environment or secret cleanup (deps never carry environment values)
- Profile data correction (the first slice only ever reports `unspecified`)

First impl forbids durable residue so rollback stays flag-or-revert.

## 3. Proof criteria (all required)

| Proof                          | How                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No observe calls               | Metric/test spy `observe_calls` stays 0 under load OR test spy not invoked                                                                                                                             |
| Behavior unchanged             | Preflight allow/deny/hold and tool-availability golden tests match pre-wire baseline                                                                                                                   |
| No DB/ledger/migration residue | `rg` for new migrations / ledger writers in the revert diff is empty; prod sink is no-op                                                                                                               |
| Flag isolation                 | Turning RUNTIME_SHADOW off does not alter other Constitutional flags                                                                                                                                   |
| No async residue               | No timers/promises from shadow modules after flag off (B-22)                                                                                                                                           |
| Revert completeness (Option 2) | After revert, `constitutionalRuntimeShadowDeps` and `OPENBOT_CONSTITUTIONAL_RUNTIME_SHADOW` no longer appear under `src/`, and the direct `runEmbeddedAttempt` caller set equals the pre-wire baseline |

## 4. Rollback drill (design)

Before production enable of RUNTIME_SHADOW (a later checkpoint, after C authorization):

1. Staging: flag on → observe_calls > 0 with whitelist-only payloads (`profileCategory: "unspecified"`); p95 ≤ 2 ms.
2. Staging: inject a throwing sink → turns complete normally; no fallback output anywhere.
3. Staging: flag off → observe_calls returns to 0; no attempt-level sink create / no `sink.record`; business tests green.
4. Staging: single-commit revert rehearsal on a branch; §3 proofs recorded.

## 5. This checkpoint / PR #181

No runtime to roll back. Docs PR revert is sufficient if the design is rejected.
PR #181 was docs-only; **no runtime rollback is needed** after its merge. Freeze cycle 2 likewise ships docs only.
