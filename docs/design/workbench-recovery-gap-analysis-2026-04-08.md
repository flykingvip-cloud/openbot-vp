# Workbench Recovery Gap Analysis

Date: 2026-04-09

## Summary

The repository is no longer missing the `workbench` route itself.

What is active today:

- `ui/src/ui/views/workspace.ts` is now only a re-export to `ui/src/ui/ports/employee/views/workbench.ts`
- `ui/src/ui/ports/employee/render-model.ts` builds the workbench props directly from `AppPortState`
- the recovered `ports/employee` workbench chain typechecks in its scoped area and targeted tests pass

What is still missing:

- several user-facing behaviors that existed in the old `workspace.ts` surface were not migrated into the current workbench render path
- some collaboration screens in the recovered workbench are still placeholders or are fed by stubbed data

So the current problem is no longer "the workbench files are gone".

The real next problem is "the route was restored before the old workspace behaviors were fully migrated".

## Verified Active Route

Current route switch evidence:

- `ui/src/ui/views/workspace.ts:1` re-exports `renderWorkspace` from `../ports/employee/views/workbench.ts`
- `ui/src/ui/ports/employee/views/workbench.ts:122` is the active top-level page renderer
- `ui/src/ui/ports/employee/render-model.ts:76` builds `WorkspaceWorkbenchProps` directly from `AppPortState`

This means the user is already running through the recovered workbench entry.

## What Is Already Working

The recovered chain now has a coherent minimum shell:

- assistant and collaboration nav rendering in `ui/src/ui/ports/employee/views/workbench.ts:146`
- shell/header rendering in `ui/src/ui/ports/employee/views/workbench.ts:200`
- stage routing for assistant, collaboration, knowledge, and settings in `ui/src/ui/ports/employee/views/workbench-stage.ts:64`
- workbench state projection from app state in `ui/src/ui/ports/employee/render-model.ts:81`

This is enough to explain why the page loads while still feeling incomplete.

## Verified Migration Gaps

### 1. Conversation/dashboard switching was removed instead of migrated

Old behavior:

- `git show HEAD:ui/src/ui/views/workspace.ts` had `renderViewSwitcher(...)` at lines 221-237
- the main shell branched between `props.view === "conversation"` and dashboard mode at lines 1291-1404

Current behavior:

- `ui/src/ui/ports/employee/views/workspace-types.ts:14` still defines `WorkspaceView`
- there is no current consumer for `WorkspaceView` or `onViewChange`
- `ui/src/ui/ports/employee/views/workbench.ts:167` and `ui/src/ui/ports/employee/views/workbench-stage.ts:79` route only by `primaryModule` and `groupProfileView`

Conclusion:

- the old conversation/dashboard split was dropped during the recovery
- this is a direct cause of "missing surface" compared with the legacy page

### 2. Dashboard tab state survives, but the dashboard UI does not

Old behavior:

- the legacy shell rendered six tabs at `git show HEAD:ui/src/ui/views/workspace.ts` lines 1387-1400
- tab-specific content existed in `renderDashboardTabContent(...)` at lines 721-930
- tabs included `work`, `knowledge`, `favorites`, `growth`, `innovation`, and `coach`

Current behavior:

- `ui/src/ui/ports/employee/render-model.ts:154` still passes `dashboardTab`
- `ui/src/ui/ports/employee/views/workspace-types.ts:18` still defines the same `WorkspaceDashboardTab`
- there is no current render-path consumer of `dashboardTab` under `ui/src/ui/ports/employee/**`

Conclusion:

- dashboard state still exists in app state and props
- the dashboard surface itself was not migrated into the workbench renderer

### 3. Team deck, filters, and wizard were not migrated

Old behavior:

- `renderTeamWizard(...)` lived at `git show HEAD:ui/src/ui/views/workspace.ts` lines 513-583
- `renderTeamDeck(...)` lived at lines 585-703
- this included `teamFilter`, team spotlight, create/rename/reorder actions, and team wizard flows

Current behavior:

- `ui/src/ui/ports/employee/views/workspace-types.ts:16` still defines `WorkspaceTeamFilter`
- there is no current consumer for `teamFilter`, `teamWizardOpen`, `onOpenTeamWizard`, or `onCreateTeamObject`
- `ui/src/ui/ports/employee/views/workbench.ts:248` only renders nav groups and module buttons; it does not render the old team deck surface

Conclusion:

- the old team-management surface is missing from the active route
- the type aliases survived, but the actual UI and actions did not

### 4. Remote command overlay was dropped

Old behavior:

- `renderRemoteActionRow(...)` lived at `git show HEAD:ui/src/ui/views/workspace.ts` lines 705-718
- the overlay dialog was rendered at lines 1409-1460
- it was backed by `workspace-commands.ts`

Current behavior:

- `ui/src/ui/views/workspace-commands.ts` still exists as a command source
- there is no current `remoteOpen`, `remoteQuery`, `onRemoteToggle`, `onRemoteClose`, or `onRemoteQueryChange` path under `ui/src/ui/ports/employee/**`
- the active workbench renderer in `ui/src/ui/ports/employee/views/workbench.ts:200` has no overlay branch

Conclusion:

- the command palette behavior still has data helpers nearby
- the actual remote UI was never migrated into the recovered workbench shell

### 5. Quick actions for control/full chat/new session were lost

Old behavior:

- `onOpenControl` was used in the sidebar footer at `git show HEAD:ui/src/ui/views/workspace.ts` line 1285
- `onOpenFullChat` and `onRequestNewSession` were used in the chat header at lines 1332-1336
- dashboard action cards also depended on these callbacks at lines 1357-1379

Current behavior:

- `ui/src/ui/ports/employee/views/workspace-types.ts:155` no longer exposes these callbacks on `WorkspaceWorkbenchProps`
- `ui/src/ui/ports/employee/render-model.ts:243` only wires `onOpenAgents`, `onOpenChannels`, `onOpenSessions`, `onOpenCron`, `onOpenOverview`, and `onRefreshWorkspace`

Conclusion:

- several direct navigation affordances from the old workspace shell no longer exist on the active route

### 6. Collaboration detail views are still placeholder-grade

Current behavior:

- `ui/src/ui/ports/employee/views/workbench-stage.ts:52` renders a generic placeholder for non-chat collaboration profile views
- `ui/src/ui/ports/employee/views/workbench-stage.ts:95` routes every non-chat collaboration subview through that placeholder
- `ui/src/ui/ports/employee/render-model.ts:249` still stubs `onLoadGroupMembers`
- `ui/src/ui/ports/employee/render-model.ts:47` synthesizes `workspaceSpacesResult` with empty member lists

Conclusion:

- even inside the recovered workbench path, collaboration detail flows are not fully restored yet
- this is a current functional gap, not just a legacy parity issue

## Root Cause Now

The repository has moved past the earlier "missing files" phase.

The present root cause is:

1. the route switch to `workbench` is already active
2. the restored shell only covers the minimum assistant/collaboration/module structure
3. several legacy `workspace.ts` features were never ported into the new shell
4. some new collaboration screens still run on placeholder or stubbed data

That combination makes the product feel like "large chunks of code disappeared", even though the core route and most source files are now present.

## Recommended Next Implementation Order

### Priority 1: restore the old decision surfaces

Reintroduce the user-facing surfaces that were clearly lost in the route switch:

- conversation/dashboard switcher
- dashboard tab strip and tab content
- quick action cards

This closes the most visible feature regression first.

### Priority 2: restore workflow entry points

Bring back the high-frequency actions that existed in the old workspace shell:

- remote command overlay
- open control
- open full chat
- request new session

These are small surfaces with high perceived completeness impact.

### Priority 3: restore team-management UX

Rebuild the old team deck path on top of the recovered workbench data:

- team filters
- spotlight/details area
- create wizard
- rename/save/reorder flows where still applicable

### Priority 4: replace collaboration placeholders with real views

Stop rendering non-chat collaboration modes as placeholders and connect them to real read models:

- group member loading
- managed space member data
- governance and other detail views

## Decision

The next correct move is not broad repo cleanup.

The next correct move is to migrate the missing user-facing behaviors into the active `workbench` route, starting with the old dashboard/conversation shell and quick actions.
