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

Task status still imports the original board focus formatter. A single ESM facade therefore exposes its static loading closure even to stop consumers. Gateway already directly imports SessionTaskBoard; real Gateway regressions are retained. Do not claim this layer is fully independent. Future work should extract a coherent read-only task projection (rather than add a formatter callback per helper), then retire this implementation dependency.

Command planning, general message interpretation and task storage are NOT migrated. The facade is an explicit boundary for current use cases, not completion of the full layer.

## Verification

Ten files / 38 tests PASS. A temporary forbidden auto-reply deep import is rejected by the existing architecture checker, then removed. Full type diagnostics equal the post-#223 baseline (52); changed-file type-aware lint clean. Build and warning comparison recorded in tasks.md.
