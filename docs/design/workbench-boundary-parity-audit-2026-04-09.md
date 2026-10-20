# Workbench Boundary Parity Audit (2026-04-09)

## Goal

Clarify the current boundary of the employee workbench after the `workspace.ts`
recovery effort, confirm which legacy files were safely removed, and record the
remaining overlap that still deserves follow-up.

## Current Canonical Boundary

The employee workbench now has one real implementation boundary:

- `ui/src/ui/ports/employee/views/workbench.ts`

Supporting responsibilities are now split by boundary instead of by old view file:

- employee workbench view-models:
  - `ui/src/ui/ports/employee/views/workspace-home-model.ts`
  - `ui/src/ui/ports/employee/views/workspace-modules.ts`
  - `ui/src/ui/ports/employee/views/workspace-signals.ts`
- employee rendering and shell assembly:
  - `ui/src/ui/ports/employee/render-model.ts`
  - `ui/src/ui/ports/employee/render-actions.ts`
  - `ui/src/ui/ports/employee/views/workbench-stage*.ts`
- shared frontstage data modeling:
  - `ui/src/ui/data/frontstage-session-cards.ts`
  - `ui/src/ui/data/frontstage-overview.ts`
- shared frontstage rendering:
  - `ui/src/ui/views/frontstage.ts`

This is the first point in the refactor where the boundary is structurally clear,
not just conventionally described.

## Verified Legacy Files Removed

The following files were confirmed to be wrapper-only and are now deleted:

- `ui/src/ui/views/workspace.ts`
- `ui/src/ui/views/workspace-home-model.ts`
- `ui/src/ui/views/workspace-modules.ts`
- `ui/src/ui/views/workspace-signals.ts`
- `ui/src/ui/views/frontstage-model.ts`

Why deletion was safe:

- full-repo import scans showed no active code consumers left
- focused `tsgo` verification for the workbench/frontstage chain stayed clean
- focused tests stayed green after deletion:
  - `ui/src/ui/views/frontstage-model.node.test.ts`
  - `ui/src/ui/views/workspace-home-model.node.test.ts`
  - `ui/src/ui/views/workspace-commands.node.test.ts`
  - `ui/src/ui/ports/employee/render-model.node.test.ts`
  - `ui/src/ui/ports/employee/views/workbench-stage.node.test.ts`

This means the old view-layer compatibility period is over for these paths.

## What Was Actually Preserved

The deletion did not remove useful behavior. The useful behavior had already been
re-homed before cleanup:

- session/contact/group card derivation stayed in
  `ui/src/ui/data/frontstage-session-cards.ts`
- persona/account aggregation stayed in
  `ui/src/ui/data/frontstage-overview.ts`
- workspace home-model assembly stayed in
  `ui/src/ui/ports/employee/views/workspace-home-model.ts`
- workspace module and signal aggregation stayed in
  `ui/src/ui/ports/employee/views/workspace-modules.ts` and
  `ui/src/ui/ports/employee/views/workspace-signals.ts`

The repository therefore moved from:

- duplicated responsibility across `views/` and `ports/employee/`

to:

- one canonical implementation per concern

## Verified Non-Issue: Duplicate Modeling

The core frontstage derivation functions now exist in exactly one place:

- `buildFrontstagePersonaCards(...)`
  - `ui/src/ui/data/frontstage-overview.ts`
- `deriveSessionCards(...)`
  - `ui/src/ui/data/frontstage-session-cards.ts`
- `buildContactCards(...)`
  - `ui/src/ui/data/frontstage-session-cards.ts`
- `buildGroupCards(...)`
  - `ui/src/ui/data/frontstage-session-cards.ts`

There is no second implementation left in `ui/src/ui/views/`.

This is the right outcome. It removes the main cause of duplicate rebuilds in
this area.

## App-State Cleanup Already Completed

The stale workbench edit/wizard state that no longer had active runtime paths has
already been removed from:

- `ui/src/ui/app.ts`
- `ui/src/ui/app-view-state.ts`

Removed fields:

- `workspaceTeamFilter`
- `workspaceTeamRenameKey`
- `workspaceTeamRenameDraft`
- `workspaceTeamWizardOpen`
- `workspaceTeamWizardKind`
- `workspaceTeamWizardSourceKey`
- `workspaceTeamWizardAlias`

Repo scan confirms these identifiers no longer exist under `ui/src/ui/`.

## Remaining Boundary Questions

The remaining work is no longer about duplicate files. It is about keeping the
new boundary stable.

### 1. `frontstage.ts` is now correctly shared, but should stay render-only

Current status:

- `ui/src/ui/views/frontstage.ts` still owns Lit rendering and row composition
- pure derivation is already moved out to `ui/src/ui/data/`

Preferred rule:

- keep `frontstage.ts` as shared rendering only
- do not move derivation logic back into it

### 2. App-global workbench state should stay under review

The remaining active state is much narrower now:

- `workspaceTeamSelectedKey`
- `workspaceGroupProfileView`
- `workspacePrimaryModule`
- `workspaceView`
- `workspaceDashboardTab`

These are not stale by default, but they should only remain app-global if they
really drive cross-surface navigation. Otherwise they should migrate behind an
employee-port state adapter later.

## Practical Rule Set

To avoid rebuilding shadow implementations again:

1. New workbench behavior must land under `ui/src/ui/ports/employee/**`.
2. Shared frontstage derivation must land under `ui/src/ui/data/**`.
3. `ui/src/ui/views/` may host shared rendering, but not a second employee
   business implementation.
4. If a new file cannot be clearly classified as employee-port, shared-data, or
   shared-rendering, it should not be added yet.

## Immediate Conclusion

The workbench/UI recovery is no longer in the dangerous state where old and new
implementations coexist.

The repo now has:

- one canonical workbench entry
- one canonical workspace home-model
- one canonical workspace module/signal layer
- one canonical frontstage derivation layer

That is the correct base for restoring any still-missing behavior without
creating a third implementation surface.
