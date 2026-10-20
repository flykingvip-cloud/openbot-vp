# Interactive Choice Follow-up MVP (2026-10-12)

## Goal

Reusable interactive choice on OpenBot control-ui without inventing DIL/GenUI.

## Mapping

| Capability | OpenBot mechanism |
| --- | --- |
| Single-select | `chat-delivery` choice buttons (`role="option"`) |
| Selection state | Ephemeral panel map in `chat-delivery-view.ts` |
| Submit | 「确认并继续」 → `onSubmitChoice` → `handleSendChat(text)` |
| Skill guidance | `skills/interactive-choice-follow-up/SKILL.md` |
| Text fallback | Same `你选` / `A ·` markdown |

## Files

- `ui/src/ui/chat/chat-delivery.ts` — submit message helpers + question scaffold types
- `ui/src/ui/chat/chat-delivery-view.ts` — select + confirm UI
- `ui/src/ui/chat/grouped-render.ts` / `views/chat.ts` / `app-render.ts` — wiring
- `ui/src/styles/chat/grouped.css` — selected / confirm styles
- tests in `chat-delivery.node.test.ts`

## P1 (not this PR)

Multi-question radio panel; mobile parity.
