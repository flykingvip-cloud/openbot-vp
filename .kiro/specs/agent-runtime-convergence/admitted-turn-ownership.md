# F2 admitted-turn orchestration ownership

Owner: codex-runtime-manager. This checkpoint moves one complete existing orchestration use case, not a new agent executor. Original admitted-candidate, admission-lease, bounded-recovery and outcome components remain the existing sole implementations.

## Actual main path

```text
Gateway / get-reply adapters
  -> runReplyAgent
       -> execution/index.runAdmittedTurn(request, wiring.bindAdmittedTurnHost())
            -> original task identity and budget clock
            -> original outcome recorder and run context registration
            -> original admission lease
            -> original bounded error-recovery loop
                 -> admission / routing / governance / snapshot
                 -> original model fallback
                      -> admitted-candidate (original CLI / embedded adapters)
                 -> original feedback / credit / session-error handling
            -> original result with delivery-triggered outcome commit
            -> finally original slot release and snapshot forgetting
       -> existing delivery preparation and terminal outlet
```

`auto-reply/reply/agent-runner-execution.ts` contains no loop or independent decisions. It preserves the old exported function/types and delegates to the same execution use case with the same mandatory host binder. The primary reply consumer imports the execution public entry directly, not that compatibility module.

## Required host groups

| Group         | Existing authority/effects retained                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| task          | Original entry TaskOutcome creation, subject normalization and original-task-current guard             |
| budget        | Original budget assessment and per-real-model-call charging; clocks/sequences remain run-local         |
| admission     | Original commercial slot acquire/release, called by the original admission lease                       |
| model         | Original context estimate, capability routing, governance, snapshots, platform mode and model fallback |
| accounting    | Original credit usage, AOR feedback and explanation writes                                             |
| observability | Original smoke clock, run context/language registration and failure gap reporting                      |
| sessions      | Original corrupted-session I/O transaction, invoked only after the original guarded decision           |

All groups and members are required typed source-code dependencies. No executable configuration, generic field dictionary, optional authorization handler, plugin callback or default no-op is added. The host binder captures function references only; it does not pre-read run snapshots, select models, acquire resources, initiate retries or create tasks. The existing corrupted-session effect implementation retains its old internal logs/unlink/memory/locked-store/catch order. It does not independently decide when recovery occurs.

The execution module owns run-local orchestration and all original branching/retry limits. Host effects retain their existing stores and mandatory policy checks. Grouped ports are an internal adaptation contract, not the final public SDK for external plugins. Existing typed request/result references still include legacy session/stream adapters; this does not claim their complete migration.

## Preserved invariants

- Run/task identity and budget initialization occur at the original time; no finish-time task inference.
- Denied admission returns before constructing a candidate or invoking model fallback.
- Original allowlists, capability failures and governance remain in the original order; no fallback bypass is added.
- Shared warnings, directly-sent keys, modelGate, budget sequence, tool counters and modality evidence remain same-run state, lazily read where originally read.
- Actual candidate invocation and provider switching remain the original model fallback; no wrapper loop added around it.
- Failure/abort/compaction/transient/session-recovery behavior and text remain unchanged.
- Credit/feedback timing, fire-and-forget writes and original delivery-triggered outcome commitment remain unchanged.
- Acquired slot release precedes snapshot forgetting in the original finally. Skipped or denied slots are not released.
- SessionManager transcript authority is not moved into optional context; original session reset I/O is retained, not replaced by raw message appends.

Independent normalized-body comparison found only host-call qualification, path/format changes and the preserved session-recovery I/O extraction. No algorithm change was accepted as part of this equivalence migration.

## Consumer and audit updates

- Main reply uses execution/index; run-ID regression observes that actual public entry.
- Model caller registry points to admitted-turn as the actual model-fallback call site.
- Commercial entry registry points to the actual mandatory admission call path.
- Tool observer and identity hop anchors point to admitted-candidate, which already owns the original embedded invocation.
- Architecture rules prohibit main reply from importing the old turn owner/private execution modules, prohibit turn orchestration from direct authoritative task/session/slot/snapshot imports, and prohibit host adapters from starting a second execution/provider loop.

## Remaining work

This closes ownership and main-consumer replacement for the complete existing normal turn entry. It does not complete command intake/state adapters, the final composition root, the full capability invocation contract, general task acceptance, cross-turn asynchronous job recovery, or builder/extension retirement. Legacy helper dependencies are still explicitly retained; Pi attempt/session/tool internals remain the original execution kernel.

Separate individual and collaboration orchestration still governs their respective task/claim lifecycles. Sharing this execution entry does not authorize a member to close a group contract or make one member output the final group deliverable.
