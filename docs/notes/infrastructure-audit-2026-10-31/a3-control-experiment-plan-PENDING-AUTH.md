# Batch A3 — minimal control experiment (PENDING AUTH) — 2026-10-31

**Status: prepared, not authorized, not executed.**

Goal: see whether a trivial GitHub-hosted job obtains a runner (`runner_id≠0`, non-empty steps, downloadable logs).
**A3 alone cannot close H1 (minutes exhaustion).** H1 still needs org Billing UI export/screenshot or an annotation that explicitly states billing/minutes block.

## Defaults / registration

| Item | Value |
|---|---|
| Workflow file (proposed) | `.github/workflows/audit-a3-runner-probe.yml` on branch only |
| Trigger | `workflow_dispatch` only (no `push`/`pull_request`) |
| Branch to register dispatch | GitHub requires the workflow file to exist on the branch selected in the Actions UI **or** on default branch to appear in the dropdown. Prefer: merge workflow to default **only if owner insists**; otherwise run dispatch via `gh workflow run audit-a3-runner-probe.yml --ref <branch>` after the file exists on that ref |
| Exact ref SHA | Pin dispatch to the commit that adds the workflow: record full SHA before run; never “latest main” loosely |
| `runs-on` | `ubuntu-latest` |
| Job body Exp-1 | single step `run: echo ok && uname -a && date -u` |
| Permissions | `contents: read` |

## Cost ceiling

- Max **2** `workflow_dispatch` attempts (Exp-1, optional Exp-2).
- Job `timeout-minutes: 5`.
- Stop if first run sits `queued`/`pending` with `runner_id=0` / empty steps for **10 minutes** wall clock — capture JSON and stop (do not retry-spam).
- No matrix, no reusable workflows, no services, no cache warming.

## Stop conditions

1. Exp-1 reaches `success` with `runner_id≠0` and log downloadable → stop; report “runner obtainable”; H1 still open.
2. Exp-1 terminal `startup_failure` / failure with `steps=[]` / `runner_id=0` / log 404 → stop; report Batch A class reproduced; H1 still **待验证**.
3. Any unexpected write to `main`, ruleset, billing, or production host → abort immediately.

## Exp-2 (only if Exp-1 got a runner)

- Same workflow job + `actions/checkout@v4` with `fetch-depth: 1`.
- Distinguishes “have runner” vs “clone/network fail”.

## Evidence retention

- Save under `docs/notes/infrastructure-audit-2026-10-31/a3-evidence/<run_id>/`:
  - `run.json` (`gh api repos/.../actions/runs/<id>`)
  - `jobs.json` (jobs+steps)
  - `attempt-log.txt` or note of log 404
  - `dispatch-ref.txt` (full SHA + workflow file SHA256)
- Do not delete the workflow file until owner confirms; then remove in a follow-up PR.

## Non-goals

- Not a minutes counter; not Billing API substitute.
- No ruleset/spending/runner-group changes; no DIGEST; no LIVE mutate.
