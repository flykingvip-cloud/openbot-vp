# S3 group deliverable preview — per-conflict reconciliation against `main` (2026-07-28)

Scope: the `S3-group-deliverable` selection in
`docs/design/convergence-evidence/2026-07-27/subset-replay.py`, re-measured after the seven-layer
replay stack landed (`main` = `24a966b621`).

Re-run with the new baseline:

```
python3 docs/design/convergence-evidence/2026-07-27/subset-replay.py --trunk origin/main
```

(`--trunk` added in this pass; the tool previously hard-coded
`origin/replay/b7-deliverable-preview-partial`, which is now inside `main`.)

## 1. The gap shrank a lot — `main` already has 11 of the 14 files

`e68780e90d` ("Recovery: fold safe Tier-1 gaps from orphaned #90/#91", 2026-07-27) already folded most
of this feature. Current state of the 14-file selection:

| State               | Count | Files                                                                                                                                                                                                                                                                                                   |
| ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRESENT-IDENTICAL` | 8     | `group-manifest.ts`, `server-methods/group-workspace-file.ts`, `group-workspace-file.pack.ts`, `collaboration/resolve-group-scope.ts`, `controllers/group-workspace-file.ts`, `controllers/group-deliverable-manifest.ts`, `wiring/group-workspace-file.ts`, `wiring/group-deliverable-preview-flow.ts` |
| `PRESENT-DIFFERENT` | 3     | `wiring/deliverable-save.ts`, `wiring/deliverable-save.test.ts`, `app.group-deliverable-preview.node.test.ts`                                                                                                                                                                                           |
| `ABSENT-ON-MAIN`    | 3     | `knowledge/deliverables/save-and-archive.ts`, `save-and-archive.test.ts`, `views/artifact-sidebar-deliverable.test.ts`                                                                                                                                                                                  |

## 2. What is actually broken on `main` right now

`ui/src/ui/wiring/deliverable-save.ts` and `ui/src/ui/wiring/group-deliverable-preview-flow.ts` are on
`main` but **nothing imports them**. `main`'s `app.ts` imports only
`resolveGroupIdFromSessionContext` from `collaboration/resolve-group-scope.ts`.

Worse, PR #119 added this to `ui/src/ui/views/artifact-sidebar.ts`:

```ts
import {
  resolveDeliverableSaveChipLabel,
  type DeliverableSaveState,
  type DeliverableSaveToast,
} from "../wiring/deliverable-save.ts";
```

None of the three is used anywhere in that file — the render side never landed. `.oxlintrc.json` runs
`correctness` as `error` and `no-unused-vars` is in that category, so `pnpm check` fails on `main`.
Reproduced against a minimal fixture with this repo's exact plugin/category config:
`eslint(no-unused-vars): ... is imported but never used`, exit non-zero. `tsconfig.json` does not set
`noUnusedLocals`, so `pnpm tsgo` does **not** catch it — only `pnpm check` does.

This PR removes that import to make the trunk lint-clean again. It comes back together with the render
side.

## 3. The four `app.ts` conflicts — all four resolve to `main`

Three-way inputs: base = `a038f5c113^`, ours = `origin/main`, theirs = `a038f5c113`.

| #   | Region                                                   | `main` (ours)                                                                                                                                                                                                                                                       | `a038f5c113` (theirs)                                                                                                               | Verdict                                 |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| C1  | import list from the operational-identity command module | `syncEmployeeEnterpriseIdentityAccess` + `type UserOperationalIdentityNav`                                                                                                                                                                                          | `syncEmployeeEnterpriseIdentityAccess` only                                                                                         | **main** — strict superset              |
| C2  | `@state()` block                                         | `tenantImSyncBusy`, `tenantImIdentityLinkHint`, `enterpriseOperationalIdentityLoaded`                                                                                                                                                                               | `enterpriseOperationalIdentityLoaded` only                                                                                          | **main** — strict superset              |
| C3  | enterprise identity methods                              | `syncChannelToOperationalIdentity` + `navigateToEnterpriseMessageChannels` + `upsertEnterpriseOperationalIdentityCredential`                                                                                                                                        | `upsertEnterpriseOperationalIdentityCredential` only                                                                                | **main** — strict superset              |
| C4  | user operational identity methods                        | `applyEnterpriseIdentityRobotBindings`, `startEnterpriseWechatOfficialOAuth`, `startEnterpriseOperationalIdentityOAuth`, `openUserOperationalIdentityEditor(params?: {...} \| string)`, `setUserOperationalIdentityNav`, `verifyUserOperationalIdentityCredentials` | same first three, plus `openUserOperationalIdentityEditor(params?: {provider?, displayName?})` — narrower signature, no `\| string` | **main** — superset and wider signature |

**None of the four conflicts is about the group deliverable feature.** They exist only because
`a038f5c113` is a bulk WIP-sweep commit whose `app.ts` snapshot predates `main`'s
operational-identity work. Taking `main` on all four loses nothing from the feature.

The feature wiring itself lands in the _non-conflicting_ part of the merge:

- imports of `wiring/deliverable-save.ts` and `wiring/group-deliverable-preview-flow.ts`
- `handleOpenArtifact` delegating to `openArtifactDeliverablePreview`
- `sidebarDeliverableSaveState` / `sidebarDeliverableSaveToast` state + the toast timer
- `handleDeliverableInlineEditApplied`, `handleSaveSidebarDeliverable`, `showDeliverableSaveToast`,
  `showSidebarDeliverableSaveToast`
- teardown in `handleCloseSidebar`

Net: `+152 / -16` on `app.ts` after resolving all four to `main`.

## 4. Two problems a "clean" `merge-file` result does not surface

### 4.1 Duplicate import

`resolveGroupIdFromSessionContext` ends up imported **twice** — once at `main`'s line 104 and once at
line 276 from the WIP side, because the two sides put it in different sort positions and `merge-file`
treats them as independent insertions. That is a duplicate-identifier error. The resolution has to
dedupe it; `merge-file` exiting 0 says nothing about it.

### 4.2 `handleOpenArtifact` looks like it drops the steward path — it does not

The WIP replaces this in `handleOpenArtifact`:

```ts
const workspaceFilename = resolveStewardWorkspaceFilename(workspace);
if (workspaceFilename) {
  await openStewardWorkspaceFileArtifact(this, workspace, workspaceFilename, client);
  return;
}
```

with a single `openArtifactDeliverablePreview({...})` call, and drops the
`wiring/steward-workspace-file.ts` import. Checked: `main`'s
`wiring/group-deliverable-preview-flow.ts` calls `resolveStewardWorkspaceFilename` at line 85 and
`openStewardWorkspaceFileArtifact` at line 87. So the steward workspace-file path is preserved inside
the flow module — this is a genuine refactor, not a regression. Verified rather than assumed, because
the Import IA batch (#109) failed exactly this kind of check.

## 5. Do **not** take the source `artifact-sidebar.ts` wholesale

`main` → source is `+95 / -128`. Beyond the deliverable-save additions, the source version **removes**
things `main` still uses:

| Removed by the source version              | Consequence                                |
| ------------------------------------------ | ------------------------------------------ |
| `downloadTextFile`                         | artifact download gone                     |
| `resolveDownloadFilename`                  | ditto                                      |
| `formatArtifactDate`                       | preview timestamps gone                    |
| `buildArtifactPreviewSummaryText`          | copy-summary gone                          |
| `onDismissAssetIncubationFromPreview` prop | asset-incubation dismiss from preview gone |

Same shape as the Import IA trap in #109: a wholesale take would silently regress `main`. The
integration has to be **surgical** — add only the deliverable-save pieces onto `main`'s file:

- props `deliverableSaveState`, `onSaveDeliverable`, `onDeliverableInlineEditApplied`,
  `deliverableSaveToast`
- `resolveDeliverableSaveChipClass`, `renderDeliverableSaveChip`, `renderDeliverableSaveToast`
- the save-button block in the artifact actions row
- thread an `onApplied` callback through `applyInlinePreviewEdit`
- keep `main`'s download / date / summary / dismiss code untouched

## 6. Remaining scope, and why it is not landed in this PR

| Piece                             | Status                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `app.ts` wiring                   | verdicts settled (§3), needs the duplicate import deduped                                                                               |
| `artifact-sidebar.ts` render side | needs surgical addition (§5), **not** a replay                                                                                          |
| CSS                               | `artifact-preview-status-chip` does **not** exist on `main` — the chip needs styles added                                               |
| `app-render.ts`                   | must pass the four new props through to the sidebar                                                                                     |
| 3 absent files                    | `save-and-archive.ts`, `save-and-archive.test.ts`, `artifact-sidebar-deliverable.test.ts`                                               |
| 3 divergent files                 | `deliverable-save.ts`, `deliverable-save.test.ts`, `app.group-deliverable-preview.node.test.ts` need their own three-way reconciliation |

This is authored feature integration across roughly eight files plus CSS, not a faithful replay. It
cannot be typechecked or tested from the current shared working tree (256 dirty files belonging to
other agents, HEAD on `deploy/user-modeling-v92`), so landing it here would mean shipping an
unverified UI integration onto the trunk. It needs either an isolated worktree or CI, and an explicit
go-ahead.

What this PR does land: the trunk is lint-clean again, and every reconciliation verdict above is
recorded so the follow-up is mechanical rather than another investigation.
