## Agents

- codex-runtime · role: owner · scope: runtime-concurrency-recovery:codex-runtime · paths: src/agent-runtime/state/repository/task-board-file.ts, src/agent-runtime/state/repository/task-board-file.test.ts, .kiro/specs/runtime-concurrency-recovery/\*\*, src/agent-runtime/state/durable-json.ts, src/gateway/collaboration-dispatch/round-store-io.ts · since: 2026-11-19

## Batch 1

- [x] Fresh origin/main baseline and isolated worktree — codex-runtime
- [x] Reproduce cross-process baseline: 6/7 failures; child exits on DIRECTORY_LOCK_STALE_MS initialization cycle — codex-runtime
- [x] Remove broad state barrel from round durable I/O initialization path — codex-runtime
- [x] Cross-process 7/7 and round persistence 6/6 pass; changed TS format and lint pass — codex-runtime
- [x] Historical intermittent lost update is not proven fixed; crash injection remains next batch — codex-runtime

## Checkpoint / WIP

- Root cause: round-store-io imported the broad state/index barrel and eagerly read DIRECTORY_LOCK_STALE_MS while that barrel was still initializing. A narrow durable-json public port removes this initialization dependency — codex-runtime
- Before: cross-process suite 6 failed / 1 passed, all failures were child-process initialization errors. After: 13/13 tests pass across both suites — codex-runtime
- pnpm check stops at pre-existing formatting issues in 124 files; those files were not changed. Scoped TS format/lint pass — codex-runtime
- Attribution reports no unattributed files, but round-store-io is also claimed by two historical tasks; registry is a designated shared file. No commit/landing until ownership handoff is resolved. Isolated worktree contains only this task's edits — codex-runtime
- Next: resolve path ownership, land the narrow fix, then add deterministic contention barriers and crash recovery cases. No database migration or production cutover performed — codex-runtime

## Authorized handoff

- User confirmed takeover on 2026-11-19. Narrowed predecessor broad gateway globs around round-store-io.ts; all other existing paths retained. Their sessions remain unchanged. This task is the sole owner of the repair path — codex-runtime

- Added real SIGKILL holder recovery test: passes; committed board focusRevision and writeEpoch survive takeover. This verifies lock-holder death only, not external tool exactly-once semantics — codex-runtime
- Scoped lint passes on all 3 TS files. Full tsgo reports errors outside changed files; full check previously stopped at 124 existing formatting failures — codex-runtime
- Ownership transfer refines predecessor broad gateway globs to retain all existing other paths; resulting registry expansion is attribution-only — codex-runtime

## Batch 2

- [x] Verified existing board adapter and clean predecessor checkpoint before taking over the shared file for the user-requested next batch; designated this task as lander, preserved historical sessions — codex-runtime
- [x] Reproduced corrupt-state overwrite: new regression failed before fix because mutation silently reset malformed persisted JSON — codex-runtime
- [x] Make mutation, CAS, and publication epoch reads strict: missing files still bootstrap; corrupt/unreadable existing state fails closed — codex-runtime
- [x] Clean temporary staging files after failed atomic publication; verify old snapshot, epoch and lock cleanup — codex-runtime
- [x] 31/31 scoped tests pass, including real child SIGKILL recovery and 7 cross-process cases; scoped lint passes — codex-runtime
- Remaining: deterministic stale-lock contention barriers, real SIGKILL during publication, external tool result reconciliation. Injection of rename failure does not prove power-loss durability or exactly-once execution — codex-runtime

## Batch 3

- [x] Four real Node workers wait at an IPC readiness barrier before 80 combined read-modify-write operations; assert exact focusRevision 80 and writeEpoch 81 — codex-runtime
- [x] Real SIGKILL after production temporary snapshot write and immediately before rename: committed snapshot remains unchanged, next writer recovers dead-owner lock and advances exactly once — codex-runtime
- Test-only fs override in isolated child establishes crash point; production publication code is unchanged. Process death leaves its temporary staging file; no unsafe global cleanup added — codex-runtime
- These tests do not close the stale-lock multiple-reaper race, power-loss durability, or external tool reconciliation. Historical intermittent constraint loss remains unproven fixed — codex-runtime

## Batch 4 — confirmed stale-reaper defect, repair pending

- [x] Refreshed origin/main and verified ancestry — codex-runtime
- [x] Existing lock liveness tests pass 4/4, but do not cover successful stale inspection followed by replacement before unlink — codex-runtime
- [x] Node diagnostic injects a peer replacement at the stale unlink boundary; replacementInjected=true and acquiredOverLivePeer=true. Confirms a deterministic check/unlink race in synchronous recovery — codex-runtime
- Diagnostic uses an isolated temporary directory and fs override, not concurrent OS scheduling; validates the interleaving vulnerability, not real-world incidence. Run: node --import tsx .kiro/specs/runtime-concurrency-recovery/stale-reaper-probe.ts — codex-runtime
- [ ] Design mutually exclusive stale reclamation/acquisition, with recovery of a crashed reclaimer. Rechecking inode or token immediately before unlink alone cannot close the remaining TOCTOU window. Async path shares the pattern but needs its own regression — codex-runtime
- No production lock changes shipped; previous SIGKILL recovery remains single-reclaimer evidence only. Batch is diagnostic, not a completed concurrency fix — codex-runtime

## Batch 5 — repair investigation WIP

- [x] Independently reproduced async stale unlink race: mode=async, replacementInjected=true, acquiredOverLivePeer=true. Sync and async both affected — codex-runtime
- Reviewed task-orchestration/lease-file-lock.ts before reuse: its companion path limits stale claim targeting, but final public inode-check/unlink is still separate and tomb recovery must be proven. Not adopted as a proven fix — codex-runtime
- Required protocol properties: acquisition and reclaim serialized by the same mechanism; no shared-name unlink after an unprotected check; crashed reclaimers recover without timeout-based revocation of live owners; sync and async share the protocol; legacy participants require an explicit migration boundary — codex-runtime
- Candidate implementation direction: OS-owned advisory lock with process-death release, or a formally reviewed unique-ticket arbitration protocol over local filesystem. No new native dependency selected yet. Network/shared-host semantics remain outside the single-host guarantee — codex-runtime
- [ ] Production repair remains unfinished. Do not interpret diagnostic probe success as a passing safety regression. Next implementation must invert probe expectation and add real multi-process paused-reclaimer and killed-reclaimer tests — codex-runtime

## Shared acquisition/reclamation protocol implementation

- [x] User explicitly requested protocol implementation; reviewed predecessor file-lock implementation and liveness tests, registered session runtime-lock-protocol-20261119, transferred only these paths while preserving predecessor sessions — codex-runtime
- [x] Added unique-ticket local-filesystem bakery arbitration: publish choosing ticket atomically, choose monotonic number with filename tie-break, refuse earlier or choosing live participants; dead owners are cleaned only via their never-reused ticket names — codex-runtime
- [x] Sync/async acquisition and stale reclaim execute one synchronous, arbitrated filesystem section. Release participates in arbitration and verifies descriptor inode before deleting public name — codex-runtime
- [x] Actual Node child pauses with SIGSTOP while owning reclaimer arbitration; both acquisition APIs refuse entry. SIGCONT completes normally; SIGKILL recovers both before and after old public-lock deletion — codex-runtime
- [x] Direct stale-unlink replacement regression blocks cooperating acquirer; updated standalone probe asserts this for sync and async. Earlier historical probe output describes old implementation only — codex-runtime
- [x] 41 tests passed across 5 relevant files; added after-unlink crash case then arbitration suite passed 5/5, bringing relevant cases to 42. Scoped lint on six TS files passes. tsgo reports 8 existing errors, none in modified files — codex-runtime
- pnpm check stops at existing formatting failures in 124 files. Isolated build command was rejected because automatic approval review could not complete; command was not executed. Build verification remains outstanding — codex-runtime
- Deployment boundary: local filesystem and all participating workers upgraded together. Mixed old/new writers, cross-host shared storage, power-loss durability and global exactly-once tools are not claimed. Arbitration directory remains intentionally; kill during staging may leave a unique .pending file that is never treated as an active ticket. PID reuse can delay recovery conservatively — codex-runtime
- Release arbitration timeout fails closed and reports an error; live paused owners are never revoked by elapsed time. This can delay work until the paused process resumes/exits — codex-runtime

## Next full-pack checkpoint

- [x] Durable external-operation journal added before side-effect execution; succeeded results replay without re-running; started records fail closed as outcome-unknown — codex-runtime
- [x] Delivery side-effect path now uses operation journal; usage Outbox recovery tests cover persisted receipt, interrupted processing, and duplicate completion — codex-runtime
- [x] Relevant tests: 26 passed across 6 files; scoped lint passed.
- [ ] Unified ExecutionContext/StepEvent/WaitCondition/TurnOutcome has not yet been wired end-to-end.
- [ ] External provider query/reconciliation, cancellation-vs-completion transaction, metrics, and Postgres lease/fencing backend remain incomplete.

- [x] Added typed ExecutionContext, StepEvent, WaitCondition and StandardExecutionResult contracts with evidence/wake-condition test. End-to-end adapters are still pending — codex-runtime

## Rebase and wait-contract integration checkpoint

- [x] Replayed all seven Runtime commits onto refreshed origin/main; preserved latest registry on conflicts; narrow durable storage port retained — codex-runtime
- [x] Installed newly required stream-json dependency from frozen lockfile; reran exact relevant regression set: 8 files / 45 tests pass — codex-runtime
- [x] Unknown operation now carries standard external_operation WaitCondition. Repeated delivery claims with a started journal surface reconciliation requirement instead of silently skipping, and never re-fire — codex-runtime
- [ ] Model adapter still projects unknown operation as tool error. Unified waiting scheduler and reconciliation consumer are not integrated.
- WIP: registry session restoration needs minimal-diff normalization and ownership audit before committing this checkpoint; edits remain uncommitted — codex-runtime

## Waiting tool adapter and reconciliation WIP

- [x] Pi tool adapter now returns waiting + retryAllowed=false + canonical WaitCondition for unknown external outcomes — codex-runtime
- [x] Added query-only reconciliation: unknown keeps started state; confirmed provider evidence persists result and supports replay without invoking a writer — codex-runtime
- [x] 22 tests across operation journal/private bag/actual delivery adapter pass; scoped lint passes — codex-runtime
- [ ] Provider-specific query consumers, durable wait scheduling, Postgres, cancellation transaction and observation sinks remain unfinished.
- WIP remains uncommitted pending minimal registry normalization and path takeover audit. No deployment performed — codex-runtime

## Durable reconciliation waiting WIP

- Added persisted wait condition, query due time, attempt count and bounded backoff to external operation records. Query-unknown persists next due time; confirmed evidence clears wait. Added due scan for result journals — codex-runtime
- Existing 22 operation/delivery tests pass and scoped lint passes; new due-scan/backoff tests and production scheduler consumer are still required — codex-runtime
- Requested provider-specific consumers, cancel arbitration and Postgres backend remain unimplemented. No claims of completion or database validation. Worktree remains WIP, uncommitted — codex-runtime

## Closure audit — incomplete

- Due scan/backoff/confirmed removal regression added: 23 related tests pass. Query exceptions become unknown with persisted retry backoff instead of permitting writes — codex-runtime
- Attribution gate fails: 1 unattributed path and 3 conflicting historical ownership paths. Do not commit until registry is repaired without overwriting predecessor records — codex-runtime
- Full requested scope remains open: provider query consumers, gateway scheduling integration, cancellation/completion arbitration transaction, Postgres repository and fencing takeover tests. Current changes are a partial recovery layer only — codex-runtime
