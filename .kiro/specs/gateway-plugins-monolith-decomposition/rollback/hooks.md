# Rollback Plan — `src/plugins/hooks.ts` Decomposition

Spec: gateway-plugins-monolith-decomposition
Target_Module: `src/plugins/hooks.ts`
Landing PR: <PR number, TBD at merge time>
Merge SHA: <to be filled in at merge time — placeholder>

## Trigger conditions

A revert is justified when:

- Hook firing semantics regress (a `wired-hooks-*` test starts failing post-merge).
- The public-export surface verifier (`src/plugins/__tests__/public-export-snapshot.test.ts`) fails on the post-merge tree.
- Hook firing trace replay (`src/plugins/__tests__/hook-firing-trace.test.ts`) starts producing mismatches.
- A regression report from a downstream extension fails to import a previously-stable hook name.

## Revert command

```bash
git revert <merge-sha> --no-edit
git push origin <branch>
```

This is a pure structural refactor — no feature flag toggle is needed (Req 8.2). The revert restores the pre-refactor monolith `src/plugins/hooks.ts`, removes the `src/plugins/hooks/**` sub-modules, and drops the corresponding architecture-manifest rules and LOC budget entry in a single commit.

## No feature flag

There is no feature flag for this refactor. Hook semantics are preserved verbatim by the post-refactor code (verified by Tasks 2.7's hook firing trace property test), so a runtime toggle would be ineffective for hiding a regression — any regression would be hard-coded in the new sub-modules' implementation.

## Expected runtime impact during rollback

- No data migration needed.
- No on-disk state changes.
- The `globalThis` hook runner singleton (in `hook-runner-global.ts`) continues to work; its `import { createHookRunner } from "./hooks.js"` resolves to whichever `hooks.ts` is on the tree (facade or pre-refactor monolith).
- Plugins on disk are NOT affected — the plugin SDK alias machinery is untouched by this split.
- Estimated rollback duration: minutes (single revert commit + redeploy via the same channel as the original).

## Verification steps after rollback

Re-run the hooks Verification Matrix (Task 2.8 commands):

1. `pnpm exec vitest run src/plugins/hooks.before-agent-start.test.ts src/plugins/hooks.model-override-wiring.test.ts src/plugins/hooks.phase-hooks.test.ts`
2. `pnpm exec vitest run "src/plugins/wired-hooks-*.test.ts"`
3. `pnpm exec vitest run src/plugins/wired-hooks-after-tool-call.e2e.test.ts`
4. `pnpm lint:core:architecture-manifest` (the new rules are gone, but existing rules must still pass)
5. `pnpm lint:core:composition-root-loc` (the new entry is gone, but existing entries must still pass)
6. `pnpm exec vitest run src/plugins/__tests__/public-export-snapshot.test.ts` — verifier still works against any remaining snapshots; the `baseline/hooks.md` snapshot is now back-compatible with the pre-refactor monolith (since the public surface was preserved across the split).

## Multi-commit revert behavior

Tasks 2.2 + 2.3 + 2.4 landed together as a single coherent refactor commit. The architecture-manifest rules (2.5) and LOC budget entry (2.6) are separate commits but small; their revert is also automatic via `git revert <sha>` per commit.

If the split was squashed into one commit, a single `git revert` cleanly restores the pre-refactor tree (Req 8.5).

## Worktree dry-run

Before relying on this plan, run a dry-run revert in a scratch worktree to confirm the revert produces a clean tree:

```bash
git worktree add ../openclaw-revert-dry-run main
cd ../openclaw-revert-dry-run
git revert <hooks-merge-sha> --no-edit
git status   # should show clean tree, working copy = pre-refactor state
pnpm install --frozen-lockfile
pnpm exec vitest run "src/plugins/wired-hooks-*.test.ts"   # should pass
git worktree remove --force ../openclaw-revert-dry-run
```

The dry-run is a SHOULD-do for the on-call rotation before this rollback plan is treated as live.
