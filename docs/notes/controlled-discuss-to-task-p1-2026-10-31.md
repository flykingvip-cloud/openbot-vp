# Controlled discuss→formal-task P1 (2026-10-31)

- Branch: `cursor-grok/controlled-discuss-to-task-p1-20261031`
- Base tip at start: `3dd5253b` (origin/main); later rebased onto `d37bed51` (#165).
- Closes breakpoint: explicit delegation never entered formal activate/materialize path.
- Does **not** claim full three-layer collaboration loop complete.
- Reuses `activateCollaborationTask` / materialize / publish; `oralDispatchCreatesBoardFact` stays false.
- `humanConfirmed` defaults false; flag-off checked **before** activate/ensure (unified user copy; **no task/board writes**); budget unchanged.
- Entry: RPC `collaboration.task.discussToTask`, tool `discuss_to_task`, chat pre-primary hook.
- WS integration proof scope: real WS/handler/store with identity boundary injected
  (`resolveDeliveryAclActor` mock); observer case split from dual-principal same-group isolation.
