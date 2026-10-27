# Account Computer strip display name (2026-10-08)

## Symptom

市场助手 computer header painted English **Assistant** + red **A** while the sidebar / TO showed **市场助手**. Skill孵化 strip name stayed correct.

## Root cause

1. Computer chrome paints `props.assistantName` from `agent.identity.get` → `resolveAssistantIdentity`.
2. Resolution chain was `ui.assistant.name → agents.list[].identity.name → IDENTITY file → DEFAULT "Assistant"` and **did not** consult top-level `agents.list[].name`.
3. Sidebar uses `identity?.name || agent.name` (`agentDisplayName`), so roster `name` alone is enough for the list but not for the strip.
4. `resolveComputerOperatorDisplay` treated a non-empty session name (including DEFAULT `Assistant`) as authoritative and short-circuited roster lookup.
5. `loadAssistantIdentity` swallowed errors and could keep a previous/DEFAULT identity after an agent switch.

## Fix (DESKTOP_COMPUTER_STRIP_DISPLAY_NAME_M1)

- Gateway `resolveAssistantIdentity`: fall back to `resolveAgentConfig(...).name` before DEFAULT / steward fallback.
- UI `resolveComputerOperatorDisplay`: treat DEFAULT `Assistant` / avatar `A` as placeholders; resolve open-bot face from roster (`identity.name || name`) by `session.agentId`.
- UI `loadAssistantIdentity`: when identity.get returns DEFAULT or errors after a switch, apply the same roster face when `agentsList` is present.

Iron rules unchanged: streamUrl ≠ INTERACTIVE; no omnibox unlock; layout defaults untouched.

## Out of scope

- Auto-takeover for remote browser omnibox typing
- Centering / changing docked layout default
- Skill孵化 connecting / streamUrl stuck (deploy / #454 follow-up)
