# Command public API checkpoint

The explicit facade is src/agent-runtime/command/index.ts. Entrances in auto-reply and Gateway consume this facade; they must not import implementation files. Internal component tests may still directly test their subject. Exports are named; interfaces use export type. No registration, model call or scheduling occurs at module initialization.

| Use case               | Input/effects                                                                   | Adapter still owns                                                        |
| ---------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| queryCurrentTaskStatus | recognized query; read-only snapshot port; recorded-fact reply                  | admission, active-session scope, touch/cleanup, delivery                  |
| amendActiveTask        | existing restriction classification; captured identity, persist and steer ports | eligibility, presentation, fallback queue, session bookkeeping            |
| controlCurrentTask     | admitted owner prompt; atomic apply then main/aside/queue ports                 | authorization, state adapter, transport and reply                         |
| stopTaskAtGateway      | admitted Gateway stop; await chat abort then owner-only embedded/queue ports    | identity, partial/transcript behavior, acknowledgements and final cleanup |

The facade also exposes existing status formatting/classification compatibility symbols. It is not a generic command bus and accepts no configured callbacks, modules or scripts. Ports are fixed source-code dependencies.

## Remaining coupling

Task focus formatting has now moved to a pure context projection depending only on task data contracts. Command no longer imports the task persistence implementation, and the architecture rule rejects that dependency. Original board paths only re-export the same formatter for compatibility. Real Gateway regressions remain required; other command/planning migration is still incomplete.

Command planning, general message interpretation and task storage are NOT migrated. The facade is an explicit boundary for current use cases, not completion of the full layer.

## Verification

Ten files / 38 tests PASS. A temporary forbidden auto-reply deep import is rejected by the existing architecture checker, then removed. Full type diagnostics equal the post-#223 baseline (52); changed-file type-aware lint clean. Build and warning comparison recorded in tasks.md.
