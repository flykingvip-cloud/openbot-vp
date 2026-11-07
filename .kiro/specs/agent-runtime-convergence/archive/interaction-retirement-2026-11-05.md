# Interaction retirement record

Owner: codex-runtime-manager. Source snapshot: d2593caf9. Archived intent and source are recoverable with git show; no executable archive is imported or discovered at runtime.

| Retired entry | Original intent | Consumer audit | Replacement | Disposition |
| --- | --- | --- | --- | --- |
| src/agent-runtime/command/active-turn.ts | Compatibility export for the earlier busy-turn facade | No source imports or dynamic import references | command/index -> handleInteraction | Removed; no legacy fallback |
| src/auto-reply/reply/mid-task-aside.ts | Task query projection and old aside result vocabulary | Only two test suites; no production consumer | command dialogue-intent with fixed wiring rule bindings | Removed; assertions migrated to the actual public interaction behavior |
| Old aside-label routing | Keep ordinary recall separate from amendments | Removed in d2593caf9 | Shared semantic task relation | Historical intent retained; labels cannot override task changes |

The response lane is NOT retired: parent session lock isolation, cancellation registration before prepare, untrusted user-body history, stable message identity, and final-run separation remain necessary. Its existing prepared shared context, skill snapshot, authenticated identity and knowledge lineage must reach the same embedded model boundary; no new context retrieval or weaker source authorization is introduced.

Evidence: context forwarding test fails before fix (1 FAIL / 16 PASS) and passes after fix (17 PASS). Four affected suites pass 34 tests. Read-only repository searches find no imports of either retired module. Storage formats and historical sidecar names remain compatible.

Remaining architectural gaps are explicit: idle conversation still enters task orchestration; depth classification is scoped to selected sessions; context lane rules currently conflate capability restriction and optional context reduction; actual whole-runtime acceptance and deployment are not complete. Do not enable an alternate runtime or claim full cutover from this checkpoint.

## Execution compatibility adapter retirement

Source snapshot: 5eed6824a. src/auto-reply/reply/agent-runner-execution.ts only delegated to runAdmittedTurn. Production runtime call consumers: none. The remaining fallback-state import was type-only and now targets its original type owner agent-run-credit-usage directly. Main reply continues through fixed replyTurnRuntime.execution -> execution/index -> runAdmittedTurn -> admitted candidate; no alternate entry survives.

Governance E1/E5 metadata and actual-entry contract assertions now name the real execution owner. The preflight source assertion was stale (it looked for a provider call in a wrapper); it now examines the actual admitted candidate. Persisted submittedBy/validatorId values remain historical data identifiers and are intentionally not rewritten. Old closed-loop importer-list baseline failures are not weakened or represented as green. Source remains recoverable in Git; no runtime archive is loaded.

## Semantic routing retirement on 2026-11-08

Local annotated archive tag: archive/runtime-semantic-routing-20261108, source 07352de776f926ef98bdd07233b090c776d065d6. The tag preserves the removed implementation and historical tests; it has not been pushed.

The old interaction.ts, dialogue-intent.ts and command-adapters.ts originally separated busy-turn queries, amendments, owner controls and ordinary dialogue. Their second semantic classification is superseded by prepared governed interaction and explicit admission in get-reply-run; locked typed state mutations retain target/version/control semantics. Fixed interrupt/steer effects remain in interaction-effects.ts. Resource queue policy remains in policy/execution-queue.ts. No channel implementation is removed.

Consumer review found only historical tests and internal exports; package/plugin SDK exports do not expose these modules. The old comparison tests remain recoverable in the archive tag. Current route-interaction, prepared-interaction, state lifecycle and constraint regression cover retained responsibilities. The slice3 state tests retain query-does-not-write assertions while dropping calls to the retired classifier. Architecture denies imports of all three removed modules without exceptions. This retires these specific duplicate paths, not every legacy executor helper or extension workflow.

## Standalone aside executor retirement on 2026-11-08

This supersedes the earlier statement that the ephemeral response lane must remain. Its original purpose was timely dialogue without taking the task execution lock, plus cancellation isolation and trustworthy dialogue history. Governed interaction now answers directly without entering embedded execution, creating a task, or acquiring the task runner slot. Its own request AbortSignal rejects late provider responses. Task controls continue through typed state mutations and fixed execution cancellation effects.

The standalone runMidTaskAsideReplyLane has no production caller after the mainline routing retirement. Removed its ephemeral embedded executor, private lane registry, obsolete runner expectations and registry-only tests. Preserved Gateway run/buffer identity isolation tests and historical sidecar read/merge/trust support; existing conversation records are not deleted. Original implementation/tests are preserved by archive/runtime-semantic-routing-20261108 at 07352de776f926ef98bdd07233b090c776d065d6. No package or plugin SDK exports expose that lane.

Evidence: real isolated Gateway dialogue with an admitted task left the complete board unchanged; supplement/local revision/full replacement retained the same task and active constraints 1/2/1. Shared model cancellation regression rejects a provider answer returned after cancellation. Current shared interaction, lifecycle and Gateway identity suites pass 17 tests. Two old runner tests were observed failing because they demanded the intentionally removed execution-layer dialogue branch; they are archived rather than reinstating that branch. This does not establish every real concurrent cancellation or collaboration scenario.
