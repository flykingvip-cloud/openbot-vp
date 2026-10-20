# Workbench Recovery Execution

Date: 2026-04-08

## Scope

This report captures the execution of the non-destructive recovery plan for the local
`workspace -> workbench` transition.

Goals:

- preserve the current local state before any destructive recovery attempt
- verify whether the `ports/employee` workbench chain is still physically present
- distinguish "missing from disk" from "present but untracked" and "present but not integrated"

## Non-destructive recovery artifacts

Recovery artifacts were written to:

- `/tmp/openbot-recovery-20260408-235418-b34af6fc99`

Artifacts created:

- `status.txt`
- `tracked.patch`
- `diff-stat.txt`
- `diff-summary.txt`
- `untracked.txt`
- `stash0-stat.txt`
- `stash0.patch`
- `untracked-workbench-and-ui.tgz`
- `untracked-docs-and-packages.tgz`

These are enough to preserve:

- the current tracked diff
- the current stash contents
- the current untracked workbench/UI files

## Verified current state

### 1. Current branch/history remains abnormal

- current branch: `codex/openbot/localization-workspace`
- `HEAD` is still the single local-init commit `b34af6fc99`
- this branch still does not represent a normal continuation of `upstream/main`

Conclusion:

- the repository baseline is still detached from normal upstream history

### 2. The workbench tree is no longer "missing from disk"

The following files are now present in the working tree as untracked local files:

- `ui/src/ui/ports/employee/render-model.ts`
- `ui/src/ui/ports/employee/views/workbench.ts`
- `ui/src/ui/ports/employee/views/workbench-stage.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-collaboration.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-assistant.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-conversation.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-copy.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-module.ts`
- `ui/src/ui/ports/employee/views/workspace-actions.ts`
- `ui/src/ui/ports/employee/views/workspace-capability-contracts.ts`
- `ui/src/ui/ports/employee/views/workspace-chrome.ts`
- `ui/src/ui/ports/employee/views/workspace-header.ts`
- `ui/src/ui/ports/employee/views/workspace-stage-contracts.ts`
- `ui/src/ui/ports/employee/views/group-member-governance-panel.ts`

Conclusion:

- the primary workbench chain is not absent from the filesystem anymore
- the current problem is that it is still outside tracked Git history

### 3. The app entry has already been switched to the untracked workbench chain

Observed entry switch:

- `ui/src/ui/app-render.ts` imports `buildEmployeeWorkbenchProps`
- `ui/src/ui/app-render.ts` imports `./ports/employee/views/workbench.ts`
- `ui/src/ui/views/workspace.ts` is deleted in the current working tree

Conclusion:

- the legacy tracked `workspace.ts` surface has been removed locally
- the new workbench entry is already wired in
- this is why the repo feels like it "lost code": the old tracked path was removed before the new path was fully integrated

### 4. The local stash is not the source of the missing workbench tree

The remaining stash contains:

- `ui/src/ui/app.ts`
- `ui/src/ui/app-render.ts`
- `ui/src/ui/views/workspace.ts`
- other unrelated files

The stash does not contain the `ui/src/ui/ports/employee/...` workbench tree.

Conclusion:

- the workbench files were not removed by applying/dropping the stash
- they existed outside tracked Git history

## Verification results

### Targeted workbench tests

Command run:

- `pnpm exec vitest run ui/src/ui/ports/employee/render-model.node.test.ts ui/src/ui/ports/employee/views/workbench-stage.node.test.ts ui/src/ui/ports/employee/views/workbench-sidebar-members.node.test.ts ui/src/ui/ports/employee/views/workspace-header.node.test.ts`

Result:

- 4 test files passed
- 7 tests passed

Conclusion:

- the local workbench chain is at least partially self-consistent
- this is not a total-loss state

### Follow-up recovery status

After the recovery integration pass, the filtered workbench/UI errors were reduced to zero for:

- `ui/src/ui/ports/employee/**`
- `ui/src/ui/views/frontstage-model.ts`
- `ui/src/ui/views/workspace-commands.node.test.ts`
- `ui/src/ui/app-gateway.node.test.ts`

Re-verified:

- `pnpm exec vitest run ui/src/ui/ports/employee/render-model.node.test.ts ui/src/ui/ports/employee/views/workbench-stage.node.test.ts ui/src/ui/ports/employee/views/workbench-sidebar-members.node.test.ts ui/src/ui/ports/employee/views/workspace-header.node.test.ts`

Result:

- 4 test files passed
- 7 tests passed

Interpretation:

- the recovered workbench chain now typechecks within its own local integration surface
- remaining global `tsc` failures are no longer primarily caused by the workbench recovery

### TypeScript integration check

Command run:

- `pnpm exec tsc -p tsconfig.json --noEmit`

Result:

- failed

There are many unrelated package errors in local untracked packages under `packages/`.
In addition to those, the workbench integration currently has real type-level blockers.

Confirmed workbench-related blockers include:

- `ui/src/ui/app-render.ts`
- `ui/src/ui/ports/employee/render-model.ts`
- `ui/src/ui/ports/employee/views/workbench-sidebar-members.ts`
- `ui/src/ui/ports/employee/views/workbench-stage-collaboration.ts`
- `ui/src/ui/ports/employee/views/workbench-stage.ts`
- `ui/src/ui/ports/employee/views/workbench.ts`
- `ui/src/ui/ports/employee/views/workspace-chrome.ts`
- `ui/src/ui/ports/employee/views/workspace-header.ts`
- `ui/src/ui/ports/employee/views/workspace-home-model.ts`
- `ui/src/ui/ports/employee/views/workspace-signals-surface.ts`

Representative failure classes:

- `AppPortState` does not match the new workbench expectations
- gateway/auth/session types do not line up with workbench assumptions
- icon names referenced by the new chrome/header do not exist in the current icon set
- duplicated "workspace home model" shapes diverged between legacy and workbench copies
- collaboration stage contracts are stricter than the current supplied props

Conclusion:

- the main issue is now integration drift, not raw file disappearance

## Recovery interpretation

The current state is best described as:

1. local legacy workspace path removed
2. local recovered workbench path added
3. recovered workbench path left untracked
4. integration layer not finished

This is why the repository currently appears to have "lost" large amounts of code even though
much of the intended replacement still exists locally.

## Recommended next actions

Safe next steps:

1. keep the `/tmp/openbot-recovery-20260408-235418-b34af6fc99` artifacts until the transition is complete
2. separate unrelated untracked package experiments from the workbench recovery path
3. fix the workbench integration blockers before any destructive cleanup
4. only after the workbench chain typechecks should the deleted legacy `workspace.ts` path be considered safe to replace permanently

Practical implementation order:

1. isolate unrelated package/type noise from `packages/*`
2. align `AppPortState`, gateway row types, and workbench contracts
3. align icon usage and duplicated workspace model types
4. rerun workbench tests and TypeScript validation
5. only then decide whether to track the `ports/employee` tree and remove the old path
