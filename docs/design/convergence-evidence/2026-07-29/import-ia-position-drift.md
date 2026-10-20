# Import IA position drift after the b3/b4 reconciliation (2026-07-29)

Follow-up to `docs/design/convergence-evidence/2026-07-28/b3-b4-main-reconciliation.md`. That
document adjudicated the Import IA divergence and ruled **take `main`** on both open questions. This
one records only what has changed since it was written, because two of the facts it relied on no
longer hold and the proposal it rejected has resurfaced a third time.

Nothing here reopens the verdict. It records that the verdict is no longer legible from the code.

## 1. What the b3/b4 verdict rested on

Section 3 of that document cites, as counter-evidence that `main` wants the opposite of the proposal:

- `3734cbdd5c` body: "Keep vaultSync on the recovery import surface"
- `main` had narrowed `SpaceImportKind` to `"localFolder" | "url" | "note" | "active" | "vaultSync"`,
  with vaultSync retained
- `main` carries a regression test asserting the sync-method selector renders with all three methods
- `main` carries `openPersonalSpaceImportEntry never auto-materializes when no private space`, which
  asserts `onEnsurePersonalSpaceForImport` is not called, `onPageTabChange` is called with
  `"libraryCreate"`, and `onLibraryWorkspaceImportOpenChange` is not called

The second of those four is gone.

## 2. Drift one: the union was widened back

`d00bb132b7` ("Recovery: CI gate tsgo subset + learning recall wiring", PR #139,
`Task: main-recovery-routing`, `Agent: cursor-main-recovery`) re-added the five retired channels to
`SpaceImportKind`, taking it from five members back to ten:

| ref                                     | `SpaceImportKind` members |
| --------------------------------------- | ------------------------- |
| `3734cbdd5c` (the decision b3/b4 cites) | 5                         |
| `d00bb132b7` (current trunk)            | 10                        |

`SPACE_IMPORT_TAB_KINDS` stayed at four. So five channels are typed and renderable with no tab that
reaches them, addressable only through a stale persisted `libraryWorkspaceImportKind`.

The commit that did it is a tsgo-subset cleanup, and its subject describes it as such. The five
`TS2678` errors in `renderImportForm` were cleared by widening the type to match the stale switch
arms rather than by deleting the arms. That is a legitimate way to lower an error count; it is not an
IA decision, and it silently reverses one at the type layer.

Reproduce:

```
git show 3734cbdd5c:ui/src/ui/ports/employee/views/home-page-contracts.ts | grep -A11 'SpaceImportKind ='
git show d00bb132b7:ui/src/ui/ports/employee/views/home-page-contracts.ts | grep -A11 'SpaceImportKind ='
```

## 3. Drift two: a page tab landed without its route, and took the signal with it

The same PR added `| "spaceImport"` to `KnowledgeUniversePageTab`. The router case in
`knowledge-universe-page.ts` did not land with it.

Consequences on the current trunk:

- `openSpaceImportEntry` calls `onPageTabChange("spaceImport")`, and six production call sites reach
  it: the knowledge tree, the library workspace hero and space rows, the home 上传知识 action, space
  ingest, and the workspace nav
- the dispatch switch has no `spaceImport` case, so all six fall through to `default:` and
  re-render the knowledge home page. No error, no blank screen
- `renderKnowledgeUniverseSpaceImportPage` and `resolveSpaceImportPageTitle` remain imported and
  unused at `knowledge-universe-page.ts:29,30`
- the two errors that used to flag this, `TS2367` and `TS2345` in
  `knowledge-universe-space-import.ts`, are now silent because the tab name is a legal member

So the break is unchanged and is no longer visible to the type checker. It is also present on LIVE
`87d46f34ac17`, which has the caller and neither the union member nor the route.

The complete route exists on `27a7163e60` ("Fullscreen spaceImport route, four-channel import page",
2026-07-25, `Agent: cursor-deploy-import-ia-v94`), on `codex/deploy-import-ia-v94` and six sibling
deploy branches. It has never been an ancestor of `main` or of LIVE. Across all 23 commits touching
`home-page-contracts.ts` on `main`, `spaceImport` appears in none.

Why 22 passing tests never caught it: every one of them calls
`renderKnowledgeUniverseSpaceImportPage` directly. The router has no tests at all, so a page can be
fully covered and completely unreachable at the same time.

## 4. Drift three: the rejected proposal is back, as uncommitted working-tree state

Section 4 of the b3/b4 document found the replay blobs byte-identical to PR #84
(`kiro-web-ui/knowledge-workbench-import-ia`, opened 2026-07-23, still open) and concluded it was an
unlanded proposal with an owner, not lost work.

The shared development tree now carries a **third variant** of the same position, uncommitted, in two
files:

| file                                                    | working-tree delta vs `HEAD` |
| ------------------------------------------------------- | ---------------------------- |
| `ui/src/ui/views/knowledge-universe-space-import.ts`    | +13 / -3                     |
| `ui/src/ui/controllers/knowledge-universe-workspace.ts` | +1 / -21                     |

It is not a copy of #84. Against #84's blob for the view file it is +8 / -37. Both agree on the
substance:

| symbol                      | PR #84 | shared-tree WIP | `main` |
| --------------------------- | ------ | --------------- | ------ |
| `renderVaultSyncImportForm` | 0      | 0               | 3      |
| `FolderSyncMethod`          | 0      | 0               | 7      |
| `renderFolderSyncPanel`     | 0      | 0               | 2      |
| `resolveFolderSyncMethod`   | 0      | 0               | 2      |

The WIP also deletes the `vaultSync` branch from
`setKnowledgeUniverseLibraryWorkspaceImportKind`, with the comment:

> vaultSync kind retained for internal/future entry wiring only, not a product 录入知识 tab.
> Import IA no longer surfaces Vault under 本地文件夹 (方案 A superseded 2026-07-23).

And it rewrites `openPersonalSpaceImportEntry` to call `surface.onEnsurePersonalSpaceForImport()`,
set the tab to `spaceImport`, and open the import page. Those are the three things `main`'s regression
test at `knowledge-universe-space-import.node.test.ts:378` forbids by name. Committing the WIP as-is
would fail that test.

Attribution status: `bun scripts/agent-attribution.ts` reports both files **UNATTRIBUTED**. No task
claims them, so there is no owner to coordinate with through the registry. The only remote copy of
this WIP is the backup branch `backup/worktree-snapshot-20260728-1322`
(commit `24d823865235`), pushed as a working-tree snapshot; it is recoverable from there and is not
at risk.

## 5. The two questions, and where each position stands

| question                                                               | `main` as landed                                                           | PR #84 and the shared-tree WIP                                 | PR #141                                                      |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| Is Vault surfaced under the 本地文件夹 tab, with the 同步方式 selector | yes, all four symbols present, test asserts three methods render           | no, selector and Vault form removed                            | follows `main`, all four symbols unchanged                   |
| 录入知识 with no private space                                         | route to `libraryCreate`, never auto-materialize, asserted by a named test | call `onEnsurePersonalSpaceForImport`, land on the import page | does not touch this path                                     |
| The five retired channels in `SpaceImportKind`                         | 10 members since `d00bb132b7`, 5 before it                                 | not addressed                                                  | back to 5, with the switch arms and renderer modules deleted |
| The `spaceImport` router case                                          | tab member present, route absent                                           | not addressed                                                  | route restored from `27a7163e60`                             |

PR #141 therefore sits on `main`'s side of both open questions and restores the narrowing that the
b3/b4 verdict treated as evidence of `main`'s intent. It does not adjudicate anything new.

## 6. What needs a decision, and from whom

1. **Vault surfacing and 录入知识 auto-materialize.** Already ruled once: take `main`. The proposal has
   now appeared three times (replay, PR #84, shared-tree WIP). Either close #84 and discard the WIP,
   or reopen the ruling deliberately. Leaving it as uncommitted state in a shared tree means it will
   keep resurfacing and will conflict with anything that touches those two files. Owner: whoever owns
   PR #84 (`kiro-web-ui`) plus the operator.

2. **The re-widened union.** `cursor-main-recovery` widened it to clear tsgo; PR #141 narrows it
   again. Both cannot hold. If the five channels are retired, the narrowing is correct and the tsgo
   errors should have been cleared by deleting the switch arms, which is what #141 does. Owner:
   `cursor-main-recovery` plus the operator.

3. **The missing router case.** Not a design question. Six live entry points navigate to a tab the
   router does not handle, on both `main` and LIVE, and the type checker no longer says so. PR #141
   carries the fix plus the first test that goes through the router rather than around it.

## 7. Verification commands

```
# drift one
git show d00bb132b7:ui/src/ui/ports/employee/views/home-page-contracts.ts | grep -A11 'SpaceImportKind ='

# drift two
git show origin/main:ui/src/ui/views/knowledge-universe-page.ts | grep -c 'case "spaceImport"'   # 0
git grep -n '"spaceImport"' origin/main -- ui/src | grep -v '\.test\.'                            # only openSpaceImportEntry
git merge-base --is-ancestor 27a7163e60 origin/main; echo $?                                      # 1

# drift three
git diff -- ui/src/ui/views/knowledge-universe-space-import.ts
git diff -- ui/src/ui/controllers/knowledge-universe-workspace.ts
bun scripts/agent-attribution.ts | grep -E 'knowledge-universe-workspace|knowledge-universe-space-import\.ts'
```
