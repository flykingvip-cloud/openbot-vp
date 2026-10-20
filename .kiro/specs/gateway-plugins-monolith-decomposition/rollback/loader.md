# Rollback Plan — `src/plugins/loader.ts` Decomposition

Spec: gateway-plugins-monolith-decomposition
Target_Module: `src/plugins/loader.ts`
Landing PR: <PR number, TBD at merge time>
Merge SHA: <to be filled in at merge time — placeholder>

## Trigger conditions

A revert is justified when:

- Plugin loading semantics regress (`loader.test.ts` or `installs.test.ts` starts failing post-merge).
- The public-export surface verifier (`src/plugins/__tests__/public-export-snapshot.test.ts`) fails on the post-merge tree.
- Plugin registry round-trip (`src/plugins/__tests__/loader-registry-roundtrip.test.ts`) starts producing mismatches.
- A regression report from a downstream extension fails to import a previously-stable loader name.

## Revert command

```bash
git revert <merge-sha> --no-edit
git push origin <branch>
```

This is a pure structural refactor — no feature flag toggle is needed (Req 8.2). The revert restores the pre-refactor monolith `src/plugins/loader.ts`, removes the `src/plugins/loader/**` sub-modules, and drops the corresponding architecture-manifest rules and LOC budget entry in a single commit.

## No feature flag

There is no feature flag for this refactor. Loader semantics are preserved verbatim by the post-refactor code (verified by Task 3.9's loader registry round-trip property test), so a runtime toggle would be ineffective for hiding a regression — any regression would be hard-coded in the new sub-modules' implementation.

## Expected runtime impact during rollback

- No data migration needed.
- No on-disk state changes.
- The `globalThis` hook runner singleton (in `hook-runner-global.ts`) continues to work; its `initializeGlobalHookRunner` call from `load-orchestration.ts` resolves to whichever loader is on the tree.
- Plugins on disk are NOT affected — the plugin SDK alias machinery is untouched by this split.
- Estimated rollback duration: minutes (single revert commit + redeploy via the same channel as the original).

## Verification steps after rollback

Re-run the loader Verification Matrix (Task 3.10 commands):

1. `pnpm exec vitest run src/plugins/loader.test.ts src/plugins/installs.test.ts`
2. `pnpm exec vitest run "src/plugins/wired-hooks-*.test.ts"`
3. `pnpm build 2>&1 | grep -F '[INEFFECTIVE_DYNAMIC_IMPORT]' && exit 1 || exit 0`
4. `pnpm exec vitest run src/plugins/__tests__/loader-registry-roundtrip.test.ts`
5. `pnpm lint:core:architecture-manifest` (the new rules are gone, but existing rules must still pass)
6. `pnpm lint:core:composition-root-loc` (the new entry is gone, but existing entries must still pass)
7. `pnpm exec vitest run src/plugins/__tests__/public-export-snapshot.test.ts` — verifier still works against any remaining snapshots; the `baseline/loader.md` snapshot is now back-compatible with the pre-refactor monolith (since the public surface was preserved across the split).

## Multi-commit revert behavior

Tasks 3.2 + 3.3 + 3.4 + 3.5 landed together as a single coherent refactor commit. The facade conversion (3.6), architecture-manifest rules (3.7), LOC budget entry (3.8), and property test (3.9) are separate commits but small; their revert is also automatic via `git revert <sha>` per commit.

If the split was squashed into one commit, a single `git revert` cleanly restores the pre-refactor tree (Req 8.5).

## Worktree dry-run

Before relying on this plan, run a dry-run revert in a scratch worktree to confirm the revert produces a clean tree:

```bash
git worktree add ../openclaw-revert-dry-run main
cd ../openclaw-revert-dry-run
git revert <loader-merge-sha> --no-edit
git status   # should show clean tree, working copy = pre-refactor state
pnpm install --frozen-lockfile
pnpm exec vitest run src/plugins/loader.test.ts src/plugins/installs.test.ts   # should pass
git worktree remove --force ../openclaw-revert-dry-run
```

The dry-run is a SHOULD-do for the on-call rotation before this rollback plan is treated as live.
