# B3/B4 replay — per-conflict reconciliation against `main` (2026-07-28)

Scope: PR #109 (`replay/b3-b4-import-ia-and-convergence-ledger` → `main`).

When PR #106 landed and #109 was retargeted from `replay/b2-web-favicon-branding` to `main`, the PR
flipped `MERGEABLE` → `CONFLICTING`. This document adjudicates every divergence, file by file, and
records why the Import-IA half of the batch is **dropped** and the system-authorization half is
**kept**.

Merge base used throughout: `cbf4bede7a` (b2 replay tip, now an ancestor of `main` via merge commit
`812c6ec49e`).

## 1. Machine classification of the 24 changed files

| Class                | Meaning                                              | Count |
| -------------------- | ---------------------------------------------------- | ----- |
| `MAIN-UNTOUCHED`     | `main` blob == base blob; only the replay changed it | 10    |
| `NEW-IN-MAIN-ABSENT` | file does not exist on `main`                        | 4     |
| `ALREADY-IDENTICAL`  | `main` blob == replay blob; nothing to land          | 4     |
| `MAIN-DIVERGED`      | both sides changed the file                          | 6     |

Important correction to an earlier assumption: **`MAIN-UNTOUCHED` does not mean "safe to take."**
Two `MAIN-UNTOUCHED` files (`knowledge-universe-local-folder.ts`,
`knowledge-universe-space-import-local-folder.ts`) carry the largest product regressions in this
batch. Absence of a textual conflict says nothing about semantic agreement.

## 2. The two textual conflicts

`git merge-tree --write-tree --merge-base cbf4bede7a origin/main <branch>` reports exactly two
conflicted paths for every layer of the stack:

- `ui/src/ui/views/knowledge-universe-space-import.ts`
- `ui/src/ui/views/knowledge-universe-space-import.node.test.ts`

Both conflicts sit in one function, `openPersonalSpaceImportEntry`, and in its docblock.

### C1 — docblock

| Side   | Content                                                                                                                                              |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main` | "open the four-channel import page under a private space. Never silently materialize 「我的收录」— without a private target, route to create space." |
| replay | "Prefer an existing private space; when none exists, materialize one via `onEnsurePersonalSpaceForImport` (create-once) then open the import page."  |

### C2 — the no-private-space branch

| Side   | Behavior                                                                                           |
| ------ | -------------------------------------------------------------------------------------------------- |
| `main` | `openKnowledgeSpaceCreatePage(surface)` — route to the create-space page                           |
| replay | call `surface.onEnsurePersonalSpaceForImport()` (auto-create), else fall back to the locked picker |

**Verdict: take `main`.** Evidence:

1. `main`'s content comes from `3734cbdd5c` (2026-07-27, `Task: knowledge-space-unification`,
   `Agent: cursor-auto`, subject "UI: unify knowledge supply lists and import target guards", body
   "Require an explicit KnowledgeBase for import"). The replay content dates from 2026-07-23.
   `main` is the later decision.
2. `main` carries a regression test named literally
   `"openPersonalSpaceImportEntry never auto-materializes when no private space"` which asserts
   `onEnsurePersonalSpaceForImport` is **not** called, `onPageTabChange` is called with
   `"libraryCreate"`, and `onLibraryWorkspaceImportOpenChange` is **not** called. The replay
   behavior is the exact thing that test forbids.

## 3. The silent regression hiding behind the clean part of the merge

The rest of the replay's Import-IA change does **not** conflict textually, because `main` never
touched those regions. Merging it would therefore apply silently. What it would do:

| Replay change                                                                                                                                                                                                                                                                                              | Effect on `main`                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| drop `renderVaultSyncImportForm` import, delete `renderFolderSyncPanel`, delete `FolderSyncMethod` / `FOLDER_SYNC_METHODS` / `resolveFolderSyncMethod` / `selectFolderSyncMethod`                                                                                                                          | removes the 同步方式 selector (本机索引 / 云端同步 / 端到端加密仓库) and makes the entire Vault Sync UI unreachable |
| `knowledge-universe-space-import-local-folder.ts`: delete the `local_index` / `managed_push` radios, delete the watcher checkbox, delete the manual scan button, make the path input `readonly`                                                                                                            | removes user control over indexing mode, watching, and manual rescan                                                |
| `knowledge-universe-local-folder.ts`: hard-code `libraryWorkspaceLocalFolderMode = "managed_push"` and `WatcherEnabled = false` in `syncLocalFolderToAppState`; rename `setKnowledgeUniverseLocalFolderWatcherEnabled(enabled)` → `(_enabled)` and `setKnowledgeUniverseLocalFolderMode(mode)` → `(_mode)` | turns both setters into no-ops while `main` still renders controls bound to them                                    |
| replace gateway `workspaces.local.choose` with the browser File System Access picker                                                                                                                                                                                                                       | drops the gateway-mediated folder picker path                                                                       |
| `knowledge-universe.ts` + `app.ts` + `render-model.ts` default flips (`local_index` → `managed_push`, watcher `true` → `false`)                                                                                                                                                                            | changes the preselected sync method that `main`'s own test asserts is `local_index`                                 |

None of this breaks the build, because `renderVaultSyncImportForm` has no importer outside the
import page. It would land as a quiet capability removal.

Counter-evidence that `main` wants the opposite: `3734cbdd5c`'s commit body says "Keep vaultSync on
the recovery import surface," `main` narrowed `SpaceImportKind` to
`"localFolder" | "url" | "note" | "active" | "vaultSync"` (vaultSync retained), `main`'s test asserts
the sync-method selector renders with all three methods and that the vault form renders, and Vault
Sync remains a live subsystem in `main` (gateway client methods `vaultSyncStatus` /
`vaultSyncInventory` / `vaultSyncHistory` / `vaultSyncTrash`, the
`knowledge-universe-vault-sync.ts` controller, i18n entries under both locales).

## 4. Duplicate-work finding

The replay blobs for both conflicted files are **byte-identical** to PR #84
(`kiro-web-ui/knowledge-workbench-import-ia`, opened 2026-07-23, still open, also `CONFLICTING`):

- `knowledge-universe-space-import.ts` → `1b3b749058` on both refs
- `knowledge-universe-space-import.node.test.ts` → `b6c60bae27` on both refs

So this is not lost work needing rescue. It is an unlanded proposal that already has an owner PR,
and `main` has since moved the other way. Landing it through the consolidation PR would both
duplicate #84 and pre-empt its owner's decision.

## 5. Genuine gap the batch _does_ close

`main` already contains the employee system-authorization port module and its unit test, but nothing
wires them up:

- `ui/src/ui/ports/employee/system-authorization.ts` — importers on `main`: only its own
  `system-authorization.node.test.ts`. Dead module.
- `ui/src/ui/controllers/knowledge-universe-personal-space.ts` — `ensurePersonalKnowledgeBase` has
  zero references on `main` outside its own file. Dead export.

The replay wires `system-authorization.ts` into `render-model.ts` and `workbench-stage-module.ts`,
adds the four stage/props fields (`authorizationHostConnected`, `authorizationAppleDesktop`,
`systemAuthorizationNotice`, `systemAuthorizationError`), and adds the two app-level state fields.
It replaces the previous behavior — which unconditionally opened macOS System Settings and reused
`workbenchDefaultWorkspaceRootNotice` as its notice channel — with an explicit action resolver
(`unavailable` / `open-mac-settings` / `browser-notification` / `invoke`) plus dedicated
notice/error fields. That is a real improvement over `main` and does not collide with anything.

## 6. Final verdicts

### Kept (lands in #109)

| File                                                          | Delta     | Why                                                            |
| ------------------------------------------------------------- | --------- | -------------------------------------------------------------- |
| `ui/src/ui/ports/employee/render-model.ts`                    | +88 / -35 | wires `system-authorization.ts`; adds the action resolver path |
| `ui/src/ui/ports/employee/render-model.node.test.ts`          | +73       | covers the new wiring                                          |
| `ui/src/ui/ports/employee/views/workbench-stage-module.ts`    | +49 / -11 | renders authorization state + notices                          |
| `ui/src/ui/ports/employee/views/workbench-stage.node.test.ts` | +53 / -5  | covers the above                                               |
| `ui/src/ui/ports/employee/views/workbench-stage-contracts.ts` | +12       | stage contract fields                                          |
| `ui/src/ui/ports/employee/views/workbench-types.ts`           | +8        | props fields                                                   |
| `ui/src/ui/ports/employee/views/workbench.ts`                 | +4        | prop pass-through                                              |
| `ui/src/ui/app-view-state-shell-slices.ts`                    | +2        | state slice fields                                             |
| `ui/src/ui/app.ts`                                            | +2        | the two `@state()` fields                                      |
| `deploy/production/BASELINE_RECOVERY_20260725.md`             | +16       | append-only ledger                                             |

### Reverted to `main`'s blob

- `ui/src/ui/views/knowledge-universe-space-import.ts`
- `ui/src/ui/views/knowledge-universe-space-import.node.test.ts`
- `ui/src/ui/views/knowledge-universe-space-import-local-folder.ts`
- `ui/src/ui/controllers/knowledge-universe-local-folder.ts`
- `ui/src/ui/controllers/knowledge-universe.ts`
- `ui/src/ui/ports/employee/views/home-page-contracts.ts`

### Dropped from the replay

- `.kiro/specs/knowledge-workbench-import-ia/tasks.md` — RECORD class; superseded proposal
- `docs/design/knowledge-workbench-renamed-mockup.html` — design of the rejected IA; preserved on
  `origin/kiro-web-ui/knowledge-workbench-import-ia` (PR #84), so nothing is lost
- `ui/src/ui/controllers/knowledge-universe-local-folder.node.test.ts` — asserts the rejected
  managed_push-only behavior
- `ui/src/ui/controllers/knowledge-universe-personal-space.node.test.ts` — belongs to the rejected
  auto-materialize path

### Partially reconciled (authored, not a verbatim replay)

Two files keep the replay's system-authorization content but have the Import-IA edits removed. These
are the only hand-authored hunks in this batch:

- `ui/src/ui/app.ts` — reverted `knowledgeUniverseLibraryWorkspaceLocalFolderWatcherEnabled`
  default from `false` back to `true`; kept the two `workbenchSystemAuthorization*` fields.
- `ui/src/ui/ports/employee/render-model.ts` — reverted
  `libraryWorkspaceLocalFolderMode ?? "managed_push"` back to `?? "local_index"`, removed the
  `onEnsurePersonalSpaceForImport` handler (17 lines) and its
  `ensurePersonalKnowledgeBase` import.

### No action (already identical on `main`)

- `ui/src/ui/ports/employee/system-authorization.ts`
- `ui/src/ui/ports/employee/system-authorization.node.test.ts`
- `ui/src/ui/controllers/knowledge-universe-personal-space.ts`
- `ui/src/ui/controllers/knowledge-universe-local-folder-upload.ts`

## 7. Why this also unblocks the rest of the stack

Layers `b5`, `b8`, `b7-deliverable-preview-partial`, `b7-subset-security` and
`b7-subset-retention-and-export` all reported the _same_ two conflicts. They inherit them: each
branch contains the b3/b4 commits as ancestors, none of them touches these files itself.

Once the excise commit lands on `main` through #109, for every upper layer `L`:
`merge-base(main, L)` is the pre-excise b3/b4 tip, the `main` side of the diff carries the excise,
and the `L` side is empty for those paths. The merge is then clean and `main`'s content wins by
construction. Verified with `merge-tree` after the fact, per layer.

## 8. Handed back to owners (not fixed here)

1. **`main` has a latent excess-property type error.** `knowledge-universe-space-import.node.test.ts`
   passes `onEnsurePersonalSpaceForImport` inside an object literal typed
   `Partial<WorkbenchKnowledgeSurface>`, but no type on `main` declares that member. Owner of
   `knowledge-space-unification` should either declare the optional member or drop it from the mock.
   Not fixed here, because the only available fix path is the file this batch is deliberately
   leaving to its owner.
2. **Two dead artifacts remain on `main`** after this batch: `ensurePersonalKnowledgeBase` (zero
   callers) and the now-unused parts of the personal-space controller. Either wire or delete.
3. **PR #84 needs an owner decision.** It is the canonical home of the Import-IA proposal this batch
   drops. It is still `CONFLICTING` against `main` and now contradicts `3734cbdd5c`.
