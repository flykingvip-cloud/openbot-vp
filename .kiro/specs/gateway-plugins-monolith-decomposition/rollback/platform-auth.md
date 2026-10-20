# Rollback Plan: platform-auth.ts Facade Decomposition

## Scope

This plan covers the decomposition of `src/gateway/platform-auth.ts` into a
facade module (`platform-auth.ts`) + sub-modules under
`src/gateway/platform-auth/`.

## Rollback Signal

- **SRE alert**: `login_5xx_rate` > 1% over rolling 5-minute window
- **Smoke-test failure**: Control UI login / session refresh returns 5xx or
  unexpected 4xx after deployment
- **Type-check or lint regression** caught in CI after merge

## Rollback Procedure (30-minute SLO)

1. **Halt pipeline** (0 min)
   - If deploy is still in progress: abort the active deployment.
   - If deploy has completed: proceed to step 2.

2. **Identify last known good commit** (5 min)
   - Use the commit immediately before the facade decomposition merge.
   - Tag: `platform-auth-pre-facade` (already annotated at merge time).

3. **Revert merge commit** (10 min)
   - `git revert -m 1 <merge-commit-sha>`
   - Resolve conflicts by accepting the pre-deletion version of
     `src/gateway/platform-auth.ts` and deleting the
     `src/gateway/platform-auth/` directory.

4. **Verify revert** (10 min)
   - `pnpm check:core:architecture-manifest` — confirm no platform-auth rules
     remain (they were added in 5.15 and will be reverted with the merge).
   - `pnpm check:core:composition-root-loc` — confirm the old monolith line
     count is within the pre-existing budget (no budget entry existed before).
   - `pnpm exec vitest run --config vitest.gateway.config.ts src/gateway/platform-auth*.test.ts`
   - Quick manual smoke: login flow in Control UI against staging.

5. **Communicate** (5 min)
   - Post in `#incidents` with:
     - Signal observed
     - Revert commit SHA
     - Link to this rollback plan

## Pre-revert Checklist

- [ ] `platform-auth-pre-facade` tag exists on the last good commit before merge.
- [ ] No other dependent PRs have merged on top of the decomposition commit.
- [ ] Staging environment is available for smoke test.

## Post-revert Follow-up

- Re-open the decomposition spec issue.
- Root-cause the failure before attempting re-land.
- Update `verification/platform-auth.md` with the failure mode.
