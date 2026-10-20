# OpenBot Product Entry Matrix (2026-04-11)

## Purpose

This document records the current user-facing entry surfaces that can lead into
OpenBot or legacy OpenBot UI flows.

It exists to answer three practical questions:

1. Which entry points are still active today?
2. Which ones are OpenBot-facing versus legacy/system-facing?
3. Which ones should be kept, renamed, migrated, or retired?

This is a current-state execution artifact, not a vision document.

## Status Vocabulary

- `keep`: keep as an active entry point
- `migrate`: keep behavior, but move ownership or wording into OpenBot
- `rename`: keep the surface, but change user-facing naming
- `freeze`: keep temporarily, but no new product work
- `retire`: remove from product path after replacement exists

## Entry Matrix

| Surface                                   | Entry Type            | Current Path / Trigger                                                                            | Current Owner                       | User-Facing Role Today               | Target Role                            | Status  | Notes                                                                                                          |
| ----------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------ | -------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| Browser workbench home                    | browser route         | `ui/src/ui/navigation.ts` -> `/` -> `me`                                                          | `ui/src/ui/ports/employee/**`       | New employee/workbench shell         | OpenBot primary browser workspace      | keep    | This is the strongest candidate for the new primary OpenBot browser surface.                                   |
| Browser chat                              | browser route         | `ui/src/ui/navigation.ts` -> `/chat`                                                              | `ui/src/ui/views/chat.ts`           | Browser chat workspace               | OpenBot conversation surface           | keep    | Needs capability-backed chat boundary, not direct controller coupling.                                         |
| Browser control center                    | browser route         | `ui/src/ui/navigation.ts` -> `/control`                                                           | `ui/src/ui/views/control-center.ts` | Console launcher / control hub       | System control hub inside OpenBot      | migrate | Keep functionally, but clarify that this is a system/control area, not the product home.                       |
| Browser overview                          | browser route         | `ui/src/ui/navigation.ts` -> `/overview`                                                          | `ui/src/ui/views/overview.ts`       | Gateway/control overview             | Control console section                | migrate | Should stay under control/console IA, not compete with the workbench home.                                     |
| Browser channels                          | browser route         | `ui/src/ui/navigation.ts` -> `/channels`                                                          | `ui/src/ui/views/channels.ts`       | Channel operations and login         | Connection capabilities console        | migrate | User-facing wording should shift from raw channel management to OpenBot connection management.                 |
| Browser config                            | browser route         | `ui/src/ui/navigation.ts` -> `/config`                                                            | `ui/src/ui/views/config.ts`         | Raw gateway/config editor            | System settings console                | migrate | Likely stays admin-facing; should not be presented as the main product settings experience.                    |
| Browser sessions                          | browser route         | `ui/src/ui/navigation.ts` -> `/sessions`                                                          | `ui/src/ui/views/sessions.ts`       | Session inspection and patching      | Work session operations console        | migrate | This is system-heavy and should remain separate from the employee workbench.                                   |
| Browser agents                            | browser route         | `ui/src/ui/navigation.ts` -> `/agents`                                                            | `ui/src/ui/views/agents.ts`         | Agent admin surface                  | Digital employee management            | migrate | Needs OpenBot product naming while preserving current control-plane capabilities.                              |
| Browser skills                            | browser route         | `ui/src/ui/navigation.ts` -> `/skills`                                                            | `ui/src/ui/views/skills.ts`         | Skills/runtime management            | Skill management console               | migrate | Naming already close to target, but still control-plane-first.                                                 |
| Browser nodes                             | browser route         | `ui/src/ui/navigation.ts` -> `/nodes`                                                             | `ui/src/ui/views/nodes.ts`          | Nodes, pairing, exec approvals       | Device/runtime console                 | migrate | Admin/runtime area; should not leak into the main product narrative.                                           |
| Browser logs/debug/usage/cron/instances   | browser routes        | `ui/src/ui/navigation.ts` -> `/logs` `/debug` `/usage` `/cron` `/instances`                       | `ui/src/ui/views/**`                | Gateway operator tooling             | System console                         | keep    | These are real operator tools and should stay, but as explicit console surfaces.                               |
| `openbot dashboard` / `openbot dashboard` | CLI entry             | `src/commands/dashboard.ts`                                                                       | CLI + browser control UI            | Opens the browser control UI         | Browser workspace/control launcher     | rename  | Command can stay for compatibility, but product wording should stop implying “dashboard” is the whole product. |
| Control UI docs                           | docs entry            | `docs/web/control-ui.md`                                                                          | docs/web                            | Browser admin/control docs           | Browser control console docs           | rename  | Useful docs, but should align with OpenBot naming and IA.                                                      |
| Dashboard docs                            | docs entry            | `docs/web/dashboard.md`                                                                           | docs/web                            | Alternate name for Control UI        | Browser launcher docs                  | rename  | This currently reinforces naming overlap with workbench/home.                                                  |
| WebChat docs                              | docs entry            | `docs/web/webchat.md`                                                                             | docs/web                            | Native and browser chat explanation  | Conversation surface docs              | migrate | Keep behavior, but align naming with OpenBot conversation/work session language.                               |
| macOS menu bar menu                       | native shell          | `apps/macos/Sources/OpenBot/MenuContentView.swift`                                                | legacy macOS shell                  | Primary native product shell         | Legacy fallback shell                  | freeze  | Still a major entry point today and therefore a real source of user confusion.                                 |
| macOS web chat panel                      | native shell / window | `apps/macos/Sources/OpenBot/WebChatManager.swift`                                                 | legacy macOS shell                  | Native chat panel                    | Transitional native chat shell         | migrate | Behavior remains useful, but ownership should move behind the new capability boundary.                         |
| macOS canvas panel                        | native shell / window | `apps/macos/Sources/OpenBot/CanvasManager.swift`                                                  | legacy macOS shell                  | Canvas/browser side panel            | Transitional runtime shell             | freeze  | Keep until a new host-side contract is in place.                                                               |
| macOS settings windows                    | native shell          | `apps/macos/Sources/OpenBot/ConfigSettings.swift`, `ChannelsSettings.swift`, `CronSettings.swift` | legacy macOS shell                  | Native admin/settings UI             | Legacy fallback settings               | freeze  | Do not add product features here.                                                                              |
| iOS root canvas                           | native shell          | `apps/ios/Sources/RootCanvas.swift`                                                               | legacy iOS shell                    | Current native home shell            | Legacy fallback shell                  | freeze  | Still owns onboarding, settings, quick setup, and chat sheet handoff.                                          |
| iOS settings tab                          | native page           | `apps/ios/Sources/Settings/SettingsTab.swift`                                                     | legacy iOS shell                    | Native config/gateway/admin settings | Legacy fallback settings               | freeze  | Current behavior is useful but too tightly coupled to remain the product-facing source of truth.               |
| iOS onboarding wizard                     | native page           | `apps/ios/Sources/Onboarding/OnboardingWizardView.swift`                                          | legacy iOS shell                    | Pairing/auth/connect setup flow      | Rebuilt onboarding later               | migrate | Behavior must be retained; UI should be rebuilt only after gateway/config capability seams are stable.         |
| iOS chat sheet                            | native page           | `apps/ios/Sources/Chat/ChatSheet.swift`                                                           | legacy iOS shell                    | Native chat surface                  | Transitional native conversation shell | migrate | Keep for now, but align with OpenBot work-session semantics later.                                             |

## Immediate Decisions

The following decisions should now be treated as fixed until explicitly revised:

1. The browser workbench home at `/` is the primary candidate for the new
   OpenBot browser home.
2. Browser control/console surfaces stay, but they must be framed as system or
   operator areas, not the full product identity.
3. Native legacy shells on iOS and macOS remain active today and must therefore
   be counted as first-class migration targets, not ignored.
4. `dashboard`, `control UI`, `webchat`, and `workbench` are currently
   overlapping names and need a managed rename strategy.

## Next Actions

1. Use this matrix to decide which entry labels appear in docs, CLI help, and
   UI copy.
2. Link each active browser entry to the new `ui/src/ui/capability/**` boundary
   as facades are introduced.
3. Mark every native legacy shell entry with an owner and exit criterion before
   adding more product work to it.
