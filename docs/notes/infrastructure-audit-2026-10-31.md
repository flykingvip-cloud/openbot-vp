# Infrastructure audit task view (2026-10-31)

- Task: `infrastructure-audit:infra-audit`
- Owner: `infra-audit` (agent 基础设施审计)
- Session: `844CDD06-136B-4F1A-BF56-7B671063A923` (ide=cursor)
- Codex = independent acceptance; this agent does not declare PASS
- Scope: batches A→E per owner brief; no DIGEST/deploy/ruleset/billing/runner changes without explicit auth

## Repo / checkout baseline (recorded Asia/Shanghai 2026-10-31 ~18:40)

| Item | Value |
|---|---|
| remote | `git@github.com-flykingvip:flykingvip-cloud/openbot-vp.git` |
| shared checkout path | `/Users/daniel/AI VP/openbot` |
| current branch | `fix/deliverable-open-chip-survive-sanitize` (#169 WIP — **not** audit isolation) |
| HEAD | `a9e7bd2b8096bdb57d501fd497863ace904764ee` |
| freshly fetched `origin/main` | `53e11c997463abf68c4b889bc6f94c23f48b9c4e` |
| relation | `origin/main` is ancestor of HEAD; HEAD is **12 commits ahead** of main (foreign WIP) |
| untracked (foreign — do not touch) | `Dockerfile.bak`, `handoffs/`, `vendor-docker-cli/` |
| Node | v22.18.0 |
| pnpm | 10.23.0 |
| Bun | 1.2.21 (CI setup targets 1.3.9 — delta noted) |
| OS | macOS 26.5.2 arm64 |
| lockfile | `pnpm-lock.yaml` present |
| Data volume | ~99% used, ~14GiB avail (risk clue only; no cleanup) |

## Path ownership (this task)

Claimed for landing attribution:

- `docs/notes/infrastructure-audit-2026-10-31.md`
- `docs/notes/infrastructure-audit-2026-10-31/**`

**Not yet claimed** (active/landed owners elsewhere; Batch B needs takeover or coordination before edit):

- `.github/workflows/ci-gate.yml` — landed task `cursor-s01-r6-replay-v2`
- `scripts/ci-local-merge-gate.sh` / related under `scripts/**` — active `pi-sdk-family-migration-v3:cursor`

## Batch A status

Evidence package on bot box: `/workspace/infrastructure-audit/batch-a/` (REPORT + raw JSON). Root-cause class: hosted jobs fail without runner (`steps=[]`, `runner_id=0`, log 404). Billing minutes exhaustion remains **待验证假设**.

## Isolation note

Human-authorized 2026-10-31: agent created worktree
`/Users/daniel/AI VP/openbot-infrastructure-audit` from freshly fetched `origin/main`
(`0e4d269615e26909bbac606f1dfb755b3511400c`) on branch `audit/infra-batch-b-local-gate`.
Shared checkout `#169` was left untouched.

## Batch B (this PR)

- `scripts/ci-local-merge-gate.sh`: `git fetch origin main` fail-closed; require base∈candidate ancestry; emit `result=blocked` on exit 3.
- `docs/reference/ci-local-merge-gate.md`: drop false "Equivalent" claim; document partial coverage + blocked/partial/passed language; refresh outage notes.
- `.github/workflows/ci-gate.yml`: refresh header comments (current `ci.yml` is GitHub-hosted; keep minutes-exhaustion guidance).
- Evidence notes under `docs/notes/infrastructure-audit-2026-10-31*`.

Codex = independent acceptance; this agent does not declare PASS.
