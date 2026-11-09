# Batch C follow-up: state direction and handoff transaction

- Continues Draft PR #260. Does not start Batch D.
- Accepted compiler head `d72148535ec98959a48b1ea03c508561f49e6f19` stays in history.

## State no longer imports the collaboration host

`state/repository/durable-json.ts` owns the directory lock, durable JSON write, and JSONL append. The lock still uses a 30 second stale age, 20ms retry, and 250 attempts, and still throws `round lock timeout`.

`state/collaboration/round-txn.ts` imports that repository module. It does not import `gateway/collaboration-dispatch`.

`round-store-io.ts` re-exports the same primitives from `state/index` and keeps round snapshot paths. Gateway callers of `withRoundLock`, `appendJsonlDurable`, and `writeJsonDurable` are unchanged.

## Handoff transaction

`state/collaboration/handoff-txn.ts` owns, inside one directory lock:

- re-read of the handoff log and status check
- human-approval and governance-gate checks on approve
- fact idempotency read, then fact append, then contract append
- apply order: roll an existing txn forward, else write the txn, append the responsibility fact, write the task overlay, append the applied contract, delete the txn
- directory recovery of `*.txn` files

The host `handoff-contract.ts` still checks the flag, validates identity, builds the event key, projects optional OGUI text, and wakes after propose returns. Ledger append and the writable-path check are an injected port. The crash probe `afterFactBeforeTask` only runs between the fact and the overlay; it does not choose the writes.

SessionTaskBoard, ClaimContract, and ExecutorPrivateTodolist stay separate directories. No new recovery system and no state-machine change.

## Debt (non-blocking)

`src/agent-runtime/policy/collaboration-compile-sections.ts` is still one file of about 826 lines. Follow-up: split it by the existing segment functions (participation, dispatch, governance, context, presentation). This round does not do that split.

## Regression

`OPENBOT_TEST_PROFILE=low pnpm exec vitest run` on handoff invariant, handoff recovery boot, claim contract, peer review, private todolist, compiler, and the pinned hash file.
