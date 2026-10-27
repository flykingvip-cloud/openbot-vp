# Collaboration P1 — Shared board fact surface (2026-10-15)

> Status: **gray-group ClaimContract allowlist + intent→publish draft + board template fields.**  
> Platform `collaboration.task.claimContract` remains **OFF** by default.  
> No Floor live / L3 `task.assign` / LIVE flag flips / second orchestrator.

## What this ships

| Item                                             | Behavior                                                                                                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collaboration.task.claimContractGroupAllowlist` | Gray enable: listed `groupId` or `tenantId/groupId` may write board facts while global flag stays false                                                              |
| Board template fields                            | Optional `goal` / `constraints` / `dueAtMs` / `suggestedRole` on publish (+ RPC schema)                                                                              |
| Intent materialize                               | `buildBoardPublishDraftFromIntent` / `materializeIntentToBoardItem` / entry `materializeCollaborationIntentToBoard` — default **needs human confirm** before publish |
| Progress read                                    | Existing `listBoardItems` / `getMemberProgress` unchanged (readable even when writes off)                                                                            |
| `oralDispatchCreatesBoardFact()`                 | Still always `false`                                                                                                                                                 |

Sample gray group: `grp-daniel-hhd-gmail-com-upbeyond`（数字人战队）.

## Gray-enable

In gateway config (ops-only; not an admin UI switch):

```json5
{
  collaboration: {
    task: {
      // keep false
      claimContract: false,
      claimContractGroupAllowlist: [
        "grp-daniel-hhd-gmail-com-upbeyond",
        // or "*/grp-daniel-hhd-gmail-com-upbeyond"
      ],
    },
  },
}
```

Reload/restart gateway so config snapshot picks up the list. Other groups remain Mode A (writes fail-closed).

## Rollback

1. Remove the group entry from `claimContractGroupAllowlist` (or set the array to `[]`).
2. Keep `claimContract: false`.
3. Reload/restart gateway.
4. Verify: `publishBoardItem` for that group returns `flag_off`; reads still work.

## Intent → board

1. Organizer/human utterance with deliverable+deadline (or long task goal) → draft with Goal/Acceptance/Constraints/Due/suggested claimants.
2. Default: `needs_confirm` until `humanConfirmed=true`.
3. On confirm + allowlist/global on → `publishBoardItem`.
4. Chat bubbles / oral “已派工” alone never create board facts.

## Tests

```bash
./node_modules/.bin/vitest run --config vitest.gateway.config.ts \
  src/gateway/collaboration-dispatch/claim-contract.test.ts \
  src/gateway/collaboration-dispatch/intent-board-materialize.test.ts \
  src/gateway/collaboration-learning/claim-contract-entry.test.ts
```

## Non-goals

- Global `claimContract` default ON
- LIVE production config changes without separate user auth
- P2 Todolist / P3 wake heartbeat / P4 self_advance
- Floor live / L3 bot `task.assign`
