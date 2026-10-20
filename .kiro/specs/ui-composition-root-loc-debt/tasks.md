# UI composition-root LOC debt

## Agents

- cursor-composer · role: owner · scope: track and retire `ui/src/ui/app.ts` LOC over-budget without raising budgets or disabling guards · paths: ui/src/ui/app.ts, ui/src/ui/app-lifecycle.ts, ui/src/ui/app-host-adapters.ts, ui/src/ui/capability/app-view-state-slices.ts, scripts/check-core-composition-root-loc.ts · since: 2026-09-16

## Goal

Bring `ui/src/ui/app.ts` back under the locked budget in `scripts/check-core-composition-root-loc.ts` (4347 lines) by extracting wiring into existing controllers / lifecycle / view-state adapters — **not** by raising `maxLines`, disabling lint, or deleting the guard.

## Baseline (2026-09-16, post UI chat turn presentation rebase onto `origin/main`)

| File               | Lines | Budget | Delta |
| ------------------ | ----: | -----: | ----: |
| `ui/src/ui/app.ts` |  4430 |   4347 |   +83 |

Note: `origin/main` was already ~81 lines over budget before this UI stream; the chat turn / thinking / quote work added ~2 net lines after migrating thinking-clock sync into `app-lifecycle.ts`.

## Scope (ordered)

1. **Done (this stream):** Move `syncChatThinkingClock` / `stopChatThinkingClock` from `app.ts` into `app-lifecycle.ts` (`handleUpdated` / `handleDisconnected`).
2. **Next:** Move `@state()` chat fields that are pure projection (`chatQuoteDraft`, `chatThinkingNowMs`) behind `AppViewChatCapabilityState` wiring helpers so `app.ts` only delegates to typed slices.
3. **Next:** Peel remaining chat send / scroll / session-switch one-liners from `app.ts` into `app-chat.ts` + `app-session-actions.ts` hosts (match existing `adaptChatSendHost` pattern).
4. **Gate:** `pnpm lint:core:composition-root-loc` passes with no budget table edits.

## Out of scope

- Raising `maxLines` for `ui/src/ui/app.ts`
- Disabling `lint:core:composition-root-loc` in CI or `pnpm check`
- Unrelated refactors in gateway / platform-auth files also over budget on dirty worktrees

## Acceptance

- `node --import tsx scripts/check-core-composition-root-loc.ts` reports `ui/src/ui/app.ts` ≤ 4347 lines
- UI chat turn / paste / quote / thinking behavior unchanged (existing node tests + browser checklist)
