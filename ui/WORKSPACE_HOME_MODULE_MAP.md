# Workspace Home Module Map

## Scope

This document maps the current workspace home to its live implementation
boundaries after the `workbench` recovery and legacy `workspace.ts` cleanup.

It is intentionally current-state only. It does not describe deleted wrappers as
if they were still active code paths.

## Canonical Runtime Path

The workspace home now flows through these layers:

1. routing and shell handoff
   - `ui/src/ui/navigation.ts`
   - `ui/src/ui/app-render.ts`
2. employee workbench entry
   - `ui/src/ui/ports/employee/views/workbench.ts`
3. employee home-model assembly
   - `ui/src/ui/ports/employee/views/workspace-home-model.ts`
4. employee module and signal aggregation
   - `ui/src/ui/ports/employee/views/workspace-modules.ts`
   - `ui/src/ui/ports/employee/views/workspace-signals.ts`
5. shared frontstage data modeling
   - `ui/src/ui/data/frontstage-session-cards.ts`
   - `ui/src/ui/data/frontstage-overview.ts`
6. shared frontstage rendering
   - `ui/src/ui/views/frontstage.ts`

Deleted legacy wrappers:

- `ui/src/ui/views/workspace.ts`
- `ui/src/ui/views/workspace-home-model.ts`
- `ui/src/ui/views/workspace-modules.ts`
- `ui/src/ui/views/workspace-signals.ts`
- `ui/src/ui/views/frontstage-model.ts`

Those files are no longer valid implementation targets.

## Current Data Sources

The workspace home is wired to live application state:

- agents
- sessions
- channels snapshot
- presence entries
- cron status
- locally persisted workspace-team objects

Persistence inputs still live in:

- `ui/src/ui/storage.ts`

Key persisted values:

- `sessionSeenAt`
- `workspaceTeamObjects`
- `workspaceTeamOrder`

Important modeling constraint:

- contacts, groups, and recent-session cards are still derived from session data
- saved team objects remain local UI objects layered on top of those derived
  session-backed entities

## Module Responsibilities

### 1. Home Shell

Files:

- `ui/src/ui/app-render.ts`
- `ui/src/styles/components.css`
- `ui/src/styles/layout.css`
- `ui/src/styles/layout.mobile.css`

Owns:

- page shell
- top-level layout split
- handoff into the employee workbench surface

Should not own:

- workspace business derivation
- frontstage card aggregation
- team object modeling

### 2. Workbench Surface

Files:

- `ui/src/ui/ports/employee/views/workbench.ts`
- `ui/src/ui/ports/employee/views/workbench-stage*.ts`
- `ui/src/ui/ports/employee/render-model.ts`
- `ui/src/ui/ports/employee/render-actions.ts`

Owns:

- workbench composition
- stage switching
- selection and view handoff
- employee-specific rendering decisions

Should not own:

- shared frontstage derivation logic
- generic cross-surface rendering helpers that belong in shared layers

### 3. Workspace Home Model

Files:

- `ui/src/ui/ports/employee/views/workspace-home-model.ts`
- `ui/src/ui/ports/employee/views/workspace-modules.ts`
- `ui/src/ui/ports/employee/views/workspace-signals.ts`

Owns:

- sidebar object summaries
- team deck summaries
- workspace metrics
- signal/module bundle assembly

Should not own:

- direct Lit rendering
- app-global shell routing

### 4. Shared Frontstage Data

Files:

- `ui/src/ui/data/frontstage-session-cards.ts`
- `ui/src/ui/data/frontstage-overview.ts`

Owns:

- session/contact/group card derivation
- persona summaries
- connected account flattening

This layer exists specifically to prevent frontstage and workbench from each
recreating their own slightly different session-derived summaries.

### 5. Shared Frontstage Rendering

Files:

- `ui/src/ui/views/frontstage.ts`

Owns:

- shared Lit rendering for persona/contact/group frontstage sections

Boundary rule:

- rendering can stay here
- derivation should stay in `ui/src/ui/data/`

## What Is Already Restored

The current workspace/workbench surface already preserves the high-value parts of
the old experience:

- sidebar objects for agents, contacts, and spaces
- session switching from the object rail
- embedded chat work area
- overview/dashboard surface
- signal cards driven by real app state
- local team deck persistence

## What Is Still Intentionally Incomplete

These are real capability gaps, not file-boundary gaps:

- no backend-first team object model
- no shared command registry for universal remote style actions
- no first-class task/calendar/meeting domain data behind all cards
- no cross-device sync for saved team objects
- no deep-link model for every workbench subregion

These should be added by extending the canonical layers above, not by
reintroducing deleted `workspace*.ts` files.

## Practical Rules

1. If the change is employee-specific, put it under `ui/src/ui/ports/employee/**`.
2. If the change is session/persona/contact/group derivation reused across
   surfaces, put it under `ui/src/ui/data/**`.
3. If the change is shared rendering only, keep it under `ui/src/ui/views/**`.
4. Do not recreate a second `workspace` root under `ui/src/ui/views/`.

## Recommended Next Extensions

1. Keep `frontstage.ts` render-only and continue extracting pure data helpers to
   `ui/src/ui/data/**` when needed.
2. Review whether the remaining `workspace*` app-global state should stay in
   `ui/src/ui/app-view-state.ts` or move behind an employee-port state adapter.
3. Add backend-backed team objects only after defining a stable domain model,
   rather than extending local-only UI objects further.
