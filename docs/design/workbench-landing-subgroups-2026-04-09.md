# Workbench Landing Subgroups (2026-04-09)

## Goal

Break the current `workbench / employee UI` recovery stream into reviewable
subgroups that can land without mixing gateway bootstrap, platform auth, or
package incubation work back into the same batch.

This document refines Group A from:

- `docs/design/worktree-landing-groups-2026-04-09.md`

## A1. Employee Workbench Boundary

This is the core boundary move and should land first inside the UI stream.

Paths:

- `ui/src/ui/ports/employee/**`
- `ui/src/ui/data/frontstage-session-cards.ts`
- `ui/src/ui/data/frontstage-overview.ts`
- `ui/src/ui/data/frontstage-overview.node.test.ts`
- `ui/src/ui/views/frontstage.ts`
- `ui/src/ui/views/frontstage-model.node.test.ts`
- `ui/src/ui/views/workspace-commands.ts`
- `ui/src/ui/views/workspace-commands.node.test.ts`
- `ui/src/ui/views/workspace-home-model.node.test.ts`
- deleted wrapper-only legacy files:
  - `ui/src/ui/views/workspace.ts`
  - `ui/src/ui/views/workspace-home-model.ts`
  - `ui/src/ui/views/workspace-modules.ts`
  - `ui/src/ui/views/workspace-signals.ts`
  - `ui/src/ui/views/frontstage-model.ts`
- `ui/src/ui/app-port-state.ts`
- `ui/src/ui/app-view-state.ts`
- `ui/WORKSPACE_HOME_MODULE_MAP.md`
- `docs/design/workbench-boundary-parity-audit-2026-04-09.md`

Why this is one subgroup:

- it moves real responsibility from deleted legacy files into the new
  `ports/employee` and `data/` boundaries
- it establishes the only valid source of truth for workspace/frontstage
  behavior

Known coupling:

- this subgroup carries a hard type seam with collaboration capability state
  through `WorkspaceWorkbenchProps` and `WorkspaceStageProps`
- `ui/src/ui/app-view-state.ts` currently imports collaboration/daibai result
  types used by employee workbench runtime state
- this seam is acceptable, but it means A1 should not be reviewed in isolation
  from capability contracts in `ui/src/ui/ports/employee/views/workspace-capability-contracts.ts`

Do not mix into this subgroup:

- gateway connection bootstrap
- platform auth UI
- daibai or collaboration capability surfaces

## A2. App Shell And Navigation Support

This subgroup is the shell that hosts the new workbench.

Paths:

- `ui/src/ui/app.ts`
- `ui/src/ui/app-render.ts`
- `ui/src/ui/app-render.helpers.ts`
- `ui/src/ui/app-chat.ts`
- `ui/src/ui/app-channels.ts`
- `ui/src/ui/app-polling.ts`
- `ui/src/ui/app-scroll.ts`
- `ui/src/ui/app-scroll.test.ts`
- `ui/src/ui/app-settings.ts`
- `ui/src/ui/app-settings.test.ts`
- `ui/src/ui/navigation.ts`
- `ui/src/ui/navigation.test.ts`
- `ui/src/ui/navigation.browser.test.ts`
- `ui/src/ui/presenter.ts`
- `ui/src/ui/storage.ts`
- `ui/src/ui/storage.node.test.ts`
- `ui/src/ui/types.ts`
- `ui/src/ui/ui-types.ts`
- `ui/src/ui/test-helpers/app-mount.ts`
- `ui/index.html`
- `ui/src/styles/layout.css`
- `ui/src/styles/layout.mobile.css`
- `ui/src/styles/workbench.css`

Why this is a separate subgroup:

- these files provide shell composition, location syncing, persisted UI state,
  and rendering handoff
- they are necessary for the new workbench, but they are not themselves the
  employee business boundary

## A3. Shared Presentation And Test Baseline Sync

This subgroup is the UI presentation fallout caused by the new shell and
frontstage behavior.

Paths:

- `ui/src/ui/chat/grouped-render.ts`
- `ui/src/ui/views/chat.ts`
- `ui/src/ui/views/chat.test.ts`
- `ui/src/ui/views/overview.ts`
- `ui/src/ui/views/sessions.ts`
- `ui/src/ui/views/sessions.test.ts`
- `ui/src/ui/views/cron.ts`
- `ui/src/ui/views/cron.test.ts`
- `ui/src/ui/views/channels.config.ts`
- `ui/src/ui/views/channels.browser.test.ts`
- `ui/src/ui/views/agents.ts`
- `ui/src/ui/views/agents-utils.ts`
- `ui/src/ui/views/agents-panels-tools-skills.ts`
- `ui/src/ui/views/agents-panels-tools-skills.browser.test.ts`
- `ui/src/ui/views/config.ts`
- `ui/src/ui/views/config.browser.test.ts`
- `ui/src/ui/views/config-form.render.ts`
- `ui/src/ui/views/debug.ts`
- `ui/src/ui/views/exec-approval.ts`
- `ui/src/ui/views/markdown-sidebar.ts`
- `ui/src/ui/views/nodes-exec-approvals.ts`
- `ui/src/ui/views/skills-grouping.ts`
- `ui/src/ui/views/usage-metrics.ts`
- `ui/src/ui/views/usage-render-details.ts`
- `ui/src/ui/views/usage-render-overview.ts`
- `ui/src/styles/chat/**`
- `ui/src/i18n/lib/translate.ts`
- `ui/src/i18n/locales/en.ts`
- `ui/src/i18n/locales/zh-CN.ts`
- `ui/src/i18n/test/translate.test.ts`

Why this is separate:

- these are mostly presentation, copy, layout, and test-baseline updates
- they depend on the new workbench shell and frontstage shape, but are not the
  boundary move itself

## Explicitly Not In Group A

These files are UI files, but they should land with other streams:

### Belongs to Group B: Control-UI And Platform Auth Recovery

- `ui/src/ui/app-gateway.ts`
- `ui/src/ui/app-gateway.node.test.ts`
- `ui/src/ui/app-lifecycle.ts`
- `ui/src/ui/app-lifecycle.node.test.ts`
- `ui/src/ui/app-lifecycle-connect.node.test.ts`
- `ui/src/ui/controllers/control-ui-bootstrap.ts`
- `ui/src/ui/controllers/control-ui-bootstrap.test.ts`
- `ui/src/ui/controllers/platform-auth.ts`
- `ui/src/ui/controllers/platform-auth.test.ts`
- `ui/src/ui/views/platform-auth-panel.ts`

Reason:

- they depend directly on gateway bootstrap and control-ui auth contract changes

### Belongs to Group C: Collaboration, Daibai, And Support-Case Runtime

- `ui/src/ui/controllers/collaboration-governance-actions.ts`
- `ui/src/ui/controllers/collaboration-governance-actions.node.test.ts`
- `ui/src/ui/controllers/collaboration-learning.ts`
- `ui/src/ui/controllers/collaboration-learning.node.test.ts`
- `ui/src/ui/controllers/daibai.ts`
- `ui/src/ui/controllers/daibai.test.ts`
- `ui/src/ui/controllers/spaces.ts`
- `ui/src/ui/chat/evidence-drawer.ts`
- `ui/src/ui/chat/task-card-narrative.ts`
- `ui/src/ui/chat/task-card-state.ts`
- `ui/src/ui/views/artifact-sidebar.ts`

Reason:

- they expose new domain capability surfaces, not generic workbench shell

Exception seam to watch:

- `ui/src/ui/app-view-state.ts` may need mechanical type updates when Group C
  evolves daibai/collaboration result shapes
- treat those updates as contract-synchronization changes, not as boundary
  moves between groups

## Recommended Landing Order Inside Group A

1. A1. Employee workbench boundary
2. A2. App shell and navigation support
3. A3. Shared presentation and test-baseline sync

This order keeps the source-of-truth move ahead of the cosmetic and regression
sync layers.
