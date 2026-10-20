# Collaboration space authority convergence

Date: 2026-08-08  
Related:

- [isolation-layers-hard-rules-2026-08-06.md](./isolation-layers-hard-rules-2026-08-06.md)
- [agent-seat-binding-tenant-isolation-2026-08-04.md](./agent-seat-binding-tenant-isolation-2026-08-04.md)
- `src/gateway/employee-workbench-scope.ts`
- `src/gateway/collaboration-learning/shared.ts`
- `src/organization/runtime.ts`

## Problem

Collaboration groups (“协作小组”) answered the same questions with multiple rules and data sources:

| Question                                 | Divergent answers (before)                                                |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Who is in the group?                     | Runtime `members.json` vs managed mirror (opposite read order for agents) |
| Who can see the group?                   | `isCollaborationSpaceVisibleToEmployeeUser` (owner ∪ seat ∪ roster)       |
| Who can see / send on the group session? | `visibleSpaceIds = seatSpaceIds` only                                     |
| How should bots address the owner?       | Stale appended `systemInstructions` (“群主：…”) vs live roster            |

Isolation L2 historically said `owned ∪ seat-granted ∪ steward` and did not define roster membership for collaboration spaces. Product invite flows wrote humans into the roster and gated `spaces.list` on membership, but session ACL stayed seat/ownership-only — producing “visible nav, blocked chat”.

## Authority model (single answers)

**Roster authority (group participation)** and **seat/ownership authority (asset binding)** are separate. Do not cross-use them.

| Question                                                       | Sole authority                                                                                           | Must not consult                                          |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Who is in the group / member list for UI & agents              | Runtime `members.json` (`active` / `paused`)                                                             | Managed-mirror-first reads; embedded stale profile roster |
| Who may see the group, group sessions, and send group messages | Same roster + `ownerUserId` (humans)                                                                     | Treating `seatSpaceIds` alone as “in the group”           |
| Who owns the group asset / enterprise seat binding             | Ownership store + seat-assets                                                                            | Using roster as ownership                                 |
| Who is the group owner (label)                                 | `profile.ownerUserId` synced with `governanceRole=owner`; resolve via `resolveEffectiveGroupOwnerUserId` | Bootstrap text “群主：…” as source of truth               |
| Discussion policy (open without @)                             | `operatingState.collaborationPolicy`                                                                     | Hardcoded dispatch defaults outside that object           |

### Intentional non-dual layer (keep)

Bot owners may **audit-read** their own bot’s transcript inside a group they are not a human member of (`auditableGroupBotSessions`). That path is read-only and never grants `chat.send`.

## L2 / L3 for collaboration spaces

Extends isolation-layers for **collaboration groups only**:

- **L2 employee-visible collaboration spaces/sessions** = `owned ∪ seat-granted ∪ **roster membership (active/paused humans)** ∪ steward` (agents remain owned ∪ seat ∪ steward).
- **L3 object ACL** for `groupId` / `space:*` / bot group session keys uses the **same membership predicate** as space list visibility (`isCollaborationSpaceVisibleToEmployeeUser`). Session `visibleSpaceIds` MUST be derived from that predicate over the space list (plus seat ids as a safety union), never from `seatSpaceIds` alone.
- Mutating RPCs that take `groupId` on personal-workbench MUST assert space visibility (create = unknown groupId allowed). Owner-only ops (reset / dissolve / transfer) keep an extra owner check.

## Storage roles

| Store                            | Role                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------- |
| Workspace runtime `groups/{id}/` | **SoT** for profile, members, operating-state, capabilities                  |
| `{stateDir}/spaces/{id}/`        | **Mirror** for UI/governance indexing — write-through, read only as fallback |
| Ownership + seat-assets          | Asset binding for owner / enterprise seat — not chat participation           |

All consumers (spaces.list, session ACL, agent org context, dispatch) MUST load members **runtime-first, managed fallback**.

## Forbidden dual rules

1. Session ACL using only `actor.seatSpaceIds` while space list uses roster membership.
2. Agent org registry reading managed mirror before runtime members.
3. Client visibility matching `handle` while gateway matches `email` (or the reverse) — match `userId ∪ email ∪ handle` against actor `userId ∪ userEmail`.
4. Append-only bootstrap `systemInstructions` that retain stale “群主：” lines after roster/owner changes.
5. Assuming “seen once in spaces.list” without object ACL on mutate / chat paths.

## Conversation policy (not dual authority)

`group_broadcast` vs focused/mention is **policy**, stored in `operatingState.collaborationPolicy` (e.g. `openDiscussionWithoutMention`). Greeting-class messages may expand visible bot replies; task-class messages stay focused. Defaults live in operating-state sync, not ad-hoc in `chat.ts`.

## Acceptance

- Non-owner active human member: visible in `spaces.list`, session listed, `chat.send` allowed.
- Bot owner, non-member: audit session readable; write denied.
- When managed mirror and runtime members disagree, UI and agent org both prefer runtime.
- Owner/label changes rebuild bootstrap-managed instruction lines instead of appending duplicates.
