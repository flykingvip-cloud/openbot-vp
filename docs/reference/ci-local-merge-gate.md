# Local CI merge gate

When GitHub-hosted Actions cannot run (private-repo **included minutes exhausted**,
spending limit = 0, or jobs finish with `runner_id=0` / empty steps), use this
**local substitute** for parts of `.github/workflows/ci-gate.yml` before merging to
`main`.

Confirmed outage pattern:

- 2026-08: Actions minutes 3,000/3,000 used → hosted jobs never start
  (historical track: `gmood2008/openbot#289`; that issue may be unreachable from
  the current GitHub App grant on `flykingvip-cloud/openbot-vp`).
- 2026-10-31 audit (batch A): same empty-steps / `runner_id=0` / log 404 pattern on
  current `ubuntu-24.04` gates; Dependabot still succeeded on a separate billing path.
  See `docs/notes/infrastructure-audit-2026-10-31.md`.

Remote CI remaining red in that state is **not** a PR-local regression signal.
Do **not** treat a blocked or partial local run as a remote green, and do **not**
skip absolute checks to invent a PASS.

## What this covers (partial)

`./scripts/ci-local-merge-gate.sh` runs a **subset** of the merge bar:

- fresh `git fetch origin main` (**fail closed** on fetch failure)
- candidate must contain the chosen base (`merge-base --is-ancestor`)
- diagnostic-delta unit tests + knowledge universe page-tab check
- optional absolute: `check:host-env-policy:swift` + `format:check`
- `ci-diagnostic-delta` vs base/candidate
- delivery unit tests + `delivery:ledger:audit`

It is **not** a full equivalent of CI Gate. Examples of remote/local gaps:

- S01 / collab red-line and other gate steps added after this script
- full hosted job environment (Node/pnpm/Bun matrix as Actions sets them)
- ruleset required-check context names and merge-queue behavior

Status language: use `passed` only when the script exits 0; use `blocked` when fetch
or ancestry fails (exit 3); use `partial` if you intentionally pass `--skip-absolute`
(and say so in the PR comment). Never report `passed` on a blocked run.

## Required local checks (merge bar)

From a tip that you intend to merge:

```bash
# Partial local substitute for ci-gate "check" + "delivery guard"
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
# Optional absolute gates (same families as ci-gate; skip only if already green on tip):
# pnpm format:check
# pnpm check:host-env-policy:swift
```

Plus **scoped vitest** for the files you changed (not full `pnpm test`).

Pre-merge PR comment should paste the command outputs (delta = 0 new diagnostics;
relevant tests passed; fetch/ancestry not blocked).

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
