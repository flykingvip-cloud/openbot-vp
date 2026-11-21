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

## Claim ownership checkpoint

- Claims persist ownerPid and unique ownerToken. Same-process active claims dedupe without mistaking the pre-journal window for an orphan. Failed/no-result dead-owner claims require reconciliation and never re-fire — codex-runtime
- Existing delivery/private-bag 17 tests pass; new orphan regression passes (private bag 9/9); scoped lint passes. PID recycling conservatively delays detection; token is identity metadata, not fencing — codex-runtime
- Provider consumers, gateway recovery scheduling, cancellation transaction and Postgres fencing remain open — codex-runtime

## Postgres execution prototype — WIP, not integrated

- Added tenant-scoped execution/outbox schema and SQL repository claim + terminal arbitration. Database clock, fence/version/owner checks and atomic terminal event insertion are specified — codex-runtime
- Scoped lint passes; no database integration tests yet. No renewal, cancellation request ingress, repository factory, gateway wiring or migration deployment; not a completed Postgres backend — codex-runtime
- Query consumers and production waiting scheduler remain unfinished. New source and registry are uncommitted WIP — codex-runtime

## Production integration audit WIP

- runAdmittedTurn success is model execution, not business acceptance/delivery. Production completion hook must attach to verified acceptance after delivery, never to the model-loop return — codex-runtime
- Added database requestCancellation transition: tenant scoped, terminal compare-and-set, fence invalidation, atomic cancellation Outbox. This method is not yet connected to trusted interaction cancellation ingress — codex-runtime
- Production connection factory, lifetime/renewal worker, verified completion hook and shutdown lifecycle remain missing. No production backend enabled or deployed — codex-runtime

## Cancellation ingress repository verification

- Real isolated PostgreSQL regression extended and passed: cross-tenant cancellation rejected; duplicate cancellation produces no extra event; cancelled owner cannot renew or finish; one cancellation event persisted — codex-runtime
- Temporary database stopped after validation. Scoped lint and diff whitespace checks pass. Test is a single integration scenario with multiple assertions, not multiple independently isolated cases — codex-runtime
- Production trusted ingress, abort propagation, accepted delivery completion and gateway lifecycle remain unconnected. Repository code is WIP and not deployed — codex-runtime

## Lease lifecycle helper WIP

- Located trusted executionIdentity on queued runs, opts.abortSignal, and deferred commitGrowthOutcome acceptance/delivery boundary. Gateway server-close owns connection shutdown lifecycle — codex-runtime
- Added acquireExecutionLease helper: requires tenant/execution identity, claims before use, propagates parent abort, serializes renew calls, aborts on renewal rejection/error, exposes explicit dispose — codex-runtime
- Helper only: no gateway pool/factory or actual run/acceptance/cancel binding yet. No lifecycle regression test yet. Scoped lint passes; must not enable in production before integration and tests — codex-runtime

## Lifecycle regression checkpoint

- 4 lifecycle tests pass: trusted identity rejection, parent cancellation propagation, renewal rejection/error aborts and disposal stops timers. Invalid lease parameters/pre-aborted callers rejected before claim — codex-runtime
- Actual reply-turn/gateway lifecycle binding remains unfinished. Repository helpers are not a production-enabled backend; no config activation or completion hooks added — codex-runtime

## Opt-in reply execution lease binding WIP

- replyTurnRuntime.execution now calls runWithPostgresTurnLease; unset OPENBOT_RUNTIME_DATABASE_URL retains existing behavior, configured mode requires trusted enterprise identity and stable task executionAttempt, creates ready row and acquires lease before model invocation — codex-runtime
- Leased AbortSignal flows through opts; lost lease rejects return; finally disposes renewal and closes per-turn pool. No automatic schema creation — codex-runtime
- Binding has no dedicated mock/real-db runner test yet; final acceptance/delivery and gateway-level pool/shutdown still not connected. Database row remains running until lease expiry; repeated logical execution requires explicit terminal policy. Do not enable in production yet — codex-runtime
- Scoped lint passed; full type diagnostics saved in /tmp/runtime-binding-tsgo.log. Source remains uncommitted WIP pending ownership and integration tests — codex-runtime

## Turn binding regression WIP

- Added injectable per-turn pool test seam; 3 turn binding tests pass (disabled pass-through, trusted identity/parent cancel/cleanup, DB failure prevents model execution). Combined lifecycle tests 7/7 pass; scoped lint passes — codex-runtime
- Lease currently ends at model return; verified acceptance/delivery occurs later and has no lease fence. This is a known integration gap, not production-complete. Gateway lifecycle, final acceptance and cancellation ingress remain unfinished — codex-runtime

## Deferred acceptance binding WIP

- Success result transfers lease ownership to commitGrowthOutcome wrapper. Completed requires passed acceptance, delivered transport, deliveryId and no processPlaceholder; DB terminal commit fences before legacy outcome callback — codex-runtime
- New test confirms pool remains open after model return and closes after verified terminal callback. Turn wrapper suite 4/4 passes; existing lifecycle 4/4 passed before this addition — codex-runtime
- Known gap: absent deferred callback leaves renewal alive; gateway registry/shutdown cleanup missing. DB completion and legacy growth write are not one transaction. Not production-ready; uncommitted WIP — codex-runtime

## Gateway registry binding WIP

- Added gateway-scoped lease registry; per-turn resources register cleanup, shutdown stops admission and drains cleanup, startup recovery reopens admission. Lease disposal aborts delayed acceptance — codex-runtime
- Turn/lifecycle tests 8 passed; registry shutdown/reopen test 1 passed. Real server-close integration and failure paths still untested — codex-runtime
- Known remaining: cleanup failure currently can interrupt broader gateway close; concurrent renewal disposal ordering; trusted cancel request wiring; no complete production end-to-end validation. No deployment — codex-runtime

## Submit validation 2026-11-20

- 9 unit/integration-seam tests and 1 isolated real PostgreSQL scenario pass. Scoped lint on 11 TS files passes; full tsgo errors are outside modified paths; full check remains blocked by existing repository issues — codex-runtime
- Shutdown cleanup errors no longer skip other gateway shutdown work. dispose returns pending renewal promise; per-turn cleanup awaits it before closing pool — codex-runtime
- Submission is opt-in WIP integration, not production readiness certification: provider query consumers, trusted cancel ingress, DB+legacy outcome reconciliation, real gateway shutdown fault tests and no-callback runtime timeout remain open — codex-runtime

## Full remaining scope acceptance gates

User instruction: do not submit/push new implementation until ALL gates pass. Prior commits retained and rebased onto refreshed origin/main — codex-runtime

- [ ] Unified trusted identity/global operation key consumed by chat, cron, recovery, sub-agent and Fabric execution, not only type declarations.
- [ ] Tool-specific query consumers use trusted receipts; unknown retains wait without replaying writes; confirmed restores original result.
- [ ] Durable wait consumer owns claims, persists retry/backoff, wakes original execution, survives restart and duplicate delivery.
- [ ] Trusted cancellation ingress invalidates DB owner and aborts live work; cancel-vs-acceptance race produces one terminal fact.
- [ ] Growth/statistics/AOR projection consumers persist receipts and replay idempotently; accounting/policy remain reliable.
- [ ] Postgres task Repository supports authoritative task state, operations, recovery scans, lease renewal and transactional Outbox; no parallel file authority.
- [ ] Real process pause → takeover → old process resume rejects old writes; provider result-loss and billing crash tests pass.
- [ ] Acceptance/delivery commits are fenced; legacy outcome dual-write reconciles; gateway shutdown/renewal fault tests pass.
- [ ] Recovery and cost metrics emitted with definitions; scoped checks, real DB integration, build and ownership gates pass.

## Additional ingress correlation WIP

- Fabric gated execution now forwards canonical operation correlation identity/key to ToolRunner when tenant/task/request/node correlation fields exist. This is NOT persisted deduplication or authority; source tenant still requires existing policy validation. ToolInvoker consumer does not yet enforce it — codex-runtime
- Existing Fabric execution tests 14/14 pass. Child spawn currently allocates new random childIdem per call; cron needs occurrence ownership persisted at scheduler source. Neither is complete; no submission/push — codex-runtime

## Spawn durable identity audit

- Subagent childSessionKey and childIdem allocated randomly per spawn invocation; gateway agent dedupe reads context.dedupe. Neither establishes persisted logical parent-operation → original-child mapping — codex-runtime
- Do not hash task prose or use parentRunId+toolCallId as cross-recovery identity: both collapse legitimate duplicates or change on recovery. Required trusted dispatch record must own logical child operation, request digest, pending/accepted/unknown state and child receipt before retries reuse it — codex-runtime
- Scheduler currentFireId is already persisted; avoid duplicate trigger journal. Child spawn and downstream persistence remain unfinished; no new submission/push — codex-runtime

## Spawn identity concurrent/restart verification

- Replaced direct wx publication with complete private staging + no-replace hardlink publication. Racing readers see either absent or complete canonical JSON; staging cleanup in finally — codex-runtime
- Real Node process test: six IPC-barrier workers resolve one recorded call to identical identity; fresh seventh process reuses the receipt; one canonical record and no normal-exit staging residue. Corrupt published JSON fails closed. 2/2 tests and scoped lint pass — codex-runtime
- This covers resolver concurrency and process restart, not power-loss durability or killing mid-staging. All new work remains uncommitted per user instruction — codex-runtime

## Identity publication crash validation

- Added staging-file fsync and post-link directory fsync before returning identity. Real child SIGKILL tests cover partial private write, pre-link and post-link boundaries; restart returns one complete canonical identity, post-link identity is reused — codex-runtime
- Resolver suite 5/5 passes; previous scoped lint passes. Orphan private .pending files after SIGKILL are ignored, not garbage-collected.
- Actual power failure not tested. Directory ancestor creation durability and device/cache guarantees remain outside evidence; fsync is a durability measure, not proof of power-loss survival — codex-runtime

## Consolidated audit 2026-11-20

- Re-ran 14 focused test files: 68 tests passed. Isolated real PostgreSQL scenario passed separately; temporary server stopped — codex-runtime
- Full tsgo exposed logical identity incorrectly forwarded to skill rendering options; moved it to actual createOpenClawCodingTools invocation. This corrected an earlier unverified propagation claim — codex-runtime
- Actual power-loss testing unavailable without disposable VM/block-device fault setup; process SIGKILL evidence is not power-loss certification.
- Remaining full-pack gates are still open: all-entry event lifecycle, provider query consumers and recovery scheduler, cross-process billing consumption, trusted cancel ingress, projection Outbox migration, authoritative DB task state and full worker takeover/dual-write reconciliation. No new commits/push — codex-runtime

## Waiting handoff transaction WIP

- Added fenced owner/version guarded running→waiting transition and same-statement Outbox event; deferred acceptance wrapper invokes it for pending/unsuccessful closeout rather than leaving running state behind — codex-runtime
- Turn wrapper tests 5/5 pass; isolated PostgreSQL scenario extended for waiting state/reason, cleared lease and exactly one handoff event and passed. Temporary server stopped — codex-runtime
- Recovery scanner/consumer must route waiting by reason and original result evidence before any reexecution. This is not implemented; automatic waiting reclaim must not be enabled as blind model rerun. Full four-package scope remains incomplete. No commits/push — codex-runtime

## Outbox consumer ownership WIP

- Added PostgreSQL Outbox token claims with SKIP LOCKED, DB-clock expiry, token/expiry guarded ack, retry scheduling and errors. Tenant-scoped lookups and index included — codex-runtime
- Isolated PostgreSQL integration scenario passes: wrong tenant no claim; wrong/expired token no ack; expired claim replaced with new token; duplicate ack rejected. This is sequential transaction evidence, not multi-worker process proof — codex-runtime
- Concrete growth/statistics/AOR consumers and atomic effect+ack or receipt-based deduplication remain unimplemented; at-least-once transport cannot guarantee exactly-once projections by itself. No commit/push — codex-runtime

## Independent Outbox consumers verification

- Real PostgreSQL test uses 3 independent connections and committed isolated schema. Concurrent claims select different events; disconnected claimant's expired event is reclaimed with a new token; old token rejected and both events acknowledged once — codex-runtime
- Outbox and execution integration scenarios 2/2 pass. Isolated schema dropped and temporary server stopped. This verifies connection-loss/expiry, not OS worker SIGKILL or effect+ack exactly-once — codex-runtime
- Growth/statistics/AOR migration and recovery handlers remain open. All new work uncommitted per instruction — codex-runtime

## Outbox scheduler composition WIP

- Scheduler composes claim/drain and event handler resolver, serializes in-process ticks, aborts new work and awaits in-flight drain during stop. 7 consumer/handler/scheduler tests pass; scoped lint passes — codex-runtime
- Gateway does not start it yet: concrete replay-safe growth/statistics/AOR and recovery ports are missing. Scheduler scope requires trusted tenant list/connection lifecycle before activation. Not production connected, no commit/push — codex-runtime

## Projection receipt foundation WIP

- Added immutable tenant/consumer/event projection receipts with payload+execution conflict rejection and duplicate idempotence. Real PostgreSQL integration scenario passes with one receipt — codex-runtime
- Existing Growth JSON, operational metrics JSON and AOR bandit/audit files are not transactionally coupled to this receipt; no projection consumer is enabled yet. This foundation cannot claim exactly-once effects — codex-runtime
- Temporary DB stopped. No commits/push per user instruction — codex-runtime

## Strict AOR projection boundary WIP

- Extracted strict AOR feedback port: invalid target/write failures propagate; legacy best-effort wrapper preserves existing warning behavior. AOR feedback tests 8/8 pass; scoped lint passes — codex-runtime
- Strict port is not replay-idempotent and is deliberately not registered with Outbox yet. Database receipt and file bandit mutation are still separate authorities. Growth/statistics/AOR production migration remains unfinished, no submission/push — codex-runtime

## AOR event projection atomicity WIP

- New recordAorFeedbackEvent writes bandit mutation and payload-digest receipt into one locked atomic snapshot; duplicate does not increment trials, conflicting event fails. AOR tests 9/9 and scoped lint pass — codex-runtime
- Legacy PersistentBanditFeedbackStore writer exports state without eventReceipts and could erase receipts. New event port is NOT registered in production until all same-file writers preserve receipts/use protocol; tests do not prove mixed-writer safety — codex-runtime
- No new commits/push — codex-runtime

## AOR legacy writer convergence

- Gateway legacy/strict feedback now delegate to same receipt-preserving atomic writer; compatibility calls are distinct observations with unique legacy IDs. Mixed old/new gateway API test passes; AOR tests 10/10 — codex-runtime
- Added concrete validated AOR event handler with host-configured destination, not event-supplied path. Not registered in gateway yet; SDK direct persistent-bandit writers still outside this protocol. Growth/statistics and recovery consumers remain incomplete — codex-runtime
- No new commits/push — codex-runtime

## Concrete AOR consumer composition

- Composed real AOR handler with event resolver and drainer. Ack-lost replay increments trial once; payload cannot override host projection target; invalid score writes nothing. 2/2 tests and scoped lint pass — codex-runtime
- Fixed test callback type against RuntimeOutboxEvent after full tsgo caught narrowing. Production scheduler still not registered; SDK/multi-process mixed-writer safety remains open; growth/statistics/recovery handlers remain incomplete. No commits/push — codex-runtime

## Atomic statistics projection WIP

- Added PostgreSQL statistics projection with receipt insert and counter mutation in one CTE statement; replay no increment and altered duplicate payload rejected. Real database scenario passes with total/success exactly 1 — codex-runtime
- This is not yet registered as statistics.refresh handler (that event lacks outcome success) and does not replace existing JSON read authority. SDK mixed-writer solution remains open; an unprotected pre-write check was rejected as insufficient. Production scheduler still disabled — codex-runtime
- No new commits/push — codex-runtime

## Statistics outcome consumer binding

- Added statistics.outcome strict boolean-result event route and concrete tenant-bound PostgresStatisticsProjection handler. Missing/invalid result or unregistered handler remains unhandled, not acknowledged — codex-runtime
- Consumer/handler/scheduler suites 8 tests pass, scoped lint passes. Verified task-acceptance producer and production gateway handler registration remain missing. Growth/recovery handlers still incomplete — codex-runtime
- No new commits/push — codex-runtime

## Verified acceptance statistics producer

- Postgres settle inserts terminal fact plus statistics.outcome (when trusted agent provided) in one statement; reply acceptance callback supplies run.agentId after explicit passed acceptance + delivered receipt — codex-runtime
- Turn binding suite 5/5 and real PostgreSQL integration scenario pass; DB asserts completed execution produces terminal+statistics events. No producer from bare model success — codex-runtime
- Gateway concrete consumer registration, growth/recovery handlers, terminal audit retention still incomplete. Temporary DB stopped; no commits/push — codex-runtime

## Opt-in statistics gateway registration WIP

- Added OPENBOT_RUNTIME_STATISTICS_CONSUMER=1 registration requiring DB URL and trusted OPENBOT_RUNTIME_CONSUMER_TENANT_ID. Gateway startup composes real SQL projection and scheduler; gateway resource registry owns shutdown — codex-runtime
- Outbox filter restricts claim to statistics.outcome; real DB proves audit and recovery events remain unclaimed. 2 DB integration scenarios pass, full tsgo and scoped lint pass — codex-runtime
- No running config changed. Gateway startup failure/shutdown fault integration tests missing. Growth/AOR/recovery registrations and SDK mixed writing remain incomplete. No commits/push — codex-runtime

## Statistics consumer lifecycle verification

- Added 3 composition tests: disabled/missing tenant avoids pool; real projection SQL precedes ack; registry stop closes pool and timer; DB errors observable and cleaned up. Tests and scoped lint pass — codex-runtime
- This is injected SQL pool + gateway resource registry evidence, not complete gateway process boot/close. Other projection/recovery registrations and SDK mixed-writer protocol still incomplete. No commits/push — codex-runtime

## Deterministic growth snapshot WIP

- Added Postgres operational growth snapshot from statistics source and receipt in one statement; duplicate event is harmless, missing statistics source fails. Real database integration scenario passes — codex-runtime
- Snapshot is NOT full GrowthStatus/adaptive learning; existing JSON read authority remains. No growth producer/scheduler registration yet; source ordering must be enforced by atomic statistics→growth event emission. No commits/push — codex-runtime

## Remove parallel growth model

- Removed this task's untracked growth-projection.ts, runtime_growth_projection schema and prototype DB assertions. Runtime statistics remains source data; GrowthStatus remains sole growth aggregate — codex-runtime
- 11 growth store/operational consumer/legacy projection/self-tuning regression tests pass. Tenant directory resolver audit confirms host context and tenant-root checks required; production registration cannot infer filesystem authority from env tenant string — codex-runtime
- No user DB schema was changed or dropped; removed only uncommitted prototype creation source. No commits/push — codex-runtime

## Trusted GrowthStatus consumer scope

- Added host-client-bound operational consumer factory: re-resolves authoritative membership per event; tenant mismatch blocks before directory resolution; uses existing resolveAgentDirForClient. Revocation regression 1/1 passes; scoped lint passes — codex-runtime
- Gateway background boot lacks authenticated client and cannot fabricate it. This factory is not a production background registration; service-principal authority path still required. No commits/push — codex-runtime

## Existing operational producer convergence

- syncRobotGrowthFromOperationalMetrics now applies through same GrowthStatus event aggregate, with content-derived operational snapshot ID and observation timestamp; preserves legacy callers while removing separate state write path — codex-runtime
- 12 growth regression tests and scoped lint pass. Self-tuning still runs BEFORE aggregate event dedupe; duplicate sync can repeat adaptive behavior. It is not asynchronous/replay-safe yet. Background authority and Outbox registration remain open. No commits/push — codex-runtime

## Authorized growth Outbox composition

- Added startGrowthOutboxConsumer requiring host DB + live service authorization, startup tenant check, per-event grant validation, growth.operational-only claim and registry-owned stop. Auth/lifecycle tests 3/3, scoped lint and full tsgo pass — codex-runtime
- Main gateway does not invoke factory: actual service authorization provider and immutable operational event producer are not implemented. Connection ownership stays with host. This is composition, not production activation; no commits/push — codex-runtime

## Durable service authorization source WIP

- Added disabled-by-default expiring database grants scoped to tenant/principal/user/domain/agent allowlist. Authorizer queries every time, rejects absent/expired/invalid grants. Environment identity is selection only, not authority. Revocation unit test and scoped lint pass — codex-runtime
- No grant provisioned, no migration applied to production. Main gateway still not composing growth service; immutable producer still incomplete. No commits/push — codex-runtime

## Main gateway growth service wiring

- Main gateway recovery startup calls opt-in startPostgresGrowthService. Requires configured DB, tenant and principal selection plus a live DB grant; creates scheduler only after authorization; registry stops scheduler and pool — codex-runtime
- Startup missing-grant/authorized lifecycle tests 2/2 pass, scoped lint and full tsgo pass. Running config/grants unchanged. Startup sits inside existing catch/log recovery block; enabled authorization failure is logged rather than aborting whole gateway startup — codex-runtime
- Complete immutable growth.operational production and end-to-end delivery still missing; no deployment or new commits/push — codex-runtime

## Immutable growth event producer WIP

- Added enqueueOperationalGrowth: complete metrics/observation time/skill snapshot, canonical sorting, execution existence guard and idempotent event payload conflict. 2 producer tests and lint pass — codex-runtime
- Producer is not connected to recordTaskOutcome because that path lacks DB/lease host context. Do not open a new DB pool in Growth module; execution host must pass transaction/tenant authority. Main gateway still not full end-to-end — codex-runtime

## Real closeout growth producer WIP

- Opt-in leased turn deferred closeout calls produceCloseoutGrowth after legacy outcome commit. Revalidates DB service grant and agent allowlist, requires configured legacy metric directory equal authorized tenant directory before snapshot enqueue — codex-runtime
- Scoped lint passes; existing turn tests run with growth flag off. Enabled end-to-end path not validated. Skill catalog tenant ownership still requires audit.
- Known double-write window remains: DB terminal and legacy metric commit precede growth snapshot enqueue; crash there may omit event. Snapshot sampled on a later retry may conflict under same event ID. No claim of atomic end-to-end completion; must persist immutable intent/snapshot in original closeout transaction or reconciler. No commits/push — codex-runtime

## Growth production path acceptance audit

- 6 focused files / 16 tests pass: closeout grant/directory/enqueue boundaries, gateway service startup, consumer lifecycle, full aggregate projection and lease acceptance. Scoped lint and full tsgo pass — codex-runtime
- Added mismatch test proves no global metric/skill read before authorized directory match. Enqueue failures propagate. These use mocked boundaries and are NOT real gateway+DB end-to-end evidence.
- Acceptance remains blocked on immutable closeout intent/snapshot atomicity and tenant-scoped skill catalog source. No production activation or commits/push — codex-runtime

## Atomic growth capture intent

- Enabled growth completion transaction now persists growth.capture with tenant/execution/agent and delivery evidence together with completion/statistics. DB scenario confirms all 3 events; turn suite 5/5 and full tsgo pass — codex-runtime
- Intent prevents completely unrecorded capture work after post-completion crash, but no growth.capture consumer exists yet. Original metrics+snapshot capture is still a separate dual-write; not a fully closed recovery path.
- Skill store audit: global robotRelations keyed by agentId, no tenant qualifier. Directory equality does not establish skill ownership; real tenant skill binding source required before production safety claim. No commits/push — codex-runtime

## growth.capture consumer protocol WIP

- Added capture event route and consumer: checks downstream immutable event first, reuses persisted publication after lost ack, only invokes injected authorized snapshot source if absent. Failed capture propagates, no silent ack. 5 capture/handler tests pass; scoped lint passes — codex-runtime
- Not registered in production: authoritative tenant skill snapshot source absent; robot relation has no tenant/user. Requires install/read migration and explicit historical ownership mapping, no guessing from global agentId. Full two-gap closure and real gateway acceptance incomplete. No commits/push — codex-runtime

## Latest verification 2026-11-20

- Real PostgreSQL execution+Outbox scenarios 2/2 pass; 11 focused growth/skill/spawn files 53 tests pass; full tsgo passes; isolated OPENBOT_STATE_DIR pnpm build exits 0; diff whitespace passes — codex-runtime
- DB server stopped. Build output remained inside worktree; no running config/gateway changed.
- Not full gateway end-to-end: no single real DB→authorized capture→GrowthStatus test or process boot+crash+recovery. Partial mocked-boundary tests cannot close this gate. No new commits/push — codex-runtime

## Real growth pipeline verification

- Added real child-process test with isolated state/tenant roots, real skill install ownership, PostgreSQL grant, growth.capture→growth.operational claim/dispatch and real GrowthStatus publication. Both events acked; observation=100 and score>0 asserted. 1 integration scenario passes — codex-runtime
- Temporary schema/root cleaned and DB stopped. This is real service-function pipeline, not HTTP gateway boot or SIGKILL recovery. Those acceptance gates remain open; no commits/push — codex-runtime

## Real projection-before-ack SIGKILL recovery

- Real pipeline test now kills consumer after GrowthStatus publication before Outbox ack, expires claim deterministically with DB clock, launches fresh Node process and replays original operational event. Full persisted state exactly unchanged; both capture+operational events ultimately acked. 1 real integration scenario passes — codex-runtime
- Scoped lint passes. Temporary schema/root removed and DB stopped. This is service process recovery, not full gateway HTTP boot/close validation or power-loss test. No commits/push — codex-runtime

## Full gateway process lifecycle baseline

- Started actual startGatewayServer under isolated OPENBOT_STATE_DIR/CONFIG_PATH/TENANTS_ROOT and loopback port 19543, control UI/browser/mDNS disabled. Non-minimal normal startup completed; server.close completed and process exited 0. Markers/log in /tmp/runtime-gateway-process.log — codex-runtime
- DB growth consumer was OFF in this baseline. This does not certify enabled consumer startup/close or real HTTP-triggered growth end-to-end; that remains open. No existing gateway/config touched, no commits/push — codex-runtime

## Enabled full gateway growth consumption acceptance

- Actual non-minimal gateway process started on isolated port 19544 with real PostgreSQL schema, enabled growth flag and expiring service grant. Preloaded immutable growth.operational event consumed automatically, GrowthStatus written under authorized tenant/user agent directory, DB delivered_at confirmed; server.close and process exit 0. Markers in /tmp/runtime-enabled-gateway.log — codex-runtime
- Temporary DB schema dropped and server stopped. Running production config/grants untouched. Harness is /tmp/runtime-enabled-gateway.mjs, not yet a checked-in reproducible regression. This covers preloaded operational event→gateway consumer, not model acceptance producer or gateway SIGKILL recovery. No commits/push — codex-runtime

## Full gateway SIGKILL recovery evidence

- Isolated full gateway on 19545 with real PostgreSQL grant and operational event; test-only instance process patched ack method to pause after GrowthStatus write. Parent SIGKILLed gateway, expired claim in DB and started fresh full gateway; event acked and growth file byte-identical, then normal close. Exit 0 marker FULL_GATEWAY_SIGKILL_RECOVERY_PASSED in /tmp/runtime-full-gateway-kill.log — codex-runtime
- Harness remains /tmp/runtime-gateway-kill-parent.mjs, not checked-in regression; injected prototype override is isolated process fault seam. Tests use preloaded event and forced DB expiry, not real elapsed lease or physical power failure. Temporary schema dropped, test DB stopped; no commits/push — codex-runtime

## Authoritative terminal result fact WIP

- Added runtime_task_result_facts; settle persists immutable tenant/execution terminal state, delivery evidence and agent in same SQL statement as state and Outbox. Real DB fact assertion passes; real acceptance/growth SIGKILL scenario passes — codex-runtime
- Growth capture still reads legacy metrics; facts-to-metrics reconstruction not implemented, so stale-snapshot dual-write gap is not fully closed. Request cancellation method does not yet emit matching result fact. No commits/push — codex-runtime

## Terminal facts → operational task metrics

- Added tenant/agent-scoped rebuildOperationalMetrics from runtime_task_result_facts: counts completed/failed, excludes cancellation from task judgement; derives stable latest fact timestamp. Growth authorized capture now uses DB aggregate, not legacy metrics JSON — codex-runtime
- Missing tool/takeover/satisfaction evidence contributes zero observation denominator, not a perfect score. Those fact streams and historical metric migration remain unfinished. Empty tenant scope returns no observations.
- 3 capture unit tests, real DB execution and acceptance→growth SIGKILL scenarios 2/2 pass; scoped lint passes. Legacy directory equality guard retained for destination consistency, not metrics authority. No commits/push — codex-runtime

## Cancellation fact completeness

- requestCancellation now atomically inserts cancelled result fact alongside state/fence and Outbox; admission row stores trusted agentId for attribution. Real DB scenario passes; turn wrapper 5/5 and scoped lint pass — codex-runtime
- Cancelled excluded from task-judgement denominator; transient execution failure remains waiting, not fabricated task failure. Trusted cancellation ingress/AbortSignal wiring remains incomplete; tools/takeover/satisfaction fact streams still missing. No commits/push — codex-runtime

## Cross-connection cancellation and terminal competition

- Real DB scenario with 3 independent connections: remote cancel causes lease abort at renewal; ended worker DB connection causes renewal error and abort; 12 concurrent cancel/complete rounds each yield exactly one accepted transition, result fact and event. Scenario passed — codex-runtime
- Same OS process/independent DB connections simulate nodes; not multi-host proof. Network blackhole/hung query and real HTTP cancel authorization remain untested. Default cancellation detection is renewal cadence, not immediate remote push. Temporary schema dropped and server stopped; no commits/push — codex-runtime

## Hung-renewal deadline and cancellation regression

- Added independent local lease expiry watchdog; hung renewal promise aborts at local expiry, late response cannot revive aborted lease. Renewal success uses request-start timestamp conservatively. Lease+turn tests 10 pass; scoped lint passes — codex-runtime
- Existing chat-abort/RPC owner-pause/persistence suites 16 tests pass. This is not HTTP auth evidence or real remote-host evidence. No authorized second host was provided; real multi-host execution remains unverified. Hung dispose still awaits pending renewal; driver/network timeout and shutdown deadline remain needed. No commits/push — codex-runtime

## Focused skill authority convergence WIP

- Robot skill list/toggle/upgrade/remove RPCs now obtain authoritative membership; mutation checks persisted exact tenant/user relation before invoking legacy store operation. List uses scoped read. 23 store tests, scoped lint and tsgo pass — codex-runtime
- Unauthenticated/local legacy RPC calls now reject: compatibility decision must be validated; install fallback, rollback, execution binding and auto-install still unclosed. Read-check-write is not a transactional scoped store mutation; concurrent relation replacement must be addressed before final isolation acceptance. No commits/push — codex-runtime

## Scoped skill invocation and restore WIP

- Invocation statistics and restore installation wrap same scope protocol; invocation event passes tenant/user when present; new scoped restore seeds attributed install then restores pin. 24 store regression tests, scoped lint and tsgo pass — codex-runtime
- Actual restore/evolution callers not fully migrated; invocation catch still swallows relation authorization errors. All skill writers not yet share lock, so global concurrent mutation safety not accepted. No commits/push — codex-runtime

## Skill invocation authority failures no longer swallowed

- Typed SkillRelationScopeError propagates through invocation completion before seen receipt is written, instead of silently accepting authorization failure. Missing legacy relation tolerance retained. Store+invocation attribution 30 tests, scoped lint and full tsgo pass — codex-runtime
- Not exactly-once invocation stats: audit append/counter/seen remain distinct. Evolution default port lacks trusted scope and is not yet migrated. No commits/push — codex-runtime

## Invocation audit projection ordering WIP

- Canonical invocation snapshot commits before completed JSONL projection. Non-missing-relation errors propagate; JSONL completed append uses lock+invocationId duplicate/content conflict guard. 31 store/invocation tests, scoped lint and tsgo pass — codex-runtime
- No snapshot→JSONL reconciliation scanner yet; mixed legacy skill writers can still overwrite snapshot/receipts. Scope constructor production migration still incomplete. JSONL scanning is O(history) per completed append and requires scaling review. No commits/push — codex-runtime

## Committed audit reconciliation WIP

- Added tenant/user-scoped read of canonical invocation audit facts and idempotent JSONL replay function. Real file test publishes missing audit, repeats harmlessly, does not increment counters and excludes other tenant; store suite 26/26, lint and tsgo pass — codex-runtime
- No production schedule or complete pagination yet; first-N scan can starve later history. Runtime audit shape validation is partial. Other skill writers and scope construction remain incomplete. No commits/push — codex-runtime

## Audit reconciliation cursor WIP

- Added tenant/user-hashed durable cursor with lock, ordered pagination and cursor advance only after audit append. Empty page wraps sweep so late earlier IDs are not starved. Page size 1/late insertion regression passes; store suite 27/27 — codex-runtime
- Normal replay is safe; explicit append-failure cursor test and production authorization/schedule still missing. Current implementation loads/sorts full receipt history per page, not scalable indexed pagination. Other skill writers/scope construction remain incomplete. No commits/push — codex-runtime

## Audit append failure and service scope

- Injected JSONL disk append failure, rerun projects original event once and skill counter remains one; 28 store tests pass. Added optional agent allowlist to committed audit scan; cursor identity includes sorted allowlist to avoid cross-grant cursor reuse — codex-runtime
- Scoped lint and full tsgo pass. Agent allowlist regression and production audit scheduler still missing. Full skill writer locking and scope constructor migration remain incomplete. No commits/push — codex-runtime

## Audit recovery lifecycle fault verification 2026-11-21

- Added revocation recheck, projection failure retry, hung authorization bounded stop and no late scan regressions. Audit scheduler+growth service suites 5/5 pass; scoped lint/full tsgo/diff checks pass — codex-runtime
- Growth service stop now attempts audit and consumer stops concurrently with deadlines, so one failure does not skip the other before pool cleanup. Actual enabled audit gateway fault process test still missing; all-writer skill protocol still incomplete. No commits/push — codex-runtime

## All direct skill-store writers lock convergence WIP

- AST inventory found 24 functions directly invoking writeStore; all now acquire same synchronous file-lock protocol around full function body/RMW. writeStore atomic snapshot already used. Corrupt store reads now fail rather than silently replacing with empty state — codex-runtime
- Skill store/invocation/evolution 34 tests pass; initial full tsgo and lint pass. After strict-read change skill suite 29 passes. Mixed-process stress and lock-held mutation-hook safety remain untested.
- Enabled audit full-gateway failure acceptance not executed in this turn. Scope migration still incomplete; no new commits/push — codex-runtime

## Real mixed-process skill snapshot evidence

- Added real Node IPC barrier race: 4 workers each create 10 distinct skills then atomic invocation commits; asserts 40 skills, 40 relations, 40 receipts, every relation counter=1. Test and lint pass — codex-runtime
- Does not cover delete/upgrade/rollback combinations or registered projection hooks; enabled audit full-gateway failure acceptance still open. No commits/push — codex-runtime

## Full gateway audit whitelist/revocation acceptance

- Actual non-minimal gateway on 19546, real DB grant + invocation snapshot: only allowed agent projected to tenant/user JSONL; denied agent absent. Revoked enabled grant, appended another fact and waited real 31 seconds; fact not projected; normal gateway close and process exit 0. Marker FULL_GATEWAY_AUDIT_SCOPE_REVOCATION_CLOSE_PASSED in /tmp/runtime-gateway-audit-accept.log — codex-runtime
- Schema dropped/test DB stopped. Harness /tmp/runtime-gateway-audit-accept.mjs is not checked-in regression. Hook mixed-writer stress/scope production migration and broader original runtime goals remain open. No commits/push — codex-runtime

## Mixed writer hooks and repeatable audit harness WIP

- Real four-process test now registers actual skill execution hooks and mixes create/invocation/toggle/upgrade/remove. Expected 40 skills, 20 remaining relations, 40 invocation receipts and count=1 pass; no observed deadlock — codex-runtime
- Copied prior full gateway audit script into scripts/runtime-acceptance/gateway-audit.mjs, adding isolated-root opt-in and loopback DB guard; lint passes. New checked-in version has not rerun; fixed schema/port/root requirements still need parameterization. Global agentId execution projection remains a multi-tenant gap. No commits/push — codex-runtime

## Repository audit harness rerun

- gateway-audit.mjs now uses unique safe schema and auto-reserved test port; production tenant runtime resolver derives projection path; schema dropped only if created. Requires isolated-root opt-in and loopback DB.
- Ran repository script with fresh state root and real PostgreSQL; actual gateway whitelist, real 31s grant revocation and close pass, marker in /tmp/runtime-audit-repo-harness.log; DB stopped — codex-runtime
- Port reservation race and supplied-root isolation assertion remain operator-managed; not parallel-safe reused roots. Same-relation stress and tenant-qualified execution projections remain open. No commits/push — codex-runtime

## HTTP durable operation admission regression

- Added real local HTTP test with authenticated tenant identity: identical operation replay invokes tool once; changed params rejected before duplicate execution; tenant mismatch 403. HTTP suite 24/24, lint and tsgo pass — codex-runtime
- Admission is local-file only, no DB fence; Fabric loopback gateway-token identity may lack enterprise attribution, so actual Fabric execution still not accepted end-to-end. Need service identity and trusted logical ownership, not request tenant trust. No commits/push — codex-runtime

## Durable admission concurrent publication

- Child/HTTP shared durable admission now publishes complete unique staging via no-replace hardlink rather than exposing partial wx claim JSON. 12 concurrent attempts test confirms at-most-one dispatch, unknown losers, receipt replay. 3 tests and lint pass; full tsgo passes after test discriminant fix — codex-runtime
- Fabric gateway bootstrap still supplies global operator token, not tenant service authorization; no unsafe tenant-header bypass added. DB fencing and authoritative service execution grant remain incomplete. No commits/push — codex-runtime

## Fabric authority regression gate

- Added RPC tests: spoofed tenant/user rejects before service.execute, authorized tenant binds membership user, stream tenant mismatch registers no recipient. Fabric handlers suite 15/15, lint and full tsgo pass — codex-runtime
- Service authority transfer and DB fencing not implemented: global gateway token cannot imply tenant execution ownership. HTTP checks deliberately remain strict; short-lived execution-specific authorization bound to admitted task/owner/fence is required. No commits/push — codex-runtime

## DB execution-bound tool authorization WIP

- Added hashed random token grants issued only under live owner/fence/task match; binds tenant/task/execution/step/operation/tool/session/request digest, expires no later than lease. Validate rechecks live lease/fence. Real DB scenario verifies matching grant, payload mismatch rejection and cancellation invalidation — codex-runtime
- Not wired to Fabric issue or HTTP validation. No durable result CAS under grant yet; external effects without downstream fencing remain uncertain after stale worker resumes. No commits/push — codex-runtime

## Fabric grant transport and HTTP validation WIP

- Loopback invoker requires injected host grant issuer for identity-bearing calls and sends execution grant header. HTTP validates provided grant against DB before and after invocation while retaining authenticated tenant/policy checks — codex-runtime
- Main gateway does NOT yet supply issuer; token-only Fabric remains rejected. Header is optional for legacy tenant-auth HTTP path, not full mandatory fencing. No dedicated integration tests yet; attempted loopback test file absent. Not production-complete. No commits/push — codex-runtime

## Host-bound Fabric grant issuer

- Added per-admitted-execution issuer binding host tenant/task/execution/session/owner/fence and AbortSignal; overrides rejected before SQL; invoker requires issuer and transmits capability. 2 issuer/transport tests and scoped lint pass; full tsgo passes after typed fetch mock fix — codex-runtime
- Global FabricService bootstrap still lacks request-scoped lease host. No issuer registered globally; sharing a user's lease across global service is forbidden. HTTP grant+tenant identity integration remains incomplete. No commits/push — codex-runtime

## Billing Outbox local cross-process locking WIP

- All receipt mutations use shared file lock inside existing in-process serialization; drain and direct-record drain share separate per-file delivery lock across processes. 6 existing recovery/hold/store tests pass, lint and tsgo pass — codex-runtime
- Real 4-process receipt writers retain all 60 receipts. This proves concurrent enqueue, not live debit exactly-once; direct-record done behavior and interrupted debit stages still require audit. File locks are single-host only; no Postgres billing authority implied. No commits/push — codex-runtime

## Gap-by-gap closure governance

- Created open-gaps.md and closed-gaps.md. No parent gap closed without production/test/fault evidence. G1 DB-mode identity request missing grant now denies before tool execute; HTTP tests 25/25 and full tsgo pass — codex-runtime
- Only G1 missing-grant subcase accepted; valid grant and request-scoped Fabric lifecycle still pending. Identity-less legacy requests are not covered by mandatory grant policy. No commits/push — codex-runtime

## G1 real DB grant + HTTP acceptance subgate

- HTTP suite now 26/26 with real PostgreSQL grant: valid invoke+replay executes once, changed args rejected, cancellation invalidates even local completed-result replay. Schema and temp state cleaned, DB stopped; lint and full tsgo pass — codex-runtime
- Mock gateway auth/tool surface remains in test. Full request-scoped Fabric host and atomic fenced result repository absent; G1 remains open. No commits/push — codex-runtime

## G1 fenced result publication repository subgate

- Added runtime_tool_results and commitGrantedToolResult: locks current execution row, validates complete grant binding/live owner/fence and atomically inserts result. Identical replay accepted; conflicting result or cancelled execution denied. Real PostgreSQL scenario and scoped lint pass — codex-runtime
- Not wired into HTTP durable dispatch. No start-intent operation claim, takeover race or full Fabric host test yet. G1 stays open, no commits/push — codex-runtime

## G1 database intent admission WIP

- Added runtime_tool_intents and claimGrantedToolIntent: current grant/fence lock, unique logical operation claim, repeat unknown, mismatched grant digest denied. Real DB scenario and lint pass — codex-runtime
- Not wired into HTTP; result commit not yet requiring exact matching intent, cross-node result replay missing, sequential DB test is not concurrency proof. G1 remains open; no commits/push — codex-runtime

## G1 HTTP database operation protocol

- Grant-bearing HTTP bypasses local file dispatch: validates grant, replays matching DB result, uniquely claims DB intent, executes once, commits result under exact original intent grant/fence. Unresolved intent returns unknown. DB result commit now requires intent match — codex-runtime
- HTTP+repository real DB suites 27 tests pass; lint/full tsgo pass. DB stopped. Concurrent HTTP/lease takeover and request-scoped Fabric host still absent; no parent closure or commits/push — codex-runtime

## G1 HTTP concurrent and takeover subgate

- Real PG+HTTP regression pauses first mocked tool, concurrent same-op request 409 without second execution; then expires lease after tool started, new owner claims, old result commit returns unknown and new owner cannot redispatch orphan intent. HTTP 26/26 pass — codex-runtime
- Tool/auth remain test doubles; no external destination fencing proof. Fabric request-scoped host and service identity propagation still incomplete; G1 stays open, no commits/push — codex-runtime

## G1 request host isolation WIP

- Added FabricService wrapper separating shared check/catalog from per-request admitted execution service and disposal; concurrent hosts and failure disposal/admission reject tests 2/2 pass; lint/tsgo pass — codex-runtime
- Wrapper not registered in gateway; actual admit must derive membership-bound DB lease and trusted service identity. Catalog mutation propagation into request services still requires design. G1 remains open, no commits/push — codex-runtime

## G1 resumed after release-chat alignment

- Refreshed main ancestry valid. Request host now checks admitted AbortSignal before invoke and before accepting result; cancellation regression confirms cleanup. Host/issuer/transport suites 5 tests pass. Main bootstrap still uses global service, G1 remains open — codex-runtime
- Updated stale gap ledger: HTTP PG intent/result CAS and valid-grant/concurrency/takeover tests are completed subgates, not full Fabric completion. No commits/push — codex-runtime

## G1 request-scoped gateway production host WIP

- Main gateway DB mode now wraps Fabric execute/stream in request admission: requires existing persisted ingress=fabric + tenant/task/user/session record, claims lease, builds scoped issuer and service, registry cleanup; never creates authority from request. Native process runner disabled in this mode to avoid HTTP bypass — codex-runtime
- Host/issuer/transport tests 5 pass; lint/full tsgo pass. Actual admission producer missing; HTTP global-token cannot yet recover tenant identity from validated grant; dynamic adapter catalog not propagated into new service; new admission lacks real DB regression. G1 OPEN, no commits/push — codex-runtime

## G1 authenticated admission and shared catalog production wiring

- Authenticated Fabric RPC persists full tenant/user/task/session/request binding using conflict-checked DB upsert before service execution; request host consumes record. Shared AdapterRegistry used by global and per-request services so dynamic adapters persist — codex-runtime
- Full tsgo passes. Complete RPC→host→issuer→HTTP grant identity→result test still missing; parent G1 not closed. Request correlation is still client-selected under auth and needs task ownership validation. No commits/push — codex-runtime

## G1 task authority binding WIP

- Fabric admission INSERT now requires matching existing live non-Fabric task execution under authenticated tenant/user/session, rather than creating arbitrary task authority from request. Chat lease admission persists trusted platformUserId/sessionKey/ingress for this check — codex-runtime
- Chat wrapper tests 5/5 and scoped lint pass. Existing rows lack fields and reject until explicit migration; active task concurrency and full authorized Fabric request path still untested. SQL authority query is not a complete task ACL model. G1 open, no commits/push — codex-runtime

## G1 real component chain verification

- HTTP real DB test now provisions existing task authority, invokes real persistAuthorizedFabricRequest, request host, shared adapter, issuer and loopback HTTP under operator auth with no tenant. HTTP restores tenant/user from valid grant before tool construction; executes successfully. 26 HTTP tests pass including concurrency/takeover — codex-runtime
- Found fixed service identity resolution incorrectly overriding authenticated member grant path; resolve only if no authenticated enterprise. Real DB cleaned/stopped. RPC auth/tool remain mocks; full gateway Fabric RPC and host teardown/retry policy missing. G1 stays OPEN. No commits/push — codex-runtime

## User-requested integration freeze 2026-11-21

- User superseded defer-all-commits instruction: freeze and commit current isolated work for multi-agent shared baseline review. No merge/deploy authorization inferred — codex-runtime
- Current snapshot is incomplete architecture work, NOT production-ready. G1 and G2-G10 remain open. DB-enabled Fabric behavior can reject legacy/unowned tasks; skill RPC membership requirements change compatibility. Keep opt-in features disabled pending integration review — codex-runtime
- Historical agents/paths retained in registry; this isolated snapshot designated lander solely for current edits. Full tsgo passes before freeze. pnpm check executed; repository-wide existing checks may remain failing. No bypass of commit hooks — codex-runtime
