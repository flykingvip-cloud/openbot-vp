# Rollback Plan — src/gateway/collaboration-learning.ts

## Target

- Facade: `src/gateway/collaboration-learning.ts`
- Sub_Modules: `src/gateway/collaboration-learning/*`
- Merge SHA: `<TBD at PR merge>`

## Trigger

This is a pure structural refactor with no behavioral change and no feature flag.
Rollback is only needed if the decomposition introduces:

- Import resolution failures in production (`node --enable-source-maps` load-time errors)
- Type checker regressions that block CI
- Test failures in `src/gateway/server-methods/collaboration-learning.test.ts`

No SLO carve-out — revert window is standard (immediate upon detection).

## Rollback Command

```bash
git revert <merge-sha> --no-edit && git push origin <branch>
```

## Verification After Revert

Re-run the verification matrix from `verification/collaboration-learning.md`:

1. `pnpm exec vitest run --config vitest.gateway.config.ts src/gateway/server-methods/collaboration-learning.test.ts`
2. `pnpm exec vitest run src/gateway/__tests__/public-export-snapshot.test.ts`
3. `pnpm build`
4. `pnpm exec tsx scripts/check-architecture-manifest.ts`
5. `pnpm exec tsx scripts/check-core-composition-root-loc.ts`

All must pass before the revert is considered clean.

## Worktree Dry-Run Confirmation

Run this before the PR lands to confirm `git revert` will produce a clean tree:

```bash
git worktree add /tmp/collaboration-learning-revert-dry-run
pushd /tmp/collaboration-learning-revert-dry-run
git revert --no-commit <merge-sha>
# Inspect tree; if clean, the plan is valid.
git reset --hard && popd
git worktree remove /tmp/collaboration-learning-revert-dry-run
```

## Notes

- The original monolith (`src/gateway/collaboration-learning.ts`, ~3019 LOC) will be
  restored in full by the revert. All sub-module files under
  `src/gateway/collaboration-learning/` will be deleted.
- No database schema, config, or runtime state changes are involved.
