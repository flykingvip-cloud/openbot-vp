# Local substitute CI coverage — 2026-11-16

GitHub Actions for this repository is currently unavailable because of
account billing / spending limits. The commands below were run on a Linux
auditor box (Ubuntu, `Asia/Shanghai`). This is **not** a full-CI-equivalent
pass. Jobs that were not run are listed as **not run**, never as green.

## `.github/workflows/ci-gate.yml`

| Job | Runner in workflow | Local substitute (this review) |
| --- | --- | --- |
| `check` (types, lint, format) | `ubuntu-24.04` | **Partial.** Format was checked only on files this PR adds or edits, not `pnpm format:check` of the whole tree (origin/main already has a large inherited format failure; this PR does not do a 152-file cleanup). Diagnostic-delta, host-env-policy, Knowledge Universe tabs, S01 R6, and collaboration red-line jobs were **not** re-run here; they are unchanged by this PR's delivery-docs/tests scope except where delivery unit tests are covered below. |
| `delivery-guard` — `pnpm vitest run scripts/delivery` | `ubuntu-24.04` | **Run** on this branch after the C1 test fix. Result recorded in the evidence directory and the PR. This is the step that was failing on `origin/main` because of the seq 151 pin. |
| `delivery-guard` — `pnpm delivery:ledger:audit` | `ubuntu-24.04` | **Run.** Still exits 30 (163 releases, missing-object errors, warnings). Inherited; not cleared; guard not weakened. |
| `delivery-guard` — `pnpm delivery:release-record:check` | `ubuntu-24.04` | **Run.** Still exits 20 (generated block seq 154 vs ledger tip 165). Inherited; not cleared by applying the C3 proposal. |

## `.github/workflows/ci.yml` and related workflows — not run

| Job / workflow | Runner in workflow | Local substitute |
| --- | --- | --- |
| `checks` / Node test matrix (`ci.yml`) | `ubuntu-24.04` | **Not run** (out of scope for this delivery-guard debt review). |
| `checks-windows` | `windows-2025` | **Not run.** Must not be reported as passed. |
| `macos` | `macos-latest` | **Not run.** Must not be reported as passed. |
| `ios` | `macos-latest` | **Not run.** Must not be reported as passed. |
| Android-scoped jobs (`run_android`) | per `ci.yml` changed-scope | **Not run.** Must not be reported as passed. |
| `cogniweave-sdk-core-gate` | `ubuntu-24.04` | **Not run.** Must not be reported as passed. |
| `cogniweave-sdk-integration-rollback` | `ubuntu-24.04` | **Not run.** Must not be reported as passed. |
| `.github/workflows/install-smoke.yml` | `ubuntu-24.04` | **Not run.** Must not be reported as passed. |
| docker-release, canary, CodeQL, CogniWeave nightly, sandbox-common-smoke, other workflows | various | **Not run.** |

Passing `pnpm vitest run scripts/delivery` on Linux is evidence only for that
job slice. It is not production-release evidence and not a substitute for the
full required CI matrix once Actions billing is restored.
