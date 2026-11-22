# Local CI merge gate

When GitHub-hosted Actions jobs **do not obtain a runner** (observed pattern:
`runner_id=0`, empty `steps`, job log HTTP 404), use this **local substitute** for
_parts_ of `.github/workflows/ci-gate.yml`
before merging to `main`.

## Observed pattern vs root cause

**Observed (batch A, 2026-10-31):** hosted gate jobs finish in a few seconds with
`runner_id=0`, empty steps, and missing logs. Dependabot still succeeded on a
separate path. Runs that never assigned a runner and never executed checks do **not**
provide PR-local code-regression evidence.

**Not proven without Billing page, explicit run annotations, or a controlled
experiment:** included-minutes exhaustion, spending-limit = 0, org policy denial,
or Actions service faults. Prefer checking Billing / Actions usage next, but do not
treat the empty-steps pattern alone as a confirmed billing root cause, and do not
use this document as an automatic CI exemption.

Historical track for a similar outage: `gmood2008/openbot#289` (may be unreachable
from the current GitHub App grant on `flykingvip-cloud/openbot-vp`).

## What this covers (partial)

`./scripts/ci-local-merge-gate.sh` runs a **subset** of the merge bar:

- fresh `git fetch origin main` (**fail closed** on fetch failure)
- **always** require freshly fetched `origin/main` ∈ ancestors of candidate
  (trunk constraint; cannot be bypassed by passing an older `--base`)
- chosen `--base` must also be an ancestor of candidate (diagnostic comparison base)
- report `checkout` SHA; if `HEAD != candidate` or the worktree is dirty → at best
  `partial` (absolute/format/tests still execute against the current checkout tree)
- diagnostic-delta unit tests + knowledge universe page-tab check
- optional absolute: `check:host-env-policy:swift` + `format:check`
- `ci-diagnostic-delta` vs base/candidate
- delivery unit tests + `delivery:ledger:audit`

It is **not** a full equivalent of CI Gate (S01 / collab red-line and other remote
steps may be absent; hosted toolchains differ).

### Machine-readable results

| `result=` | exit | meaning                                                                                                                          |
| --------- | ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| `blocked` | 3    | fetch failed, or fresh `origin/main` / chosen base not ancestor of candidate                                                     |
| `partial` | 0    | subset finished but absolute gates skipped and/or checkout≠candidate / dirty tree — **not** a merge-gate PASS                    |
| `passed`  | 0    | subset finished with absolute gates run, clean checkout matching candidate, fresh main ancestry OK — still not “remote CI green” |

Never report `passed` on a blocked or partial run.

## Required local checks (merge bar)

```bash
./scripts/ci-local-merge-gate.sh --base origin/main --candidate HEAD
```

Or step-by-step:

```bash
git fetch origin main
node scripts/ci-diagnostic-delta.mjs --base origin/main --candidate HEAD
OPENBOT_TEST_PROFILE=low pnpm vitest run \
  scripts/ci-diagnostic-delta.test.ts \
  scripts/check-knowledge-universe-page-tabs.test.ts \
  scripts/delivery
pnpm delivery:ledger:audit
# Optional absolute gates (skip only via --skip-absolute → result=partial):
# pnpm format:check
# pnpm check:host-env-policy:swift
```

Plus **scoped vitest** for the files you changed (not full `pnpm test`).

Pre-merge PR comment should paste outputs (`result=passed` or an explained
`result=partial` / `result=blocked`; delta = 0 new diagnostics).

Regression coverage: `pnpm vitest run scripts/ci-local-merge-gate.test.ts`.

## Optional: self-hosted runner

If you want Actions green again without buying minutes:

1. GitHub → repo **Settings → Actions → Runners → New self-hosted runner**
2. Install on a trusted always-on host (macOS/Linux); register with the repo token
3. Labels: keep default `self-hosted` (+ `macOS`/`Linux` as appropriate)
4. Only then change `ci-gate.yml` `runs-on` to include `self-hosted` (or a dedicated
   label). **Do not** switch `runs-on` until a runner is online — otherwise jobs
   queue forever (same failure mode as unused Blacksmith labels historically).

Heavy `ci.yml` matrix stays out of scope until a runner provider is actually connected.
As of 2026-10-31, `ci.yml` on `main` already uses GitHub-hosted `ubuntu-24.04` /
`windows-2025` / `macos-latest` labels for its jobs — do not assume Blacksmith is
still required for those workflows without re-checking the file.

## What this does **not** replace

- Production cutover gates (`verify-forward-only`, LIVE `build-info.json`, smoke)
- Required human review / trunk rulesets (`require-pr-on-trunk`)
- Full platform test matrix (Windows / iOS / Android / Docker)
- Restoring billed GitHub-hosted minutes / spending limits (owner Billing action)
