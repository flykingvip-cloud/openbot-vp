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

## Step 3 contracts (2026-10-31 Asia/Shanghai)
Closed and locked via `discuss-to-task-contracts.lock.test.ts` + prior suites:

## Confirm bind (2026-10-31 Asia/Shanghai final hardening)
- Confirm must reuse first-persisted activationKey (message/goal/constraints/candidates).
- Drift on confirm → `activation_contract_conflict` (no silent replace).
- Lock: `discuss-to-task-confirm-bind.test.ts`; combo confirm uses same contract fields.

1. Explicit delegation → formal task
2. Flag-off real blocked (fixed copy; no task/board establish)
3. Source idempotency (same sourceMessageId)
4. Failure visible (persist-fail fixed suffix via existing egress; client assert)
5. Status receipt does not end main run (`state:"status"`)
Historical R4/R5: chat egress client-receive + `createOpenClawTools`→`collaboration_board` execute (injection.test).
Dual-principal WS timeout left for Step 4 combo loop — not expanded here.
