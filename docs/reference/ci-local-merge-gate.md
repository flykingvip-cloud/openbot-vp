# Local CI merge gate

When GitHub-hosted Actions cannot run (private-repo **included minutes exhausted**,
spending limit = 0, or jobs finish with `runner_id=0` / empty steps), use this
**local substitute** for `.github/workflows/ci-gate.yml` before merging to `main`.

Confirmed outage pattern (2026-08): Actions minutes 3,000/3,000 used → hosted jobs
never start. Track: <https://github.com/gmood2008/openbot/issues/289>

Remote CI remaining red in that state is **not** a PR-local regression signal.

## Required local checks (merge bar)

From a clean tip that contains freshly fetched `origin/main`:

```bash
# Equivalent of ci-gate "check" + "delivery guard"
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
# Optional absolute gates (same as ci-gate; skip only if already green on tip):
# pnpm format:check
# pnpm check:host-env-policy:swift
```

Plus **scoped vitest** for the files you changed (not full `pnpm test`).

Pre-merge PR comment should paste the command outputs (delta = 0 new diagnostics;
relevant tests passed). See port WIP landing on 2026-08-07 for the pattern.

## Optional: self-hosted runner

If you want Actions green again without buying minutes:

1. GitHub → repo **Settings → Actions → Runners → New self-hosted runner**
2. Install on a trusted always-on host (macOS/Linux); register with the repo token
3. Labels: keep default `self-hosted` (+ `macOS`/`Linux` as appropriate)
4. Only then change `ci-gate.yml` `runs-on` to include `self-hosted` (or a dedicated
   label). **Do not** switch `runs-on` until a runner is online — otherwise jobs
   queue forever (same failure mode as unused Blacksmith labels).

Heavy `ci.yml` matrix stays out of scope until a runner provider is actually connected.

## What this does **not** replace

- Production cutover gates (`verify-forward-only`, LIVE `build-info.json`, smoke)
- Required human review / trunk rulesets (`require-pr-on-trunk`)
- Full platform test matrix (Windows / iOS / Android / Docker)
