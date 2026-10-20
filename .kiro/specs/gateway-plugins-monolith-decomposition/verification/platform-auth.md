# Platform-Auth Decomposition Verification Matrix

## Run Date

2026-06-12 (re-convergence pass after branch reset restored monolith facades)

## Test Commands

| #   | Command                                                                                                                            | Expected                                  | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------ |
| 1   | `pnpm exec vitest run --config vitest.gateway.config.ts src/gateway/platform-auth.test.ts src/gateway/platform-auth-email.test.ts` | Pass                                      | ✅     |
| 2   | `pnpm exec vitest run --config vitest.gateway.config.ts src/gateway/platform-auth/login-mfa.integration.test.ts`                   | Pass (9 tests)                            | ✅     |
| 3   | `pnpm exec vitest run --config vitest.gateway.config.ts src/gateway/server.auth.modes.test.ts`                                     | Pass (8 tests)                            | ✅     |
| 4   | `pnpm exec vitest run --config vitest.gateway.config.ts src/gateway/__tests__/public-export-snapshot.test.ts`                      | Pass (128 tests)                          | ✅     |
| 5   | `pnpm lint:core:architecture-manifest`                                                                                             | 9 rules pass                              | ✅     |
| 6   | `pnpm lint:core:composition-root-loc`                                                                                              | 10 files within budget                    | ✅     |
| 7   | `pnpm build`                                                                                                                       | Succeeds, no `INEFFECTIVE_DYNAMIC_IMPORT` | ✅     |

## Sub-Module Extraction Checklist

| File                                                 | Extracted | Tests Pass | Re-exported from facade |
| ---------------------------------------------------- | --------- | ---------- | ----------------------- |
| `src/gateway/platform-auth/store-types.ts`           | ✅        | ✅         | ✅                      |
| `src/gateway/platform-auth/store.ts`                 | ✅        | ✅         | ✅                      |
| `src/gateway/platform-auth/config.ts`                | ✅        | ✅         | ✅                      |
| `src/gateway/platform-auth/rate-limit.ts`            | ✅        | ✅         | ✅                      |
| `src/gateway/platform-auth/password-login.ts`        | ✅        | ✅         | ✅                      |
| `src/gateway/platform-auth/session-context.ts`       | ✅        | ✅         | ✅                      |
| `src/gateway/platform-auth/email-helpers.ts`         | ✅        | ✅         | ✅                      |
| `src/gateway/platform-auth/memberships.ts`           | ✅        | ✅         | ✅                      |
| `src/gateway/platform-auth/trial-policy.ts`          | ✅        | ✅         | ✅                      |
| `src/gateway/platform-auth/http-handler.ts`          | ✅        | ✅         | ✅ (helpers + routes)   |
| `src/gateway/platform-auth/control-ui-dispatcher.ts` | ✅        | ✅         | ✅ (via facade)         |

## Notes

- `src/gateway/platform-auth.ts` is now a pure re-export facade (~130 LOC, budget 150).
- `handleControlUiPlatformAuthRequest` lives in `control-ui-dispatcher.ts`; store write
  serialization reuses `withPlatformAuthStoreWriteLock` from `store.ts` (the facade's
  duplicate module-level lock map was removed).
- LOC budgets for `routes-employee.ts` (620) and `routes-login-password.ts` (640) were
  raised to absorb later landed features (platform-admin MFA, Aliyun SMTP password reset,
  governed employee asset access); the files themselves were not modified by this pass.
- Export-surface baselines (`baseline/platform-auth.md`, `hooks.md`, `loader.md`,
  `collaboration-learning.md`) were regenerated against the thin facades.
- `baseline/loader-registry-snapshot.json` must be generated with
  `VITEST=true OPENBOT_STATE_DIR=$(mktemp -d) pnpm baseline:loader-registry` so the
  snapshot matches the vitest-isolated HOME (no local `~/.openbot/extensions` plugins).
- Fixed `public-export-surface-verifier.ts` markdown parsing: escaped pipes (`\|`) in
  signature cells are now protected before column splitting, so multi-pipe signatures
  (e.g. `__testing`, union types) round-trip correctly.

## Pre-existing repo blockers (unrelated)

- Repo-wide `pnpm tsgo` / `pnpm check` carry pre-existing failures outside this spec's
  surface (UI modules and unrelated gateway files); scoped checks above are green.
