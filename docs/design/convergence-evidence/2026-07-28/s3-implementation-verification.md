# S3 group deliverable save — implementation and verification (2026-07-28)

Implements option 2 from the S3 reconciliation
(`docs/design/convergence-evidence/2026-07-28/s3-group-deliverable-reconciliation.md`): land the
whole group-deliverable preview and save chain, not just the read half.

## What the feature does

### Read: preview source routing

`handleOpenArtifact` previously only tried the steward workspace file, then fell back to the chat
message text. It now delegates to `openArtifactDeliverablePreview`, which tries in order:

1. **Group workspace file** — when the session belongs to a collaboration group, read the group
   deliverable manifest (`workbench.group-manifest.read`) to resolve the canonical or draft path, then
   read that file (`workbench.group-file.read`). The preview shows the group's authoritative file, not
   the chat snapshot.
2. **Steward workspace file** — the previous behavior, now only when there is no group.
3. **Inline** — the chat message text.

Both RPCs were already registered on `main` under `operator.read` via
`group-workspace-file.pack.ts`. They had no caller.

### Write: save status and save action

The sidebar header gains a status chip with four states (i18n keys already on `main`):

| Status      | Label                              |
| ----------- | ---------------------------------- |
| `unsaved`   | 未保存                             |
| `captured`  | 已收录成果中心 · 待保存            |
| `saved`     | 已保存 / 已保存 · 已沉淀至「{kb}」 |
| `kb_failed` | 已保存 · 知识库沉淀失败            |

Plus a save button, disabled while a save is in flight or when `status === "saved"` and not dirty.
Applying an inline preview edit marks the state dirty and re-enables it. Results surface in a 5s
toast (`DELIVERABLE_SAVE_TOAST_MS`).

Target knowledge base resolution: `providerMetadata.relatedKnowledgeBaseId` → the currently selected
knowledge space → the first available. With none, the toast says 请先在知识宇宙选择目标知识库。

`knowledge.deliverables.saveAndArchive` then:

1. writes the content into the group workspace (`deliverables/<logicalId>.md`, or the draft path)
2. captures it as a deliverable in 成果中心 (`captureAgentOutputDeliverable`, forced, tagged
   `["collaboration", "saved"]`)
3. attaches it to the knowledge base (`attachWorkspaceDeliverableToKnowledgeBase`)
4. upserts the group manifest canonical entry so step 1 of the read path finds it next time

## Authorization

Two layers, deliberately:

- The method is registered under **`operator.write`**, not the `operator.read` the existing
  group-file read pair uses. `method-scopes.test.ts` asserts every exposed handler is classified, and
  an unclassified method falls through to admin-only, so registration is mandatory rather than
  optional.
- The handler additionally requires write access to the _specific_ knowledge base via
  `authorizedKnowledgeBase(kbId, context, clientUserEmail(client), "write")`, because the deliverable
  gets attached to it. Holding `operator.write` alone is not enough.

## Deliberate narrowing versus the source branch

`captureAgentOutputDeliverable` needed `groupId` / `logicalId` so repeated saves of one logical
deliverable fold into a single 成果 entry. The source branch's version of that change also rerouted
the dedup scope to `owner:<ownerId>` whenever `ownerId` was present. Every existing caller passes
`ownerId`, and `main` carries a test named
`"does NOT fold different owners' same-named files (lineage-scoped identity)"`, so adopting it would
have silently changed the dedup identity across the board.

Here the scope only changes when `groupId` is supplied. No caller on `main` supplies it, so every
existing identity key is byte-identical and all seven `auto-capture-runtime` tests keep passing
unchanged.

`artifact-sidebar.ts` was likewise edited surgically. The source branch's version of that file also
deletes `downloadTextFile`, `resolveDownloadFilename`, `formatArtifactDate`,
`buildArtifactPreviewSummaryText` and the `onDismissAssetIncubationFromPreview` prop. All of those
stay.

## Verification

Run in an isolated export of `origin/main` (`git archive` into a plain directory, workspace
`node_modules` and the built `packages/*/dist` symlinked in). The shared working tree could not be
used: it has 256 dirty files belonging to other agents and `HEAD` on `deploy/user-modeling-v92`, so a
repo-wide run there would not be attributable to this change.

### Type check

`npx tsgo --noEmit -p tsconfig.json`, comparing the full error set line by line against the same
export without these changes:

|                        | errors |
| ---------------------- | -----: |
| `origin/main` baseline |     96 |
| with these changes     |     96 |
| newly introduced       |  **0** |
| newly resolved         |      0 |

`main` carries 96 pre-existing type errors (the known tsgo debt). The comparison is a set difference,
not a count, so a swap would still show up.

### Tests

`vitest run` over `src/gateway/knowledge/deliverables`, `src/gateway/method-scopes.test.ts`,
`ui/src/ui/wiring`, `ui/src/ui/views/artifact-sidebar-deliverable.test.ts`,
`ui/src/ui/app.group-deliverable-preview.node.test.ts`, `ui/src/ui/views/chat.test.ts`:

|                        | test files          | tests                    |
| ---------------------- | ------------------- | ------------------------ |
| `origin/main` baseline | 2 failed, 16 passed | 6 failed, 136 passed     |
| with these changes     | 2 failed, 19 passed | 6 failed, **143** passed |

The failing set is identical by test name — no regressions. The six failures are pre-existing on
`main`: four in `chat.test.ts` (sender labels, working strip) and two in `method-scopes.test.ts`
(unclassified methods, none of them this one).

Seven new passing tests across three new files:

- `save-and-archive.test.ts` (1) — writes the group workspace file, captures the deliverable,
  attaches to the knowledge base, pins the manifest canonical entry
- `save-and-archive-registration.test.ts` (3) — the method is listed, is classified, and requires
  `operator.write` while rejecting `operator.read`
- `artifact-sidebar-deliverable.test.ts` (3) — save disabled when saved and clean, enabled when
  saved but dirty, toast renders

### Lint and format

`oxlint` on all 14 changed TypeScript files: 0 warnings, 0 errors. `oxfmt --check` on those plus the
CSS: all formatted.

### Structural checks

- `app.ts` imports `resolveGroupIdFromSessionContext` exactly once. A naive three-way merge of the
  source branch's `app.ts` produced it twice, because the two sides had it in different sort
  positions and `merge-file` treated them as independent insertions.
- The five previously-dead UI modules now have a live entry point at `app.ts`:
  `wiring/deliverable-save`, `wiring/group-deliverable-preview-flow`, `wiring/group-workspace-file`,
  `controllers/group-deliverable-manifest`, `controllers/group-workspace-file`.
- The `steward-workspace-file` import was removed from `app.ts` once the flow module took over that
  call, so it does not become the same kind of unused import that PR #119 left behind and #135 had to
  clean up.
- `artifact-preview-status-chip` and `artifact-preview-deliverable-toast` styles now exist in
  `ui/src/styles/chat/sidebar.css`; they were absent, so the chip would have rendered unstyled.
- `main`'s download / date / summary / asset-incubation-dismiss code is still present in
  `artifact-sidebar.ts`.

## Not verified

- No browser or manual run against a live gateway. The save path touches the filesystem
  (group workspace writes) and the knowledge base store; the unit test covers it with a temp
  `CONFIG_DIR` and a mocked `attach`, not a real gateway session.
- `pnpm check` in full was not run: it chains `check:host-env-policy:swift`, the collaboration package
  build and roughly fifteen bespoke lint scripts, several of which are unrelated to this change and
  already failing on `main`. `tsgo`, `oxlint` and `oxfmt` — the three parts of `check` that this change
  can affect — were all run.
